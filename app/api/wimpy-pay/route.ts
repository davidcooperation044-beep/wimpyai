import { NextRequest } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const user = await getUserFromBearerToken(authHeader);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: subscriptions, error: subscriptionError } = await supabaseServer
    .from('subscriptions')
    .select('id, status, plan, product_name, current_period_end')
    .eq('user_id', user.id)
    .eq('product_name', 'wimpyai')
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (subscriptionError) {
    return Response.json({ error: 'Unable to query subscription status.' }, { status: 500 });
  }

  const subscription = Array.isArray(subscriptions) ? subscriptions[0] : null;
  if (!subscription || subscription.plan !== 'Pro' || subscription.status !== 'active') {
    return Response.json({ error: 'No active Pro subscription found.' }, { status: 402 });
  }

  const existingAppMetadata = typeof user.app_metadata === 'object' && user.app_metadata !== null ? user.app_metadata : {};
  const { error: updateError } = await supabaseServer.auth.admin.updateUserById(user.id, {
    app_metadata: { ...existingAppMetadata, plan: 'Pro' },
  });

  if (updateError) {
    return Response.json({ error: 'Unable to update user plan.' }, { status: 500 });
  }

  return Response.json({ plan: 'Pro', subscription });
}
