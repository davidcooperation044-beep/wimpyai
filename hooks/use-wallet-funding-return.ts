'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type WalletStatus = 'idle' | 'polling' | 'ready' | 'error' | 'timeout';

const WALLET_POLL_INTERVAL = 2500;
const WALLET_POLL_MAX_ATTEMPTS = 12;

export function useWalletFundingReturn(
  requiredAmount?: number,
  onWalletFunded?: () => void
) {
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fundingPending, setFundingPending] = useState(false);

  const intervalRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);
  const cancelledRef = useRef(false);

  const clearPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stopWithError = useCallback(
    (message: string) => {
      setError(message);
      setStatus('error');
      clearPolling();
    },
    [clearPolling]
  );

  const stopWithTimeout = useCallback(() => {
    setError('Still processing — this can take a moment. Try again in a bit.');
    setStatus('timeout');
    clearPolling();
  }, [clearPolling]);

  const checkWallet = useCallback(async () => {
    if (cancelledRef.current) return;
    if (!requiredAmount || requiredAmount <= 0) return;

    setStatus('polling');
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        stopWithError('Unauthorized');
        return;
      }

      const response = await fetch('/api/wimpypay/wallet', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json().catch(() => ({} as any));
      if (cancelledRef.current) return;

      if (!response.ok) {
        stopWithError(payload.error || 'Unable to check wallet status.');
        return;
      }

      const balanceRaw =
        payload.balance ??
        payload.currentBalance ??
        payload.wallet_balance ??
        payload.wallet?.balance ??
        payload.data?.balance ??
        payload.data?.currentBalance ??
        payload.data?.wallet_balance ??
        null;
      const balance = Number(balanceRaw);

      if (!Number.isFinite(balance)) {
        stopWithError('Unable to verify wallet balance.');
        return;
      }

      if (balance >= requiredAmount) {
        clearPolling();
        setStatus('ready');
        setError(null);
        onWalletFunded?.();
        return;
      }

      attemptsRef.current += 1;
      if (attemptsRef.current >= WALLET_POLL_MAX_ATTEMPTS) {
        stopWithTimeout();
        return;
      }
    } catch (err) {
      if (cancelledRef.current) return;
      stopWithError((err as Error).message || 'Wallet polling failed.');
    }
  }, [clearPolling, onWalletFunded, requiredAmount, stopWithError, stopWithTimeout]);

  const retry = useCallback(() => {
    if (!fundingPending || !requiredAmount || requiredAmount <= 0) return;
    cancelledRef.current = false;
    attemptsRef.current = 0;
    clearPolling();
    setError(null);
    setStatus('polling');

    void checkWallet();
    intervalRef.current = window.setInterval(checkWallet, WALLET_POLL_INTERVAL);
  }, [checkWallet, clearPolling, fundingPending, requiredAmount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    const funding = searchParams.get('funding');
    const isPending = funding === 'pending';
    setFundingPending(isPending);

    if (!isPending || !requiredAmount || requiredAmount <= 0) {
      setStatus('idle');
      return;
    }

    cancelledRef.current = false;
    attemptsRef.current = 0;
    clearPolling();
    setError(null);
    setStatus('polling');

    void checkWallet();
    intervalRef.current = window.setInterval(checkWallet, WALLET_POLL_INTERVAL);

    return () => {
      cancelledRef.current = true;
      clearPolling();
    };
  }, [clearPolling, checkWallet, requiredAmount]);

  return { status, error, fundingPending, retry };
}
