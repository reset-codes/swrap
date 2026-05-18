import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Plus } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getFormsByOwner } from '@/services/FormService';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { FormCard } from '@/components/dashboard/FormCard';
import { FormsEmptyState } from '@/components/dashboard/FormsEmptyState';
import { ImportFormButton } from '@/components/dashboard/ImportFormButton';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Forms',
};

// ─── Actions ──────────────────────────────────────────────────────────────────

function FormActions() {
  return (
    <div className="flex items-center gap-2">
      <ImportFormButton />
      <Button asChild>
        <Link href="/dashboard/forms/new">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Form
        </Link>
      </Button>
    </div>
  );
}

// ─── Forms List Page ──────────────────────────────────────────────────────────

/**
 * Server component — fetches all forms owned by the authenticated user
 * and renders them in a paginated table with per-row actions.
 *
 * Requirements: R11
 */
export default async function FormsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  // Wrap in try/catch — if DATABASE_URL is not configured for this environment
  // (e.g., Vercel deployment without DB env vars), show empty state instead of crashing.
  let forms: Awaited<ReturnType<typeof getFormsByOwner>> = [];
  try {
    forms = await getFormsByOwner(session.user.id);
  } catch (err) {
    // DB unavailable — render empty state rather than crashing the page
    console.error('[FormsPage] Failed to fetch forms:', err instanceof Error ? err.message : err);
  }

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader title="Forms" actions={<FormActions />} />

      <div className="flex-1 overflow-auto p-6">
        {forms.length === 0 ? (
          <FormsEmptyState />
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
                      Title
                    </th>
                    <th
                      scope="col"
                      className="hidden sm:table-cell px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Slug
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Mode
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
                      Submissions
                    </th>
                    <th
                      scope="col"
                      className="hidden md:table-cell px-4 py-3 text-left text-small font-medium text-text-secondary uppercase tracking-wide"
                    >
                      Created
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
                  {forms.map((form) => (
                    <FormCard
                      key={form.id}
                      form={form}
                      currentUserId={session.user!.id!}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
