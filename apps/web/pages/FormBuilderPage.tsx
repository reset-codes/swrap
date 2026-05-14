'use client';

/**
 * FormBuilderPage — Form_Builder_UI page component.
 *
 * Orchestrates the full form creation flow:
 *   idle → validate → POST /api/poc/forms → upsertForm → navigate to preview
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
import { uxCopy, type SaveLoadingStage, type SaveErrorStage } from '../copy/ux-copy';
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
// API response shape
// ---------------------------------------------------------------------------

interface SaveApiResponse {
  blob_id: string;
  schema_hash: string;
  created_at: string;
  tx_digest?: string | null;
}

interface SaveApiError {
  error: {
    code: string;
    stage: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Map API error stage to SaveErrorStage
// ---------------------------------------------------------------------------

function toSaveErrorStage(apiStage: string): SaveErrorStage {
  if (apiStage === 'securing' || apiStage === 'uploading' || apiStage === 'anchoring') {
    return apiStage;
  }
  // Default to 'uploading' for unknown stages
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
      const formSchema = {
        title,
        fields,
        version: 1 as const,
        created_at: new Date().toISOString(),
      };

      // POST to /api/poc/forms
      // Stage transitions are driven by the server's error envelope stage field.
      // We optimistically show 'securing' → 'uploading' → 'anchoring' as the
      // request progresses (the server does all three in sequence).
      setSaveState({ status: 'loading', stage: 'uploading' });

      const response = await fetch('/api/poc/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_schema: formSchema }),
      });

      if (!response.ok) {
        // Parse error envelope to get the failing stage
        let stage: SaveErrorStage = 'uploading';
        let message: string = uxCopy.save.error.uploading;

        try {
          const errBody = (await response.json()) as SaveApiError;
          stage = toSaveErrorStage(errBody.error?.stage ?? '');
          message = String(uxCopy.save.error[stage]);
        } catch {
          // JSON parse failed — use defaults
        }

        setSaveState({ status: 'error', stage, message });
        return;
      }

      // Show anchoring stage briefly before success
      setSaveState({ status: 'loading', stage: 'anchoring' });

      const data = (await response.json()) as SaveApiResponse;
      const blobId = data.blob_id;

      // Persist to Local_Store (R10.4)
      useLocalStore.getState().upsertForm({
        blobId,
        schemaHash: data.schema_hash,
        title,
        ownerAddress: '', // populated by server; we store what we have
        createdAt: data.created_at,
      });

      setSaveState({ status: 'success', blobId });

      // Navigate to preview (R10.3)
      router.push(`/poc/forms/${blobId}`);
    } catch (err) {
      // Network error or unexpected failure
      const message = err instanceof Error ? err.message : uxCopy.save.error.uploading;
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
            <LoadingState mode="block" label={uxCopy.save.success} />
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
              label={uxCopy.save.loading[saveState.stage]}
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
              aria-label={uxCopy.save.idle}
            >
              {uxCopy.save.idle}
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
