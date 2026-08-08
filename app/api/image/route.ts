import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getQuotaState, getQuotaWindowStart } from '@/lib/quota';
import { getUserFromBearerToken } from '@/lib/supabase-server';
import { getUserQuotaUsage, getUserPlanIsPro, incrementUserQuotaUsage } from '@/lib/quota-db';
import { modelRegistry } from '@/lib/models';
import { recordUsage } from '@/lib/usage';

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

    const response = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelRegistry.image,
        prompt,
      }),
    });

    const payload = await response.json().catch(() => ({} as any));
    if (!response.ok) {
      return Response.json({ error: 'Image generation failed.', detail: payload }, { status: 500 });
    }

    let imageUrl = '';
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

    const usageTokens = payload.usage?.total_tokens;
    if (user && typeof usageTokens === 'number') {
      await incrementUserQuotaUsage(user.id, usageTokens);
      try {
        await recordUsage({ userId: user.id, event_type: 'image_generation', tokens: usageTokens, metadata: { promptLength: (prompt || '').length } });
      } catch (e) {
        console.warn('[usage] failed to record image generation (image route)', e);
      }
    }

    if (!imageUrl) {
      return Response.json({ error: 'Image generation failed.' }, { status: 500 });
    }

    return Response.json({ imageUrl, alt: `Generated image for: ${prompt}`, quota });
  } catch {
    return Response.json({ error: 'Image generation failed.' }, { status: 500 });
  }
}
