import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

    const body = await req.json();
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    const pinned = typeof body?.pinned === 'boolean' ? body.pinned : null;
    if (!conversationId || pinned === null) return NextResponse.json({ error: 'invalid' }, { status: 400 });

    const { data, error } = await supabaseServer.from('wai_conversations').update({ pinned }).eq('id', conversationId).eq('user_id', user.id).select().single();
    if (error) {
      console.error('[pin] supabase error', error);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return NextResponse.json({ conversation: data });
  } catch (error) {
    console.error('[pin] exception', error);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}
