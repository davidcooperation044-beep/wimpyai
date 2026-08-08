import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';
import { nanoid } from 'nanoid';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

    const body = await req.json();
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!conversationId) return NextResponse.json({ error: 'invalid' }, { status: 400 });

    const token = nanoid(12);
    const { data, error } = await supabaseServer.from('wai_shares').insert({ conversation_id: conversationId, token }).select().single();
    if (error) {
      console.error('[share/create] supabase error', error);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    const url = `${process.env.NEXT_PUBLIC_BASE_URL || ''}/share/${token}`;
    return NextResponse.json({ url, token, share: data });
  } catch (error) {
    console.error('[share/create] exception', error);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}
