import Link from 'next/link';

export default function SecurityPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto max-w-5xl p-6 lg:p-10">
        <div className="mb-6">
          <p className="text-sm font-semibold text-[var(--accent)]">Legal</p>
          <h1 className="text-3xl font-semibold">Security</h1>
        </div>

        <section className="space-y-5 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-sm">
          <p className="text-sm text-[var(--muted)]">
            Security is important to us. This page summarizes our approach to protecting your account data and application usage.
          </p>
          <div className="space-y-4 text-sm leading-7 text-[var(--ink)]">
            <p>
              We use secure authentication and encrypted storage for sensitive data where available. We also rely on Supabase's security model for user sessions and policies.
            </p>
            <p>
              Always keep your credentials safe, and sign out of shared devices. Report suspicious activity through the app's support channels.
            </p>
            <p>
              We continually monitor and improve our platform to reduce risk and protect your information.
            </p>
          </div>
        </section>

        <div className="mt-8">
          <Link href="/profile" className="text-sm font-semibold text-[var(--accent)] hover:underline">
            ← Back to profile
          </Link>
        </div>
      </div>
    </main>
  );
}
