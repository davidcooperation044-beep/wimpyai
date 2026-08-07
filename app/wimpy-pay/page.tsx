'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWalletFundingReturn } from '@/hooks/use-wallet-funding-return';

export default function WimpyPayCompletePage() {
  const [message, setMessage] = useState('Verifying your subscription...');
  const [isResuming, setIsResuming] = useState(false);
  const [hasResumed, setHasResumed] = useState(false);
  const router = useRouter();
  const [planName, setPlanName] = useState('Pro');

  const { status, error, fundingPending } = useWalletFundingReturn(() => {
    setMessage('Funding confirmed. Resuming subscription...');
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
    if (fundingPending && status === 'ready' && !hasResumed) {
      setHasResumed(true);
      setIsResuming(true);
      setMessage('Funding confirmed. Activating your Pro subscription...');

      const resumeSubscription = async () => {
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

      void resumeSubscription();
    }
  }, [fundingPending, status, hasResumed, planName, router]);

  useEffect(() => {
    if (fundingPending) return;
    if (hasResumed) return;

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
  }, [fundingPending, hasResumed, planName, router]);

  const displayMessage = fundingPending
    ? status === 'polling'
      ? 'Waiting for wallet funding to complete...'
      : status === 'error'
      ? error ?? 'Wallet polling failed.'
      : message
    : message;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex items-center justify-center px-4">
      <div className="mx-auto max-w-xl rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center shadow-lg">
        <p className="text-lg font-semibold">WimpyPay Subscription</p>
        <p className="mt-4 text-sm text-[var(--muted)]">{displayMessage}</p>
      </div>
    </main>
  );
}
