import { supabaseServer } from '@/lib/supabase-server';
import { getQuotaWindowStart } from '@/lib/quota';

export async function getUserQuotaUsage(userId: string) {
  const windowStart = new Date(getQuotaWindowStart()).toISOString();
  const { data, error } = await supabaseServer
    .from('quota_usage')
    .select('tokens_used')
    .eq('user_id', userId)
    .eq('window_start', windowStart)
    .maybeSingle();

  if (error) {
    console.error('[quota-db] failed to read quota usage', error);
  }

  return data?.tokens_used ?? 0;
}

export async function incrementUserQuotaUsage(userId: string, tokens: number) {
  const windowStart = new Date(getQuotaWindowStart()).toISOString();
  const { error } = await supabaseServer.rpc('increment_quota_usage', {
    p_user_id: userId,
    p_window_start: windowStart,
    p_tokens: tokens,
  });

  if (error) {
    console.error('[quota-db] failed to increment quota usage', error);
  }
}

export async function getUserPlanIsPro(user: any) {
  if (user?.app_metadata?.plan === 'Pro') {
    return true;
  }

  const planJoinResult = await supabaseServer
    .from('subscriptions')
    .select('plan_id(name)')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!planJoinResult.error && planJoinResult.data?.plan_id?.name) {
    return planJoinResult.data.plan_id.name === 'Pro';
  }

  const legacyResult = await supabaseServer
    .from('subscriptions')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();

  if (legacyResult.error) {
    console.error('[quota-db] failed to read subscription plan', legacyResult.error);
    return false;
  }

  return legacyResult.data?.plan === 'Pro';
}
