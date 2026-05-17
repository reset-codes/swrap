'use client';

/**
 * FormBuilderPage — Form_Builder_UI page component.
 *
 * Orchestrates the full form creation flow:
 *   idle → validate → createForm (via metadata-client) → upsertForm → navigate to preview
 *
 * SaveState union covers all five UX_State primitives (R19.7):
 *   idle | loading (per-stage) | success | error (per-stage) | empty
 *
 * All user-visible strings come from uxCopy (R19.8).
 *
 * Requirements: R10.3, R10.4, R10.7, R10.8, R19.7, R19.8
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { PocField } from '@poc/shared';
import { createForm } from '../lib/api/metadata-client';
import { useLocalStore } from '../stores/local-store';
import {
  FormTitleInput,
  FieldRow,
  AddFieldButton,
  ValidationSummary,
  type ValidationError,
} from '../components/forms';
import {
  Button,
  EmptyState,
  LoadingState,
} from '../components/ui';
import { ContentFrame } from '../components/layout/ContentFrame';
import { PageHeader } from '../components/layout/PageHeader';
import { AppShell } from '../components/layout/AppShell';
import { FileText } from 'lucide-react';
import { privacyModeLabel, uploadPhase } from '../lib/copy/ux-copy';

// POC UX copy strings (inlined — apps/web/copy/ux-copy was removed as a duplicate)
const pocCopy = {
  save: {
    idle: 'Save form',
    loading: {
      securing: uploadPhase('encrypting'),
      uploading: uploadPhase('uploading'),
      anchoring: uploadPhase('uploaded'),
    },
    success: 'Form saved successfully.',
    error: {
      securing: 'Failed to secure your form. Please try again.',
      uploading: 'Upload failed. Please check your connection and try again.',
      anchoring: 'Could not save to the network. Please try again.',
    },
  },
} as const;

type SaveLoadingStage = keyof typeof pocCopy.save.loading;
type SaveErrorStage = keyof typeof pocCopy.save.error;

// ---------------------------------------------------------------------------
// SaveState union — five UX_State primitives (R19.7)
// ---------------------------------------------------------------------------

type SaveState =
  | { status: 'idle' }
  | { status: 'loading'; stage: SaveLoadingStage }
  | { status: 'success'; blobId: string }
  | { status: 'error'; stage: SaveErrorStage; message: string }
  | { status: 'empty' };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

function validateForm(title: string, fields: PocField[]): ValidationResult {
  const errors: ValidationError[] = [];

  // Title: 1–200 chars (R10.1)
  if (title.trim().length === 0) {
    errors.push({ field: 'Form title', message: 'Title is required.' });
  } else if (title.length > 200) {
    errors.push({ field: 'Form title', message: 'Title must be 200 characters or fewer.' });
  }

  // Fields: 0–50 (R10.1)
  if (fields.length > 50) {
    errors.push({ field: 'Fields', message: 'A form can have at most 50 fields.' });
  }

  // Each field label: 1–100 chars (R10.2)
  fields.forEach((field, index) => {
    if (field.label.trim().length === 0) {
      errors.push({
        field: `Field ${index + 1}`,
        message: 'Label is required.',
      });
    } else if (field.label.length > 100) {
      errors.push({
        field: `Field ${index + 1}`,
        message: 'Label must be 100 characters or fewer.',
      });
    }
  });

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Per-field label errors (for FieldRow labelError prop)
// ---------------------------------------------------------------------------

function getFieldLabelErrors(
  fields: PocField[],
  validationErrors: ValidationError[],
): Record<number, string> {
  const result: Record<number, string> = {};
  validationErrors.forEach((err) => {
    const match = err.field.match(/^Field (\d+)$/);
    if (match) {
      const index = parseInt(match[1], 10) - 1;
      result[index] = err.message;
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Map API error code to SaveErrorStage
// ---------------------------------------------------------------------------

function toSaveErrorStage(apiCode: string): SaveErrorStage {
  if (apiCode === 'Internal' || apiCode === 'BlobNotFound') return 'uploading';
  if (apiCode === 'Unauthorized' || apiCode === 'Forbidden') return 'securing';
  return 'uploading';
}

// ---------------------------------------------------------------------------
// FormBuilderPage component
// ---------------------------------------------------------------------------

export function FormBuilderPage() {
  const router = useRouter();

  // Form state — preserved on validation failure (R10.7, R10.8)
  const [title, setTitle] = React.useState('');
  const [fields, setFields] = React.useState<PocField[]>([]);
  const [privacyMode, setPrivacyMode] = React.useState<'public' | 'private'>('public');
  const [saveState, setSaveState] = React.useState<SaveState>({ status: 'idle' });
  const [validationErrors, setValidationErrors] = React.useState<ValidationError[]>([]);

  const isLoading = saveState.status === 'loading';

  // ---------------------------------------------------------------------------
  // Field operations
  // ---------------------------------------------------------------------------

  function handleAddField(type: PocField['type']) {
    setFields((prev) => [
      ...prev,
      { type, label: '', required: false },
    ]);
  }

  function handleFieldChange(index: number, updated: PocField) {
    setFields((prev) => prev.map((f, i) => (i === index ? updated : f)));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    setFields((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function handleMoveDown(index: number) {
    setFields((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function handleRemoveField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  async function handleSave() {
    // Clear previous validation errors
    setValidationErrors([]);

    // Validate (R10.7 — show field-level errors, preserve data)
    const { valid, errors } = validateForm(title, fields);
    if (!valid) {
      setValidationErrors(errors);
      return;
    }

    // Begin save flow — securing stage
    setSaveState({ status: 'loading', stage: 'securing' });

    try {
      const formDefinition = {
        title,
        fields,
        version: 1 as const,
        created_at: new Date().toISOString(),
      };

      // Transition to uploading stage before the API call
      setSaveState({ status: 'loading', stage: 'uploading' });

      // Use the canonical metadata-client to create the form.
      // The API_Server handles Walrus upload and Postgres metadata indexing.
      // Session token is empty string for now (auth session wired in a later task).
      const result = await createForm(
        { formDefinition, privacyMode },
        '', // session token — wired in auth task
      );

      if (!result.ok) {
        const stage = toSaveErrorStage(result.error.code);
        const message = String(pocCopy.save.error[stage]);
        setSaveState({ status: 'error', stage, message });
        return;
      }

      // Show anchoring stage briefly before success
      setSaveState({ status: 'loading', stage: 'anchoring' });

      const formRow = result.result;
      const blobId = formRow.walrusBlobId;

      // Persist to Local_Store (R10.4)
      useLocalStore.getState().upsertForm({
        blobId,
        schemaHash: formRow.contentDigest,
        title,
        ownerAddress: formRow.ownerAddress,
        createdAt: formRow.createdAt,
      });

      setSaveState({ status: 'success', blobId });

      // Navigate to preview (R10.3)
      router.push(`/poc/forms/${blobId}`);
    } catch (err) {
      // Network error or unexpected failure
      const message = err instanceof Error ? err.message : pocCopy.save.error.uploading;
      setSaveState({ status: 'error', stage: 'uploading', message });
    }
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const fieldLabelErrors = getFieldLabelErrors(fields, validationErrors);
  const titleError = validationErrors.find((e) => e.field === 'Form title')?.message;

  // ---------------------------------------------------------------------------
  // Render — five UX_State primitives (R19.7)
  // ---------------------------------------------------------------------------

  // UX_State: success — redirect is handled imperatively; render nothing while navigating
  if (saveState.status === 'success') {
    return (
      <AppShell>
        <ContentFrame>
          <div className="flex items-center justify-center py-24">
            <LoadingState mode="block" label={pocCopy.save.success} />
          </div>
        </ContentFrame>
      </AppShell>
    );
  }

  // UX_State: loading
  if (saveState.status === 'loading') {
    return (
      <AppShell>
        <ContentFrame>
          <div className="flex items-center justify-center py-24">
            <LoadingState
              mode="block"
              label={pocCopy.save.loading[saveState.stage]}
            />
          </div>
        </ContentFrame>
      </AppShell>
    );
  }

  // UX_State: empty — shown when there are no fields and the form has never been interacted with
  // (title is empty and no fields added yet)
  const isEmpty = title.trim().length === 0 && fields.length === 0 && saveState.status === 'idle';

  return (
    <AppShell>
      <ContentFrame>
        <PageHeader
          title="New form"
          description="Add a title and fields, then save to upload securely."
          actions={
            <Button
              variant="primary"
              size="md"
              onClick={handleSave}
              disabled={isLoading}
              aria-label={pocCopy.save.idle}
            >
              {pocCopy.save.idle}
            </Button>
          }
        />

        <div className="mt-8 flex flex-col gap-6 max-w-2xl">
          {/* UX_State: error */}
          {saveState.status === 'error' && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-status-error bg-status-error-bg p-4"
            >
              <p className="text-token-sm font-medium text-status-error">
                {saveState.message}
              </p>
            </div>
          )}

          {/* Validation errors (R10.7) */}
          {validationErrors.length > 0 && (
            <ValidationSummary errors={validationErrors} />
          )}

          {/* Form title input */}
          <FormTitleInput
            value={title}
            onChange={setTitle}
            error={titleError}
            disabled={isLoading}
          />

          {/* Privacy mode selector — uses UX vocabulary labels (R8.2) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-token-sm font-medium text-text-primary">
              Access
            </label>
            <div className="flex gap-2" role="radiogroup" aria-label="Form access mode">
              {(['public', 'private'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={privacyMode === mode}
                  onClick={() => setPrivacyMode(mode)}
                  disabled={isLoading}
                  className={[
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-token-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                    privacyMode === mode
                      ? 'border-border-strong bg-bg-subtle text-text-primary font-medium'
                      : 'border-border-subtle bg-bg-base text-text-secondary hover:border-border-strong hover:text-text-primary',
                    isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  ].join(' ')}
                >
                  {privacyModeLabel(mode)}
                </button>
              ))}
            </div>
            <p className="text-token-xs text-text-tertiary">
              {privacyMode === 'private'
                ? 'Only you can view responses. Responses are encrypted before storage.'
                : 'Anyone with the link can view responses.'}
            </p>
          </div>

          {/* UX_State: empty — no fields yet */}
          {isEmpty ? (
            <EmptyState
              mode="block"
              title="No fields yet"
              description="Add your first field to get started."
              icon={<FileText className="h-5 w-5" aria-hidden="true" />}
              action={{
                label: 'Add field',
                onClick: () => handleAddField('text'),
              }}
            />
          ) : (
            <>
              {/* Field list */}
              {fields.length > 0 && (
                <div className="flex flex-col gap-3" role="list" aria-label="Form fields">
                  {fields.map((field, index) => (
                    <div key={index} role="listitem">
                      <FieldRow
                        field={field}
                        index={index}
                        total={fields.length}
                        onChange={(updated) => handleFieldChange(index, updated)}
                        onMoveUp={() => handleMoveUp(index)}
                        onMoveDown={() => handleMoveDown(index)}
                        onRemove={() => handleRemoveField(index)}
                        labelError={fieldLabelErrors[index]}
                        disabled={isLoading}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Add field button */}
              <div>
                <AddFieldButton onAdd={handleAddField} disabled={isLoading || fields.length >= 50} />
              </div>
            </>
          )}
        </div>
      </ContentFrame>
    </AppShell>
  );
}
