import { NextRequest } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';

function buildReference(userId: string) {
  return `wimpyai-${userId}-${Date.now()}`;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const user = await getUserFromBearerToken(authHeader);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const planName = body.plan ?? body.plan_name ?? 'Pro';
  const reference = body.reference ?? buildReference(user.id);

  const wimpyPayUrl = process.env.WIMPYPAY_API_URL;
  const internalApiKey = process.env.WIMPYPAY_INTERNAL_API_KEY;
  if (!wimpyPayUrl || !internalApiKey) {
    return Response.json({ error: 'WimpyPay is not configured' }, { status: 500 });
  }

  const upstream = await fetch(`${wimpyPayUrl}/api/external/subscribe`, {
    method: 'POST',
    headers: {
      'x-internal-api-key': internalApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: user.id,
      product_name: 'wimpyai',
      plan_name: planName,
      reference,
    }),
  });

  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    if (data.error === 'insufficient-funds') {
      return Response.json(
        { error: 'insufficient-funds', requiredAmount: data.requiredAmount, currentBalance: data.currentBalance },
        { status: 402 }
      );
    }
    return Response.json(data, { status: upstream.status });
  }

  await supabaseServer.from('subscriptions').upsert(
    {
      user_id: user.id,
      product_name: 'wimpyai',
      plan: planName,
      status: 'active',
      current_period_end: data.current_period_end ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,product_name' }
  );

  const existingAppMetadata = typeof user.app_metadata === 'object' && user.app_metadata !== null ? user.app_metadata : {};
  await supabaseServer.auth.admin.updateUserById(user.id, {
    app_metadata: { ...existingAppMetadata, plan: planName },
  });

  return Response.json({ success: true, plan: planName, subscription: data });
}
