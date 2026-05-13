'use client';

/**
 * TableModeForm — renders all form fields simultaneously in a scrollable layout.
 *
 * On submit, POSTs to `/api/forms/[formId]/submissions`.
 * Shows a loading state during submission and a success state on completion.
 *
 * Requirements: R6, R14
 */

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldRenderer } from './FieldRenderer';
import { validateAllFields } from '@/lib/forms/validator';
import type { FormSchema } from '@/types/form';
import type { FieldValue } from '@/types/submission';

interface TableModeFormProps {
  schema: FormSchema;
}

type FormValues = Record<string, FieldValue['value']>;
type FormErrors = Record<string, string>;

// ─── Component ────────────────────────────────────────────────────────────────

export function TableModeForm({ schema }: TableModeFormProps) {
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(fieldId: string, value: FieldValue['value']) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    // Clear error on change
    if (errors[fieldId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    // Validate all fields
    const validationErrors = validateAllFields(schema.fields, values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      // Scroll to first error
      const firstErrorId = schema.fields.find((f) => validationErrors[f.id])?.id;
      if (firstErrorId) {
        document.getElementById(`field-${firstErrorId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setIsSubmitting(true);

    try {
      // Assemble field values array
      const fieldValues: FieldValue[] = schema.fields.map((field) => ({
        fieldId: field.id,
        fieldType: field.type,
        value: values[field.id] ?? null,
        encrypted: field.encrypted,
      }));

      const res = await fetch(`/api/forms/${schema.id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formSlug: schema.slug,
          formVersion: schema.version,
          fields: fieldValues,
          metadata: {
            userAgent: navigator.userAgent,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } })?.error?.message ??
            'Submission failed. Please try again.',
        );
      }

      setIsSuccess(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckCircle2 className="mb-4 h-12 w-12 text-success" aria-hidden="true" />
        <h2 className="text-h3 text-text-primary">Thank you for your submission!</h2>
        <p className="mt-2 text-body text-text-secondary">
          Your response has been recorded successfully.
        </p>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  const sortedFields = [...schema.fields].sort((a, b) => a.order - b.order);

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-6">
        {sortedFields.map((field) => {
          const fieldError = errors[field.id];
          const inputId = `field-${field.id}`;

          return (
            <div key={field.id} className="flex flex-col">
              {/* Label — not rendered separately for checkbox (it's inline) */}
              {field.type !== 'checkbox' && (
                <label
                  htmlFor={inputId}
                  id={`${inputId}-label`}
                  className="mb-1.5 text-sm font-medium text-text-primary"
                >
                  {field.label}
                  {field.required && (
                    <span className="ml-0.5 text-error" aria-hidden="true">
                      *
                    </span>
                  )}
                </label>
              )}

              {/* Field renderer */}
              <FieldRenderer
                field={field}
                value={values[field.id] ?? null}
                onChange={(val) => handleChange(field.id, val)}
                error={fieldError}
              />

              {/* Help text */}
              {field.helpText && !fieldError && (
                <p className="mt-1 text-xs text-text-muted">{field.helpText}</p>
              )}

              {/* Error message */}
              {fieldError && (
                <p
                  id={`${inputId}-error`}
                  role="alert"
                  className="mt-1 text-xs text-error"
                >
                  {fieldError}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Submit error */}
      {submitError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-error/20 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {submitError}
        </div>
      )}

      {/* Submit button */}
      <div className="mt-8">
        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Submitting…
            </>
          ) : (
            'Submit'
          )}
        </Button>
      </div>
    </form>
  );
}
