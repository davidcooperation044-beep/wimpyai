import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getUserFromBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromBearerToken(req.headers.get('authorization'));
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const body = await req.json();
    const code = typeof body?.code === 'string' ? body.code.trim() : null;
    if (!code) return NextResponse.json({ error: 'missing_code' }, { status: 400 });

    const { data: ref } = await supabaseServer.from('wai_referrals').select('*').eq('code', code).limit(1).maybeSingle();
    if (!ref) return NextResponse.json({ error: 'invalid_code' }, { status: 404 });
    if (ref.referrer_id === user.id) return NextResponse.json({ error: 'self_referral' }, { status: 400 });

    // check if already claimed
    const { data: existing } = await supabaseServer.from('wai_referral_claims').select('*').eq('referral_id', ref.id).eq('claimant_id', user.id).limit(1).maybeSingle();
    if (existing) return NextResponse.json({ error: 'already_claimed' }, { status: 400 });

    // insert claim
    const { error: claimErr } = await supabaseServer.from('wai_referral_claims').insert({ referral_id: ref.id, claimant_id: user.id });
    if (claimErr) {
      console.error('[referral claim] insert error', claimErr);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    // credit amounts (example: 100 credits each)
    const creditAmount = 100;

    // helper to increment credits
    const incrementCredits = async (userId: string) => {
      const { data } = await supabaseServer.from('wai_credits').select('credits').eq('user_id', userId).limit(1).maybeSingle();
      if (data) {
        await supabaseServer.from('wai_credits').update({ credits: (data.credits ?? 0) + creditAmount, updated_at: new Date().toISOString() }).eq('user_id', userId);
      } else {
        await supabaseServer.from('wai_credits').insert({ user_id: userId, credits: creditAmount });
      }
    };

    // credit referrer and claimant
    await incrementCredits(ref.referrer_id);
    await incrementCredits(user.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[referral claim] exception', e);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}
