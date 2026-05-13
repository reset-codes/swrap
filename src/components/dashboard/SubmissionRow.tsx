'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import type { SubmissionMetadata } from '@/types/submission';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Truncate a blob ID to 16 chars + "…" for display. */
function truncateBlobId(blobId: string): string {
  if (blobId.length <= 16) return blobId;
  return `${blobId.slice(0, 16)}…`;
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — silently ignore
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 text-text-muted hover:text-text-secondary"
      onClick={handleCopy}
      aria-label={copied ? 'Copied!' : label}
      title={copied ? 'Copied!' : label}
    >
      {copied ? (
        <Check className="h-3 w-3 text-success" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3" aria-hidden="true" />
      )}
    </Button>
  );
}

// ─── SubmissionRow ────────────────────────────────────────────────────────────

interface SubmissionRowProps {
  submission: SubmissionMetadata;
  formId: string;
}

/**
 * A single row in the submissions table.
 *
 * Displays: Submission_Blob_ID (truncated, copy button), timestamp,
 * Status_Tag badge, and a "View" action link.
 *
 * Clicking the row navigates to the submission detail page.
 */
export function SubmissionRow({ submission, formId }: SubmissionRowProps) {
  const detailHref = `/dashboard/forms/${formId}/submissions/${submission.id}`;

  return (
    <tr className="border-b border-border hover:bg-muted/40 transition-colors">
      {/* Blob ID */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-small text-text-secondary"
            title={submission.walrusBlobId}
          >
            {truncateBlobId(submission.walrusBlobId)}
          </span>
          <CopyButton
            value={submission.walrusBlobId}
            label={`Copy blob ID for submission ${submission.id}`}
          />
        </div>
      </td>

      {/* Submitted timestamp */}
      <td className="px-4 py-3">
        <span className="text-small text-text-secondary">
          {formatDate(submission.submittedAt)}
        </span>
      </td>

      {/* Status badge */}
      <td className="px-4 py-3">
        <StatusBadge status={submission.status} />
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <Button
          variant="secondary"
          size="sm"
          asChild
          aria-label={`View submission ${submission.id}`}
        >
          <Link href={detailHref}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            View
          </Link>
        </Button>
      </td>
    </tr>
  );
}
