import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const { data: referral } = await supabaseServer.from('wai_referrals').select('id,code,created_at').eq('referrer_id', user.id).limit(1).maybeSingle();
    const { data: creditsRow } = await supabaseServer.from('wai_credits').select('credits').eq('user_id', user.id).limit(1).maybeSingle();
    const credits = creditsRow?.credits ?? 0;
    return NextResponse.json({ referral, credits });
  } catch (e) {
    console.error('[referral GET] error', e);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    // generate short code
    const code = crypto.randomUUID().split('-')[0];
    const { data, error } = await supabaseServer.from('wai_referrals').insert({ code, referrer_id: user.id }).select().single();
    if (error) {
      console.error('[referral POST] supabase error', error);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return NextResponse.json({ referral: data });
  } catch (e) {
    console.error('[referral POST] exception', e);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}
