'use client';

/**
 * UploadStatusPill — renders the four save stages via uxCopy.save.
 *
 * Stages:
 *   idle       → show nothing (null)
 *   securing   → uxCopy.save.loading.securing
 *   uploading  → uxCopy.save.loading.uploading
 *   anchoring  → uxCopy.save.loading.anchoring
 *   success    → uxCopy.save.success
 *   error.securing   → uxCopy.save.error.securing
 *   error.uploading  → uxCopy.save.error.uploading
 *   error.anchoring  → uxCopy.save.error.anchoring
 *
 * Requirements: R19.6, R19.7, R19.8
 */

import * as React from 'react';
import { uxCopy } from '../../copy/ux-copy';

/** All possible save stage values. */
export type SaveStage =
  | 'idle'
  | 'securing'
  | 'uploading'
  | 'anchoring'
  | 'success'
  | 'error.securing'
  | 'error.uploading'
  | 'error.anchoring';

export interface UploadStatusPillProps {
  stage: SaveStage;
}

type PillVariant = 'loading' | 'success' | 'error';

interface PillConfig {
  label: string;
  variant: PillVariant;
}

function getConfig(stage: SaveStage): PillConfig | null {
  switch (stage) {
    case 'idle':
      return null;
    case 'securing':
      return { label: uxCopy.save.loading.securing, variant: 'loading' };
    case 'uploading':
      return { label: uxCopy.save.loading.uploading, variant: 'loading' };
    case 'anchoring':
      return { label: uxCopy.save.loading.anchoring, variant: 'loading' };
    case 'success':
      return { label: uxCopy.save.success, variant: 'success' };
    case 'error.securing':
      return { label: uxCopy.save.error.securing, variant: 'error' };
    case 'error.uploading':
      return { label: uxCopy.save.error.uploading, variant: 'error' };
    case 'error.anchoring':
      return { label: uxCopy.save.error.anchoring, variant: 'error' };
    default: {
      // Exhaustive check — TypeScript will error if a new stage is added without handling it.
      const _exhaustive: never = stage;
      return null;
    }
  }
}

const variantClasses: Record<PillVariant, string> = {
  loading: 'bg-bg-muted text-text-secondary border-border-subtle',
  success: 'bg-status-success-bg text-status-success border-status-success',
  error:   'bg-status-error-bg text-status-error border-status-error',
};

export function UploadStatusPill({ stage }: UploadStatusPillProps) {
  const config = getConfig(stage);

  if (!config) return null;

  const { label, variant } = config;
  const isLoading = variant === 'loading';

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        'text-token-xs font-medium',
        variantClasses[variant],
      ].join(' ')}
    >
      {isLoading && (
        <svg
          className="h-3 w-3 animate-spin"
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
      {label}
    </span>
  );
}
