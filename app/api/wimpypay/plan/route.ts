import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const planName = searchParams.get('plan_name') ?? 'Pro';

  const wimpyPayUrl = process.env.WIMPYPAY_API_URL;
  const internalApiKey = process.env.WIMPYPAY_INTERNAL_API_KEY;
  if (!wimpyPayUrl || !internalApiKey) {
    return Response.json({ error: 'WimpyPay is not configured' }, { status: 500 });
  }

  try {
    const upstream = await fetch(
      `${wimpyPayUrl}/api/external/plan?product_name=wimpyai&plan_name=${encodeURIComponent(planName)}`,
      {
        headers: {
          'x-internal-api-key': internalApiKey,
          'Content-Type': 'application/json',
        },
      }
    );
    const data = await upstream.json().catch(() => ({}));
    return Response.json(data, { status: upstream.status });
  } catch (error) {
    console.error('[wimpypay/plan]', error);
    return Response.json({ error: 'Failed to fetch plan details from WimpyPay' }, { status: 500 });
  }
}
