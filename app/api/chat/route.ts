import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getQuotaState, getQuotaWindowStart } from '@/lib/quota';
import { getUserFromBearerToken } from '@/lib/supabase-server';
import { recordUsage } from '@/lib/usage';
import { getUserQuotaUsage, incrementUserQuotaUsage, getUserPlanIsPro } from '@/lib/quota-db';
import { modelRegistry } from '@/lib/models';
import { getUserMemory, rememberForUser } from '@/lib/memory';

export async function POST(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  const userId = user?.id ?? 'guest';

  const requestId = crypto.randomUUID();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitKey = userId === 'guest' ? `chat:guest:${ip}` : `chat:${userId}`;
  const rateLimit = checkRateLimit(rateLimitKey);

  if (!rateLimit.allowed) {
    return Response.json({ error: 'Rate limit exceeded', retryAfterMs: rateLimit.retryAfterMs }, { status: 429 });
  }

  const body = await req.json();
  const { prompt, persona = 'Serious', context: contextOverride, attachments = [], history = [] } = body;

  const isPro = user ? await getUserPlanIsPro(user) : false;
  const windowStartMs = getQuotaWindowStart();
  const tokensUsed = user ? await getUserQuotaUsage(user.id) : 0;
  const quota = getQuotaState(tokensUsed, isPro, windowStartMs);

  if (!user && process.env.REQUIRE_AUTH_FOR_CHAT === 'true') {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (quota.remaining <= 0) {
    return Response.json({ error: 'quota-exceeded', quota, resetsAt: quota.resetsAt }, { status: 429 });
  }

  // Sanitize/clip incoming history so we don't blow up token usage and so we
  // only ever forward well-formed {role, content} entries to OpenRouter.
  // Images from older turns are intentionally dropped here (kept as text-only
  // context) — only the *current* turn's attachments are sent as images.
  const MAX_HISTORY_MESSAGES = 20;
  const sanitizedHistory = Array.isArray(history)
    ? history
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
        .slice(-MAX_HISTORY_MESSAGES)
        .map((m: any) => ({ role: m.role, content: m.content }))
    : [];

  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json({ error: 'OpenRouter is not configured yet.', requestId }, { status: 500 });
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const userMessage = attachments.length
    ? {
        role: 'user',
        content: [
          { type: 'text', text: prompt || 'Please describe the attached image(s).' },
          ...attachments.map((attachment: { url: string }) => ({
            type: 'image_url',
            image_url: { url: attachment.url },
          })),
        ],
      }
    : { role: 'user', content: prompt };

  // Always include a fixed identity system message first.
  const identityMessage = {
    role: 'system',
    content: `You are WIMPY, built by Wimpy Cooperations. Today's date is ${today}. You can generate images when asked — use the generate_image tool. Use the prior conversation turns provided to you as context; remember details the user already told you and stay consistent with earlier answers.`,
  };

  // Persona or context override (context takes precedence if supplied)
  const personaMessage = {
    role: 'system',
    content: contextOverride && typeof contextOverride === 'string' && contextOverride.trim().length > 0 ? contextOverride : `Respond in ${persona} mode. Keep answers accurate and useful.`,
  };

  // If the user has saved memory, fold it into the system prompt as 'what you know'.
  let memorySystemMessage = null as any;
  if (user) {
    try {
      const mem = await getUserMemory(user.id);
      if (Array.isArray(mem) && mem.length > 0) {
        const summary = mem.map((m: any) => `${m.key}: ${m.value}`).join('\n');
        memorySystemMessage = { role: 'system', content: `What you know about the user:\n${summary}` };
      }
    } catch (e) {
      console.error('[chat] failed to load user memory', e);
    }
  }

  const baseMessages = [identityMessage, personaMessage,
    {
      role: 'system',
      content: `Formatting rule for math: every mathematical expression, equation, variable, or calculation — including every intermediate step in a multi-step derivation, not just the final result — must be wrapped in $...$ for inline math or $$...$$ on its own line for standalone/display math. Do NOT use square-bracket math delimiters like [ ... ] or \( ... \) / \[ ... \] anywhere — only $ and $$ are recognized by the renderer. A LaTeX command (\times, \text{}, \frac{}{}, \quad, etc.) must never appear outside a $...$ or $$...$$ region.`,
    },
    ...(process.env.TAVILY_API_KEY
      ? [
          {
            role: 'system',
            content: `If a question depends on events, prices, releases, sports results, or anything else that may have changed recently, use the web_search tool rather than answering from memory. Don't guess about anything time-sensitive.`,
          },
        ]
      : []),
    ...sanitizedHistory,
    userMessage,
  ];

  if (memorySystemMessage) {
    // insert memory right after identity/persona for clarity
    baseMessages.splice(2, 0, memorySystemMessage);
  }

  const generateImageTool = {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate an image from a text prompt and return the image URL.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The text prompt to generate an image from.',
          },
          source_image_url: {
            type: 'string',
            description: 'Optional URL of an existing image to use as the source for editing/variation.',
          },
          size: {
            type: 'string',
            enum: ['256x256', '512x512', '1024x1024'],
            description: 'The requested image size.',
          },
        },
        required: ['prompt'],
      },
    },
  };

  const webSearchTool = {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current information. Use this whenever a question depends on recent events, current prices, releases, news, sports results, or anything else that may have changed since your training data — do not answer time-sensitive questions from memory alone.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query.',
          },
        },
        required: ['query'],
      },
    },
  };

  const rememberTool = {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Store a short user fact or preference for future conversations.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['key', 'value'],
      },
    },
  };

  const tools = process.env.TAVILY_API_KEY ? [generateImageTool, webSearchTool, rememberTool] : [generateImageTool, rememberTool];
  let finalMessages: Array<any> = baseMessages;
  let detectionUsage = 0;

  if (process.env.TAVILY_API_KEY && prompt?.trim()) {
    try {
      const detectionResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://wimpyai.example',
          'X-Title': 'WimpyAI',
        },
        body: JSON.stringify({
          model: modelRegistry.chat,
          stream: false,
          tool_choice: 'auto',
          tools,
          messages: baseMessages,
        }),
      });

      const detectionData = await detectionResponse.json().catch(() => ({} as any));
      detectionUsage = detectionData.usage?.total_tokens ?? 0;
      const choice = detectionData.choices?.[0]?.message;
      const toolCalls = choice?.tool_calls ?? [];

            if (toolCalls.length > 0) {
        const resolvedToolCalls: any[] = [];
        const toolResponses: any[] = [];

        for (const tc of toolCalls) {
          if (tc.function?.name === 'web_search') {
            const args = JSON.parse(tc.function.arguments || '{}');
            const query = typeof args.query === 'string' ? args.query : null;
            if (!query) continue;

            const { answer, results } = await webSearch(query);
            const resultsText = [
              answer ? `Summary: ${answer}` : null,
              results.length
                ? results.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.url})`).join('\n')
                : 'No results found.',
            ]
              .filter(Boolean)
              .join('\n\n');

            resolvedToolCalls.push(tc);
            toolResponses.push({ role: 'tool', tool_call_id: tc.id, name: 'web_search', content: resultsText });
            continue;
          }

          console.warn(`[chat] detection pass produced unhandled tool call: ${tc.function?.name}`);
        }

        if (resolvedToolCalls.length > 0) {
          finalMessages = [
            ...baseMessages,
            { role: 'assistant', content: null, tool_calls: resolvedToolCalls },
            ...toolResponses,
          ];
        }
      }
    } catch (error) {
      console.error('[searchDetection] failed', error);
    }
  }

  const assistantToolMsg = finalMessages.find((m: any) => m.role === 'assistant' && m.tool_calls);
  if (assistantToolMsg) {
    const respondedIds = new Set(finalMessages.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id));
    const unresolved = assistantToolMsg.tool_calls.filter((tc: any) => !respondedIds.has(tc.id));
    if (unresolved.length > 0) {
      console.error('[chat] unresolved tool_call_ids before pass 2', unresolved.map((tc: any) => tc.id));
      finalMessages = baseMessages;
    }
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://wimpyai.example',
      'X-Title': 'WimpyAI',
    },
    body: JSON.stringify({
      model: modelRegistry.chat,
      stream: true,
      tool_choice: 'auto',
      tools,
      messages: finalMessages,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const encoder = new TextEncoder();
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'OpenRouter request failed', detail: bodyText, requestId })}\n\n`)
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(errorStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      const toolCalls: Record<number, { name: string | null; arguments: string }> = {};
      let assistantText = '';
      let finalUsage: number | null = null;

      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ requestId, quota, event: 'quota' })}\n\n`));

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              break;
            }
            
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta?.content || '';

              if (parsed.usage?.total_tokens != null) {
                finalUsage = parsed.usage.total_tokens;
              }

              const deltaToolCalls = parsed.choices?.[0]?.delta?.tool_calls;
              if (Array.isArray(deltaToolCalls)) {
                for (const tc of deltaToolCalls) {
                  const idx = typeof tc.index === 'number' ? tc.index : 0;
                  if (!toolCalls[idx]) toolCalls[idx] = { name: null, arguments: '' };
                  if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
                }
              }

              const messageToolCalls = parsed.choices?.[0]?.message?.tool_calls;
              if (Array.isArray(messageToolCalls)) {
                messageToolCalls.forEach((tc: any, idx: number) => {
                  if (!toolCalls[idx]) toolCalls[idx] = { name: null, arguments: '' };
                  if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
                });
              }

              if (delta) {
                assistantText += delta;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta, requestId, quota })}\n\n`));
              }
            } catch {
              // ignore malformed frame
            }
          }
        }

        const imageCall = Object.values(toolCalls).find((tc) => tc.name === 'generate_image');
        if (imageCall) {
          try {
            const functionArgs = JSON.parse(imageCall.arguments || '{}');
            const imageResponse = await generateImage(functionArgs.prompt);

            if (imageResponse?.imageUrl) {
              // record image usage server-side
              try {
                if (user) {
                  const estimated = Number(process.env.EST_IMAGE_TOKENS ?? 50);
                  await recordUsage({ userId: user.id, event_type: 'image_generation', tokens: estimated, metadata: { promptLength: (functionArgs.prompt || '').length, size: functionArgs.size || null, source_image_url: functionArgs.source_image_url || null } });
                }
              } catch (e) {
                console.warn('[usage] failed to record image generation', e);
              }

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ imageUrl: imageResponse.imageUrl, requestId, quota })}\n\n`
                )
              );
            } else {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    delta: '\n\n(Image generation returned no image — please try again.)',
                    requestId,
                    quota,
                  })}\n\n`
                )
              );
            }
          } catch {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ delta: '\n\n(Image generation failed.)', requestId, quota })}\n\n`
              )
            );
          }
        }

        if (user) {
          const totalUsage = (finalUsage ?? 0) + detectionUsage;
          if (totalUsage > 0) {
            await incrementUserQuotaUsage(user.id, totalUsage);
            try {
              await recordUsage({ userId: user.id, event_type: 'chat', tokens: totalUsage, metadata: { detectionUsage } });
            } catch (e) {
              console.warn('[usage] failed to record chat usage', e);
            }
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function GET(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  const userId = user?.id ?? 'guest';

  if (!user && process.env.REQUIRE_AUTH_FOR_CHAT === 'true') {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const isPro = user ? await getUserPlanIsPro(user) : false;
  const windowStartMs = getQuotaWindowStart();
  const tokensUsed = user ? await getUserQuotaUsage(user.id) : 0;
  const quota = getQuotaState(tokensUsed, isPro, windowStartMs);

  return Response.json({ quota, plan: isPro ? 'Pro' : 'Free' });
}

async function generateImage(args: string | { prompt?: string; source_image_url?: string; size?: string }) {
  const parsed = typeof args === 'string' ? { prompt: args } : args ?? {};
  const { prompt = '', source_image_url, size } = parsed;

  const bodyPayload: any = { model: modelRegistry.image, prompt };
  if (size) bodyPayload.size = size;
  if (source_image_url) bodyPayload.image_url = source_image_url;

  const response = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(bodyPayload),
  });

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    console.error('[generateImage] failed', response.status, payload);
    return null;
  }

  let imageUrl: string | undefined;
  if (typeof payload.url === 'string') {
    imageUrl = payload.url;
  } else if (typeof payload.image_base64 === 'string') {
    imageUrl = `data:image/png;base64,${payload.image_base64}`;
  } else if (Array.isArray(payload.data) && payload.data.length > 0) {
    const first = payload.data[0];
    if (typeof first.url === 'string') {
      imageUrl = first.url;
    } else if (typeof first.b64_json === 'string') {
      imageUrl = `data:image/png;base64,${first.b64_json}`;
    } else if (typeof first.image_base64 === 'string') {
      imageUrl = `data:image/png;base64,${first.image_base64}`;
    }
  }

  if (!imageUrl) {
    console.error('[generateImage] unexpected payload format', payload);
  }

  return imageUrl ? { imageUrl } : null;
}

type WebSearchResult = { title: string; snippet: string; url: string };

type WebSearchResponse = { answer: string; results: WebSearchResult[] };

async function webSearch(query: string): Promise<WebSearchResponse> {
  if (!process.env.TAVILY_API_KEY) {
    return { answer: '', results: [] };
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    console.error('[webSearch] failed', response.status, payload);
    return { answer: '', results: [] };
  }

  const answer = typeof payload.answer === 'string' ? payload.answer : '';
  const rawResults = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.data)
    ? payload.data
    : [];

  const results = rawResults
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any) => ({
      title: typeof item.title === 'string' ? item.title : typeof item.heading === 'string' ? item.heading : 'Search result',
      snippet:
        typeof item.snippet === 'string'
          ? item.snippet
          : typeof item.description === 'string'
          ? item.description
          : '',
      url: typeof item.url === 'string' ? item.url : typeof item.link === 'string' ? item.link : '',
    }))
    .filter((item: WebSearchResult) => item.url);

  return { answer, results };
}
