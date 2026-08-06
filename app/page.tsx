"use client";

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Sparkles, Plus, Moon, SunMedium, SendHorizontal } from 'lucide-react';
import 'katex/dist/katex.min.css';

const initialConversation = {
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
  const [conversations, setConversations] = useState([initialConversation]);
  const [activeConversationId, setActiveConversationId] = useState(initialConversation.id);
  const [draft, setDraft] = useState('');

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? conversations[0],
    [conversations, activeConversationId]
  );

  const createConversation = () => {
    const newConversation = {
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

  const sendMessage = () => {
    if (!draft.trim()) return;
    const userMessage = { id: `msg-${Date.now()}`, role: 'user', content: draft.trim() };
    const assistantMessage = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: `This is a starter UI for ${mode.toLowerCase()} mode. The full streaming backend and model integration are wired as the next step.`,
    };
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              title: conversation.messages.length === 1 && conversation.title === 'New chat' ? draft.trim().slice(0, 40) : conversation.title,
              messages: [...conversation.messages, userMessage, assistantMessage],
            }
          : conversation
      )
    );
    setDraft('');
  };

  return (
    <main className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] transition-colors">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
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
          <section className="flex-1 p-4 md:p-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{mode} mode</p>
                  <p className="text-sm text-[var(--muted)]">Calm, precise, and built by Wimpy Cooperations.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className={`rounded-full px-3 py-1.5 text-sm ${mode === 'Serious' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--panel-strong)]'}`} onClick={() => setMode('Serious')}>Serious</button>
                  <button className={`rounded-full px-3 py-1.5 text-sm ${mode === 'Wimpy' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--panel-strong)]'}`} onClick={() => setMode('Wimpy')}>Wimpy</button>
                </div>
              </div>

              <div className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
                {activeConversation?.messages.map((message) => (
                  <article key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>
                    {message.role === 'assistant' ? (
                      <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Sparkles size={16} />
                      </div>
                    ) : null}
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.role === 'user' ? 'bg-[var(--accent)] text-white' : 'bg-transparent'}`}>
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

              <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-sm">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={4}
                  className="w-full resize-none bg-transparent p-2 text-sm outline-none"
                  placeholder="Ask WimpyAI anything…"
                />
                <div className="mt-3 flex items-center justify-between">
                  <div className="text-sm text-[var(--muted)]">Mode: {mode}</div>
                  <button className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white" onClick={sendMessage}>
                    <SendHorizontal size={16} /> Send
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
