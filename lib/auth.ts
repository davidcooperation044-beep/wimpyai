export function buildWimpyIDLoginUrl(appUrl: string, mode: 'login' | 'signup' = 'login') {
  const redirectUrl = new URL(appUrl);
  return `https://id.wimpy-corp.com.ng/${mode}?redirect=${encodeURIComponent(redirectUrl.toString())}`;
}

export function bootstrapWimpyIDSession() {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (accessToken && refreshToken) {
    void window.history.replaceState({}, '', window.location.pathname + window.location.search);
    return true;
  }

  return false;
}
