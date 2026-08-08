import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const { data } = await supabaseServer.from('wai_usage').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
    return NextResponse.json({ usage: data ?? [] });
  } catch (e) {
    console.error('[usage GET] exception', e);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const body = await req.json();
    const event_type = typeof body?.event_type === 'string' ? body.event_type : 'unknown';
    const tokens = Number(body?.tokens ?? 0);
    const cost = Number(body?.cost ?? 0.0);
    const metadata = body?.metadata ?? {};
    const { error } = await supabaseServer.from('wai_usage').insert({ user_id: user.id, event_type, tokens, cost, metadata });
    if (error) {
      console.error('[usage POST] db error', error);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[usage POST] exception', e);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}
