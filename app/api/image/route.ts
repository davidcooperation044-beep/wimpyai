import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { modelRegistry } from '@/lib/models';
import { getUserFromBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  const userId = user?.id ?? 'guest';

  const rateLimit = checkRateLimit(`image-generate:${userId}`);
  if (!rateLimit.allowed) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });
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

    if (!imageUrl) {
      return Response.json({ error: 'Image generation failed.' }, { status: 500 });
    }

    return Response.json({ imageUrl, alt: `Generated image for: ${prompt}` });
  } catch {
    return Response.json({ error: 'Image generation failed.' }, { status: 500 });
  }
}
