'use client';

/**
 * SubmissionDetailView — Client component for the submission detail page.
 *
 * Displays:
 *   - Field values with encryption indicators and decrypt buttons
 *   - Inline media previews for image/video BlobRef fields
 *   - Walrus blob ID with copy-to-clipboard
 *   - Status badge with update dropdown (append-only)
 *   - Status history timeline
 *   - Submission timestamps
 *
 * Requirements: R12
 */

import { useState, useTransition } from 'react';
import { Lock, Copy, Check, Clock, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { toasts } from '@/lib/toast';
import type { SubmissionView, SubmissionStatus, FieldValue, BlobRef } from '@/types/submission';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: SubmissionStatus[] = [
  'open',
  'under_review',
  'planned',
  'resolved',
  'rejected',
];

const STATUS_LABELS: Record<SubmissionStatus, string> = {
  open: 'Open',
  under_review: 'Under Review',
  planned: 'Planned',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

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

function isBlobRef(value: unknown): value is BlobRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'blobId' in value &&
    'mimeType' in value
  );
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isVideoMime(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

function renderScalarValue(value: FieldValue['value']): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(', ');
  }
  return String(value);
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
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

// ─── MediaPreview ─────────────────────────────────────────────────────────────

interface MediaPreviewProps {
  blobRef: BlobRef;
  walrusAggregatorUrl: string;
}

function MediaPreview({ blobRef, walrusAggregatorUrl }: MediaPreviewProps) {
  const url = `${walrusAggregatorUrl}/v1/blobs/${blobRef.blobId}`;

  if (isImageMime(blobRef.mimeType)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={blobRef.fileName}
        className="max-w-full rounded-md border border-border"
      />
    );
  }

  if (isVideoMime(blobRef.mimeType)) {
    return (
      <video
        src={url}
        controls
        className="max-w-full rounded-md border border-border"
        aria-label={blobRef.fileName}
      />
    );
  }

  // Generic file — show a download link
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline text-small"
    >
      {blobRef.fileName} ({blobRef.mimeType})
    </a>
  );
}

// ─── EncryptedFieldValue ──────────────────────────────────────────────────────

interface EncryptedFieldValueProps {
  fieldValue: FieldValue;
  submissionId: string;
}

function EncryptedFieldValue({ fieldValue, submissionId }: EncryptedFieldValueProps) {
  const [decryptedValue, setDecryptedValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDecrypt = () => {
    if (!fieldValue.encryptedData) return;

    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/submissions/${submissionId}/decrypt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedData: fieldValue.encryptedData }),
        });

        const json = await res.json();

        if (!res.ok || !json.success) {
          setError(json.error?.message ?? 'Decryption failed.');
          return;
        }

        // Display-only — never persisted
        setDecryptedValue(String(json.data.plaintext));
      } catch {
        setError('Network error. Please try again.');
      }
    });
  };

  // Decrypted — show plaintext with a note that it's ephemeral
  if (decryptedValue !== null) {
    return (
      <div className="space-y-1">
        <p className="text-body text-text-primary break-words">{decryptedValue}</p>
        <p className="text-small text-text-muted italic">
          Decrypted in-memory only — not stored.
        </p>
      </div>
    );
  }

  // Has encrypted data — show decrypt button
  if (fieldValue.encryptedData) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-small text-seal-brand">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Encrypted</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleDecrypt}
          disabled={isPending}
          aria-label="Decrypt this field value"
        >
          {isPending ? 'Decrypting…' : 'Decrypt'}
        </Button>
        {error && (
          <p className="text-small text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  // Encrypted but no data available (e.g. full_submission mode)
  return (
    <div className="flex items-center gap-1.5 text-small text-seal-brand">
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Encrypted</span>
    </div>
  );
}

// ─── FieldValueDisplay ────────────────────────────────────────────────────────

interface FieldValueDisplayProps {
  fieldValue: FieldValue;
  index: number;
  submissionId: string;
  walrusAggregatorUrl: string;
}

function FieldValueDisplay({
  fieldValue,
  index,
  submissionId,
  walrusAggregatorUrl,
}: FieldValueDisplayProps) {
  const label = `Field ${index + 1}`;

  const renderValue = () => {
    if (fieldValue.encrypted) {
      return (
        <EncryptedFieldValue
          fieldValue={fieldValue}
          submissionId={submissionId}
        />
      );
    }

    const { value } = fieldValue;

    // BlobRef array
    if (Array.isArray(value) && value.length > 0 && isBlobRef(value[0])) {
      return (
        <div className="space-y-2">
          {(value as BlobRef[]).map((blob) => (
            <MediaPreview
              key={blob.blobId}
              blobRef={blob}
              walrusAggregatorUrl={walrusAggregatorUrl}
            />
          ))}
        </div>
      );
    }

    // Single BlobRef
    if (isBlobRef(value)) {
      return (
        <MediaPreview
          blobRef={value}
          walrusAggregatorUrl={walrusAggregatorUrl}
        />
      );
    }

    // Scalar / array of strings
    return (
      <p className="text-body text-text-primary break-words">
        {renderScalarValue(value)}
      </p>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
      <p className="text-small font-medium text-text-secondary mb-1">{label}</p>
      <div className="text-body text-text-primary">{renderValue()}</div>
    </div>
  );
}

// ─── StatusUpdateDropdown ─────────────────────────────────────────────────────

interface StatusUpdateDropdownProps {
  submissionId: string;
  currentStatus: SubmissionStatus;
  onStatusUpdated: (newStatus: SubmissionStatus) => void;
}

function StatusUpdateDropdown({
  submissionId,
  currentStatus,
  onStatusUpdated,
}: StatusUpdateDropdownProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (status: SubmissionStatus) => {
    if (status === currentStatus) {
      setOpen(false);
      return;
    }

    startTransition(async () => {
      setError(null);
      setOpen(false);
      try {
        const res = await fetch(`/api/submissions/${submissionId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });

        const json = await res.json();

        if (!res.ok || !json.success) {
          setError(json.error?.message ?? 'Failed to update status.');
          return;
        }

        toasts.statusUpdated(STATUS_LABELS[status]);
        onStatusUpdated(status);
      } catch {
        setError('Network error. Please try again.');
        toasts.networkError();
      }
    });
  };

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change submission status"
        className="gap-1.5"
      >
        {isPending ? 'Updating…' : 'Change Status'}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>

      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <ul
            role="listbox"
            aria-label="Select new status"
            className="absolute left-0 top-full z-20 mt-1 min-w-[160px] rounded-md border border-border bg-white py-1 shadow-md"
          >
            {STATUS_OPTIONS.map((status) => (
              <li key={status}>
                <button
                  role="option"
                  aria-selected={status === currentStatus}
                  onClick={() => handleSelect(status)}
                  className={`w-full px-3 py-2 text-left text-small hover:bg-muted transition-colors ${
                    status === currentStatus
                      ? 'font-medium text-text-primary'
                      : 'text-text-secondary'
                  }`}
                >
                  {STATUS_LABELS[status]}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && (
        <p className="mt-1 text-small text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── StatusHistoryTimeline ────────────────────────────────────────────────────

interface StatusHistoryTimelineProps {
  history: SubmissionView['statusHistory'];
}

function StatusHistoryTimeline({ history }: StatusHistoryTimelineProps) {
  if (history.length === 0) {
    return (
      <p className="text-small text-text-muted italic">No status changes yet.</p>
    );
  }

  return (
    <ol className="space-y-3" aria-label="Status history">
      {history.map((entry, i) => (
        <li key={entry.id} className="flex gap-3">
          {/* Timeline dot + line */}
          <div className="flex flex-col items-center">
            <div
              className={`h-2 w-2 rounded-full mt-1 shrink-0 ${
                i === history.length - 1 ? 'bg-accent' : 'bg-border'
              }`}
              aria-hidden="true"
            />
            {i < history.length - 1 && (
              <div className="w-px flex-1 bg-border mt-1" aria-hidden="true" />
            )}
          </div>

          {/* Entry content */}
          <div className="pb-3 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={entry.status} />
              <span className="text-small text-text-muted flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {formatDate(entry.createdAt)}
              </span>
            </div>
            {entry.note && (
              <p className="mt-1 text-small text-text-secondary">{entry.note}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── SubmissionDetailView ─────────────────────────────────────────────────────

export interface SubmissionDetailViewProps {
  submission: SubmissionView;
  walrusAggregatorUrl: string;
}

/**
 * Client component — renders the full submission detail view.
 *
 * Two-column layout on lg:
 *   - Left: field values with encryption indicators and media previews
 *   - Right: metadata sidebar (blob ID, status, status history, timestamps)
 *
 * Requirements: R12
 */
export function SubmissionDetailView({
  submission,
  walrusAggregatorUrl,
}: SubmissionDetailViewProps) {
  const { metadata, payload, statusHistory } = submission;
  const [currentStatus, setCurrentStatus] = useState<SubmissionStatus>(
    metadata.status,
  );

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          {/* ── Left: Field Values ─────────────────────────────────────────── */}
          <section aria-label="Submission field values">
            <h2 className="text-h3 font-semibold text-text-primary mb-4">
              Field Values
            </h2>

            {payload === null ? (
              <div className="rounded-lg border border-border bg-white p-6 shadow-sm text-center">
                <p className="text-body text-text-secondary">
                  Payload unavailable — Walrus fetch failed. The submission
                  metadata is still valid.
                </p>
              </div>
            ) : payload.fields.length === 0 ? (
              <div className="rounded-lg border border-border bg-white p-6 shadow-sm text-center">
                <p className="text-body text-text-secondary">
                  No fields in this submission.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {payload.fields.map((field, i) => (
                  <FieldValueDisplay
                    key={field.fieldId}
                    fieldValue={field}
                    index={i}
                    submissionId={metadata.id}
                    walrusAggregatorUrl={walrusAggregatorUrl}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Right: Metadata Sidebar ────────────────────────────────────── */}
          <aside aria-label="Submission metadata" className="space-y-4">
            {/* Blob ID card */}
            <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
              <h3 className="text-small font-medium text-text-secondary mb-2 uppercase tracking-wide">
                Walrus Blob ID
              </h3>
              <div className="flex items-start gap-1.5">
                <span className="font-mono text-small text-text-secondary break-all">
                  {metadata.walrusBlobId}
                </span>
                <CopyButton
                  value={metadata.walrusBlobId}
                  label="Copy Walrus blob ID"
                />
              </div>
            </div>

            {/* Status card */}
            <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
              <h3 className="text-small font-medium text-text-secondary mb-2 uppercase tracking-wide">
                Status
              </h3>
              <div className="flex items-center gap-2 mb-3">
                <StatusBadge status={currentStatus} />
              </div>
              <StatusUpdateDropdown
                submissionId={metadata.id}
                currentStatus={currentStatus}
                onStatusUpdated={setCurrentStatus}
              />
            </div>

            {/* Status history card */}
            <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
              <h3 className="text-small font-medium text-text-secondary mb-3 uppercase tracking-wide">
                Status History
              </h3>
              <StatusHistoryTimeline history={statusHistory} />
            </div>

            {/* Timestamps card */}
            <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
              <h3 className="text-small font-medium text-text-secondary mb-2 uppercase tracking-wide">
                Timestamps
              </h3>
              <dl className="space-y-2">
                <div>
                  <dt className="text-small text-text-muted">Submitted</dt>
                  <dd className="text-small text-text-primary">
                    {formatDate(metadata.submittedAt)}
                  </dd>
                </div>
                {payload && (
                  <div>
                    <dt className="text-small text-text-muted">Form version</dt>
                    <dd className="text-small text-text-primary">
                      v{payload.formVersion}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
