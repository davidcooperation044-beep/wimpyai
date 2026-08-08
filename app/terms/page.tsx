import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto max-w-5xl p-6 lg:p-10">
        <div className="mb-6">
          <p className="text-sm font-semibold text-[var(--accent)]">Legal</p>
          <h1 className="text-3xl font-semibold">Terms of Service</h1>
        </div>

        <section className="space-y-5 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-sm">
          <p className="text-sm text-[var(--muted)]">
            These Terms of Service govern your use of WimpyAI. By using the service, you agree to follow the rules, respect intellectual property, and avoid prohibited conduct.
          </p>
          <div className="space-y-4 text-sm leading-7 text-[var(--ink)]">
            <p>
              Use of the service is subject to applicable law and to our policies. You are responsible for the content you submit and for ensuring your usage does not violate third-party rights.
            </p>
            <p>
              We may update these terms from time to time. Continued use of WimpyAI after changes have been posted constitutes acceptance of the revised terms.
            </p>
            <p>
              If you disagree with any portion of these terms, do not use the service. For questions, please contact support through the app.
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
