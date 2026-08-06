import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getUserFromBearerToken } from '@/lib/supabase-server';

const WIMPYPAY_API_URL = process.env.WIMPYPAY_API_URL;
const WIMPYPAY_INTERNAL_API_KEY = process.env.WIMPYPAY_INTERNAL_API_KEY;
const WIMPYPAY_WEBHOOK_SECRET = process.env.WIMPYPAY_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  if (!WIMPYPAY_API_URL || !WIMPYPAY_INTERNAL_API_KEY || !WIMPYPAY_WEBHOOK_SECRET) {
    return Response.json({ error: 'WimpyPay is not configured.' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  const user = await getUserFromBearerToken(authHeader);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { transactionId } = body as { transactionId?: string };
  if (!transactionId) {
    return Response.json({ error: 'Missing transaction ID.' }, { status: 400 });
  }

  try {
    const verifyResponse = await fetch(`${WIMPYPAY_API_URL}/api/v1/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WIMPYPAY_INTERNAL_API_KEY}`,
        'X-WimpyPay-Secret': WIMPYPAY_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ transaction_id: transactionId }),
    });

    if (!verifyResponse.ok) {
      const errorBody = await verifyResponse.text();
      return Response.json({ error: `Verification failed: ${errorBody}` }, { status: 502 });
    }

    const verifyData = await verifyResponse.json();
    if (verifyData.status !== 'paid' || verifyData.plan !== 'Pro') {
      return Response.json({ error: 'Payment was not completed successfully.' }, { status: 402 });
    }

    const existingMetadata = typeof user.user_metadata === 'object' && user.user_metadata !== null ? user.user_metadata : {};
    const { error: updateError } = await supabaseServer.auth.admin.updateUserById(user.id, {
      user_metadata: { ...existingMetadata, plan: 'Pro' },
    });

    if (updateError) {
      return Response.json({ error: 'Unable to update user plan.' }, { status: 500 });
    }

    return Response.json({ plan: 'Pro' });
  } catch (error) {
    return Response.json({ error: 'Failed to verify subscription callback.' }, { status: 500 });
  }
}
