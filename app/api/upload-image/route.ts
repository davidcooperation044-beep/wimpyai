import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { modelRegistry } from '@/lib/models';
import { getUserFromBearerToken } from '@/lib/supabase-server';
import { recordUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  const userId = user?.id ?? 'guest';

  const rateLimit = checkRateLimit(`upload-image:${userId}`);
  if (!rateLimit.allowed) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { prompt, image, persona = 'Serious' } = body;

    if (!process.env.OPENROUTER_API_KEY) {
      return Response.json({ error: 'OpenRouter is not configured yet.' }, { status: 500 });
    }

    if (!image || typeof image !== 'string') {
      return Response.json({ error: 'Invalid image payload.' }, { status: 400 });
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
        model: modelRegistry.vision,
        messages: [
          {
            role: 'system',
            content: `You are WIMPY, built by Wimpy Cooperations. Respond in ${persona} mode. Analyze the supplied image carefully and answer the user's question.`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt || 'Describe this image.' },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('[upload-image] OpenRouter request failed', response.status, payload);
      return Response.json({ error: 'Image analysis failed.', detail: payload?.error || payload }, { status: 500 });
    }

    const analysis = payload?.choices?.[0]?.message?.content || 'I could not analyze that image right now.';
    try {
      if (user) {
        const estimated = Math.max(5, Math.ceil((prompt || '').length / 50));
        await recordUsage({ userId: user.id, event_type: 'vision_analysis', tokens: estimated, metadata: { promptLength: (prompt || '').length } });
      }
    } catch (e) {
      console.warn('[usage] failed to record upload-image usage', e);
    }

    return Response.json({ analysis });
  } catch (error) {
    console.error('[upload-image] failed', error);
    return Response.json({ error: 'Image analysis failed.' }, { status: 500 });
  }
}
