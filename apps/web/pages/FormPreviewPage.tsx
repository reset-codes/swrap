'use client';

/**
 * FormPreviewPage — read-only preview of a saved form by Blob_ID.
 *
 * Fetches GET /api/poc/forms/[blob_id], handles FetchState union
 * (idle/loading/success/error), and renders the parsed schema via
 * FormField primitives in read-only mode.
 *
 * On retrieval or decryption failure, shows a stage-labeled error and
 * does NOT render a partial schema (R10.9).
 *
 * BlobReferenceChip in the header: monospace, click-to-copy (R19.7).
 *
 * All user-visible strings come from uxCopy (R19.8).
 *
 * Requirements: R10.6, R10.9, R19.7, R19.8
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { FormSchema } from '@poc/shared';
import { uxCopy } from '../copy/ux-copy';
import { FormField, Input, Textarea, LoadingState, Button } from '../components/ui';
import { ContentFrame } from '../components/layout/ContentFrame';
import { PageHeader } from '../components/layout/PageHeader';
import { AppShell } from '../components/layout/AppShell';

// ---------------------------------------------------------------------------
// FetchState union — four UX_State primitives (R19.7)
// ---------------------------------------------------------------------------

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; formSchema: FormSchema }
  | { status: 'error'; stage: string; message: string };

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface FetchApiSuccess {
  form_schema: FormSchema;
  blob_id: string;
  schema_hash: string;
}

interface FetchApiError {
  error: {
    code: string;
    stage: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// BlobReferenceChip — monospace, click-to-copy
// ---------------------------------------------------------------------------

interface BlobReferenceChipProps {
  blobId: string;
}

function BlobReferenceChip({ blobId }: BlobReferenceChipProps) {
  const [copied, setCopied] = React.useState(false);

  // Truncate: show first 8 + "…" + last 8 chars
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
// Read-only field renderer
// ---------------------------------------------------------------------------

interface ReadOnlyFieldProps {
  field: FormSchema['fields'][number];
  index: number;
}

function ReadOnlyField({ field, index }: ReadOnlyFieldProps) {
  const fieldId = `preview-field-${index}`;

  const control = (() => {
    switch (field.type) {
      case 'textarea':
        return (
          <Textarea
            id={fieldId}
            disabled
            readOnly
            placeholder={`${field.label} (read-only)`}
            aria-label={field.label}
          />
        );
      case 'checkbox':
        return (
          <div className="flex items-center gap-2">
            <input
              id={fieldId}
              type="checkbox"
              disabled
              className="h-4 w-4 rounded border-border-subtle text-accent-base focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={field.label}
            />
            <span className="text-token-sm text-text-secondary">{field.label}</span>
          </div>
        );
      case 'select':
        return (
          <select
            id={fieldId}
            disabled
            className="flex h-8 w-full rounded-md border border-border-subtle bg-bg-surface px-3 text-token-base text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1"
            aria-label={field.label}
          >
            <option value="">Select an option…</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case 'number':
        return (
          <Input
            id={fieldId}
            type="number"
            disabled
            readOnly
            placeholder={`${field.label} (read-only)`}
            aria-label={field.label}
          />
        );
      case 'email':
        return (
          <Input
            id={fieldId}
            type="email"
            disabled
            readOnly
            placeholder={`${field.label} (read-only)`}
            aria-label={field.label}
          />
        );
      case 'text':
      default:
        return (
          <Input
            id={fieldId}
            type="text"
            disabled
            readOnly
            placeholder={`${field.label} (read-only)`}
            aria-label={field.label}
          />
        );
    }
  })();

  // For checkbox, the label is rendered inline with the control
  if (field.type === 'checkbox') {
    return (
      <div className="flex flex-col gap-1.5">
        {control}
      </div>
    );
  }

  return (
    <FormField
      label={field.label}
      required={field.required}
      htmlFor={fieldId}
    >
      {control}
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// FormPreviewPage component
// ---------------------------------------------------------------------------

export interface FormPreviewPageProps {
  blobId: string;
}

export function FormPreviewPage({ blobId }: FormPreviewPageProps) {
  const router = useRouter();
  const [fetchState, setFetchState] = React.useState<FetchState>({ status: 'idle' });

  // Fetch on mount
  React.useEffect(() => {
    let cancelled = false;

    async function fetchForm() {
      setFetchState({ status: 'loading' });

      try {
        const response = await fetch(`/api/poc/forms/${encodeURIComponent(blobId)}`);

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

        setFetchState({ status: 'success', formSchema: data.form_schema });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : uxCopy.fetch.error;
        setFetchState({ status: 'error', stage: 'loading', message });
      }
    }

    fetchForm();

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

  // UX_State: error — do NOT render partial schema (R10.9)
  if (fetchState.status === 'error') {
    return (
      <AppShell>
        <ContentFrame>
          <PageHeader
            title="Form preview"
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
  const { formSchema } = fetchState;

  return (
    <AppShell>
      <ContentFrame>
        <PageHeader
          title={formSchema.title}
          actions={
            <div className="flex items-center gap-4">
              <Button
                variant="primary"
                size="sm"
                onClick={() => router.push(`/poc/forms/${blobId}/fill`)}
              >
                Fill out form
              </Button>
              <BlobReferenceChip blobId={blobId} />
            </div>
          }
        />

        <div className="mt-8 flex flex-col gap-6 max-w-2xl">
          {formSchema.fields.length === 0 ? (
            <p className="text-token-sm text-text-secondary">
              This form has no fields.
            </p>
          ) : (
            <div
              className="flex flex-col gap-4"
              role="list"
              aria-label="Form fields (read-only)"
            >
              {formSchema.fields.map((field, index) => (
                <div key={index} role="listitem">
                  <ReadOnlyField field={field} index={index} />
                </div>
              ))}
            </div>
          )}
        </div>
      </ContentFrame>
    </AppShell>
  );
}
