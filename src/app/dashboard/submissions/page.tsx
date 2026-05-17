import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getFormsByOwner } from '@/services/FormService';
import { listSubmissions } from '@/services/SubmissionService';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { SubmissionFilters } from '@/components/dashboard/SubmissionFilters';
import { Button } from '@/components/ui/button';
import type { SubmissionStatus } from '@/types/submission';

export const metadata: Metadata = {
  title: 'Submissions',
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const VALID_STATUSES = new Set<SubmissionStatus>([
  'open',
  'under_review',
  'planned',
  'resolved',
  'rejected',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStatuses(raw: string | string[] | undefined): SubmissionStatus[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.filter((v): v is SubmissionStatus =>
    VALID_STATUSES.has(v as SubmissionStatus),
  );
}

function parsePage(raw: string | undefined): number {
  const n = parseInt(raw ?? '1', 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateBlobId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  under_review: 'bg-amber-50 text-amber-700 border-amber-200',
  planned: 'bg-purple-50 text-purple-700 border-purple-200',
  resolved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-muted text-text-secondary border-border';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function SubmissionsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Inbox className="h-12 w-12 text-text-muted mb-4" aria-hidden="true" />
      <h2 className="text-h3 font-semibold text-text-primary mb-2">
        No submissions yet
      </h2>
      <p className="text-body text-text-secondary max-w-sm">
        Submissions will appear here once your forms receive responses.
        Create and publish a form to get started.
      </p>
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  baseHref: string;
}

function Pagination({ page, total, pageSize, baseHref }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pageHref = (p: number) => {
    const url = new URL(baseHref, 'http://localhost');
    url.searchParams.set('page', String(p));
    return `${url.pathname}?${url.searchParams.toString()}`;
  };

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <p className="text-small text-text-secondary">
        {total === 0
          ? 'No results'
          : `Showing ${from}–${to} of ${total} submission${total !== 1 ? 's' : ''}`}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          asChild={page > 1}
          disabled={page <= 1}
          aria-label="Previous page"
          className="h-8 w-8 p-0"
        >
          {page > 1 ? (
            <Link href={pageHref(page - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
        <span className="px-2 text-small text-text-secondary">
          {page} / {totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          asChild={page < totalPages}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="h-8 w-8 p-0"
        >
          {page < totalPages ? (
            <Link href={pageHref(page + 1)}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Submissions Page (All Forms) ─────────────────────────────────────────────

interface SubmissionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Server component — lists paginated submissions across ALL forms owned by
 * the authenticated user. Provides a global view of all incoming submissions.
 */
export default async function SubmissionsPage({ searchParams }: SubmissionsPageProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const resolvedSearch = await searchParams;
  const activeStatuses = parseStatuses(resolvedSearch.status);
  const page = parsePage(resolvedSearch.page as string | undefined);

  // ── Fetch all forms owned by this user ──────────────────────────────────────
  const forms = await getFormsByOwner(session.user.id);

  if (forms.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <DashboardHeader title="Submissions" />
        <div className="flex-1 overflow-auto p-6">
          <SubmissionsEmptyState />
        </div>
      </div>
    );
  }

  // ── Aggregate submissions across all forms ──────────────────────────────────
  const allResults = await Promise.all(
    forms.map((form) =>
      listSubmissions(
        form.id,
        { status: activeStatuses.length > 0 ? activeStatuses : undefined },
        { page: 1, pageSize: 1000 },
      ).then((result) => ({
        formId: form.id,
        formTitle: form.title,
        submissions: result.submissions,
        total: result.total,
      })),
    ),
  );

  // Flatten and sort by date (newest first)
  const allSubmissions = allResults
    .flatMap((r) =>
      r.submissions.map((s) => ({
        ...s,
        formTitle: r.formTitle,
      })),
    )
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  const total = allSubmissions.length;
  const paginatedSubmissions = allSubmissions.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  // ── Build base href for pagination ──────────────────────────────────────────
  const filterParams = new URLSearchParams();
  activeStatuses.forEach((s) => filterParams.append('status', s));
  const baseHref = `/dashboard/submissions?${filterParams.toString()}`;

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader title="Submissions" />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Filters bar */}
        <SubmissionFilters activeStatuses={activeStatuses} sort="newest" />

        {/* Table or empty state */}
        {total === 0 && activeStatuses.length === 0 ? (
          <SubmissionsEmptyState />
        ) : total === 0 ? (
          <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
              <p className="text-body font-medium text-text-primary mb-1">
                No submissions match your filters
              </p>
              <p className="text-small text-text-secondary">
                Try adjusting or clearing the active filters.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
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
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Blob ID
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Submitted
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSubmissions.map((submission) => (
                    <tr
                      key={submission.id}
                      className="border-b border-border last:border-0 hover:bg-muted/60 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-text-primary font-medium">
                        <Link
                          href={`/dashboard/forms/${submission.formId}/submissions`}
                          className="hover:text-accent transition-colors"
                        >
                          {submission.formTitle}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                        {submission.walrusBlobId
                          ? truncateBlobId(submission.walrusBlobId)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">
                        {formatDate(submission.submittedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={submission.status} />
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            href={`/dashboard/forms/${submission.formId}/submissions/${submission.id}`}
                          >
                            View
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              baseHref={baseHref}
            />
          </div>
        )}
      </div>
    </div>
  );
}
