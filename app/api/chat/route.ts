import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getQuotaState, getQuotaWindowStart } from '@/lib/quota';
import { getUserFromBearerToken } from '@/lib/supabase-server';
import { getUserQuotaUsage, incrementUserQuotaUsage, getUserPlanIsPro } from '@/lib/quota-db';
import { modelRegistry } from '@/lib/models';

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
  const { prompt, persona = 'Serious', attachments = [], history = [] } = body;

  const isPro = user ? await getUserPlanIsPro(user) : false;
  const windowStartMs = getQuotaWindowStart();
  const tokensUsed = user ? await getUserQuotaUsage(user.id) : 0;
  const quota = getQuotaState(tokensUsed, isPro, windowStartMs);

  if (!user && process.env.REQUIRE_AUTH_FOR_CHAT === 'true') {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (quota.remaining <= 0) {
    return Response.json({ error: 'quota-exceeded', resetsAt: quota.resetsAt }, { status: 429 });
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
      tools: [
        {
          name: 'generate_image',
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
                size: {
                  type: 'string',
                  enum: ['256x256', '512x512', '1024x1024'],
                  description: 'The requested image size.',
                },
              },
              required: ['prompt'],
            },
          },
        },
      ],
      messages: [
        {
          role: 'system',
          content: `You are WIMPY, built by Wimpy Cooperations. Today's date is ${today}. You can generate images when asked — use the generate_image tool. Use the prior conversation turns provided to you as context; remember details the user already told you and stay consistent with earlier answers.`,
        },
        {
          role: 'system',
          content: `Respond in ${persona} mode. Keep answers accurate and useful.`,
        },
        {
          role: 'system',
          content: `Formatting rule for math: whenever your answer includes a mathematical expression, equation, or calculation, format it as LaTeX. Use $...$ for inline math and $$...$$ on its own line for standalone/display equations and multi-step derivations (one step per line inside the $$ block where helpful). Never write math as plain unformatted text.`,
        },
        ...sanitizedHistory,
        userMessage,
      ],
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
            const imageResponse = await generateImage(functionArgs.prompt, functionArgs.size || '1024x1024');
            if (imageResponse?.imageUrl) {
              if (!assistantText.trim()) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: 'Here is your image:', requestId, quota })}\n\n`));
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ imageUrl: imageResponse.imageUrl, requestId, quota })}\n\n`));
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: '\n\n(Image generation returned no image — please try again.)', requestId, quota })}\n\n`));
            }
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: '\n\n(Image generation failed.)', requestId, quota })}\n\n`));
          }
        }

        if (user && finalUsage !== null) {
          await incrementUserQuotaUsage(user.id, finalUsage);
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

async function generateImage(prompt: string, size: string) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://wimpyai.example',
      'X-Title': 'WimpyAI',
    },
    body: JSON.stringify({
      model: modelRegistry.image,
      messages: [
        {
          role: 'system',
          content: 'You are WIMPY, built by Wimpy Cooperations. Generate a single image from the user prompt and return it as a direct image URL.',
        },
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
      modalities: ['image'],
      size,
    }),
  });

  const payload = await response.json();
  const message = payload.choices?.[0]?.message;
  let imageUrl: string | undefined;

  if (typeof message?.content === 'string') {
    imageUrl = message.content.trim();
  } else if (Array.isArray(message?.content)) {
    for (const item of message.content) {
      if (item?.type === 'image_url' && item?.image_url?.url) {
        imageUrl = item.image_url.url;
        break;
      }
      if (item?.type === 'text' && typeof item.text === 'string' && item.text.includes('http')) {
        const match = item.text.match(/https?:\/\/[^\s]+/);
        if (match) {
          imageUrl = match[0];
          break;
        }
      }
    }
  }

  if (!imageUrl && Array.isArray(payload.data) && payload.data[0]?.url) {
    imageUrl = payload.data[0].url;
  }

  return imageUrl ? { imageUrl } : null;
}