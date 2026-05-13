import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Inbox, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getFormById, ServiceError } from '@/services/FormService';
import { listSubmissions } from '@/services/SubmissionService';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { SubmissionRow } from '@/components/dashboard/SubmissionRow';
import { SubmissionFilters } from '@/components/dashboard/SubmissionFilters';
import { Button } from '@/components/ui/button';
import type { SubmissionStatus } from '@/types/submission';

// ─── Metadata ─────────────────────────────────────────────────────────────────

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

function parseSort(raw: string | undefined): 'newest' | 'oldest' {
  return raw === 'oldest' ? 'oldest' : 'newest';
}

function parsePage(raw: string | undefined): number {
  const n = parseInt(raw ?? '1', 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function SubmissionsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Inbox className="h-12 w-12 text-text-muted mb-4" aria-hidden="true" />
      <h2 className="text-h3 font-semibold text-text-primary mb-2">
        No submissions yet
      </h2>
      <p className="text-body text-text-secondary">
        Submissions will appear here once your form receives responses.
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

// ─── Back to Forms Button ─────────────────────────────────────────────────────

function BackToFormsLink() {
  return (
    <Button variant="ghost" size="sm" asChild className="gap-1.5 text-text-secondary">
      <Link href="/dashboard/forms">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to Forms
      </Link>
    </Button>
  );
}

// ─── Submissions Page ─────────────────────────────────────────────────────────

interface SubmissionsPageProps {
  params: Promise<{ formId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Server component — lists paginated submissions for a specific form.
 *
 * Supports:
 *   - Multi-select status filter via `status` searchParam (repeatable)
 *   - Sort by timestamp via `sort` searchParam (newest | oldest)
 *   - Pagination via `page` searchParam
 *
 * Requirements: R12
 */
export default async function SubmissionsPage({
  params,
  searchParams,
}: SubmissionsPageProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const { formId } = await params;
  const resolvedSearch = await searchParams;

  // ── Parse searchParams ────────────────────────────────────────────────────
  const activeStatuses = parseStatuses(resolvedSearch.status);
  const sort = parseSort(resolvedSearch.sort as string | undefined);
  const page = parsePage(resolvedSearch.page as string | undefined);

  // ── Fetch form metadata ───────────────────────────────────────────────────
  let formTitle = 'Submissions';
  try {
    const form = await getFormById(formId, session.user.id);
    formTitle = form.title;
  } catch (err) {
    if (err instanceof ServiceError && err.statusCode === 404) {
      notFound();
    }
    if (err instanceof ServiceError && err.statusCode === 403) {
      redirect('/dashboard/forms');
    }
    throw err;
  }

  // ── Fetch submissions ─────────────────────────────────────────────────────
  const { submissions, total } = await listSubmissions(
    formId,
    { status: activeStatuses.length > 0 ? activeStatuses : undefined },
    { page, pageSize: PAGE_SIZE },
  );

  // ── Build base href for pagination (preserves current filters) ────────────
  const filterParams = new URLSearchParams();
  activeStatuses.forEach((s) => filterParams.append('status', s));
  if (sort === 'oldest') filterParams.set('sort', 'oldest');
  const baseHref = `/dashboard/forms/${formId}/submissions?${filterParams.toString()}`;

  // ── Sort client-side if oldest (listSubmissions always returns desc) ───────
  const sortedSubmissions =
    sort === 'oldest' ? [...submissions].reverse() : submissions;

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader
        title={`${formTitle} — Submissions`}
        actions={<BackToFormsLink />}
      />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Filters bar */}
        <SubmissionFilters activeStatuses={activeStatuses} sort={sort} />

        {/* Table or empty state */}
        {submissions.length === 0 && activeStatuses.length === 0 ? (
          <SubmissionsEmptyState />
        ) : (
          <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
            {sortedSubmissions.length === 0 ? (
              /* Filtered empty state */
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Inbox className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
                <p className="text-body font-medium text-text-primary mb-1">
                  No submissions match your filters
                </p>
                <p className="text-small text-text-secondary">
                  Try adjusting or clearing the active filters.
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
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
                      {sortedSubmissions.map((submission) => (
                        <SubmissionRow
                          key={submission.id}
                          submission={submission}
                          formId={formId}
                        />
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
