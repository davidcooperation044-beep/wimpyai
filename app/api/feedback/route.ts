import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    const body = await req.json();
    const messageId = typeof body?.messageId === 'string' ? body.messageId : null;
    const vote = typeof body?.vote === 'number' ? body.vote : null;
    if (!messageId || (vote !== 1 && vote !== -1)) return NextResponse.json({ error: 'invalid' }, { status: 400 });

    const { data, error } = await supabaseServer.from('wai_feedback').insert({ message_id: messageId, user_id: user?.id ?? null, vote }).select().single();
    if (error) {
      console.error('[feedback] supabase error', error);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return NextResponse.json({ feedback: data });
  } catch (error) {
    console.error('[feedback] exception', error);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}
