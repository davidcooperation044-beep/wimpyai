import { supabase } from './supabase';

export type WimpyPlan = 'Free' | 'Pro';

export function buildWimpyIDLoginUrl(appUrl: string, mode: 'login' | 'signup' = 'login') {
  const redirectUrl = new URL(appUrl);
  return `https://id.wimpy-corp.com.ng/${mode}?redirect=${encodeURIComponent(redirectUrl.toString())}`;
}

export function buildWimpyPayUrl(appUrl: string, plan: WimpyPlan = 'Pro') {
  const redirectUrl = new URL('/wimpy-pay', appUrl);
  redirectUrl.searchParams.set('plan', plan);
  return `https://pay.wimpy-corp.com.ng/plans?redirect=${encodeURIComponent(redirectUrl.toString())}&plan=${plan}`;
}

export async function bootstrapWimpyIDSession() {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error || !data.session?.user) {
      return null;
    }
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return null;

  const displayName =
    typeof user.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name
      : user.email?.split('@')[0] ?? 'Wimpy Member';

  return {
    displayName,
    wimpyId: user.id,
    plan: user.app_metadata?.plan === 'Pro' ? 'Pro' : 'Free',
  };
}

