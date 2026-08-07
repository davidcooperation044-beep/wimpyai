import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getQuotaState, getQuotaWindowStart } from '@/lib/quota';
import { getUserFromBearerToken } from '@/lib/supabase-server';
import { getUserQuotaUsage, getUserPlanIsPro, incrementUserQuotaUsage } from '@/lib/quota-db';
import { modelRegistry } from '@/lib/models';

export async function POST(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  const userId = user?.id ?? 'guest';
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitKey = userId === 'guest' ? `image-generate:guest:${ip}` : `image-generate:${userId}`;
  const rateLimit = checkRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return Response.json({ error: 'Rate limit exceeded', retryAfterMs: rateLimit.retryAfterMs }, { status: 429 });
  }

  const isPro = user ? await getUserPlanIsPro(user) : false;
  const windowStartMs = getQuotaWindowStart();
  const tokensUsed = user ? await getUserQuotaUsage(user.id) : 0;
  const quota = getQuotaState(tokensUsed, isPro, windowStartMs);

  if (!user && process.env.REQUIRE_AUTH_FOR_IMAGE === 'true') {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (quota.remaining <= 0) {
    return Response.json({ error: 'quota-exceeded', resetsAt: quota.resetsAt }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { prompt, persona = 'Serious' } = body;

    if (!process.env.OPENROUTER_API_KEY) {
      return Response.json({ error: 'OpenRouter is not configured yet.' }, { status: 500 });
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
        model: modelRegistry.image,
        tool_choice: 'auto',
        tools: [
          {
            name: 'generate_image',
            type: 'function',
            function: {
              name: 'generate_image',
              description: 'Generate an image from a text prompt and return it as a direct image URL.',
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
            content: 'You are WIMPY, built by Wimpy Cooperations. Generate a single image from the user prompt using the generate_image tool and return a direct image URL.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        modalities: ['image'],
        size: '1024x1024',
      }),
    });

    const payload = await response.json();
    const message = payload.choices?.[0]?.message;
    let imageUrl = '';

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

    const usageTokens = payload.usage?.total_tokens;
    if (user && typeof usageTokens === 'number') {
      await incrementUserQuotaUsage(user.id, usageTokens);
    }

    if (!imageUrl) {
      return Response.json({ error: 'Image generation failed.' }, { status: 500 });
    }

    return Response.json({ imageUrl, alt: `Generated image for: ${prompt}`, quota });
  } catch {
    return Response.json({ error: 'Image generation failed.' }, { status: 500 });
  }
}
