export const FREE_TIER_TOKENS = 3000;
export const FREE_TIER_WINDOW_MS = 7 * 60 * 60 * 1000;

export function getQuotaWindowStart(now = Date.now()) {
  return now - (now % FREE_TIER_WINDOW_MS);
}

export function getQuotaState(tokensUsed: number, isPro = false) {
  const limit = isPro ? FREE_TIER_TOKENS * 5 : FREE_TIER_TOKENS;
  const remaining = Math.max(limit - tokensUsed, 0);
  const resetsAt = new Date(Date.now() + FREE_TIER_WINDOW_MS).toISOString();
  return { limit, remaining, resetsAt };
}
