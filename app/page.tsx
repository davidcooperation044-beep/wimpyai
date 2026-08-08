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
import { buildWimpyIDLoginUrl, bootstrapWimpyIDSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { UpgradeModal } from '@/app/components/upgrade-modal';

type MessageRole = 'assistant' | 'user' | 'system';

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  image?: string;
  imageUrl?: string;
  images?: string[];
};

type AttachmentKind = 'image' | 'text';

type Attachment = {
  id: string;
  name: string;
  type: string;
  kind: AttachmentKind;
  size: number;
  src?: string;
  content?: string;
  truncated?: boolean;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  pinned?: boolean;
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

type QuotaState = {
  limit: number;
  remaining: number;
  resetsAt: string;
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

function normalizeLatexDelimiters(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expr) => `$$${expr}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expr) => `$${expr}$`);
}

function getConversationStorageKey(userId: string | null): string {
  return userId ? `wimpyai-conversations-v1:${userId}` : 'wimpyai-conversations-v1:guest';
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createEntityId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}`;
}

async function fetchUserConversations(userId: string): Promise<Conversation[] | null> {
  const { data: conversationsData, error: conversationError } = await supabase
    .from('wai_conversations')
    .select('id,title,created_at,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (conversationError || !conversationsData) {
    return null;
  }

  const conversationIds = conversationsData.map((conversation: any) => conversation.id);
  const { data: messagesData, error: messageError } = await supabase
    .from('wai_messages')
    .select('id,conversation_id,role,content,images,created_at')
    .in('conversation_id', conversationIds)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (messageError || !messagesData) {
    return null;
  }

  const messagesByConversation = messagesData.reduce<Record<string, Message[]>>((acc, message: any) => {
    const conversationId = message.conversation_id;
    if (!acc[conversationId]) acc[conversationId] = [];
    const images = Array.isArray(message.images) ? message.images : [];
    acc[conversationId].push({
      id: message.id,
      role: message.role as MessageRole,
      content: message.content,
      images,
      imageUrl: message.role === 'assistant' && images.length === 1 ? images[0] : undefined,
    });
    return acc;
  }, {});

  return conversationsData.map((row: any) => ({
    id: row.id,
    title: row.title,
    messages: messagesByConversation[row.id] ?? [],
    pinned: !!row.pinned,
  }));
}

async function persistConversationToSupabase(conversation: Conversation, userId: string) {
  if (!userId) return;
  await supabase.from('wai_conversations').upsert(
    {
      id: conversation.id,
      user_id: userId,
      title: conversation.title,
      pinned: conversation.pinned ?? false,
    },
    { onConflict: 'id' }
  );
}

async function persistMessageToSupabase(conversationId: string, message: Message, userId: string) {
  if (!userId) return;
  const images = message.images ?? [];
  if (!images.length && message.imageUrl) {
    images.push(message.imageUrl);
  }

  await supabase.from('wai_messages').upsert(
    {
      id: message.id,
      conversation_id: conversationId,
      user_id: userId,
      role: message.role,
      content: message.content,
      images,
    },
    { onConflict: 'id' }
  );
}

async function updateMessageContentInSupabase(messageId: string, content: string) {
  await supabase.from('wai_messages').update({ content }).eq('id', messageId);
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getInitialQuotaState(authHeaders: Record<string, string>) {
  const response = await fetch('/api/chat', {
    method: 'GET',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.json().catch(() => null);
  return body?.quota ?? null;
}

export default function HomePage() {
  const [mode, setMode] = useState<'Serious' | 'Wimpy'>('Serious');
  const [profile, setProfile] = useState<ProfileState>(emptyProfile);
  const [conversations, setConversations] = useState<Conversation[]>([initialConversation]);
  const [activeConversationId, setActiveConversationId] = useState(initialConversation.id);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSupported, setRecordingSupported] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [offline, setOffline] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [settings, setSettings] = useState<SettingsState>(emptySettings);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false);
  const [actionSheetMessageId, setActionSheetMessageId] = useState<string | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [quotaState, setQuotaState] = useState<QuotaState | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalMessageId, setEditModalMessageId] = useState<string | null>(null);
  const [editModalImage, setEditModalImage] = useState<string | null>(null);
  const [editModalHistory, setEditModalHistory] = useState<string[]>([]);
  const [editModalMeta, setEditModalMeta] = useState<any>(null);
  const [editInstructions, setEditInstructions] = useState('');

  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const generalFileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any | null>(null);

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
    // flush any queued messages when connection returns
    window.addEventListener('online', async () => {
      const queued = window.localStorage.getItem('wimpyai-offline-queue');
      if (!queued) return;
      try {
        const items = JSON.parse(queued) as Array<{ content: string }>; 
        for (const it of items) {
          // send queued messages
          await sendMessage(it.content);
        }
        window.localStorage.removeItem('wimpyai-offline-queue');
        showToast('Queued messages sent.');
      } catch (e) {
        // ignore
      }
    });
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const loadQuota = async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const quota = await getInitialQuotaState(authHeaders);
        if (quota) {
          setQuotaState(quota);
          setQuotaError(null);
        } else {
          setQuotaError('Unable to load quota status.');
        }
      } catch {
        setQuotaError('Unable to load quota status.');
      }
    };

    void loadQuota();
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
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setRecordingSupported(Boolean(SpeechRecognition));
  }, []);

  const startRecording = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTranscript('Voice input is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      const result = event.results[event.resultIndex];
      const text = Array.from(result)
        .map((item: any) => item.transcript)
        .join('');

      setTranscript(text);
      setDraft(text);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      recognition.stop();
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
    setTranscript('Listening…');
  };

  const stopRecording = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.stop();
    recognitionRef.current = null;
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (!recordingSupported) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = getConversationStorageKey(profile.userId);
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as unknown;
      if (Array.isArray(parsed) && parsed.length) {
        setConversations(parsed as Conversation[]);
      }
    } catch {
      // ignore invalid cache
    }

    const userId = profile.userId;
    if (!profile.isConnected || !userId) return;

    const loadRemote = async () => {
      const remoteConversations = await fetchUserConversations(userId);
      if (remoteConversations && remoteConversations.length) {
        setConversations(remoteConversations);
      }
    };

    void loadRemote();
  }, [profile.isConnected, profile.userId]);

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
    window.localStorage.setItem(getConversationStorageKey(profile.userId), JSON.stringify(conversations));
  }, [conversations, profile.userId]);

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

    // load initial profile and settings from localStorage on client
    handleProfileSync();
    handleSettingsSync();
    try {
      const dismissed = window.localStorage.getItem('wimpyai-auth-dismissed-v1');
      const savedProfile = loadJson<ProfileState>('wimpyai-profile-v1', emptyProfile);
      setShowAuthModal(!dismissed && !savedProfile.isConnected);
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener('wimpy-profile-sync', handleProfileSync);
      window.removeEventListener('wimpy-settings-sync', handleSettingsSync);
      window.removeEventListener('storage', storageListener);
    };
  }, []);

  const createConversation = async () => {
    const newConversation: Conversation = {
      id: createEntityId('conv'),
      title: 'New chat',
      messages: [
        {
          id: createEntityId('msg'),
          role: 'assistant',
          content: 'I\'m WIMPY, built by Wimpy Cooperations. What would you like to work on?',
        },
      ],
      pinned: false,
    };
    setConversations((prev) => [newConversation, ...prev]);
    setActiveConversationId(newConversation.id);
    if (profile.isConnected && profile.userId) {
      try {
        await persistConversationToSupabase(newConversation, profile.userId);
        await persistMessageToSupabase(newConversation.id, newConversation.messages[0], profile.userId);
      } catch (e) {
        console.error('Failed to persist new conversation', e);
      }
    }
  };

  const handleCloseWelcome = () => {
    setShowAuthModal(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('wimpyai-auth-dismissed-v1', 'true');
    }
  };

  const sendMessage = async (overrideContent?: string) => {
    const effectiveDraft = overrideContent ?? draft;
    if ((!effectiveDraft.trim() && !attachments.length) || isStreaming) return;
    if (offline) {
      // queue text-only messages when offline
      try {
        const queued = window.localStorage.getItem('wimpyai-offline-queue');
        const arr = queued ? JSON.parse(queued) : [];
        arr.push({ content: effectiveDraft });
        window.localStorage.setItem('wimpyai-offline-queue', JSON.stringify(arr));
        showToast('Message queued and will send when online.');
        // add a local queued assistant placeholder
        const queuedAssistant: Message = { id: createEntityId('msg'), role: 'assistant', content: '(Queued — will send when online)', images: [] };
        const userMessage: Message = { id: createEntityId('msg'), role: 'user', content: effectiveDraft, images: [] };
        setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, messages: [...c.messages, userMessage, queuedAssistant] } : c)));
        setDraft('');
      } catch (e) {
        console.error('[sendMessage] queue failed', e);
        showToast('Unable to queue message.');
      }
      return;
    }
    const content = effectiveDraft.trim();
    const textAttachments = attachments.filter((attachment) => attachment.kind === 'text');
    const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image');

    const fileBlocks = textAttachments
      .map((attachment) => {
        const truncatedNotice = attachment.truncated ? `\n[...truncated file content, original size ${attachment.size} chars]` : '';
        return `\n\n--- Attached file: ${attachment.name} ---\n\n\`\`\`\n${attachment.content ?? ''}\n\`\`\`\n${truncatedNotice}`;
      })
      .join('');

    const promptPrefix = content ||
      (textAttachments.length > 0
        ? `Please analyze the attached file${textAttachments.length > 1 ? 's' : ''} below.`
        : imageAttachments.length > 0
        ? `Please describe the attached image${imageAttachments.length > 1 ? 's' : ''}.`
        : '');

    const outgoingContent = `${promptPrefix}${fileBlocks}`.trim();

    const userMessage: Message = {
      id: createEntityId('msg'),
      role: 'user',
      content: outgoingContent,
      images: imageAttachments.map((attachment) => attachment.src || '').filter(Boolean),
    };
    const assistantMessage: Message = {
      id: createEntityId('msg'),
      role: 'assistant',
      content: '',
      images: [],
    };

    const updatedConversation = conversations.find((conversation) => conversation.id === activeConversationId);
    const updatedMessages = updatedConversation
      ? [
          ...updatedConversation.messages,
          userMessage,
          assistantMessage,
        ]
      : [userMessage, assistantMessage];

    const conversationToPersist: Conversation = updatedConversation
      ? {
          ...updatedConversation,
          title:
            updatedConversation.messages.length === 1 && updatedConversation.title === 'New chat'
              ? (content || attachments[0]?.name || 'New chat').slice(0, 40)
              : updatedConversation.title,
          messages: updatedMessages,
        }
      : {
          id: createEntityId('conv'),
          title: (content || attachments[0]?.name || 'New chat').slice(0, 40),
          messages: updatedMessages,
        };

    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversationId
          ? conversationToPersist
          : conversation
      )
    );

    if (!updatedConversation) {
      setActiveConversationId(conversationToPersist.id);
    }

    setDraft('');
    setAttachments([]);
    setIsStreaming(true);

    if (profile.isConnected && profile.userId) {
      try {
        await persistConversationToSupabase(conversationToPersist, profile.userId);
        await Promise.all([
          persistMessageToSupabase(conversationToPersist.id, userMessage, profile.userId),
          persistMessageToSupabase(conversationToPersist.id, assistantMessage, profile.userId),
        ]);
      } catch (e) {
        console.error('Failed to persist conversation/messages', e);
      }
    }

    try {
      const authHeaders = await getAuthHeaders();
      // Send prior turns of THIS conversation as context so the model has
      // memory across messages. Exclude the new user/assistant pair we just
      // appended locally (those aren't real replies yet) and any empty
      // placeholder messages.
      const priorMessages = (updatedConversation?.messages ?? []).filter(
        (message) => message.content && message.content.trim().length > 0
      );
      const history = priorMessages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: outgoingContent,
          persona: mode,
          history,
          attachments: imageAttachments.map((attachment) => ({
            url: attachment.src as string,
            filename: attachment.name,
            type: attachment.type,
          })),
        }),
      });

      if (!response.ok) {
        // Try to surface server-provided error details in the assistant bubble
        let bodyText = '';
        let parsed: any = null;
        try {
          bodyText = await response.text();
          parsed = JSON.parse(bodyText);
          bodyText = parsed?.error ? (parsed.detail ? `${parsed.error}: ${parsed.detail}` : parsed.error) : bodyText;
        } catch {
          // ignore parse error, use raw text
        }

        if (parsed?.error === 'quota-exceeded') {
          const quota = parsed?.quota;
          if (quota) {
            setQuotaState(quota);
          }
          if (profile.isConnected) {
            setShowUpgradeModal(true);
          } else {
            setShowAuthModal(true);
          }
        }

        const finalMessage = bodyText || 'Unable to reach the chat API.';
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === activeConversationId
              ? {
                  ...conversation,
                  messages: conversation.messages.map((message) =>
                    message.id === assistantMessage.id ? { ...message, content: finalMessage } : message
                  ),
                }
              : conversation
          )
        );

        if (profile.isConnected && profile.userId) {
          try {
            await persistConversationToSupabase(
              conversations.find((conversation) => conversation.id === activeConversationId) ?? conversationToPersist,
              profile.userId
            );
            await updateMessageContentInSupabase(assistantMessage.id, finalMessage);
          } catch (e) {
            console.error('Failed to persist error state', e);
          }
        }

        return;
      }

      if (!response.body) {
        throw new Error('Unable to reach the chat API.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let lastImageUrl = '';

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
            if (parsed.error) {
              const errMsg = parsed.detail ? `${parsed.error}: ${parsed.detail}` : parsed.error;
              setConversations((prev) =>
                prev.map((conversation) =>
                  conversation.id === activeConversationId
                    ? {
                        ...conversation,
                        messages: conversation.messages.map((message) =>
                          message.id === assistantMessage.id ? { ...message, content: errMsg } : message
                        ),
                      }
                    : conversation
                )
              );
              // stop streaming on server error
              buffer = '';
              break;
            }

            if (parsed.quota) {
              setQuotaState(parsed.quota);
            }

            const delta = parsed.delta || '';
            const imageUrl = parsed.imageUrl || '';
            if (imageUrl) {
              lastImageUrl = imageUrl;
            }
            if (delta) {
              accumulated += delta;
            }
            if (delta || imageUrl) {
              setConversations((prev) =>
                prev.map((conversation) =>
                  conversation.id === activeConversationId
                    ? {
                        ...conversation,
                        messages: conversation.messages.map((message) =>
                          message.id === assistantMessage.id
                            ? {
                                ...message,
                                content: accumulated || (imageUrl ? 'Here is your image:' : ''),
                                imageUrl: imageUrl || message.imageUrl,
                              }
                            : message
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

      if (profile.isConnected && profile.userId) {
        try {
          await persistMessageToSupabase(conversationToPersist.id, {
            ...assistantMessage,
            content: accumulated || 'No assistant response was returned.',
            images: lastImageUrl ? [lastImageUrl] : assistantMessage.images,
          }, profile.userId);
        } catch (e) {
          console.error('Failed to persist assistant response', e);
        }
      }
    } catch (error) {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === assistantMessage.id ? { ...message, content: 'I could not generate a reply right now.' } : message
                ),
              }
            : conversation
        )
      );
      if (profile.isConnected && profile.userId) {
        try {
          await persistConversationToSupabase(
            conversations.find((conversation) => conversation.id === activeConversationId) ?? conversationToPersist,
            profile.userId
          );
          await updateMessageContentInSupabase(assistantMessage.id, 'I could not generate a reply right now.');
        } catch (e) {
          console.error('Failed to persist failure state', e);
        }
      }
    } finally {
      setIsStreaming(false);
      setTranscript('');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const handleWimpyIDLogin = (mode: 'login' | 'signup' = 'login') => {
    if (typeof window === 'undefined') return;
    const url = buildWimpyIDLoginUrl(window.location.origin, mode);
    window.location.href = url;
  };

  const router = useRouter();

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  };

  async function copyText(text: string) {
    if (!text) {
      showToast('Nothing to copy.');
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard.');
        return;
      } catch (error) {
        console.warn('[copyText] navigator.clipboard failed', error);
      }
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (successful) {
        showToast('Copied to clipboard.');
      } else {
        throw new Error('execCommand copy failed');
      }
    } catch (error) {
      console.error('[copyText] fallback copy failed', error);
      showToast('Unable to copy text.');
    }
  }

  const handleSubscriptionToggle = () => {
    if (!profile.isConnected) {
      setShowAuthModal(true);
      return;
    }
    setShowUpgradeModal(true);
  };

  const handleSubscriptionSuccess = () => {
    setProfile((prev) => ({ ...prev, plan: 'Pro', subscriptionStatus: 'active' }));
    showToast('WimpyAI Pro is now active!');
    void (async () => {
      const authHeaders = await getAuthHeaders();
      const quota = await getInitialQuotaState(authHeaders);
      if (quota) {
        setQuotaState(quota);
      }
    })();
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
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((s) => !s);
      }
    };
    window.addEventListener('keydown', handler as any);
    return () => window.removeEventListener('keydown', handler as any);
  }, []);

  const runCommand = (cmd: string) => {
    if (cmd === 'new') createConversation();
    if (cmd === 'search') { setSidebarOpen(true); }
    if (cmd === 'profile') { window.location.href = '/profile'; }
    setShowCommandPalette(false);
  };

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

  const openImageEditor = (messageId: string, imageUrl: string, meta?: any) => {
    setEditModalMessageId(messageId);
    setEditModalImage(imageUrl);
    // load history from the message if present
    const conv = conversations.find((c) => c.id === activeConversationId);
    const msg = conv?.messages.find((m) => m.id === messageId);
    const history = Array.isArray((msg as any)?.imagesHistory) ? [...((msg as any).imagesHistory as string[])] : [];
    setEditModalHistory(history);
    setEditModalMeta((msg as any)?.originalImageMeta ?? meta ?? { source: imageUrl });
    setEditInstructions('');
    setEditModalOpen(true);
    closeMessageActionSheet();
  };

  const closeImageEditor = () => {
    setEditModalOpen(false);
    setEditModalMessageId(null);
    setEditModalImage(null);
    setEditModalHistory([]);
    setEditModalMeta(null);
    setEditInstructions('');
  };

  const handleAttachmentButton = () => setShowAttachmentSheet(true);
  const closeAttachmentSheet = () => setShowAttachmentSheet(false);

  const handleCopyMessage = (messageId: string) => {
    const message = activeConversation?.messages.find((msg) => msg.id === messageId);
    if (!message) return;
    copyText(message.content);
    closeMessageActionSheet();
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const handleRegenerate = async (messageId: string | null) => {
    if (!messageId) return;
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const msg = conv.messages[idx];
    if (msg.role !== 'assistant') return;

    // find preceding user message
    let userMsg: Message | undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'user') {
        userMsg = conv.messages[i];
        break;
      }
    }
    if (!userMsg) return;

    // remove the old assistant message locally and in supabase
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: c.messages.filter((m) => m.id !== messageId) } : c)));
    try {
      if (profile.isConnected && profile.userId) {
        await supabase.from('wai_messages').delete().eq('id', messageId);
      }
    } catch (e) {
      // ignore
    }

    closeMessageActionSheet();
    // resend the same user message
    void sendMessage(userMsg.content);
  };

  const handleEditAndResend = async (messageId: string | null) => {
    if (!messageId) return;
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const msg = conv.messages[idx];
    if (msg.role !== 'user') return;

    const newText = window.prompt('Edit your message before resending:', msg.content);
    if (newText == null) return;

    // remove messages after this user message
    const toKeep = conv.messages.slice(0, idx + 1);
    const removed = conv.messages.slice(idx + 1).map((m) => m.id);
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: toKeep } : c)));

    if (profile.isConnected && profile.userId && removed.length) {
      try {
        await supabase.from('wai_messages').delete().in('id', removed);
      } catch (e) {
        // ignore
      }
    }

    closeMessageActionSheet();
    void sendMessage(newText);
  };

  const handleFeedback = async (messageId: string, vote: 1 | -1) => {
    try {
      const auth = await getAuthHeaders();
      await fetch('/api/feedback', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, vote }) });
      showToast('Thanks for the feedback.');
    } catch (e) {
      console.error('[handleFeedback] failed', e);
      showToast('Unable to send feedback.');
    }
  };

  const handleEditImage = (messageId: string | null) => {
    if (!messageId) return;
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const msg = conv.messages[idx];
    const imageUrl = msg.imageUrl ?? (Array.isArray(msg.images) && msg.images[0]);
    if (!imageUrl) return;
    openImageEditor(messageId, imageUrl, { originalMessageId: messageId });
  };

  const confirmImageEdit = async () => {
    if (!editModalMessageId || !editModalImage) return;
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return;

    // push current image into history
    setEditModalHistory((prev) => [editModalImage as string, ...prev].slice(0, 10));

    const assistantMessage: Message = { id: createEntityId('msg'), role: 'assistant', content: 'Generating edited image...', images: [editModalImage] };
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: [...c.messages, assistantMessage] } : c)));

    try {
      const resp = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: editInstructions || 'Edit image as requested.', source_image_url: editModalImage }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        const msgText = err?.error ? `Image edit failed: ${err.error}` : 'Image edit failed';
        setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: c.messages.map((m) => m.id === assistantMessage.id ? { ...m, content: msgText } : m) } : c)));
        return;
      }
      const body = await resp.json().catch(() => null);
      const newUrl = body?.imageUrl;
      if (!newUrl) {
        setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: c.messages.map((m) => m.id === assistantMessage.id ? { ...m, content: 'Image edit returned no image.' } : m) } : c)));
        return;
      }

      // update assistant placeholder with edited image
      setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: c.messages.map((m) => m.id === assistantMessage.id ? { ...m, content: 'Edited image', imageUrl: newUrl, images: [newUrl], } : m) } : c)));

      // update original message to record history and original metadata
      setConversations((prev) => prev.map((c) => {
        if (c.id !== conv.id) return c;
        return {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== editModalMessageId) return m;
            const prevHistory = Array.isArray((m as any).imagesHistory) ? (m as any).imagesHistory : [];
            return {
              ...m,
              originalImageMeta: (m as any).originalImageMeta ?? editModalMeta ?? { source: editModalImage },
              imagesHistory: [...(prevHistory || []), editModalImage],
              imageUrl: newUrl,
              images: [newUrl],
            } as Message & { imagesHistory?: string[]; originalImageMeta?: any };
          }),
        };
      }));

      if (profile.isConnected && profile.userId) {
        try {
          await persistMessageToSupabase(conv.id, { id: createEntityId('msg'), role: 'assistant', content: 'Edited image', images: [newUrl], imageUrl: newUrl }, profile.userId);
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      console.error('[confirmImageEdit] failed', e);
      setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: c.messages.map((m) => m.id === assistantMessage.id ? { ...m, content: 'Image edit failed.' } : m) } : c)));
    } finally {
      closeImageEditor();
    }
  };

  const undoImageEdit = () => {
    if (!editModalMessageId) return;
    // revert last edit by popping history for the message
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return;
    setConversations((prev) => prev.map((c) => {
      if (c.id !== conv.id) return c;
      return {
        ...c,
        messages: c.messages.map((m) => {
          if (m.id !== editModalMessageId) return m;
          const history = Array.isArray((m as any).imagesHistory) ? [...((m as any).imagesHistory as string[])] : [];
          if (!history.length) return m;
          const last = history.pop() as string;
          return {
            ...m,
            imageUrl: last,
            images: [last],
            imagesHistory: history,
          } as Message & { imagesHistory?: string[] };
        }),
      };
    }));
    closeImageEditor();
  };

  const handleDeleteConversation = (conversationId: string) => {
    setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
    if (conversationId === activeConversationId && conversations.length > 1) {
      setActiveConversationId(conversations[0].id);
    }
    if (navigator.vibrate) navigator.vibrate([10, 20, 10]);
  };

  const doSearch = async () => {
    if (!searchQuery || searchQuery.trim().length === 0) return setSearchResults([]);
    setSearchLoading(true);
    try {
      const resp = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=20`);
      if (!resp.ok) {
        setSearchResults([]);
        return;
      }
      const body = await resp.json().catch(() => null);
      setSearchResults(body?.results ?? []);
    } catch (e) {
      console.error('[doSearch] failed', e);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const openResult = async (result: any) => {
    if (!result || !result.conversation_id) return;
    // close sidebar and activate conversation
    setSidebarOpen(false);
    setActiveConversationId(result.conversation_id);
    // give React a tick to render the selected conversation
    setTimeout(() => {
      const el = document.getElementById(`msg-${result.id}`);
      if (el && chatContainerRef.current) {
        // scroll the container so the message is visible
        const container = chatContainerRef.current;
        const top = (el as HTMLElement).offsetTop - container.offsetTop - container.clientHeight / 2 + (el as HTMLElement).clientHeight / 2;
        container.scrollTo({ top, behavior: 'smooth' });
      }
    }, 150);
  };

  const handleOpenCamera = () => {
    if (typeof window !== 'undefined') {
      cameraInputRef.current?.click();
    }
  };

  const handleOpenFilePicker = (type: 'image' | 'file') => {
    if (typeof window === 'undefined') return;
    if (type === 'image') {
      imageFileInputRef.current?.click();
      return;
    }
    generalFileInputRef.current?.click();
  };

  const handleAttach = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;

    const nextAttachments: Attachment[] = [];
    const textFilePattern = /\.(txt|md|csv|js|jsx|ts|tsx|py|json|html|css|yaml|yml|xml|log)$/i;
    const MAX_TEXT_ATTACHMENT_CHARS = 20000;

    for (const file of Array.from(event.target.files)) {
      const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif)$/i.test(file.name);
      const isTextFile =
        file.type.startsWith('text/') ||
        file.type === 'application/json' ||
        textFilePattern.test(file.name);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

      if (isTextFile) {
        let fileText = '';
        try {
          fileText = await file.text();
        } catch (error) {
          console.error('[handleAttach] failed to read text file', file.name, error);
          showToast(`Unable to read ${file.name}.`);
          continue;
        }

        const truncated = fileText.length > MAX_TEXT_ATTACHMENT_CHARS;
        const content = truncated
          ? `${fileText.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n\n[...truncated, file is ${fileText.length} characters]`
          : fileText;

        if (truncated) {
          showToast(`Attached ${file.name}, truncated to ${MAX_TEXT_ATTACHMENT_CHARS} characters.`);
        }

        nextAttachments.push({
          id: createEntityId('att'),
          name: file.name,
          type: file.type || 'text/plain',
          kind: 'text',
          size: fileText.length,
          content,
          truncated,
        });
        continue;
      }

      if (isImage) {
        const reader = new FileReader();
        const src = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            resolve(typeof reader.result === 'string' ? reader.result : '');
          };
          reader.onerror = () => {
            reject(new Error(`Failed to read file ${file.name}`));
          };
          reader.readAsDataURL(file);
        }).catch((error) => {
          console.error('[handleAttach] failed to read image file', file.name, error);
          showToast(`Unable to attach ${file.name}.`);
          return '';
        });

        if (!src) continue;
        nextAttachments.push({
          id: createEntityId('att'),
          name: file.name,
          type: file.type,
          kind: 'image',
          size: file.size,
          src,
        });
        continue;
      }

      if (isPdf) {
        // Send PDF as multipart/form-data to server extractor to avoid base64 bloat
        try {
          const form = new FormData();
          form.append('file', file, file.name);
          const resp = await fetch('/api/extract-pdf', { method: 'POST', body: form });
          if (!resp.ok) {
            const err = await resp.json().catch(() => null);
            if (err?.error === 'file_too_large') {
              showToast(`${file.name} exceeds the maximum size of 10MB.`);
            } else {
              showToast(`Failed to extract ${file.name}.`);
            }
            continue;
          }
          const body = await resp.json().catch(() => null);
          const fileText = body?.text ?? '';
          if (!fileText) {
            showToast(`No extractable text found in ${file.name}.`);
            continue;
          }

          const truncated = fileText.length > MAX_TEXT_ATTACHMENT_CHARS;
          const content = truncated
            ? `${fileText.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n\n[...truncated, file is ${fileText.length} characters]`
            : fileText;

          if (truncated) showToast(`Attached ${file.name}, truncated to ${MAX_TEXT_ATTACHMENT_CHARS} characters.`);

          nextAttachments.push({
            id: createEntityId('att'),
            name: file.name,
            type: file.type || 'application/pdf',
            kind: 'text',
            size: file.size,
            content,
            truncated,
          });
        } catch (error) {
          console.error('[handleAttach] pdf extract failed', file.name, error);
          showToast(`Unable to extract ${file.name}.`);
        }
        continue;
      }

      showToast(`Only image and text/code files are supported. Skipped ${file.name}.`);
    }

    if (nextAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...nextAttachments]);
    }
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
      <div className="flex app-shell flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)] transition-colors">
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
              <img src="/wimpyai-logo-render-removebg-preview.png" alt="WimpyAI logo" className="mb-1 h-10 w-10 rounded-2xl object-cover" />
              <p className="text-sm font-semibold">WimpyAI</p>
              <p className="text-[11px] text-[var(--muted)]">Tap to chat instantly</p>
            </div>
            <a
              href="/profile"
              className="z-30 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] shadow-sm"
              aria-label="Open profile"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/profile';
                }
              }}
            >
              <UserCircle2 size={20} />
            </a>
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
              <div className="mb-3">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }}
                  placeholder="Search conversations/messages"
                  className="w-full rounded-lg border p-2"
                />
                <div className="mt-2">
                  <button className="rounded-2xl border px-3 py-1 text-sm" onClick={() => void doSearch()}>{searchLoading ? 'Searching…' : 'Search'}</button>
                </div>
                {searchResults && (
                  <div className="mt-3 max-h-40 overflow-auto">
                    {searchResults.length === 0 ? (
                      <div className="text-sm text-[var(--muted)]">No results</div>
                    ) : (
                      searchResults.map((r: any) => (
                        <button key={r.id} onClick={() => openResult(r)} className="mb-2 w-full text-left rounded-lg border p-2 bg-[var(--panel-strong)]">
                          <div className="text-xs text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</div>
                          <div className="text-sm">{r.content.slice(0, 200)}</div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                <p className="text-sm font-semibold">{profile.displayName}</p>
                <p className="text-xs text-[var(--muted)]">{profile.isConnected ? `Connected • ${profile.plan}` : 'Guest • Free'}</p>
              </div>
              <div className="mt-4 space-y-3">
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={() => setShowAuthModal(true)}>
                  {profile.isConnected ? 'Account' : 'Sign in'}
                </button>
                <a
                  href="/profile"
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.location.href = '/profile';
                    }
                  }}
                >
                  Profile
                </a>
                <button
                  type="button"
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm flex items-center justify-between"
                  onClick={() => setSettings((prev) => ({ ...prev, darkMode: !prev.darkMode }))}
                >
                  <span>{settings.darkMode ? 'Light mode' : 'Dark mode'}</span>
                  {settings.darkMode ? <SunMedium size={16} /> : <Moon size={16} />}
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
            <div className="mx-auto flex w-full flex-1 min-h-0 flex-col gap-4 px-4 sm:px-6">
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

              <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Token quota</p>
                    <p className="text-xs text-[var(--muted)]">
                      {quotaState
                        ? `${quotaState.remaining.toLocaleString()} of ${quotaState.limit.toLocaleString()} remaining`
                        : 'Loading usage status...'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                    onClick={handleSubscriptionToggle}
                  >
                    {profile.plan === 'Pro' ? 'Manage Pro' : 'Upgrade to Pro'}
                  </button>
                </div>
                {quotaState ? (
                  <div className="mt-4">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${Math.max(0, Math.min(100, ((quotaState.limit - quotaState.remaining) / quotaState.limit) * 100))}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">Resets {new Date(quotaState.resetsAt).toLocaleString()}</p>
                  </div>
                ) : null}
                {quotaError ? <p className="mt-3 text-sm text-red-500">{quotaError}</p> : null}
              </div>

              <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl ring-1 ring-black/5">
                <div
                  ref={chatContainerRef}
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 md:px-0"
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
                          id={`msg-${message.id}`}
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
                                            {message.images?.length ? (
                              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                                {message.images.map((src, imageIndex) => (
                                  <img key={`${src}-${imageIndex}`} src={src} alt="Attached content" className="max-h-64 rounded-xl object-cover" />
                                ))}
                              </div>
                            ) : null}
                            {message.image ? <img src={message.image} alt="Uploaded content" className="mb-3 max-h-64 rounded-xl object-cover" /> : null}
                            {!message.images?.length && message.imageUrl ? <img src={message.imageUrl} alt="Generated content" className="mb-3 max-h-80 rounded-xl object-cover" /> : null}
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
                                  {normalizeLatexDelimiters(message.content)}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                            )}
                            {message.role === 'assistant' ? (
                              <div className="mt-2 flex gap-2">
                                <button className="rounded px-2 py-1 border" onClick={() => handleFeedback(message.id, 1)}>👍</button>
                                <button className="rounded px-2 py-1 border" onClick={() => handleFeedback(message.id, -1)}>👎</button>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
                <div className="border-t border-[var(--border)] bg-[var(--panel)] p-4">
                  {offline ? (
                    <div className="mb-3 rounded-2xl border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-700">
                      You are offline. Messages will send when connection returns.
                    </div>
                  ) : null}
                  {attachments.length ? (
                    <div className="mb-3 space-y-2">
                      {attachments.map((attachment, index) => (
                        <div key={`${attachment.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm">
                          <div className="flex items-center gap-2 truncate">
                            <span className="truncate">{attachment.name}</span>
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-[var(--muted)]">
                              {attachment.kind === 'image' ? 'Image' : 'Text'}
                            </span>
                            {attachment.kind === 'text' && attachment.truncated ? (
                              <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-yellow-300">
                                Truncated
                              </span>
                            ) : null}
                          </div>
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
                      className={`flex h-12 min-w-[44px] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--ink)] shadow-sm ${isRecording ? 'ring-2 ring-[var(--accent)]' : ''}`}
                      onClick={() => {
                        if ('vibrate' in navigator) navigator.vibrate(10);
                        toggleRecording();
                      }}
                      aria-label="Toggle voice input"
                    >
                      {isRecording ? (
                        <div className="listening-container">
                          <span className="listening-dot" />
                        </div>
                      ) : (
                        <Mic2 size={20} />
                      )}
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
                      onClick={() => {
                        if (isRecording) {
                          // stop and send the current transcript
                          stopRecording();
                          void sendMessage(transcript);
                        } else {
                          void sendMessage();
                        }
                      }}
                      disabled={isStreaming || (!draft.trim() && !attachments.length && !transcript)}
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
                <a href="/profile" className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={(event) => {
                  closeSidebar();
                  if (typeof window !== 'undefined') {
                    window.location.href = '/profile';
                  }
                }}>
                  Profile
                </a>
                <button
                  type="button"
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm flex items-center justify-between"
                  onClick={() => {
                    closeSidebar();
                    setSettings((prev) => ({ ...prev, darkMode: !prev.darkMode }));
                  }}
                >
                  <span>{settings.darkMode ? 'Light mode' : 'Dark mode'}</span>
                  {settings.darkMode ? <SunMedium size={16} /> : <Moon size={16} />}
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left text-sm" onClick={() => { closeSidebar(); createConversation(); }}>
                  New chat
                </button>
              </div>
              <div className="mt-6 space-y-3">
                {conversations
                  .slice()
                  .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
                  .map((conversation) => (
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
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <button
                        className="rounded-full border border-[var(--border)] bg-[var(--panel-strong)] p-2 text-[var(--muted)]"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const auth = await getAuthHeaders();
                            const resp = await fetch('/api/conversations/pin', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: conversation.id, pinned: !conversation.pinned }) });
                            if (resp.ok) {
                              const body = await resp.json().catch(() => null);
                              const updated = body?.conversation;
                              setConversations((prev) => prev.map((c) => (c.id === conversation.id ? { ...c, pinned: updated?.pinned ?? !conversation.pinned } : c)));
                            }
                          } catch (e) {
                            console.error('[pin] failed', e);
                          }
                        }}
                        aria-label={conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
                      >
                        {conversation.pinned ? '📌' : '📍'}
                      </button>
                      <button
                        className="rounded-full border border-[var(--border)] bg-[var(--panel-strong)] p-2 text-[var(--muted)]"
                        onClick={() => handleDeleteConversation(conversation.id)}
                        aria-label="Delete conversation"
                      >
                        ×
                      </button>
                    </div>
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

        {showCommandPalette ? (
          <div className="fixed inset-0 z-70 flex items-start justify-center p-4" onClick={() => setShowCommandPalette(false)}>
            <div className="w-full max-w-xl rounded-lg bg-[var(--panel)] p-4" onClick={(e) => e.stopPropagation()}>
              <input autoFocus value={commandQuery} onChange={(e) => setCommandQuery(e.target.value)} className="w-full rounded-md border p-2" placeholder="Type a command (new, search, profile)" />
              <div className="mt-3 space-y-2">
                {['new', 'search', 'profile'].filter(c => c.includes(commandQuery)).map(c => (
                  <button key={c} className="w-full text-left rounded-md border p-2" onClick={() => runCommand(c)}>{c}</button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <UpgradeModal
          open={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
          onSubscribed={handleSubscriptionSuccess}
          currentPlan={profile.plan}
        />

        {showAttachmentSheet ? (
          <div className="fixed inset-0 z-50 flex items-end bg-black/40 px-4 pb-4" onClick={closeAttachmentSheet}>
            <div className="w-full rounded-t-3xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-[var(--border)]"></div>
              <p className="mb-4 text-lg font-semibold">Attach</p>
              <div className="space-y-3">
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={handleOpenCamera}>
                  Take Photo
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={() => handleOpenFilePicker('image')}>
                  Photo Library
                </button>
                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={() => handleOpenFilePicker('file')}>
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
                {(() => {
                  const actionMsg = activeConversation?.messages.find((m) => m.id === actionSheetMessageId);
                  return (
                    <>
                      <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={() => handleCopyMessage(actionSheetMessageId)}>
                        Copy text
                      </button>
                          {actionMsg?.role === 'assistant' ? (
                            <>
                              <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={() => handleRegenerate(actionSheetMessageId)}>
                                Regenerate
                              </button>
                              {(actionMsg?.imageUrl || (actionMsg?.images && actionMsg.images.length > 0)) ? (
                                <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={() => handleEditImage(actionSheetMessageId)}>
                                  Edit Image
                                </button>
                              ) : null}
                            </>
                          ) : null}
                      {actionMsg?.role === 'user' ? (
                        <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={() => handleEditAndResend(actionSheetMessageId)}>
                          Edit & Resend
                        </button>
                      ) : null}
                      <button className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 text-left text-base" onClick={closeMessageActionSheet}>
                        Cancel
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : null}

        {editModalOpen ? (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4" onClick={closeImageEditor}>
            <div className="w-full max-w-3xl rounded-2xl bg-[var(--panel)] p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-3 text-lg font-semibold">Edit Image</h3>
              <div className="flex gap-4">
                <div className="w-1/2">
                  {editModalImage ? <img src={editModalImage} alt="preview" className="w-full rounded-md" /> : <div className="h-48 w-full rounded-md bg-[var(--border)]"></div>}
                  <div className="mt-2 text-sm text-muted-foreground">Original: {editModalMeta?.source ?? 'unknown'}</div>
                  {editModalHistory.length > 0 && (
                    <div className="mt-2">
                      <div className="text-sm font-medium">History</div>
                      <ul className="mt-1 text-sm list-disc list-inside">
                        {editModalHistory.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="w-1/2">
                  <label className="block text-sm font-medium">Edit instructions</label>
                  <textarea value={editInstructions} onChange={(e) => setEditInstructions(e.target.value)} className="mt-1 h-48 w-full rounded-md border p-2" placeholder="Describe the edit to apply (e.g. make background transparent)"></textarea>
                  <div className="mt-4 flex gap-2">
                    <button className="rounded-lg bg-blue-600 px-4 py-2 text-white" onClick={confirmImageEdit}>Apply</button>
                    <button className="rounded-lg border px-4 py-2" onClick={closeImageEditor}>Cancel</button>
                    <button className="rounded-lg border px-4 py-2" onClick={undoImageEdit}>Undo</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <input ref={imageFileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleAttach} />
        <input ref={generalFileInputRef} type="file" multiple className="hidden" onChange={handleAttach} />
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
