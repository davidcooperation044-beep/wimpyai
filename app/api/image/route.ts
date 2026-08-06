import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { modelRegistry } from '@/lib/models';
import { getUserFromBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`image-generate:${user.id}`);
  if (!rateLimit.allowed) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { prompt, persona = 'Serious' } = body;

    if (!process.env.OPENROUTER_API_KEY) {
      return Response.json({ error: 'OpenRouter is not configured yet.' }, { status: 500 });
    }

    const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://wimpyai.example',
        'X-Title': 'WimpyAI',
      },
      body: JSON.stringify({
        model: modelRegistry.image,
        prompt,
        n: 1,
        size: '1024x1024',
      }),
    });

    const payload = await response.json();
    const imageUrl = payload.data?.[0]?.url || '';
    return Response.json({ imageUrl, alt: `Generated image for: ${prompt}` });
  } catch {
    return Response.json({ error: 'Image generation failed.' }, { status: 500 });
  }
}
