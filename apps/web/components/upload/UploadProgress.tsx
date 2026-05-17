'use client';

/**
 * UploadProgress — renders Upload_Job progress using UX vocabulary.
 *
 * This component displays the current upload phase using human-readable labels
 * from `ux-copy.uploadPhase()` and NEVER renders internal state names directly.
 * It surfaces retry, reconcile, and discard affordances based on job state.
 *
 * Requirements: 6.11, 6.12, 8.8
 */

import * as React from 'react';
import { uploadPhase } from '../../lib/copy/ux-copy';
import type { UploadJob } from '../../lib/upload/upload-state-machine';
import { isOrphan } from '../../lib/upload/upload-state-machine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadProgressProps {
  /** The current Upload_Job to display progress for. */
  job: UploadJob;
  /** Called when the user clicks the retry affordance (available when state === 'failed'). */
  onRetry?: () => void;
  /** Called when the user clicks the reconcile affordance (available for orphaned jobs). */
  onReconcile?: () => void;
  /** Called when the user clicks the discard affordance (available for orphaned jobs). */
  onDiscard?: () => void;
  /** Optional additional CSS class names. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Variant styling
// ---------------------------------------------------------------------------

type ProgressVariant = 'active' | 'success' | 'error' | 'orphan';

function getVariant(job: UploadJob): ProgressVariant {
  if (job.state === 'failed') return 'error';
  if (job.state === 'indexed') return 'success';
  if (isOrphan(job)) return 'orphan';
  return 'active';
}

const variantClasses: Record<ProgressVariant, string> = {
  active: 'bg-bg-muted text-text-secondary border-border-subtle',
  success: 'bg-status-success-bg text-status-success border-status-success',
  error: 'bg-status-error-bg text-status-error border-status-error',
  orphan: 'bg-status-warning-bg text-status-warning border-status-warning',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UploadProgress({
  job,
  onRetry,
  onReconcile,
  onDiscard,
  className,
}: UploadProgressProps) {
  const variant = getVariant(job);
  const phaseLabel = uploadPhase(job.state);
  const orphaned = isOrphan(job);
  const isActive = variant === 'active';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={phaseLabel}
      className={[
        'flex items-center gap-2 rounded-md border px-3 py-2',
        'text-token-sm font-medium',
        variantClasses[variant],
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Spinner for active (in-progress) states */}
      {isActive && (
        <svg
          className="h-4 w-4 animate-spin flex-shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}

      {/* Phase label — always uses UX vocabulary, never internal state names */}
      <span className="flex-1">{phaseLabel}</span>

      {/* Retry affordance — shown when state is 'failed' */}
      {job.state === 'failed' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry upload"
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-token-xs font-medium bg-status-error text-text-inverse hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1"
        >
          Retry
        </button>
      )}

      {/* Orphan affordances — shown when job is orphaned */}
      {orphaned && (
        <div className="flex items-center gap-1.5" role="group" aria-label="Orphan recovery actions">
          {onReconcile && (
            <button
              type="button"
              onClick={onReconcile}
              aria-label="Reconcile orphaned upload"
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-token-xs font-medium bg-accent-base text-text-inverse hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1"
            >
              Reconcile
            </button>
          )}
          {onDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              aria-label="Discard orphaned upload"
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-token-xs font-medium bg-bg-surface text-text-primary border border-border-subtle hover:bg-bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1"
            >
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}
