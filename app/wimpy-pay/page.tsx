'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWalletFundingReturn } from '@/hooks/use-wallet-funding-return';

export default function WimpyPayCompletePage() {
  const [message, setMessage] = useState('Verifying your subscription...');
  const [isResuming, setIsResuming] = useState(false);
  const router = useRouter();
  const [planName, setPlanName] = useState('Pro');
  const [planPrice, setPlanPrice] = useState<number | null>(null);
  const resumeRef = useRef(false);

  const { status, error, fundingPending, retry } = useWalletFundingReturn(planPrice ?? undefined, () => {
    setMessage('Funding confirmed. Activating your Pro subscription...');
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const plan = searchParams.get('plan');
      if (plan) {
        setPlanName(plan);
      }
    }
  }, []);

  useEffect(() => {
    if (!planName) return;

    const fetchPlan = async () => {
      try {
        const response = await fetch(`/api/wimpypay/plan?plan_name=${encodeURIComponent(planName)}`);
        const data = await response.json();
        if (!response.ok) {
          console.error('[wimpy-pay page] failed to load plan', data);
          return;
        }

        const amount = typeof data.price === 'number' ? data.price : typeof data.amount === 'number' ? data.amount : null;
        setPlanPrice(amount);
      } catch (err) {
        console.error('[wimpy-pay page] plan fetch failed', err);
      }
    };

    void fetchPlan();
  }, [planName]);

  useEffect(() => {
    if (!fundingPending || status !== 'ready' || isResuming || resumeRef.current) return;
    resumeRef.current = true;
    setIsResuming(true);
    setMessage('Funding confirmed. Activating your Pro subscription...');

    const resumeSubscription = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        setMessage('Please sign in and retry the payment flow.');
        setIsResuming(false);
        resumeRef.current = false;
        return;
      }

      try {
        const response = await fetch('/api/wimpy-pay', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ plan: planName }),
        });
        const data = await response.json();

        if (response.ok && data.plan === 'Pro') {
          setMessage('Your WimpyAI Pro subscription is now active! Redirecting you back to the app...');
          window.setTimeout(() => router.replace('/'), 1500);
          return;
        }

        setMessage(data.error || 'Payment verification failed. Please try again.');
        resumeRef.current = false;
      } catch (err) {
        setMessage('Payment verification failed. Please try again later.');
        resumeRef.current = false;
      } finally {
        setIsResuming(false);
      }
    };

    void resumeSubscription();
  }, [fundingPending, status, isResuming, planName, router]);

  useEffect(() => {
    if (status !== 'ready') {
      resumeRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (fundingPending) return;

    const verifySubscription = async () => {
      setIsResuming(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        setMessage('Please sign in and retry the payment flow.');
        setIsResuming(false);
        return;
      }

      try {
        const response = await fetch('/api/wimpy-pay', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ plan: planName }),
        });
        const data = await response.json();

        if (response.ok && data.plan === 'Pro') {
          setMessage('Your WimpyAI Pro subscription is now active! Redirecting you back to the app...');
          window.setTimeout(() => router.replace('/'), 1500);
          return;
        }

        setMessage(data.error || 'Payment verification failed. Please try again.');
      } catch (err) {
        setMessage('Payment verification failed. Please try again later.');
      } finally {
        setIsResuming(false);
      }
    };

    void verifySubscription();
  }, [fundingPending, planName, router]);

  const displayMessage = fundingPending
    ? status === 'polling'
      ? 'Waiting for wallet funding to complete...'
      : status === 'error'
      ? error ?? 'Wallet polling failed.'
      : status === 'timeout'
      ? error ?? 'Still processing — this can take a moment. Try again in a bit.'
      : message
    : message;

  const retryButton = fundingPending && (status === 'timeout' || status === 'error') ? (
    <button
      type="button"
      className="mt-4 rounded-3xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      onClick={retry}
      disabled={isResuming}
    >
      Check again
    </button>
  ) : null;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex items-center justify-center px-4">
      <div className="mx-auto max-w-xl rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center shadow-lg">
        <p className="text-lg font-semibold">WimpyPay Subscription</p>
        <p className="mt-4 text-sm text-[var(--muted)]">{displayMessage}</p>
        {retryButton}
      </div>
    </main>
  );
}
