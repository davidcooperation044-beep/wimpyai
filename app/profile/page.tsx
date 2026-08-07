"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildWimpyIDLoginUrl, buildWimpyPayUrl } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Download, ShieldCheck, Sparkles, UserCircle2 } from 'lucide-react';

type ProfileState = {
  isConnected: boolean;
  userId: string | null;
  displayName: string;
  avatarInitials: string;
  plan: 'Free' | 'Pro';
  subscriptionStatus: 'active' | 'inactive';
  lastLogin: string | null;
};

type SettingsState = {
  darkMode: boolean;
  reduceMotion: boolean;
  autoSave: boolean;
  soundEffects: boolean;
  compactMode: boolean;
};

const emptyProfile: ProfileState = {
  isConnected: false,
  userId: null,
  displayName: 'Guest',
  avatarInitials: 'G',
  plan: 'Free',
  subscriptionStatus: 'inactive',
  lastLogin: null,
};

const emptySettings: SettingsState = {
  darkMode: false,
  reduceMotion: false,
  autoSave: true,
  soundEffects: true,
  compactMode: false,
};

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    if (!saved) return fallback;
    return JSON.parse(saved) as T;
  } catch {
    return fallback;
  }
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileState>(() => loadJson<ProfileState>('wimpyai-profile-v1', emptyProfile));
  const [settings, setSettings] = useState<SettingsState>(() => loadJson<SettingsState>('wimpyai-settings-v1', emptySettings));
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      setProfile(loadJson<ProfileState>('wimpyai-profile-v1', emptyProfile));
      setSettings(loadJson<SettingsState>('wimpyai-settings-v1', emptySettings));
    };
    const storageListener = (event: StorageEvent) => {
      if (event.key === 'wimpyai-profile-v1' || event.key === 'wimpyai-settings-v1') sync();
    };
    window.addEventListener('wimpy-profile-sync', sync);
    window.addEventListener('wimpy-settings-sync', sync);
    window.addEventListener('storage', storageListener);
    return () => {
      window.removeEventListener('wimpy-profile-sync', sync);
      window.removeEventListener('wimpy-settings-sync', sync);
      window.removeEventListener('storage', storageListener);
    };
  }, []);

  const exportData = () => {
    const payload = {
      profile,
      settings,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wimpyai-export.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('wimpyai-profile-v1', JSON.stringify(profile));
    window.dispatchEvent(new Event('wimpy-profile-sync'));
  }, [profile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('wimpyai-settings-v1', JSON.stringify(settings));
    window.dispatchEvent(new Event('wimpy-settings-sync'));
  }, [settings]);

  const handleWimpyIDLogin = (mode: 'login' | 'signup' = 'login') => {
    if (typeof window === 'undefined') return;
    const url = buildWimpyIDLoginUrl(window.location.origin, mode);
    window.location.href = url;
  };

  const handleSubscriptionToggle = () => {
    if (!profile.isConnected) {
      handleWimpyIDLogin('login');
      return;
    }
    if (typeof window === 'undefined') return;
    const url = buildWimpyPayUrl(window.location.origin, profile.plan === 'Free' ? 'Pro' : 'Free');
    window.open(url, '_blank', 'noopener,noreferrer');
    showToast(profile.plan === 'Free' ? 'Opening Pro upgrade flow…' : 'Opening subscription management…');
  };

  const router = useRouter();

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setProfile({
      isConnected: false,
      userId: null,
      displayName: 'Guest',
      avatarInitials: 'G',
      plan: 'Free',
      subscriptionStatus: 'inactive',
      lastLogin: null,
    });
    showToast('Signed out successfully.');
  };

  const handleToggle = (key: keyof SettingsState, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 lg:p-10">
        {toast ? (
          <div className="fixed bottom-6 left-1/2 z-50 w-[min(94%,420px)] -translate-x-1/2 rounded-3xl bg-[var(--panel)] p-4 text-sm shadow-2xl ring-1 ring-black/10">
            {toast}
          </div>
        ) : null}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--accent)]">Account center</p>
            <h1 className="text-2xl font-semibold">Profile and settings</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="rounded-full border border-[var(--border)] px-3 py-2 text-sm"
              onClick={() => router.push('/')}
            >
              Back to chat
            </button>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-xl font-semibold text-white">
              {profile.avatarInitials}
            </div>
          </div>
        </div>

        <section className="rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-lg font-semibold">{profile.displayName}</p>
              <p className="text-sm text-[var(--muted)]">
                {profile.isConnected ? `WimpyID connected • ${profile.userId ?? 'No ID yet'}` : 'Not connected to WimpyID yet'}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Last login: {profile.lastLogin ? new Date(profile.lastLogin).toLocaleString() : 'Not available'}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck size={16} className="text-[var(--accent)]" />
                {profile.isConnected ? 'Connected' : 'Not connected'}
              </div>
              <p className="mt-1 text-[var(--muted)]">
                Plan: {profile.plan} • {profile.subscriptionStatus === 'active' ? 'Subscription active' : 'Subscription inactive'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {profile.plan === 'Free' ? (
                  <button
                    type="button"
                    className="rounded-2xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white"
                    onClick={handleSubscriptionToggle}
                  >
                    Upgrade to Pro
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm"
                    onClick={handleSubscriptionToggle}
                  >
                    Manage subscription
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm"
                  onClick={exportData}
                >
                  Export data
                </button>
                {profile.isConnected ? (
                  <button
                    type="button"
                    className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm"
                    onClick={handleSignOut}
                  >
                    Sign out
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--accent)]">Realtime settings</p>
                <h2 className="text-xl font-semibold">Preferences</h2>
              </div>
              <button className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm" onClick={exportData}>
                <span className="flex items-center gap-2"><Download size={14} /> Export data</span>
              </button>
            </div>
            <div className="mt-6 space-y-4">
              {[
                ['darkMode', 'Dark mode'],
                ['reduceMotion', 'Reduce motion'],
                ['autoSave', 'Auto-save conversations'],
                ['soundEffects', 'Sound effects'],
                ['compactMode', 'Compact layout'],
              ].map(([key, label]) => {
                const typedKey = key as keyof SettingsState;
                return (
                  <label key={typedKey} className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm">
                    <span>{label}</span>
                    <input type="checkbox" checked={Boolean(settings[typedKey])} onChange={(e) => handleToggle(typedKey, e.target.checked)} className="h-4 w-4" />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
              <Sparkles size={16} />
              Subscription & account
            </div>
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
              <p className="text-sm font-medium">WimpyPay</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{profile.subscriptionStatus === 'active' ? 'Your Pro subscription is active and updates in real time.' : 'No active subscription yet. Upgrade to Pro when ready.'}</p>
            </div>
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] p-4">
              <p className="text-sm font-medium">Data controls</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Export your profile and settings at any time. Everything is stored locally in this browser for now.</p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]">
              <UserCircle2 size={14} />
              Sign in on any new device to restore the same account experience.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
