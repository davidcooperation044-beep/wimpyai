"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type KeyboardEvent, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Sparkles, Plus, Moon, SunMedium, SendHorizontal, ShieldCheck, UserCircle2, Mic2 } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { buildWimpyIDLoginUrl, buildWimpyPayUrl, bootstrapWimpyIDSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type MessageRole = 'assistant' | 'user' | 'system';

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  image?: string;
  imageUrl?: string;
  images?: string[];
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};

type ProfileState = {
  isConnected: boolean;
  userId: string | null;
  displayName: string;
  avatarInitials: string;
  plan: 'Free' | 'Pro';
  subscriptionStatus: 'active' | 'inactive';
  lastLogin: string | null;
};

type SettingsState = {
  darkMode: boolean;
  reduceMotion: boolean;
  autoSave: boolean;
  soundEffects: boolean;
  compactMode: boolean;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const initialConversation: Conversation = {
  id: 'conv-1',
  title: 'Welcome',
  messages: [
    {
      id: 'm1',
      role: 'assistant',
      content: 'I\'m WIMPY, built by Wimpy Cooperations. I can help with chat, coding, math, images, and more.',
    },
  ],
};

const emptyProfile: ProfileState = {
  isConnected: false,
  userId: null,
  displayName: 'Guest',
  avatarInitials: 'G',
  plan: 'Free',
  subscriptionStatus: 'inactive',
  lastLogin: null,
};

const emptySettings: SettingsState = {
  darkMode: false,
  reduceMotion: false,
  autoSave: true,
  soundEffects: true,
  compactMode: false,
};

function copyText(text: string) {
  navigator.clipboard.writeText(text);
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    if (!saved) return fallback;
    return JSON.parse(saved) as T;
  } catch (error) {
    return fallback;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function HomePage() {
  const [mode, setMode] = useState<'Serious' | 'Wimpy'>('Serious');
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    if (typeof window === 'undefined') return [initialConversation];
    try {
      const saved = window.localStorage.getItem('wimpyai-conversations-v1');
      if (saved) {
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed) && parsed.length) {
          const typed = parsed.filter((entry): entry is Conversation => {
            if (typeof entry !== 'object' || entry === null) return false;
            const candidate = entry as Partial<Conversation>;
            return typeof candidate.id === 'string' && typeof candidate.title === 'string' && Array.isArray(candidate.messages);
          });
          if (typed.length === parsed.length) return typed;
        }
      }
    } catch {
      // ignore invalid cache
    }
    return [initialConversation];
  });
  const [activeConversationId, setActiveConversationId] = useState(initialConversation.id);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; type: string; src: string }>>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSupported, setRecordingSupported] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [offline, setOffline] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [profile, setProfile] = useState<ProfileState>(() => loadJson<ProfileState>('wimpyai-profile-v1', emptyProfile));
  const [settings, setSettings] = useState<SettingsState>(() => loadJson<SettingsState>('wimpyai-settings-v1', emptySettings));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false);
  const [actionSheetMessageId, setActionSheetMessageId] = useState<string | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(() => {
    if (typeof window === 'undefined') return false;
    const dismissed = window.localStorage.getItem('wimpyai-auth-dismissed-v1');
    const savedProfile = loadJson<ProfileState>('wimpyai-profile-v1', emptyProfile);
    return !dismissed && !savedProfile.isConnected;
  });

  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? conversations[0],
    [conversations, activeConversationId]
  );

  const isBusy = isStreaming || isRecording;
  const pendingAssistantMessage = activeConversation?.messages[activeConversation.messages.length - 1];

  const scrollToBottom = useCallback(() => {
    if (!chatContainerRef.current) return;
    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    handleOnline();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const viewport = window.visualViewport;

    const updateViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      setViewportHeight(height);
      setKeyboardOffset(viewport ? Math.max(0, window.innerHeight - viewport.height) : 0);
      if (draft.length || isBusy) {
        scrollToBottom();
      }
    };

    const resetViewport = () => {
      setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setKeyboardOffset(0);
      if (draft.length || isBusy) {
        scrollToBottom();
      }
    };

    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    window.addEventListener('focusout', resetViewport);

    updateViewport();

    return () => {
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      window.removeEventListener('focusout', resetViewport);
    };
  }, [draft.length, isBusy, scrollToBottom]);

  useLayoutEffect(() => {
    if (!chatContainerRef.current) return;
    scrollToBottom();
  }, [conversations, scrollToBottom]);

  useEffect(() => {
    const handler = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      if (typeof installEvent.prompt === 'function') {
        event.preventDefault();
        setInstallPromptEvent(installEvent);
      }
    };
    window.addEventListener('beforeinstallprompt', handler as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', handler as EventListener);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && profile.isConnected) {
        window.dispatchEvent(new Event('wimpy-profile-sync'));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [profile.isConnected]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('wimpyai-conversations-v1', JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('wimpyai-profile-v1', JSON.stringify(profile));
    window.dispatchEvent(new Event('wimpy-profile-sync'));
  }, [profile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('wimpyai-settings-v1', JSON.stringify(settings));
    window.dispatchEvent(new Event('wimpy-settings-sync'));
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleProfileSync = () => {
      const next = loadJson<ProfileState>('wimpyai-profile-v1', emptyProfile);
      setProfile(next);
    };
    const handleSettingsSync = () => {
      const next = loadJson<SettingsState>('wimpyai-settings-v1', emptySettings);
      setSettings(next);
    };
    window.addEventListener('wimpy-profile-sync', handleProfileSync);
    window.addEventListener('wimpy-settings-sync', handleSettingsSync);
    const storageListener = (event: StorageEvent) => {
      if (event.key === 'wimpyai-profile-v1') handleProfileSync();
      if (event.key === 'wimpyai-settings-v1') handleSettingsSync();
    };
    window.addEventListener('storage', storageListener);

    async function initializeAuth() {
      const authResult = await bootstrapWimpyIDSession();
      if (authResult) {
        setProfile((prev) => ({
          ...prev,
          isConnected: true,
          userId: authResult.wimpyId,
          displayName: authResult.displayName,
          avatarInitials: authResult.displayName
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0].toUpperCase())
            .join('') || 'W',
          plan: authResult.plan === 'Pro' ? 'Pro' : 'Free',
          subscriptionStatus: authResult.plan === 'Pro' ? 'active' : prev.subscriptionStatus,
          lastLogin: new Date().toISOString(),
        }));
        setShowAuthModal(false);
        window.localStorage.setItem('wimpyai-auth-dismissed-v1', 'true');
      }
    }

    void initializeAuth();

    return () => {
      window.removeEventListener('wimpy-profile-sync', handleProfileSync);
      window.removeEventListener('wimpy-settings-sync', handleSettingsSync);
      window.removeEventListener('storage', storageListener);
    };
  }, []);

  const createConversation = () => {
    const newConversation: Conversation = {
      id: `conv-${Date.now()}`,
      title: 'New chat',
      messages: [
        {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: 'I\'m WIMPY, built by Wimpy Cooperations. What would you like to work on?',
        },
      ],
    };
    setConversations((prev) => [newConversation, ...prev]);
    setActiveConversationId(newConversation.id);
  };

  const handleCloseWelcome = () => {
    setShowAuthModal(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('wimpyai-auth-dismissed-v1', 'true');
    }
  };

  const sendMessage = async () => {
    if ((!draft.trim() && !attachments.length) || isStreaming) return;
    const content = draft.trim();
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: content || (attachments.length > 0 ? `Please describe the attached image${attachments.length > 1 ? 's' : ''}.` : ''),
      images: attachments.map((attachment) => attachment.src),
    };
    const assistantId = `msg-${Date.now() + 1}`;

    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              title:
                conversation.messages.length === 1 && conversation.title === 'New chat'
                  ? (content || attachments[0]?.name || 'New chat').slice(0, 40)
                  : conversation.title,
              messages: [...conversation.messages, userMessage, { id: assistantId, role: 'assistant', content: '' }],
            }
          : conversation
      )
    );

    setDraft('');
    setAttachments([]);
    setIsStreaming(true);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: content,
          persona: mode,
          attachments: attachments.map((attachment) => ({
            url: attachment.src,
            filename: attachment.name,
            type: attachment.type,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to reach the chat API.');
      }

      if (!response.body) {
        throw new Error('Unable to reach the chat API.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.startsWith('data:')) continue;
          const payload = part.slice(5).trim();
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.delta || '';
            if (delta) {
              accumulated += delta;
              setConversations((prev) =>
                prev.map((conversation) =>
                  conversation.id === activeConversationId
                    ? {
                        ...conversation,
                        messages: conversation.messages.map((message) =>
                          message.id === assistantId ? { ...message, content: accumulated } : message
                        ),
                      }
                    : conversation
                )
              );
            }
          } catch (error) {
            // ignore malformed chunk
          }
        }
      }
    } catch (error) {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === assistantId ? { ...message, content: 'I could not generate a reply right now.' } : message
                ),
              }
            : conversation
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const handleAttachmentSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;

    const nextAttachments: Array<{ name: string; type: string; src: string }> = [];
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      const src = await new Promise<string>((resolve) => {
        reader.onloadend = () => {
          resolve(typeof reader.result === 'string' ? reader.result : '');
        };
        reader.readAsDataURL(file);
      });
      nextAttachments.push({ name: file.name, type: file.type, src });
    }
    setAttachments((prev) => [...prev, ...nextAttachments]);
  };

  const handleWimpyIDLogin = (mode: 'login' | 'signup' = 'login') => {
    if (typeof window === 'undefined') return;
    const url = buildWimpyIDLoginUrl(window.location.origin, mode);
    window.location.href = url;
  };

  const router = useRouter();

  const handleSubscriptionToggle = () => {
    if (!profile.isConnected) {
      setShowAuthModal(true);
      return;
    }
    if (typeof window === 'undefined') return;
    const url = buildWimpyPayUrl(window.location.origin, profile.plan === 'Free' ? 'Pro' : 'Free');
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleExportData = () => {
    const payload = JSON.stringify({ profile, conversations }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wimpyai-export-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleToggleSetting = (setting: keyof SettingsState) => {
    setSettings((prev) => ({
      ...prev,
      [setting]: !prev[setting],
    }));
  };

  const handleInstallPrompt = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
    if (choice.outcome === 'accepted') {
      setTimeout(() => setInstallPromptEvent(null), 1000);
    }
  };

  const openSidebar = () => setSidebarOpen(true);
  const closeSidebar = () => setSidebarOpen(false);

  const handleOutsideDrawerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) {
      closeSidebar();
      if (navigator.vibrate) navigator.vibrate(10);
    }
  };

  const handleMessageActionOpen = (messageId: string) => {
    setActionSheetMessageId(messageId);
  };

  const closeMessageActionSheet = () => setActionSheetMessageId(null);

  const handleAttachmentButton = () => setShowAttachmentSheet(true);
  const closeAttachmentSheet = () => setShowAttachmentSheet(false);

  const handleCopyMessage = (messageId: string) => {
    const message = activeConversation?.messages.find((msg) => msg.id === messageId);
    if (!message) return;
    copyText(message.content);
    closeMessageActionSheet();
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const handleDeleteConversation = (conversationId: string) => {
    setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
    if (conversationId === activeConversationId && conversations.length > 1) {
      setActiveConversationId(conversations[0].id);
    }
    if (navigator.vibrate) navigator.vibrate([10, 20, 10]);
  };

  const handleOpenCamera = () => {
    if (typeof window !== 'undefined') {
      cameraInputRef.current?.click();
    }
  };

  const handleOpenFilePicker = () => {
    if (typeof window !== 'undefined') {
      fileInputRef.current?.click();
    }
  };

  const handleAttach = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;

    const nextAttachments: Array<{ name: string; type: string; src: string }> = [];
    for (const file of Array.from(event.target.files)) {
      const reader = new FileReader();
      const src = await new Promise<string>((resolve) => {
        reader.onloadend = () => {
          resolve(typeof reader.result === 'string' ? reader.result : '');
        };
        reader.readAsDataURL(file);
      });
      nextAttachments.push({ name: file.name, type: file.type, src });
    }
    setAttachments((prev) => [...prev, ...nextAttachments]);
    closeAttachmentSheet();
  };

  const handleLongPressMessage = (messageId: string) => {
    handleMessageActionOpen(messageId);
  };

  const handleMessageTouchStart = (messageId: string) => {
    const timeout = window.setTimeout(() => handleLongPressMessage(messageId), 500);
    return timeout;
  };

  const handleMessageTouchEnd = (timeoutId: number | undefined) => {
    if (timeoutId) window.clearTimeout(timeoutId);
  };


  return (
    <main className={settings.darkMode ? 'dark' : ''}>
      <div className="flex min-h-[100dvh] flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)] transition-colors">
        <div className="sticky top-0 z-20 shrink-0 border-b border-[var(--border)] bg-[var(--panel)]/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-8">
            <button
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--ink)] shadow-sm lg:hidden"
              onClick={openSidebar}
              aria-label="Open sidebar"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <div className="flex flex-col items-center text-center">
              <p className="text-sm font-semibold">WimpyAI</p>
              <p className="text-[11px] text-[var(--muted)]">Tap to chat instantly</p>
            </div>
            <Link
              href="/profile"
              className="z-30 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] shadow-sm"
              aria-label="Open profile"
            >
              <UserCircle2 size={20} />
            </Link>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="hidden lg:flex lg:w-80 lg:flex-col lg:border-r lg:border-[var(--border)] lg:bg-[var(--panel)] lg:shadow-sm lg:overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4">
              <div>
                <p className="text-sm font-semibold">Conversations</p>
                <p className="text-xs text-[var(--muted)]">Swipe left to delete</p>
              </div>
            </div>
            <div className="p-4">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                <p className="text-sm font-semibold">{profile.displayName}</p>
                <p className="text-xs text-[var(--muted)]">{profile.isConnected ? `Connected • ${profile.plan}` : 'Guest • Free'}</p>
              </div>
              <div className="mt-4 space-y-3">
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={() => setShowAuthModal(true)}>
                  {profile.isConnected ? 'Account' : 'Sign in'}
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={() => router.push('/profile')}>
                  Profile
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={createConversation}>
                  New chat
                </button>
              </div>
              <div className="mt-6 space-y-3">
                {conversations.map((conversation) => (
                  <div key={conversation.id} className="group relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel)]">
                    <button
                      className={`w-full px-4 py-4 text-left ${activeConversationId === conversation.id ? 'bg-[var(--accent-soft)]' : ''}`}
                      onClick={() => {
                        setActiveConversationId(conversation.id);
                      }}
                    >
                      <div className="font-medium">{conversation.title}</div>
                      <div className="text-xs text-[var(--muted)]">{conversation.messages.length} messages</div>
                    </button>
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] p-2 text-[var(--muted)] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      onClick={() => handleDeleteConversation(conversation.id)}
                      aria-label="Delete conversation"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </aside>
          <div className="flex min-h-0 flex-1 flex-col px-0 pb-0 pt-4 md:px-8 lg:px-10">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 sm:px-6">
              <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{mode} mode</p>
                  <p className="text-sm text-[var(--muted)]">{isBusy ? 'WIMPY is thinking…' : 'Calm, precise, and built by Wimpy Cooperations.'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className={`rounded-full px-3 py-1.5 text-sm ${mode === 'Serious' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--panel-strong)]'}`} onClick={() => setMode('Serious')}>Serious</button>
                  <button className={`rounded-full px-3 py-1.5 text-sm ${mode === 'Wimpy' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--panel-strong)]'}`} onClick={() => setMode('Wimpy')}>Wimpy</button>
                </div>
              </div>

              <div className="relative mx-auto w-full max-w-3xl flex h-[min(72vh,calc(100vh-12rem))] flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl ring-1 ring-black/5">
                <div
                  ref={chatContainerRef}
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 md:px-0"
                  style={{ paddingBottom: '220px' }}
                >
                  <div className="mx-auto flex max-w-2xl flex-col gap-4">
                    {isBusy && pendingAssistantMessage?.role === 'assistant' && !pendingAssistantMessage.content.trim() ? (
                      <article className="flex gap-3">
                        <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                          <Sparkles size={18} />
                        </div>
                        <div className="max-w-[85%] rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:-0.2s]" />
                            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:-0.1s]" />
                            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[var(--accent)]" />
                          </div>
                        </div>
                      </article>
                    ) : null}
                    {activeConversation?.messages.map((message) => {
                      const isUser = message.role === 'user';
                      let touchTimer: number | undefined;
                      return (
                        <article
                          key={message.id}
                          className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}
                          onTouchStart={() => {
                            touchTimer = window.setTimeout(() => handleLongPressMessage(message.id), 500);
                          }}
                          onTouchEnd={() => handleMessageTouchEnd(touchTimer)}
                          onTouchMove={() => handleMessageTouchEnd(touchTimer)}
                          onMouseDown={() => {
                            if (window.innerWidth < 768) {
                              touchTimer = window.setTimeout(() => handleLongPressMessage(message.id), 500);
                            }
                          }}
                          onMouseUp={() => handleMessageTouchEnd(touchTimer)}
                        >
                          {message.role === 'assistant' ? (
                            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                              <Sparkles size={18} />
                            </div>
                          ) : null}
                          <div className={`relative max-w-[85%] rounded-3xl px-4 py-3 ${isUser ? 'bg-[var(--accent)] text-white' : 'bg-[var(--panel-strong)] text-[var(--ink)]'}`}>
                            {message.image ? <img src={message.image} alt="Uploaded content" className="mb-3 max-h-64 rounded-xl object-cover" /> : null}
                            {message.imageUrl ? <img src={message.imageUrl} alt="Generated content" className="mb-3 max-h-80 rounded-xl object-cover" /> : null}
                            {message.role === 'assistant' ? (
                              <div className="prose prose-sm max-w-none text-[var(--ink)]">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkMath]}
                                  rehypePlugins={[rehypeKatex]}
                                  components={{
                                    code({ inline, className, children, ...props }: any) {
                                      const match = /language-(\w+)/.exec(className || '');
                                      return !inline && match ? (
                                        <div className="my-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[#1e1e1e] text-sm">
                                          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-300">
                                            <span>{match[1]}</span>
                                            <button className="rounded px-2 py-1 hover:bg-white/10" onClick={() => copyText(String(children))}>
                                              <Copy size={14} />
                                            </button>
                                          </div>
                                          <SyntaxHighlighter style={vscDarkPlus as any} language={match[1]} customStyle={{ margin: 0, padding: '1rem', background: '#1e1e1e' }}>
                                            {String(children).replace(/\n$/, '')}
                                          </SyntaxHighlighter>
                                        </div>
                                      ) : (
                                        <code className="rounded bg-[var(--panel-strong)] px-1.5 py-0.5 text-sm" {...props}>{children}</code>
                                      );
                                    },
                                  }}
                                >
                                  {message.content}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
                <div
                  className="absolute inset-x-0 bottom-0 z-10 border-t border-[var(--border)] bg-[var(--panel)] p-4"
                  style={{ bottom: keyboardOffset ? `${keyboardOffset}px` : 0, paddingBottom: `env(safe-area-inset-bottom)` }}
                >
                  {offline ? (
                    <div className="mb-3 rounded-2xl border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-700">
                      You are offline. Messages will send when connection returns.
                    </div>
                  ) : null}
                  {attachments.length ? (
                    <div className="mb-3 space-y-2">
                      {attachments.map((attachment, index) => (
                        <div key={`${attachment.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm">
                          <span className="truncate">{attachment.name}</span>
                          <button
                            className="text-[var(--muted)]"
                            onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== index))}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex h-12 min-w-[44px] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--ink)] shadow-sm"
                      onClick={handleAttachmentButton}
                      aria-label="Attach media"
                    >
                      <Plus size={20} />
                    </button>
                    <button
                      type="button"
                      className="flex h-12 min-w-[44px] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--ink)] shadow-sm"
                      onClick={() => {
                        if ('vibrate' in navigator) navigator.vibrate(10);
                        setIsRecording((prev) => !prev);
                      }}
                      aria-label="Toggle voice input"
                    >
                      <Mic2 size={20} />
                    </button>
                    <textarea
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onFocus={() => setIsInputFocused(true)}
                      onBlur={() => setIsInputFocused(false)}
                      rows={1}
                      className="min-h-[44px] flex-1 resize-none rounded-3xl border border-[var(--border)] bg-transparent px-4 py-3 text-base leading-6 outline-none focus:border-[var(--accent)]"
                      placeholder={isBusy ? 'WIMPY is responding…' : 'Ask WimpyAI anything…'}
                      disabled={isBusy}
                      style={{ fontSize: '16px' }}
                      aria-label="Message input"
                    />
                    <button
                      className="flex h-12 min-w-[52px] items-center justify-center rounded-3xl bg-[var(--accent)] text-white shadow-sm"
                      onClick={() => void sendMessage()}
                      disabled={isBusy || (!draft.trim() && !attachments.length)}
                      aria-label="Send message"
                    >
                      {isBusy ? (
                        <span className="flex items-center gap-1">
                          <span className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:-0.2s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:-0.1s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-white" />
                        </span>
                      ) : (
                        <SendHorizontal size={20} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className={`fixed inset-0 z-40 ${sidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'} lg:hidden`}>
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
            onClick={closeSidebar}
          />
          <div className={`absolute left-0 top-0 h-full w-80 max-w-full transform bg-[var(--panel)] shadow-2xl transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4">
              <div>
                <p className="text-sm font-semibold">Conversations</p>
                <p className="text-xs text-[var(--muted)]">Swipe left to delete</p>
              </div>
              <button className="rounded-2xl border border-[var(--border)] px-3 py-2" onClick={closeSidebar} aria-label="Close sidebar">
                Close
              </button>
            </div>
            <div className="p-4">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                <p className="text-sm font-semibold">{profile.displayName}</p>
                <p className="text-xs text-[var(--muted)]">{profile.isConnected ? `Connected • ${profile.plan}` : 'Guest • Free'}</p>
              </div>
              <div className="mt-4 space-y-3">
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={() => { closeSidebar(); setShowAuthModal(true); }}>
                  {profile.isConnected ? 'Account' : 'Sign in'}
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={() => { closeSidebar(); router.push('/profile'); }}>
                  Profile
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={() => { closeSidebar(); createConversation(); }}>
                  New chat
                </button>
              </div>
              <div className="mt-6 space-y-3">
                {conversations.map((conversation) => (
                  <div key={conversation.id} className="group relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel)]">
                    <button
                      className={`w-full px-4 py-4 text-left ${activeConversationId === conversation.id ? 'bg-[var(--accent-soft)]' : ''}`}
                      onClick={() => {
                        setActiveConversationId(conversation.id);
                        closeSidebar();
                      }}
                    >
                      <div className="font-medium">{conversation.title}</div>
                      <div className="text-xs text-[var(--muted)]">{conversation.messages.length} messages</div>
                    </button>
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] p-2 text-[var(--muted)] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      onClick={() => handleDeleteConversation(conversation.id)}
                      aria-label="Delete conversation"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {showAuthModal ? (
          <div className="fixed inset-0 z-50 flex items-end bg-black/40 px-4 pb-4 md:items-center md:justify-center">
            <div className="w-full rounded-t-3xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl md:max-w-md md:rounded-3xl">
              <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-[var(--border)]"></div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--accent)]">Welcome to WimpyAI</p>
                  <h2 className="mt-1 text-xl font-semibold">Sign in or create an account</h2>
                </div>
                <button className="rounded-full border border-[var(--border)] px-3 py-1 text-sm" onClick={handleCloseWelcome}>Skip</button>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">New devices and first-time visitors see this sign-in prompt first so your account, settings, and subscription stay with you.</p>
              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck size={16} className="text-[var(--accent)]" />
                  WimpyID sign-in
                </div>
                <p className="mt-3 text-sm text-[var(--muted)]">Use WimpyID to sign in securely with the shared Wimpy Cooperations authentication flow.</p>
                <div className="mt-4 flex gap-2">
                  <button className="flex-1 rounded-2xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white" onClick={() => handleWimpyIDLogin('login')}>
                    Sign in
                  </button>
                  <button className="flex-1 rounded-2xl border border-[var(--border)] px-3 py-2 text-sm" onClick={() => handleWimpyIDLogin('signup')}>
                    Sign up
                  </button>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]">
                <UserCircle2 size={14} />
                Your account state updates instantly across this device and future visits.
              </div>
            </div>
          </div>
        ) : null}

        {showAttachmentSheet ? (
          <div className="fixed inset-0 z-50 flex items-end bg-black/40 px-4 pb-4" onClick={closeAttachmentSheet}>
            <div className="w-full rounded-t-3xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-[var(--border)]"></div>
              <p className="mb-4 text-lg font-semibold">Attach</p>
              <div className="space-y-3">
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={handleOpenCamera}>
                  Take Photo
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={handleOpenFilePicker}>
                  Photo Library
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={handleOpenFilePicker}>
                  File
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {actionSheetMessageId ? (
          <div className="fixed inset-0 z-50 flex items-end bg-black/40 px-4 pb-4" onClick={closeMessageActionSheet}>
            <div className="w-full rounded-t-3xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-[var(--border)]"></div>
              <p className="mb-4 text-lg font-semibold">Message actions</p>
              <div className="space-y-3">
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={() => handleCopyMessage(actionSheetMessageId)}>
                  Copy text
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={closeMessageActionSheet}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleAttach} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleAttach} />

        {installPromptEvent ? (
          <div className="fixed bottom-6 left-0 right-0 z-50 mx-auto w-[min(96%,420px)] rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Install WimpyAI</p>
                <p className="text-xs text-[var(--muted)]">Add WimpyAI to your home screen for a faster experience.</p>
              </div>
              <button className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={handleInstallPrompt}>
                Install
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
