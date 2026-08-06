import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getQuotaState } from '@/lib/quota';
import { modelRegistry } from '@/lib/models';

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const rateLimitKey = `chat:${requestId}`;
  const rateLimit = checkRateLimit(rateLimitKey);

  if (!rateLimit.allowed) {
    return Response.json({ error: 'Rate limit exceeded', retryAfterMs: rateLimit.retryAfterMs }, { status: 429 });
  }

  const body = await req.json();
  const { prompt, persona = 'Serious' } = body;
  const quota = getQuotaState(0, persona === 'Pro');

  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json({ error: 'OpenRouter is not configured yet.', requestId }, { status: 500 });
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
      messages: [
        {
          role: 'system',
          content: `You are WIMPY, built by Wimpy Cooperations. Respond in ${persona} mode. Keep answers accurate and useful.`,
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    return Response.json({ error: 'OpenRouter request failed', requestId }, { status: 502 });
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
      try {
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
              if (delta) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta, requestId })}\n\n`));
              }
            } catch {
              // ignore malformed frame
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
