import { NextRequest, NextResponse } from 'next/server';
import { modelRegistry } from '@/lib/models';
import { getUserFromBearerToken } from '@/lib/supabase-server';
import { getUserQuotaUsage, incrementUserQuotaUsage, getUserPlanIsPro } from '@/lib/quota-db';
import { getQuotaState, getQuotaWindowStart } from '@/lib/quota';
import { recordUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
    const source = typeof body?.source_image_url === 'string' ? body.source_image_url : null;
    const size = typeof body?.size === 'string' ? body.size : undefined;

    // Quota check (requires auth token). Estimate 50 tokens per image generation.
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    const isPro = user ? await getUserPlanIsPro(user) : false;
    const tokensUsed = user ? await getUserQuotaUsage(user.id) : 0;
    const quota = getQuotaState(tokensUsed, isPro, getQuotaWindowStart());
    if (quota.remaining <= 0) {
      return NextResponse.json({ error: 'quota-exceeded', quota }, { status: 429 });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'OpenRouter not configured' }, { status: 500 });
    }

    const payload: any = { model: modelRegistry.image, prompt };
    if (size) payload.size = size;
    if (source) payload.image_url = source;

    const resp = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await resp.json().catch(() => ({} as any));
    if (!resp.ok) {
      return NextResponse.json({ error: 'generation_failed', detail: json }, { status: 502 });
    }

    let imageUrl: string | null = null;
    if (typeof json.url === 'string') imageUrl = json.url;
    else if (typeof json.image_base64 === 'string') imageUrl = `data:image/png;base64,${json.image_base64}`;
    else if (Array.isArray(json.data) && json.data.length > 0) {
      const first = json.data[0];
      if (typeof first.url === 'string') imageUrl = first.url;
      else if (typeof first.b64_json === 'string') imageUrl = `data:image/png;base64,${first.b64_json}`;
      else if (typeof first.image_base64 === 'string') imageUrl = `data:image/png;base64,${first.image_base64}`;
    }

    if (!imageUrl) return NextResponse.json({ error: 'no_image' }, { status: 502 });

    // Consume quota for the generation
    try {
        if (user) {
        const estimated = Number(process.env.EST_IMAGE_TOKENS ?? 50);
        await incrementUserQuotaUsage(user.id, estimated);
        try {
          await recordUsage({ userId: user.id, event_type: 'image_generation', tokens: estimated, metadata: { promptLength: prompt.length, size, source } });
        } catch (e) {
          console.warn('[usage] failed to record image generation', e);
        }
      }
    } catch (e) {
      console.warn('[generate-image] failed to increment quota usage', e);
    }

    return NextResponse.json({ imageUrl });
  } catch (error: any) {
    console.error('[generate-image] error', error);
    return NextResponse.json({ error: 'exception', detail: String(error?.message ?? error) }, { status: 500 });
  }
}
