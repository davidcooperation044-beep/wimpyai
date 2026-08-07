import { NextRequest } from 'next/server';
import { getUserFromBearerToken } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const wimpyPayUrl = process.env.WIMPYPAY_API_URL;
  if (!wimpyPayUrl) {
    return Response.json({ error: 'WimpyPay is not configured' }, { status: 500 });
  }

  const upstream = await fetch(`${wimpyPayUrl}/api/wallet`, {
    headers: { Authorization: req.headers.get('authorization') ?? '' },
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return Response.json(payload, { status: upstream.status });
  }

  return Response.json({ userId: user.id, ...payload });
}
