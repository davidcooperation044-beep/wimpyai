'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function WimpyPayCompletePage() {
  const [message, setMessage] = useState('Verifying your subscription...');
  const router = useRouter();

  useEffect(() => {
    const verifySubscription = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        setMessage('Please sign in and retry the payment flow.');
        return;
      }

      try {
        const response = await fetch('/api/wimpy-pay', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ plan: 'Pro' }),
        });
        const data = await response.json();

        if (response.ok && data.plan === 'Pro') {
          setMessage('Your WimpyAI Pro subscription is now active! Redirecting you back to the app...');
          window.setTimeout(() => router.replace('/'), 1500);
          return;
        }

        setMessage(data.error || 'Payment verification failed. Please try again.');
      } catch (error) {
        setMessage('Payment verification failed. Please try again later.');
      }
    };

    void verifySubscription();
  }, [router]);

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex items-center justify-center px-4">
      <div className="mx-auto max-w-xl rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center shadow-lg">
        <p className="text-lg font-semibold">WimpyPay Subscription</p>
        <p className="mt-4 text-sm text-[var(--muted)]">{message}</p>
      </div>
    </main>
  );
}
