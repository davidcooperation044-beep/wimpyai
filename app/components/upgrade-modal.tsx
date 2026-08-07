'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  onSubscribed: () => void;
  currentPlan: 'Free' | 'Pro';
}

type PlanData = {
  price?: number;
  currency?: string;
  billing_interval?: string;
  description?: string;
  [key: string]: unknown;
};

export function UpgradeModal({ open, onClose, onSubscribed, currentPlan }: UpgradeModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fundPanel, setFundPanel] = useState(false);
  const [amount, setAmount] = useState('5000');
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [requiredAmount, setRequiredAmount] = useState<number | null>(null);
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);
  const [fundingReference, setFundingReference] = useState<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setError(null);
    setPlanData(null);

    void fetch('/api/wimpypay/plan?plan_name=Pro')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Unable to fetch plan pricing');
        }
        setPlanData(data);
      })
      .catch((err) => {
        console.error('[UpgradeModal] plan fetch failed', err);
        setError(err.message || 'Unable to load pricing');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [open]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSubscribe = async () => {
    setIsLoading(true);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      setError('You must be signed in to upgrade.');
      setIsLoading(false);
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

      if (response.ok) {
        onSubscribed();
        onClose();
        return;
      }

      if (response.status === 402 && data.error === 'insufficient-funds') {
        setFundPanel(true);
        setRequiredAmount(data.requiredAmount ?? null);
        setCurrentBalance(data.currentBalance ?? null);
        return;
      }

      setError(data.error || 'Subscription failed.');
    } catch (err) {
      setError('Subscription failed. Please try again.');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const handleFundWallet = async () => {
    setFundingLoading(true);
    setFundingError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      setFundingError('You must be signed in to fund your wallet.');
      setFundingLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/wimpypay/fund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: Number(amount),
          return_url: `${window.location.origin}/wimpy-pay?funding=pending`,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to start funding flow');
      }

      if (!data.authorizationUrl) {
        throw new Error('No authorizationUrl returned from funding request');
      }

      setFundingReference(data.reference ?? null);
      window.location.href = data.authorizationUrl;
    } catch (err) {
      setFundingError((err as Error).message || 'Funding failed.');
    } finally {
      if (mountedRef.current) setFundingLoading(false);
    }
  };

  const priceLabel = useMemo(() => {
    if (!planData) return 'Loading…';
    const amount = planData.price ?? (planData.amount ?? null);
    if (typeof amount === 'number') {
      return `${planData.currency ?? 'NGN'} ${amount.toLocaleString()}`;
    }
    return planData.description ?? 'Pro';
  }, [planData]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[var(--accent)]">Upgrade to Pro</p>
              <h2 className="mt-2 text-2xl font-semibold">WimpyAI Pro</h2>
            </div>
            <button className="rounded-full border border-[var(--border)] px-3 py-2 text-sm" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-5">
            <p className="text-sm text-[var(--muted)]">Unlock faster answers, priority access, and full Pro features.</p>
            <div className="mt-5 flex items-center justify-between gap-4 rounded-3xl bg-white/90 p-5 shadow-sm">
              <div>
                <p className="text-sm font-semibold">Pro plan</p>
                <p className="text-xs text-[var(--muted)]">Monthly billing</p>
              </div>
              <p className="text-lg font-semibold">{priceLabel}</p>
            </div>
          </div>

          {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}

          <div className="mt-6 flex flex-col gap-3">
            {!fundPanel ? (
              <button
                type="button"
                className="rounded-3xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                onClick={handleSubscribe}
                disabled={isLoading}
              >
                {isLoading ? 'Processing…' : 'Subscribe to Pro'}
              </button>
            ) : (
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-5">
                <p className="text-sm font-semibold">Insufficient funds</p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  You need {requiredAmount ? `NGN ${requiredAmount.toLocaleString()}` : 'more funds'}.
                </p>
                {currentBalance !== null ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">Current balance: NGN {currentBalance.toLocaleString()}</p>
                ) : null}
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-sm font-medium">Amount</label>
                    <input
                      type="number"
                      min="0"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className="mt-2 w-full rounded-3xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm"
                    />
                  </div>
                  {fundingError ? <p className="text-sm text-red-500">{fundingError}</p> : null}
                  <button
                    type="button"
                    className="w-full rounded-3xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    onClick={handleFundWallet}
                    disabled={fundingLoading}
                  >
                    {fundingLoading ? 'Redirecting…' : 'Fund wallet'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted)]">
            <p>Billing and wallet management are handled securely through WimpyPay.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
