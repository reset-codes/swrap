'use client';

/**
 * FormFillPage — Form_Submission_UI page component.
 *
 * Fetches form metadata via metadata-client.getForm(), then fetches the
 * form definition content from Walrus. Manages the full submit flow via
 * metadata-client.createSubmission().
 *
 * Two state machines:
 *   FetchState: idle | loading | success(formSchema) | error(stage, message)
 *   SubmitState: idle | loading(stage) | success(blobId) | error(stage, message)
 *
 * All five UX_State primitives are rendered explicitly (R19.7).
 * All user-visible strings come from pocCopy.submit (R19.8).
 * Validation failure shows field-level errors without uploading (R12.6).
 * On success: upsertSubmission in Local_Store (R12.4).
 *
 * Requirements: R12.1, R12.2, R12.3, R12.4, R12.6, R19.7, R19.8
 */

import * as React from 'react';
import type { FormSchema } from '@poc/shared';
import { getForm, createSubmission } from '../lib/api/metadata-client';
import { useLocalStore } from '../stores/local-store';
import { SubmissionFillFields } from '../components/submissions';
import { Button, LoadingState } from '../components/ui';
import { ContentFrame } from '../components/layout/ContentFrame';
import { PageHeader } from '../components/layout/PageHeader';
import { AppShell } from '../components/layout/AppShell';

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
 * Used to retrieve form definition content from Walrus.
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
// POC UX copy strings (inlined — apps/web/copy/ux-copy was removed as a
// duplicate; these pages are legacy POC UI pending migration to the canonical
// upload state machine flow)
// ---------------------------------------------------------------------------
const pocCopy = {
  fetch: {
    loading: 'Loading your form…',
    error: 'Could not load the form. Please check the link and try again.',
  },
  submit: {
    idle: 'Submit',
    loading: {
      validating: 'Checking your responses…',
      securing: 'Securing your response…',
      uploading: 'Submitting securely…',
    },
    success: 'Response submitted successfully.',
    error: {
      validating: 'Some responses need attention. Please review and try again.',
      securing: 'Failed to secure your response. Please try again.',
      uploading: 'Submission failed. Please check your connection and try again.',
    },
  },
} as const;

type SubmitLoadingStage = keyof typeof pocCopy.submit.loading;
type SubmitErrorStage = keyof typeof pocCopy.submit.error;

// ---------------------------------------------------------------------------
// FetchState union — four UX_State primitives for loading the form
// ---------------------------------------------------------------------------

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; formSchema: FormSchema; formId: string }
  | { status: 'error'; stage: string; message: string };

// ---------------------------------------------------------------------------
// SubmitState union — five UX_State primitives for submitting
// ---------------------------------------------------------------------------

type SubmitState =
  | { status: 'idle' }
  | { status: 'loading'; stage: SubmitLoadingStage }
  | { status: 'success'; blobId: string }
  | { status: 'error'; stage: SubmitErrorStage; message: string };

// ---------------------------------------------------------------------------
// Map API error code to SubmitErrorStage
// ---------------------------------------------------------------------------

function toSubmitErrorStage(apiCode: string): SubmitErrorStage {
  if (apiCode === 'Validation') return 'validating';
  if (apiCode === 'Internal' || apiCode === 'BlobNotFound') return 'uploading';
  if (apiCode === 'Unauthorized' || apiCode === 'Forbidden') return 'securing';
  return 'uploading';
}

// ---------------------------------------------------------------------------
// Validate required fields client-side before submitting (R12.6)
// ---------------------------------------------------------------------------

function validateAnswers(
  formSchema: FormSchema,
  answers: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of formSchema.fields) {
    if (!field.required) continue;

    const value = answers[field.label];

    if (field.type === 'checkbox') {
      // Checkbox required means it must be checked
      if (value !== true) {
        errors[field.label] = 'This field is required.';
      }
    } else if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0)
    ) {
      errors[field.label] = 'This field is required.';
    }
  }

  return errors;
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
// FormFillPage component
// ---------------------------------------------------------------------------

export interface FormFillPageProps {
  blobId: string;
}

export function FormFillPage({ blobId }: FormFillPageProps) {
  const [fetchState, setFetchState] = React.useState<FetchState>({ status: 'idle' });
  const [submitState, setSubmitState] = React.useState<SubmitState>({ status: 'idle' });
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // ---------------------------------------------------------------------------
  // Fetch form on mount (R12.1)
  // ---------------------------------------------------------------------------

  React.useEffect(() => {
    let cancelled = false;

    async function fetchForm() {
      setFetchState({ status: 'loading' });

      try {
        // Step 1: Fetch form metadata via canonical metadata-client
        const metaResult = await getForm(blobId);

        if (cancelled) return;

        if (!metaResult.ok) {
          setFetchState({
            status: 'error',
            stage: 'loading',
            message: metaResult.error.message ?? pocCopy.fetch.error,
          });
          return;
        }

        const formRow = metaResult.result;

        // Step 2: Fetch form definition content from Walrus using the blob ID
        let formSchema: FormSchema;
        try {
          const bytes = await walrusFetchBlob(formRow.walrusBlobId);
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          formSchema = JSON.parse(text) as FormSchema;
        } catch (walrusErr) {
          if (cancelled) return;
          const message = walrusErr instanceof Error ? walrusErr.message : pocCopy.fetch.error;
          setFetchState({ status: 'error', stage: 'loading', message });
          return;
        }

        if (cancelled) return;

        setFetchState({ status: 'success', formSchema, formId: formRow.id });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : pocCopy.fetch.error;
        setFetchState({ status: 'error', stage: 'loading', message });
      }
    }

    fetchForm();

    return () => {
      cancelled = true;
    };
  }, [blobId]);

  // ---------------------------------------------------------------------------
  // Submit handler (R12.2, R12.3, R12.4, R12.6)
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    if (fetchState.status !== 'success') return;

    const { formSchema, formId } = fetchState;

    // Clear previous errors
    setFieldErrors({});
    setSubmitState({ status: 'idle' });

    // Client-side validation (R12.6 — no upload on failure)
    setSubmitState({ status: 'loading', stage: 'validating' });

    const errors = validateAnswers(formSchema, answers);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitState({
        status: 'error',
        stage: 'validating',
        message: pocCopy.submit.error.validating,
      });
      return;
    }

    // Securing stage
    setSubmitState({ status: 'loading', stage: 'securing' });

    try {
      // Uploading stage — transition before the actual API call
      setSubmitState({ status: 'loading', stage: 'uploading' });

      // Use the canonical metadata-client to create the submission.
      // The API_Server handles encryption (for private forms) and Walrus storage.
      // Session token is empty string for now (auth session wired in a later task).
      const result = await createSubmission(
        {
          formId,
          formVersion: 1,
          submitterAddress: '', // populated by auth session in a later task
          privacyMode: 'public', // default to public for legacy POC flow
          payload: JSON.stringify(answers),
        },
        '', // session token — wired in auth task
      );

      if (!result.ok) {
        const stage = toSubmitErrorStage(result.error.code);
        const message = result.error.message ?? String(pocCopy.submit.error[stage]);
        setSubmitState({ status: 'error', stage, message });
        return;
      }

      const submissionRow = result.result;

      // Persist to Local_Store (R12.4)
      useLocalStore.getState().upsertSubmission({
        blobId: submissionRow.walrusBlobId,
        formBlobId: blobId,
        submittedAt: submissionRow.createdAt,
      });

      setSubmitState({ status: 'success', blobId: submissionRow.walrusBlobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : pocCopy.submit.error.uploading;
      setSubmitState({ status: 'error', stage: 'uploading', message });
    }
  }

  // ---------------------------------------------------------------------------
  // Render — UX_State primitives (R19.7)
  // ---------------------------------------------------------------------------

  // UX_State: fetch loading
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

  // UX_State: fetch error — do NOT render partial schema
  if (fetchState.status === 'error') {
    return (
      <AppShell>
        <ContentFrame>
          <PageHeader
            title="Fill out form"
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

  // UX_State: submit loading
  if (submitState.status === 'loading') {
    return (
      <AppShell>
        <ContentFrame>
          <div className="flex items-center justify-center py-24">
            <LoadingState
              mode="block"
              label={pocCopy.submit.loading[submitState.stage]}
            />
          </div>
        </ContentFrame>
      </AppShell>
    );
  }

  // UX_State: submit success
  if (submitState.status === 'success') {
    return (
      <AppShell>
        <ContentFrame>
          <PageHeader
            title={fetchState.formSchema.title}
            actions={<BlobReferenceChip blobId={blobId} />}
          />
          <div className="mt-8 max-w-2xl">
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-status-success bg-status-success-bg p-6 flex flex-col gap-3"
            >
              <p className="text-token-base font-medium text-status-success">
                {pocCopy.submit.success}
              </p>
              <p className="text-token-sm text-text-secondary font-mono">
                Submission ID: {submitState.blobId}
              </p>
            </div>
          </div>
        </ContentFrame>
      </AppShell>
    );
  }

  // UX_State: idle or error — render the form
  const { formSchema } = fetchState;
  // submitState is 'idle' | 'error' at this point (loading and success are handled above)
  const isSubmitting = false;

  return (
    <AppShell>
      <ContentFrame>
        <PageHeader
          title={formSchema.title}
          actions={<BlobReferenceChip blobId={blobId} />}
        />

        <div className="mt-8 flex flex-col gap-6 max-w-2xl">
          {/* UX_State: submit error */}
          {submitState.status === 'error' && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-status-error bg-status-error-bg p-4"
            >
              <p className="text-token-sm font-medium text-status-error">
                {submitState.message}
              </p>
            </div>
          )}

          {/* Form fields */}
          {formSchema.fields.length === 0 ? (
            <p className="text-token-sm text-text-secondary">
              This form has no fields.
            </p>
          ) : (
            <SubmissionFillFields
              formSchema={formSchema}
              answers={answers}
              onChange={setAnswers}
              errors={fieldErrors}
              disabled={isSubmitting}
            />
          )}

          {/* Submit button */}
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit}
              disabled={isSubmitting}
              aria-label={pocCopy.submit.idle}
            >
              {pocCopy.submit.idle}
            </Button>
          </div>
        </div>
      </ContentFrame>
    </AppShell>
  );
}
