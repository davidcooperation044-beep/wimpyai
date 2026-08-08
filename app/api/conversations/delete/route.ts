import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!conversationId) return NextResponse.json({ error: 'invalid' }, { status: 400 });

    const { error: messageError } = await supabaseServer
      .from('wai_messages')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id);

    if (messageError) {
      console.error('[delete] failed to delete messages', messageError);
      return NextResponse.json({ error: 'failed_to_delete_messages' }, { status: 500 });
    }

    const { error: conversationError } = await supabaseServer
      .from('wai_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', user.id);

    if (conversationError) {
      console.error('[delete] failed to delete conversation', conversationError);
      return NextResponse.json({ error: 'failed_to_delete_conversation' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[delete] exception', error);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}
