/**
 * Submission Detail Page — Server Component
 *
 * Fetches the full submission view (metadata + Walrus payload + status history)
 * and renders the SubmissionDetailView client component.
 *
 * Requirements: R12
 */

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getSubmissionWithHistory } from '@/services/SubmissionService';
import { ServiceError } from '@/services/FormService';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { SubmissionDetailView } from '@/components/dashboard/SubmissionDetailView';
import { Button } from '@/components/ui/button';

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: 'Submission Detail',
};

// ─── Walrus aggregator URL ────────────────────────────────────────────────────

// WALRUS_AGGREGATOR_URL is a server-side env var. We pass it as a prop to the
// client component so it never needs to be exposed via NEXT_PUBLIC_.
const WALRUS_AGGREGATOR_URL =
  process.env.WALRUS_AGGREGATOR_URL ??
  'https://aggregator.walrus-testnet.walrus.space';

// ─── Back to Submissions Link ─────────────────────────────────────────────────

function BackToSubmissionsLink({ formId }: { formId: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className="gap-1.5 text-text-secondary"
    >
      <Link href={`/dashboard/forms/${formId}/submissions`}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to Submissions
      </Link>
    </Button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface SubmissionDetailPageProps {
  params: Promise<{ formId: string; submissionId: string }>;
}

/**
 * Server component — fetches submission data and renders the detail view.
 *
 * Auth: redirects to /login if unauthenticated.
 * 404: if the submission does not exist in PostgreSQL.
 *
 * Requirements: R12
 */
export default async function SubmissionDetailPage({
  params,
}: SubmissionDetailPageProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const { formId, submissionId } = await params;

  let submission;
  try {
    submission = await getSubmissionWithHistory(submissionId);
  } catch (err) {
    if (err instanceof ServiceError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader
        title="Submission Detail"
        actions={<BackToSubmissionsLink formId={formId} />}
      />

      <SubmissionDetailView
        submission={submission}
        walrusAggregatorUrl={WALRUS_AGGREGATOR_URL}
      />
    </div>
  );
}
