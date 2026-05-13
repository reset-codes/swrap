import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AlertTriangle, Database } from 'lucide-react';
import { auth } from '@/lib/auth';
import {
  getBalance,
  isLowBalance,
  getTransactionHistory,
  getPerFormUsage,
  getLowCreditThreshold,
} from '@/services/CreditService';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { CreditDepositForm } from '@/components/dashboard/CreditDepositForm';

export const metadata: Metadata = {
  title: 'Storage',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format bytes as human-readable KB / MB. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Format a WAL amount to 3 decimal places. */
function formatWal(amount: number): string {
  return amount.toFixed(3);
}

/** Format an ISO date string to a readable local date + time. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Truncate a blob ID for display (first 8 + … + last 6 chars). */
function truncateBlobId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

// ─── Storage Page ─────────────────────────────────────────────────────────────

/**
 * Server component — fetches credit balance, per-form usage, and transaction
 * history for the authenticated admin and renders the storage analytics page.
 *
 * Requirements: R10, R13
 */
export default async function StoragePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const adminId = session.user.id;

  const [balance, lowBalance, transactions, perFormUsage] = await Promise.all([
    getBalance(adminId),
    isLowBalance(adminId),
    getTransactionHistory(adminId, 50),
    getPerFormUsage(adminId),
  ]);

  const threshold = getLowCreditThreshold();

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader title="Storage" />

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* ── Balance Card ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="balance-heading"
          className="rounded-lg border border-border bg-white shadow-sm p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Database className="h-5 w-5 text-text-secondary" aria-hidden="true" />
            <h2 id="balance-heading" className="text-h3 font-semibold text-text-primary">
              Storage Credits
            </h2>
          </div>

          <div className="flex items-baseline gap-2 mb-5">
            <span
              className="text-display font-bold text-text-primary"
              aria-label={`${formatWal(balance)} WAL balance`}
            >
              {formatWal(balance)}
            </span>
            <span className="text-h2 text-text-secondary">WAL</span>
          </div>

          {/* Low-credits warning */}
          {lowBalance && (
            <div
              role="alert"
              className="flex items-start gap-2 bg-warning/10 border border-warning/30 text-warning rounded-md px-4 py-3 text-small mb-5"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <p>
                Your storage credits are running low. Deposit more to continue storing data.
                {' '}
                <span className="text-text-secondary">
                  (Threshold: {threshold} WAL)
                </span>
              </p>
            </div>
          )}

          {/* Deposit form */}
          <div>
            <p className="text-small font-medium text-text-secondary mb-2">
              Deposit Credits
            </p>
            <CreditDepositForm />
          </div>
        </section>

        {/* ── Per-Form Usage ───────────────────────────────────────────────── */}
        <section aria-labelledby="usage-heading">
          <h2
            id="usage-heading"
            className="text-h3 font-semibold text-text-primary mb-3"
          >
            Storage Usage by Form
          </h2>

          <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
            {perFormUsage.length === 0 ? (
              <p className="px-4 py-8 text-center text-small text-text-secondary">
                No storage usage yet. Submit data to a form to see usage here.
              </p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Form
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Blobs
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Size
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Est. Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perFormUsage.map((row, i) => (
                    <tr
                      key={row.formId}
                      className={`border-b border-border last:border-0 hover:bg-muted/60 transition-colors ${
                        i % 2 === 1 ? 'bg-muted/40' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-sm text-text-primary font-medium">
                        {row.formTitle}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary text-right tabular-nums">
                        {row.blobCount}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary text-right tabular-nums">
                        {formatBytes(row.totalBytes)}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary text-right tabular-nums">
                        {formatWal(row.estimatedCost)} WAL
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ── Transaction History ──────────────────────────────────────────── */}
        <section aria-labelledby="history-heading">
          <h2
            id="history-heading"
            className="text-h3 font-semibold text-text-primary mb-3"
          >
            Transaction History
          </h2>
          <p className="text-small text-text-secondary mb-3">
            Showing last {transactions.length} transactions
          </p>

          <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
            {transactions.length === 0 ? (
              <p className="px-4 py-8 text-center text-small text-text-secondary">
                No transactions yet. Deposit credits or store data to see history here.
              </p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Date
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Type
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Amount
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Blob ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, i) => (
                    <tr
                      key={tx.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/60 transition-colors ${
                        i % 2 === 1 ? 'bg-muted/40' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-small text-text-secondary whitespace-nowrap">
                        {formatDate(tx.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-small text-text-primary capitalize">
                        {tx.type}
                      </td>
                      <td
                        className={`px-4 py-3 text-small text-right tabular-nums font-medium ${
                          tx.amount >= 0 ? 'text-success' : 'text-error'
                        }`}
                      >
                        {tx.amount >= 0 ? '+' : ''}
                        {formatWal(tx.amount)} WAL
                      </td>
                      <td className="px-4 py-3 text-small">
                        {tx.walrusBlobId ? (
                          <span
                            className="font-mono text-text-secondary"
                            title={tx.walrusBlobId}
                          >
                            {truncateBlobId(tx.walrusBlobId)}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
