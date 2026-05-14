'use client';

/**
 * SubmissionViewPage — owner-only view of a decrypted submission by Blob_ID.
 *
 * Fetches GET /api/poc/submissions/[blob_id], decrypts server-side, and
 * renders the parsed Submission via SubmissionDetailPanel in read-only mode.
 *
 * FetchState union: idle | loading | success(submission) | error(stage, message)
 *
 * On retrieval or decryption failure, shows a stage-labeled error and does
 * NOT render partial data (R19.7).
 *
 * All user-visible strings come from uxCopy (R19.8).
 *
 * Requirements: R12.5, R19.7, R19.8
 */

import * as React from 'react';
import type { Submission } from '@poc/shared';
import { uxCopy } from '../copy/ux-copy';
import { LoadingState } from '../components/ui';
import { ContentFrame } from '../components/layout/ContentFrame';
import { PageHeader } from '../components/layout/PageHeader';
import { AppShell } from '../components/layout/AppShell';
import { SubmissionDetailPanel } from '../components/submissions';

// ---------------------------------------------------------------------------
// FetchState union — four UX_State primitives (R19.7)
// ---------------------------------------------------------------------------

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; submission: Submission }
  | { status: 'error'; stage: string; message: string };

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface FetchApiSuccess {
  submission: Submission;
  blob_id: string;
}

interface FetchApiError {
  error: {
    code: string;
    stage: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// BlobReferenceChip — monospace, click-to-copy (R19.7)
// ---------------------------------------------------------------------------

interface BlobReferenceChipProps {
  blobId: string;
}

function BlobReferenceChip({ blobId }: BlobReferenceChipProps) {
  const [copied, setCopied] = React.useState(false);

  const truncated =
    blobId.length > 20
      ? `${blobId.slice(0, 8)}…${blobId.slice(-8)}`
      : blobId;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(blobId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy Blob ID: ${blobId}`}
      aria-label={copied ? 'Blob ID copied' : `Copy Blob ID ${blobId}`}
      className={[
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5',
        'font-mono text-token-xs transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1',
        copied
          ? 'border-status-success bg-status-success-bg text-status-success'
          : 'border-border-subtle bg-bg-muted text-text-secondary hover:border-border-strong hover:text-text-primary',
      ].join(' ')}
    >
      <span>{truncated}</span>
      {copied ? (
        <svg
          className="h-3 w-3 flex-shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 8l3.5 3.5L13 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg
          className="h-3 w-3 flex-shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="5"
            y="5"
            width="8"
            height="8"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M3 11V3h8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SubmissionViewPage component
// ---------------------------------------------------------------------------

export interface SubmissionViewPageProps {
  blobId: string;
}

export function SubmissionViewPage({ blobId }: SubmissionViewPageProps) {
  const [fetchState, setFetchState] = React.useState<FetchState>({ status: 'idle' });

  // Fetch on mount
  React.useEffect(() => {
    let cancelled = false;

    async function fetchSubmission() {
      setFetchState({ status: 'loading' });

      try {
        const response = await fetch(
          `/api/poc/submissions/${encodeURIComponent(blobId)}`,
        );

        if (cancelled) return;

        if (!response.ok) {
          let stage = 'loading';
          let message: string = uxCopy.fetch.error;

          try {
            const errBody = (await response.json()) as FetchApiError;
            stage = errBody.error?.stage ?? 'loading';
            message = errBody.error?.message ?? uxCopy.fetch.error;
          } catch {
            // JSON parse failed — use defaults
          }

          setFetchState({ status: 'error', stage, message });
          return;
        }

        const data = (await response.json()) as FetchApiSuccess;

        if (cancelled) return;

        setFetchState({ status: 'success', submission: data.submission });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : uxCopy.fetch.error;
        setFetchState({ status: 'error', stage: 'loading', message });
      }
    }

    fetchSubmission();

    return () => {
      cancelled = true;
    };
  }, [blobId]);

  // ---------------------------------------------------------------------------
  // Render — UX_State primitives (R19.7)
  // ---------------------------------------------------------------------------

  // UX_State: loading
  if (fetchState.status === 'idle' || fetchState.status === 'loading') {
    return (
      <AppShell>
        <ContentFrame>
          <div className="flex items-center justify-center py-24">
            <LoadingState mode="block" label={uxCopy.fetch.loading} />
          </div>
        </ContentFrame>
      </AppShell>
    );
  }

  // UX_State: error — do NOT render partial data
  if (fetchState.status === 'error') {
    return (
      <AppShell>
        <ContentFrame>
          <PageHeader
            title="Submission"
            actions={<BlobReferenceChip blobId={blobId} />}
          />
          <div className="mt-8 max-w-2xl">
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-status-error bg-status-error-bg p-4"
            >
              <p className="text-token-sm font-medium text-status-error">
                {uxCopy.fetch.error}
              </p>
              {fetchState.stage && fetchState.stage !== 'loading' && (
                <p className="mt-1 text-token-xs text-status-error opacity-75">
                  Stage: {fetchState.stage}
                </p>
              )}
            </div>
          </div>
        </ContentFrame>
      </AppShell>
    );
  }

  // UX_State: success
  const { submission } = fetchState;

  return (
    <AppShell>
      <ContentFrame>
        <PageHeader
          title="Submission"
          actions={<BlobReferenceChip blobId={blobId} />}
        />

        <div className="mt-8 max-w-2xl">
          <SubmissionDetailPanel submission={submission} />
        </div>
      </ContentFrame>
    </AppShell>
  );
}
