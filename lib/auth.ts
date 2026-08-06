export type WimpyPlan = 'Free' | 'Pro';
export type WimpyPaymentStatus = 'paid' | 'failed' | 'pending';

export function buildWimpyIDLoginUrl(appUrl: string, mode: 'login' | 'signup' = 'login') {
  const redirectUrl = new URL(appUrl);
  return `https://id.wimpy-corp.com.ng/${mode}?redirect=${encodeURIComponent(redirectUrl.toString())}`;
}

export function buildWimpyPayUrl(appUrl: string, plan: WimpyPlan = 'Pro') {
  const redirectUrl = new URL(appUrl);
  redirectUrl.searchParams.set('plan', plan);
  redirectUrl.searchParams.set('payment_status', 'paid');
  return `https://pay.wimpy-corp.com.ng/checkout?redirect=${encodeURIComponent(redirectUrl.toString())}&plan=${plan}`;
}

export function bootstrapWimpyIDSession() {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const userId = params.get('user_id');
  const displayName = params.get('display_name');

  if (accessToken && refreshToken) {
    void window.history.replaceState({}, '', window.location.pathname + window.location.search);
    return {
      displayName: displayName || 'Wimpy Member',
      wimpyId: userId || `WIMPY-${Math.floor(Math.random() * 9000 + 1000)}`,
    };
  }

  return null;
}

export function bootstrapWimpyPaySession() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get('payment_status') as WimpyPaymentStatus | null;
  const plan = params.get('plan') as WimpyPlan | null;

  if (paymentStatus) {
    const cleaned = new URL(window.location.href);
    cleaned.searchParams.delete('payment_status');
    cleaned.searchParams.delete('plan');
    window.history.replaceState({}, '', cleaned.pathname + cleaned.search);

    return {
      paymentStatus,
      plan: plan === 'Pro' ? 'Pro' : 'Free',
    };
  }

  return null;
}
