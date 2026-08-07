'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function useWalletFundingReturn(onWalletFunded: () => void) {
  const [status, setStatus] = useState<'idle' | 'polling' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fundingPending, setFundingPending] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setStatus('idle');
      setFundingPending(false);
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const funding = searchParams.get('funding');
    const isPending = funding === 'pending';
    setFundingPending(isPending);

    if (!isPending) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    let intervalId: number | undefined;

    const checkWallet = async () => {
      setStatus('polling');
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) {
          setError('Unauthorized');
          setStatus('error');
          return;
        }

        const response = await fetch('/api/wimpypay/wallet', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setError(data.error || 'Unable to check wallet status.');
          setStatus('error');
          return;
        }

        setStatus('ready');
        onWalletFunded();
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message || 'Wallet polling failed.');
        setStatus('error');
      }
    };

    intervalId = window.setInterval(checkWallet, 2500);
    void checkWallet();

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [onWalletFunded]);

  return { status, error, fundingPending };
}
