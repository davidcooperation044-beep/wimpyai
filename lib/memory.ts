import { supabaseServer } from './supabase-server';
// Use built-in crypto to generate UUIDs to avoid an extra dependency

export type MemoryItem = { id: string; key: string; value: string; created_at: string };

export async function getUserMemory(userId: string): Promise<MemoryItem[]> {
  if (!userId) return [];
  const { data, error } = await supabaseServer
    .from('wai_memory')
    .select('payload')
    .eq('user_id', userId)
    .single();

  if (error) return [];
  const payload = data?.payload ?? [];
  return Array.isArray(payload) ? payload as MemoryItem[] : [];
}

export async function rememberForUser(userId: string, key: string, value: string) {
  const now = new Date().toISOString();
  const item: MemoryItem = { id: crypto.randomUUID(), key, value, created_at: now };

  // Fetch existing payload
  const { data, error } = await supabaseServer.from('wai_memory').select('payload').eq('user_id', userId).single();
  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows found; we'll insert
  }

  let payload = Array.isArray(data?.payload) ? data.payload : [];
  payload = [...payload, item];

  // Upsert the row
  await supabaseServer.from('wai_memory').upsert({ user_id: userId, payload, updated_at: now }, { onConflict: 'user_id' });
  return item;
}

export async function deleteMemoryItem(userId: string, itemId: string) {
  const { data } = await supabaseServer.from('wai_memory').select('payload').eq('user_id', userId).single();
  const payload = Array.isArray(data?.payload) ? data.payload : [];
  const next = payload.filter((it: any) => it.id !== itemId);
  await supabaseServer.from('wai_memory').update({ payload: next, updated_at: new Date().toISOString() }).eq('user_id', userId);
  return true;
}
