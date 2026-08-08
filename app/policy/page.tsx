import Link from 'next/link';

export default function PolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto max-w-5xl p-6 lg:p-10">
        <div className="mb-6">
          <p className="text-sm font-semibold text-[var(--accent)]">Legal</p>
          <h1 className="text-3xl font-semibold">Privacy Policy</h1>
        </div>

        <section className="space-y-5 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-sm">
          <p className="text-sm text-[var(--muted)]">
            This Privacy Policy explains how WimpyAI collects, uses, and protects your information when you use the service.
          </p>
          <div className="space-y-4 text-sm leading-7 text-[var(--ink)]">
            <p>
              We collect only the information needed to operate the app and support your experience. We do not sell your personal data.
            </p>
            <p>
              Some data may be stored in your browser or in Supabase to keep your conversations and settings available across sessions.
            </p>
            <p>
              You can request deletion of your data or changes to your account through the app's support and account tools.
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
