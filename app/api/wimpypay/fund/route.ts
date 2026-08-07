import { NextRequest } from 'next/server';
import { getUserFromBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { amount, return_url } = await req.json().catch(() => ({} as any));
  if (!amount || Number(amount) <= 0) {
    return Response.json({ error: 'amount is required' }, { status: 400 });
  }
  if (!return_url) {
    return Response.json({ error: 'return_url is required' }, { status: 400 });
  }

  const wimpyPayUrl = process.env.WIMPYPAY_API_URL;
  if (!wimpyPayUrl) {
    return Response.json({ error: 'WimpyPay is not configured' }, { status: 500 });
  }

  const upstream = await fetch(`${wimpyPayUrl}/api/wallet/fund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: req.headers.get('authorization') ?? '',
    },
    body: JSON.stringify({ amount: Number(amount), return_url, user_id: user.id }),
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return Response.json(payload, { status: upstream.status });
  }

  return Response.json({
    authorizationUrl: payload.authorizationUrl ?? payload.authorization_url ?? null,
    reference: payload.reference ?? null,
  });
}
