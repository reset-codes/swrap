'use client';

/**
 * UploadStatusPill — renders upload progress using UX_Vocabulary labels.
 *
 * This component maps legacy POC save stages to the canonical Upload_State_Machine
 * states and uses `uploadPhase()` from `ux-copy.ts` for all user-visible labels.
 * No internal state names are rendered directly.
 *
 * Requirements: 6.12, 8.1, 8.8
 */

import * as React from 'react';
import { uploadPhase, type UploadState } from '../../lib/copy/ux-copy';

/** All possible save stage values (legacy POC interface). */
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

/**
 * Maps legacy POC save stages to canonical Upload_State_Machine states
 * and uses `uploadPhase()` for the user-visible label.
 */
function getConfig(stage: SaveStage): PillConfig | null {
  switch (stage) {
    case 'idle':
      return null;
    case 'securing':
      // Maps to 'encrypting' in the Upload_State_Machine
      return { label: uploadPhase('encrypting'), variant: 'loading' };
    case 'uploading':
      // Maps to 'uploading' in the Upload_State_Machine
      return { label: uploadPhase('uploading'), variant: 'loading' };
    case 'anchoring':
      // Maps to 'uploaded' (saving to network = waiting for indexing)
      return { label: uploadPhase('uploaded'), variant: 'loading' };
    case 'success':
      // Maps to 'indexed' in the Upload_State_Machine
      return { label: uploadPhase('indexed'), variant: 'success' };
    case 'error.securing':
      return { label: uploadPhase('failed'), variant: 'error' };
    case 'error.uploading':
      return { label: uploadPhase('failed'), variant: 'error' };
    case 'error.anchoring':
      return { label: uploadPhase('failed'), variant: 'error' };
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
