import { supabaseServer } from './supabase-server';

export const COST_PER_TOKEN = Number(process.env.COST_PER_TOKEN ?? 0.000002);
export const IMAGE_BASE_COST = Number(process.env.IMAGE_BASE_COST ?? 0.02);

export async function computeCost(tokens: number, eventType?: string) {
  let cost = Number(tokens) * COST_PER_TOKEN;
  if (eventType === 'image_generation') cost += IMAGE_BASE_COST;
  return Number(cost.toFixed(6));
}

export async function recordUsage(opts: {
  userId: string;
  event_type: string;
  tokens?: number;
  metadata?: any;
}) {
  const { userId, event_type, tokens = 0, metadata = {} } = opts;
  try {
    const cost = await computeCost(tokens, event_type);
    const { error } = await supabaseServer.from('wai_usage').insert({ user_id: userId, event_type, tokens, cost, metadata });
    if (error) {
      console.warn('[recordUsage] supabase error', error);
    }
    return { success: !error, cost };
  } catch (e) {
    console.warn('[recordUsage] exception', e);
    return { success: false, cost: 0 };
  }
}
