import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';

export const metadata: Metadata = {
  title: 'Settings',
};

// ─── Settings Page ────────────────────────────────────────────────────────────

/**
 * Server component — workspace settings page.
 * Displays account info and workspace configuration.
 */
export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = session.user;

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader title="Settings" />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* ── Account Info ───────────────────────────────────────────────── */}
        <section
          aria-labelledby="account-heading"
          className="rounded-lg border border-border bg-white shadow-sm p-6"
        >
          <h2
            id="account-heading"
            className="text-h3 font-semibold text-text-primary mb-4"
          >
            Account
          </h2>

          <dl className="space-y-4">
            <div>
              <dt className="text-small font-medium text-text-secondary">Email</dt>
              <dd className="text-body text-text-primary mt-0.5">
                {user.email ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-small font-medium text-text-secondary">Name</dt>
              <dd className="text-body text-text-primary mt-0.5">
                {user.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-small font-medium text-text-secondary">Role</dt>
              <dd className="text-body text-text-primary mt-0.5 capitalize">
                {user.role ?? 'admin'}
              </dd>
            </div>
            <div>
              <dt className="text-small font-medium text-text-secondary">User ID</dt>
              <dd className="text-body text-text-primary mt-0.5 font-mono text-sm">
                {user.id}
              </dd>
            </div>
          </dl>
        </section>

        {/* ── Workspace ──────────────────────────────────────────────────── */}
        <section
          aria-labelledby="workspace-heading"
          className="rounded-lg border border-border bg-white shadow-sm p-6"
        >
          <h2
            id="workspace-heading"
            className="text-h3 font-semibold text-text-primary mb-4"
          >
            Workspace
          </h2>

          <dl className="space-y-4">
            <div>
              <dt className="text-small font-medium text-text-secondary">
                Network
              </dt>
              <dd className="text-body text-text-primary mt-0.5">
                Sui Testnet
              </dd>
            </div>
            <div>
              <dt className="text-small font-medium text-text-secondary">
                Storage
              </dt>
              <dd className="text-body text-text-primary mt-0.5">
                Walrus Testnet
              </dd>
            </div>
            <div>
              <dt className="text-small font-medium text-text-secondary">
                Encryption
              </dt>
              <dd className="text-body text-text-primary mt-0.5">
                Seal (on-chain access control)
              </dd>
            </div>
          </dl>
        </section>

        {/* ── API Access ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="api-heading"
          className="rounded-lg border border-border bg-white shadow-sm p-6"
        >
          <h2
            id="api-heading"
            className="text-h3 font-semibold text-text-primary mb-4"
          >
            API
          </h2>

          <dl className="space-y-4">
            <div>
              <dt className="text-small font-medium text-text-secondary">
                API Endpoint
              </dt>
              <dd className="text-body text-text-primary mt-0.5 font-mono text-sm">
                {process.env.NEXT_PUBLIC_API_URL ?? 'https://api.swrap.tech'}
              </dd>
            </div>
            <div>
              <dt className="text-small font-medium text-text-secondary">
                Documentation
              </dt>
              <dd className="text-small text-text-secondary mt-0.5">
                API documentation coming soon.
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
