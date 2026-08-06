"use client";

import { useEffect, useMemo, useState } from 'react';
import { type KeyboardEvent, type ChangeEvent } from 'react';
import Link from 'next/link';
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
  const [profile, setProfile] = useState<ProfileState>(() => loadJson<ProfileState>('wimpyai-profile-v1', emptyProfile));
  const [settings, setSettings] = useState<SettingsState>(() => loadJson<SettingsState>('wimpyai-settings-v1', emptySettings));
  const [showAuthModal, setShowAuthModal] = useState(() => {
    if (typeof window === 'undefined') return false;
    const dismissed = window.localStorage.getItem('wimpyai-auth-dismissed-v1');
    const savedProfile = loadJson<ProfileState>('wimpyai-profile-v1', emptyProfile);
    return !dismissed && !savedProfile.isConnected;
  });

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? conversations[0],
    [conversations, activeConversationId]
  );

  const isBusy = isStreaming || isRecording;
  const pendingAssistantMessage = activeConversation?.messages[activeConversation.messages.length - 1];

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


  return (
    <main className={settings.darkMode ? 'dark' : ''}>
      <div className="h-screen overflow-hidden bg-[var(--bg)] text-[var(--ink)] transition-colors">
        <div className="mx-auto flex h-screen max-w-7xl flex-col lg:flex-row">
          <aside className="w-full border-b border-[var(--border)] bg-[var(--panel)] p-4 lg:w-80 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">WimpyAI</p>
                <p className="text-sm text-[var(--muted)]">Claude-style assistant</p>
              </div>
              <button className="rounded-full border border-[var(--border)] p-2" onClick={() => setSettings((prev) => ({ ...prev, darkMode: !prev.darkMode }))} aria-label="toggle theme">
                {settings.darkMode ? <SunMedium size={16} /> : <Moon size={16} />}
              </button>
            </div>
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-semibold text-white">
                  {profile.isConnected ? profile.avatarInitials : 'G'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{profile.isConnected ? profile.displayName : 'Guest'}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{profile.isConnected ? profile.userId ?? 'No ID yet' : 'Sign in to unlock your account'}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]">
                <span>{profile.isConnected ? 'Connected' : 'Not connected'}</span>
                <span>{profile.subscriptionStatus === 'active' ? 'Pro active' : 'Free plan'}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="flex-1 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-left text-sm" onClick={() => setShowAuthModal(true)}>
                {profile.isConnected ? 'Account' : 'Sign in'}
              </button>
              <Link className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-center text-sm" href="/profile">
                Profile
              </Link>
            </div>
            <button className="mt-5 flex w-full items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-left text-sm" onClick={createConversation}>
              <Plus size={16} /> New chat
            </button>
            <div className="mt-6 space-y-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`w-full rounded-2xl px-3 py-3 text-left text-sm ${activeConversationId === conversation.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-strong)]'}`}
                  onClick={() => setActiveConversationId(conversation.id)}
                >
                  <div className="font-medium">{conversation.title}</div>
                  <div className="text-xs text-[var(--muted)]">{conversation.messages.length} messages</div>
                </button>
              ))}
            </div>
          </aside>
          <section className="flex-1 min-h-0 p-4 md:p-8">
            <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
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

              <div className="flex-1 min-h-0 overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
                <div className="mx-auto flex max-w-2xl flex-col gap-4">
                  {isBusy && pendingAssistantMessage?.role === 'assistant' && !pendingAssistantMessage.content.trim() ? (
                    <article className="flex gap-3">
                      <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Sparkles size={16} />
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
                  {activeConversation?.messages.map((message) => (
                    <article key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>
                      {message.role === 'assistant' ? (
                        <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                          <Sparkles size={16} />
                        </div>
                      ) : null}
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.role === 'user' ? 'bg-[var(--accent)] text-white' : 'bg-transparent'}`}>
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
                  ))}
                </div>
              </div>

              <div className="shrink-0 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-sm">
                {attachments.length ? (
                  <div className="mb-3 space-y-2">
                    {attachments.map((attachment, index) => (
                      <div key={`${attachment.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm">
                        <span>{attachment.name}</span>
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
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={4}
                  className="w-full resize-none bg-transparent p-2 text-sm outline-none"
                  placeholder={isBusy ? 'WIMPY is responding…' : 'Ask WimpyAI anything…'}
                  disabled={isBusy}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label htmlFor="attachment-upload" className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1.5 text-sm">
                      <Plus size={16} /> Attach
                    </label>
                    <input id="attachment-upload" type="file" multiple className="hidden" onChange={handleAttachmentSelect} />
                  </div>
                  <div className="text-sm text-[var(--muted)]">Mode: {mode}</div>
                  <button className={`flex items-center justify-center rounded-full bg-[var(--accent)] text-sm font-medium text-white ${isBusy ? 'h-10 w-10' : 'gap-2 px-4 py-2'}`} onClick={() => void sendMessage()} disabled={isBusy || (!draft.trim() && !attachments.length)}>
                    {isBusy ? (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:-0.2s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:-0.1s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-white" />
                      </span>
                    ) : (
                      <>
                        <SendHorizontal size={16} />
                        <span>Send</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {showAuthModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl">
              <div className="flex items-start justify-between">
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
      </div>
    </main>
  );
}
