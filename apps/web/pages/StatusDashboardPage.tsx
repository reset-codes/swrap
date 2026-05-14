'use client';

/**
 * StatusDashboardPage — Status dashboard for the POC.
 *
 * Renders a table of all forms from Local_Store, sorted by createdAt descending.
 * Columns are exactly DASHBOARD_COLUMNS in that order (R19.10).
 * No charts, no sparklines, no tickers (R19.10 enforced).
 *
 * Requirements: R10.5, R19.10
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocalStore } from '../stores/local-store';
import type { PersistedFormEntry } from '../stores/local-store';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { AppShell } from '../components/layout/AppShell';
import { ContentFrame } from '../components/layout/ContentFrame';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { FileText } from 'lucide-react';

// ---------------------------------------------------------------------------
// Dashboard columns — exact order enforced (R19.10)
// ---------------------------------------------------------------------------

export const DASHBOARD_COLUMNS = [
  'Form Name',
  'Submissions',
  'Encryption',
  'Upload',
  'Blob Ref',
  'Last Activity',
] as const;

export type DashboardColumn = (typeof DASHBOARD_COLUMNS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a blobId for display: first 8 + "…" + last 6 chars.
 * If the blobId is short enough, return it as-is.
 */
function truncateBlobId(blobId: string): string {
  if (blobId.length <= 16) return blobId;
  return `${blobId.slice(0, 8)}…${blobId.slice(-6)}`;
}

/**
 * Format an ISO 8601 date string to a human-readable relative or absolute date.
 * Uses Intl.DateTimeFormat for locale-aware formatting.
 */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
}

// ---------------------------------------------------------------------------
// BlobRefCell — click-to-copy monospace cell
// ---------------------------------------------------------------------------

function BlobRefCell({ blobId }: { blobId: string }) {
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(blobId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy blob ID: ${blobId}`}
      aria-label={copied ? 'Copied!' : `Copy blob ID`}
      className="font-mono text-token-xs text-text-secondary hover:text-text-primary transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 rounded"
    >
      {copied ? 'Copied!' : truncateBlobId(blobId)}
    </button>
  );
}

// ---------------------------------------------------------------------------
// StatusDashboardPage component
// ---------------------------------------------------------------------------

export function StatusDashboardPage() {
  const router = useRouter();
  const forms = useLocalStore((state) => state.forms);

  // Sort forms by createdAt descending
  const sortedForms: PersistedFormEntry[] = React.useMemo(() => {
    return Object.values(forms).sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });
  }, [forms]);

  const isEmpty = sortedForms.length === 0;

  return (
    <AppShell>
      <ContentFrame>
        <PageHeader
          title="Forms"
          description="All forms you have created on this device."
          actions={
            <Button
              variant="primary"
              size="md"
              onClick={() => router.push('/poc/forms/new')}
              aria-label="Create form"
            >
              Create form
            </Button>
          }
        />

        <div className="mt-8">
          {isEmpty ? (
            <EmptyState
              mode="block"
              title="No forms yet"
              description="Create your first form to get started."
              icon={<FileText className="h-5 w-5" aria-hidden="true" />}
              action={{
                label: 'Create form',
                onClick: () => router.push('/poc/forms/new'),
              }}
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-token-sm" aria-label="Forms list">
                <thead>
                  <tr className="border-b border-border-subtle bg-bg-muted">
                    {DASHBOARD_COLUMNS.map((col) => (
                      <th
                        key={col}
                        scope="col"
                        className="px-4 py-3 text-left font-medium text-text-secondary whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedForms.map((form) => (
                    <tr
                      key={form.blobId}
                      className="border-b border-border-subtle last:border-0 hover:bg-bg-muted transition-colors duration-fast"
                    >
                      {/* Form Name */}
                      <td className="px-4 py-3">
                        <a
                          href={`/poc/forms/${form.blobId}`}
                          className="font-medium text-text-primary hover:text-accent-base transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 rounded"
                        >
                          {form.title || 'Untitled form'}
                        </a>
                      </td>

                      {/* Submissions — always 0 for now (Phase 5 will populate) */}
                      <td className="px-4 py-3 text-text-secondary tabular-nums">
                        0
                      </td>

                      {/* Encryption — always "Encrypted" */}
                      <td className="px-4 py-3">
                        <Badge variant="success" size="sm">
                          Encrypted
                        </Badge>
                      </td>

                      {/* Upload — "Linked" or "Unlinked" based on isUnlinked */}
                      <td className="px-4 py-3">
                        {form.isUnlinked ? (
                          <Badge variant="warning" size="sm">
                            Unlinked
                          </Badge>
                        ) : (
                          <Badge variant="info" size="sm">
                            Linked
                          </Badge>
                        )}
                      </td>

                      {/* Blob Ref — truncated, click-to-copy */}
                      <td className="px-4 py-3">
                        <BlobRefCell blobId={form.blobId} />
                      </td>

                      {/* Last Activity — formatted createdAt */}
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                        {formatDate(form.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ContentFrame>
    </AppShell>
  );
}
