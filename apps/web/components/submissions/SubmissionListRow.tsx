'use client';

/**
 * SubmissionListRow — renders a single submission entry in a table row format
 * for the owner's submission list view.
 *
 * Uses UX_Vocabulary masking helpers to hide raw blob IDs in primary flows.
 * Raw identifiers are only shown when advancedView is enabled.
 *
 * Requirements: R12.5, R19.6, 8.1, 8.3
 */

import * as React from 'react';
import { Badge } from '../ui/Badge';
import { EncryptedSubmissionIndicator } from './EncryptedSubmissionIndicator';
import { maskBlobId, useAdvancedView } from '../../lib/copy/advanced-view';

export interface SubmissionListRowProps {
  blobId: string;
  formBlobId: string;
  submittedAt: string;
  isUnlinked?: boolean;
}

/** Formats an ISO 8601 date string into a human-readable relative or absolute label. */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return isoString;
  }
}

/** Truncates a blob ID for display in advanced view: shows first 6 and last 4 chars. */
function truncateBlobId(blobId: string): string {
  if (blobId.length <= 12) return blobId;
  return `${blobId.slice(0, 6)}…${blobId.slice(-4)}`;
}

export function SubmissionListRow({
  blobId,
  formBlobId,
  submittedAt,
  isUnlinked,
}: SubmissionListRowProps) {
  const [advancedView] = useAdvancedView();

  // In primary flow, blob IDs are masked. In advanced view, they are truncated for readability.
  const displayBlobId = advancedView ? truncateBlobId(blobId) : maskBlobId(blobId, advancedView);
  const displayFormBlobId = advancedView ? truncateBlobId(formBlobId) : maskBlobId(formBlobId, advancedView);

  return (
    <tr className="border-b border-border-subtle hover:bg-bg-muted transition-colors duration-fast">
      {/* Submission reference */}
      <td className="px-4 py-3">
        <span
          className="font-mono text-token-sm text-text-secondary"
          title={advancedView ? blobId : undefined}
        >
          {displayBlobId}
        </span>
      </td>

      {/* Form reference */}
      <td className="px-4 py-3">
        <span
          className="font-mono text-token-sm text-text-tertiary"
          title={advancedView ? formBlobId : undefined}
        >
          {displayFormBlobId}
        </span>
      </td>

      {/* Submitted at */}
      <td className="px-4 py-3">
        <span className="text-token-sm text-text-secondary" title={submittedAt}>
          {formatDate(submittedAt)}
        </span>
      </td>

      {/* Encryption indicator */}
      <td className="px-4 py-3">
        <EncryptedSubmissionIndicator />
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        {isUnlinked ? (
          <Badge variant="warning" size="sm">
            Unlinked
          </Badge>
        ) : (
          <Badge variant="success" size="sm">
            Stored
          </Badge>
        )}
      </td>
    </tr>
  );
}
