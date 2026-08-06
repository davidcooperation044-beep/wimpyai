"use client";

import { useEffect, useMemo, useState } from 'react';
import { type KeyboardEvent, type ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Sparkles, Plus, Moon, SunMedium, SendHorizontal } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { buildWimpyIDLoginUrl, bootstrapWimpyIDSession } from '@/lib/auth';

type MessageRole = 'assistant' | 'user' | 'system';

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  image?: string;
  imageUrl?: string;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};

type ProfileState = {
  isLoggedIn: boolean;
  displayName: string;
  plan: 'Free' | 'Pro';
  lastLogin: string | null;
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

function copyText(text: string) {
  navigator.clipboard.writeText(text);
}

export default function HomePage() {
  const [dark, setDark] = useState(false);
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
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [inputImageName, setInputImageName] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [view, setView] = useState<'chat' | 'profile'>('chat');
  const [profile, setProfile] = useState<ProfileState>(() => {
    if (typeof window === 'undefined') return { isLoggedIn: false, displayName: 'Guest', plan: 'Free', lastLogin: null };
    try {
      const saved = window.localStorage.getItem('wimpyai-profile-v1');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ProfileState>;
        return {
          isLoggedIn: Boolean(parsed.isLoggedIn),
          displayName: typeof parsed.displayName === 'string' ? parsed.displayName : 'Guest',
          plan: parsed.plan === 'Pro' ? 'Pro' : 'Free',
          lastLogin: typeof parsed.lastLogin === 'string' ? parsed.lastLogin : null,
        };
      }
    } catch {
      // ignore invalid cache
    }
    return { isLoggedIn: false, displayName: 'Guest', plan: 'Free', lastLogin: null };
  });

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? conversations[0],
    [conversations, activeConversationId]
  );

  const isBusy = isStreaming || isGeneratingImage;
  const pendingAssistantMessage = activeConversation?.messages[activeConversation.messages.length - 1];

  useEffect(() => {
    window.localStorage.setItem('wimpyai-conversations-v1', JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    window.localStorage.setItem('wimpyai-profile-v1', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const authenticated = bootstrapWimpyIDSession();
    if (authenticated) {
      setProfile((prev) => ({
        ...prev,
        isLoggedIn: true,
        displayName: prev.displayName === 'Guest' ? 'Wimpy Member' : prev.displayName,
        lastLogin: new Date().toISOString(),
      }));
    }
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

  const sendMessage = async () => {
    if ((!draft.trim() && !inputImage) || isStreaming) return;
    const content = draft.trim();
    const userMessage: Message = { id: `msg-${Date.now()}`, role: 'user', content: content || 'Image uploaded', image: inputImage || undefined };
    const assistantId = `msg-${Date.now() + 1}`;
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              title: conversation.messages.length === 1 && conversation.title === 'New chat' ? (content || inputImageName || 'Image').slice(0, 40) : conversation.title,
              messages: [...conversation.messages, userMessage, { id: assistantId, role: 'assistant', content: '' }],
            }
          : conversation
      )
    );
    setDraft('');
    setInputImage(null);
    setInputImageName('');
    setIsStreaming(true);

    try {
      const response = await fetch(inputImage ? '/api/upload-image' : '/api/chat', {
        method: 'POST',
        headers: inputImage ? {} : { 'Content-Type': 'application/json' },
        body: inputImage
          ? JSON.stringify({ prompt: content || 'Describe this image.', image: inputImage, persona: mode })
          : JSON.stringify({ prompt: content, persona: mode }),
      });

      if (!response.ok) {
        throw new Error('Unable to reach the chat API.');
      }

      if (inputImage) {
        const payload = await response.json();
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === activeConversationId
              ? {
                  ...conversation,
                  messages: conversation.messages.map((message: Message) =>
                    message.id === assistantId ? { ...message, content: payload.analysis || 'I could not analyze that image.' } : message
                  ),
                }
              : conversation
          )
        );
      } else {
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
                          messages: conversation.messages.map((message: Message) =>
                            message.id === assistantId ? { ...message, content: accumulated } : message
                          ),
                        }
                      : conversation
                  )
                );
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      }
    } catch {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message: Message) =>
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

  const handleImageSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setInputImage(typeof reader.result === 'string' ? reader.result : null);
      setInputImageName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleWimpyIDLogin = () => {
    if (typeof window === 'undefined') return;
    const loginUrl = buildWimpyIDLoginUrl(window.location.origin, 'login');
    window.open(loginUrl, '_blank', 'noopener,noreferrer');
    setProfile((prev) => ({
      ...prev,
      isLoggedIn: true,
      displayName: prev.displayName === 'Guest' ? 'Wimpy Member' : prev.displayName,
      lastLogin: new Date().toISOString(),
    }));
  };

  const handleSubscriptionToggle = () => {
    setProfile((prev) => ({
      ...prev,
      plan: prev.plan === 'Free' ? 'Pro' : 'Free',
    }));
  };

  const generateImage = async () => {
    if (!draft.trim() || isGeneratingImage) return;
    const prompt = draft.trim();
    setDraft('');
    setIsGeneratingImage(true);
    const userMessage: Message = { id: `msg-${Date.now()}`, role: 'user', content: `Generate: ${prompt}` };
    const assistantId = `msg-${Date.now() + 1}`;
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              title: conversation.messages.length === 1 && conversation.title === 'New chat' ? prompt.slice(0, 40) : conversation.title,
              messages: [...conversation.messages, userMessage, { id: assistantId, role: 'assistant', content: '', imageUrl: '' }],
            }
          : conversation
      )
    );

    try {
      const response = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, persona: mode }),
      });
      const payload = await response.json();
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message: Message) =>
                  message.id === assistantId ? { ...message, content: payload.alt || 'Image ready.', imageUrl: payload.imageUrl || '' } : message
                ),
              }
            : conversation
        )
      );
    } catch {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message: Message) =>
                  message.id === assistantId ? { ...message, content: 'Image generation failed.' } : message
                ),
              }
            : conversation
        )
      );
    } finally {
      setIsGeneratingImage(false);
    }
  };

  return (
    <main className={dark ? 'dark' : ''}>
      <div className="h-screen overflow-hidden bg-[var(--bg)] text-[var(--ink)] transition-colors">
        <div className="mx-auto flex h-screen max-w-7xl flex-col lg:flex-row">
          <aside className="w-full border-b border-[var(--border)] bg-[var(--panel)] p-4 lg:w-80 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">WimpyAI</p>
                <p className="text-sm text-[var(--muted)]">Claude-style assistant</p>
              </div>
              <button className="rounded-full border border-[var(--border)] p-2" onClick={() => setDark((v) => !v)} aria-label="toggle theme">
                {dark ? <SunMedium size={16} /> : <Moon size={16} />}
              </button>
            </div>
            <div className="mt-5 flex gap-2">
              <button className={`flex-1 rounded-2xl border px-3 py-2 text-left text-sm ${view === 'chat' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--panel-strong)]'}`} onClick={() => setView('chat')}>
                Chat
              </button>
              <button className={`flex-1 rounded-2xl border px-3 py-2 text-left text-sm ${view === 'profile' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--panel-strong)]'}`} onClick={() => setView('profile')}>
                Profile
              </button>
            </div>
            <button className="mt-5 flex w-full items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-left text-sm" onClick={createConversation}>
              <Plus size={16} /> New chat
            </button>
            <div className="mt-6 space-y-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`w-full rounded-2xl px-3 py-3 text-left text-sm ${activeConversationId === conversation.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-strong)]'}`}
                  onClick={() => {
                    setActiveConversationId(conversation.id);
                    setView('chat');
                  }}
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

              {view === 'profile' ? (
                <div className="flex-1 min-h-0 overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
                  <div className="mx-auto flex max-w-2xl flex-col gap-4">
                    <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{profile.displayName}</p>
                          <p className="text-sm text-[var(--muted)]">{profile.isLoggedIn ? 'Connected with WimpyID' : 'Not signed in yet'}</p>
                        </div>
                        <button className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white" onClick={handleWimpyIDLogin}>
                          {profile.isLoggedIn ? 'Reconnect' : 'Log in with WimpyID'}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">WimpyPay subscription</p>
                          <p className="text-sm text-[var(--muted)]">Current plan: {profile.plan}</p>
                        </div>
                        <button className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm" onClick={handleSubscriptionToggle}>
                          {profile.plan === 'Free' ? 'Upgrade to Pro' : 'Downgrade to Free'}
                        </button>
                      </div>
                      <p className="mt-3 text-sm text-[var(--muted)]">WimpyPay lets you unlock premium usage, faster replies, and richer image generation.</p>
                    </div>
                  </div>
                </div>
              ) : (
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
                          {message.image ? (
                            <img src={message.image} alt="Uploaded content" className="mb-3 max-h-64 rounded-xl object-cover" />
                          ) : null}
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
              )}

              <div className="shrink-0 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-sm">
                {inputImage ? (
                  <div className="mb-3 flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm">
                    <span>Attached: {inputImageName}</span>
                    <button className="text-[var(--muted)]" onClick={() => { setInputImage(null); setInputImageName(''); }}>Remove</button>
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
                    <label className="cursor-pointer rounded-full border border-[var(--border)] px-3 py-1.5 text-sm" htmlFor="image-upload">Upload image</label>
                    <input id="image-upload" type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                    <button className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm" onClick={generateImage} disabled={isBusy}>
                      {isGeneratingImage ? 'Generating…' : 'Generate image'}
                    </button>
                  </div>
                  <div className="text-sm text-[var(--muted)]">Mode: {mode}</div>
                  <button className={`flex items-center justify-center rounded-full bg-[var(--accent)] text-sm font-medium text-white ${isBusy ? 'h-10 w-10' : 'gap-2 px-4 py-2'}`} onClick={() => void sendMessage()} disabled={isBusy}>
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
      </div>
    </main>
  );
}
