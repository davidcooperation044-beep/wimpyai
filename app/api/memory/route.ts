import { NextRequest } from 'next/server';
import { getUserFromBearerToken } from '@/lib/supabase-server';
import { getUserMemory, rememberForUser, deleteMemoryItem } from '@/lib/memory';

export async function GET(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const mem = await getUserMemory(user.id);
  return Response.json({ memory: mem });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const body = await req.json();
  const { key, value } = body;
  if (!key || !value) return Response.json({ error: 'Missing key/value' }, { status: 400 });
  const item = await rememberForUser(user.id, String(key), String(value));
  return Response.json({ item });
}

export async function DELETE(req: NextRequest) {
  const user = await getUserFromBearerToken(req.headers.get('authorization'));
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const body = await req.json();
  const { id } = body;
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  await deleteMemoryItem(user.id, String(id));
  return Response.json({ success: true });
}
