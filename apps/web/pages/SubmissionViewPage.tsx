'use client';

/**
 * SubmissionViewPage — owner-only view of a submission by Blob_ID.
 *
 * Fetches submission metadata via metadata-client.getSubmission(), then
 * requests decryption via metadata-client.requestDecryption() for private
 * submissions, or fetches content from Walrus for public submissions.
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
import { getSubmission, requestDecryption } from '../lib/api/metadata-client';
import { LoadingState } from '../components/ui';
import { ContentFrame } from '../components/layout/ContentFrame';
import { PageHeader } from '../components/layout/PageHeader';
import { AppShell } from '../components/layout/AppShell';
import { SubmissionDetailPanel } from '../components/submissions';

// POC UX copy strings (inlined — apps/web/copy/ux-copy was removed as a duplicate)
const pocCopy = {
  fetch: {
    loading: 'Loading your form…',
    error: 'Could not load the form. Please check the link and try again.',
  },
} as const;

// ---------------------------------------------------------------------------
// Walrus aggregator URL helper
// ---------------------------------------------------------------------------

function getWalrusAggregatorUrl(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL) {
    return process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL.replace(/\/+$/, '');
  }
  return 'https://aggregator.walrus-testnet.walrus.space';
}

/**
 * Fetch raw bytes for a Walrus blob by its blob ID.
 * Used to retrieve public submission content from Walrus.
 */
async function walrusFetchBlob(blobId: string): Promise<Uint8Array> {
  const base = getWalrusAggregatorUrl();
  const url = `${base}/v1/blobs/${encodeURIComponent(blobId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Walrus fetch failed: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// FetchState union — four UX_State primitives (R19.7)
// ---------------------------------------------------------------------------

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; submission: Submission }
  | { status: 'error'; stage: string; message: string };

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
        // Step 1: Fetch submission metadata via canonical metadata-client
        const metaResult = await getSubmission(blobId, ''); // session token wired in auth task

        if (cancelled) return;

        if (!metaResult.ok) {
          setFetchState({
            status: 'error',
            stage: 'loading',
            message: metaResult.error.message ?? pocCopy.fetch.error,
          });
          return;
        }

        const submissionRow = metaResult.result;

        // Step 2: Retrieve submission content
        let submission: Submission;

        if (submissionRow.privacyMode === 'private') {
          // For private submissions: request decryption from the API_Server.
          // The API_Server performs the authorization check and returns plaintext.
          const decryptResult = await requestDecryption(submissionRow.id, ''); // session token wired in auth task

          if (cancelled) return;

          if (!decryptResult.ok) {
            const message =
              decryptResult.error.code === 'Forbidden'
                ? "You don't have access to that"
                : decryptResult.error.message ?? pocCopy.fetch.error;
            setFetchState({ status: 'error', stage: 'decrypt', message });
            return;
          }

          // Parse the decrypted plaintext as a Submission
          try {
            submission = JSON.parse(decryptResult.result.plaintext) as Submission;
          } catch {
            setFetchState({
              status: 'error',
              stage: 'parse',
              message: 'Failed to parse submission content.',
            });
            return;
          }
        } else {
          // For public submissions: fetch content from Walrus directly
          let bytes: Uint8Array;
          try {
            bytes = await walrusFetchBlob(submissionRow.walrusBlobId);
          } catch (walrusErr) {
            if (cancelled) return;
            const message = walrusErr instanceof Error ? walrusErr.message : pocCopy.fetch.error;
            setFetchState({ status: 'error', stage: 'loading', message });
            return;
          }

          if (cancelled) return;

          try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            submission = JSON.parse(text) as Submission;
          } catch {
            setFetchState({
              status: 'error',
              stage: 'parse',
              message: 'Failed to parse submission content.',
            });
            return;
          }
        }

        if (cancelled) return;

        setFetchState({ status: 'success', submission });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : pocCopy.fetch.error;
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
            <LoadingState mode="block" label={pocCopy.fetch.loading} />
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
                {pocCopy.fetch.error}
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
