'use client';

/**
 * ConversationalModeForm — renders one field at a time with animated transitions.
 *
 * Features:
 * - One question at a time with enter/exit animations (Framer Motion)
 * - Progress bar and "Question X of Y" indicator
 * - Keyboard navigation: Enter to advance, Backspace on empty field to go back
 * - Answer confirmation with subtle scale pulse animation
 * - Validates each field before advancing
 *
 * Requirements: R6, R14
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldRenderer } from './FieldRenderer';
import { validateFieldValue } from '@/lib/forms/validator';
import type { FormSchema } from '@/types/form';
import type { FieldValue } from '@/types/submission';

interface ConversationalModeFormProps {
  schema: FormSchema;
}

type FormValues = Record<string, FieldValue['value']>;
type FormErrors = Record<string, string>;

// ─── Motion variants ──────────────────────────────────────────────────────────

const questionTransition = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  exit: { opacity: 0, y: -16, transition: { duration: 0.2, ease: 'easeIn' } },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationalModeForm({ schema }: ConversationalModeFormProps) {
  const sortedFields = [...schema.fields].sort((a, b) => a.order - b.order);
  const totalFields = sortedFields.length;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Pulse animation trigger for answer confirmation
  const [confirmPulse, setConfirmPulse] = useState(false);

  const currentField = sortedFields[currentIndex] ?? null;
  const isLastField = currentIndex === totalFields - 1;
  const progress = totalFields > 0 ? ((currentIndex + 1) / totalFields) * 100 : 0;

  // ── Handlers ────────────────────────────────────────────────────────────────

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

  function handleBack() {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setErrors({});
    }
  }

  const handleNext = useCallback(() => {
    if (!currentField) return;

    const currentValue = values[currentField.id] ?? null;
    const result = validateFieldValue(currentField, currentValue);

    if (!result.valid) {
      setErrors((prev) => ({ ...prev, [currentField.id]: result.error ?? 'Invalid value.' }));
      return;
    }

    // Trigger confirmation pulse
    setConfirmPulse(true);
    setTimeout(() => setConfirmPulse(false), 300);

    if (!isLastField) {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentField, values, isLastField]);

  async function handleSubmit() {
    if (!currentField) return;

    const currentValue = values[currentField.id] ?? null;
    const result = validateFieldValue(currentField, currentValue);

    if (!result.valid) {
      setErrors((prev) => ({ ...prev, [currentField.id]: result.error ?? 'Invalid value.' }));
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const fieldValues: FieldValue[] = sortedFields.map((field) => ({
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

  // ── Keyboard navigation ──────────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && !e.shiftKey) {
        // Don't intercept Enter in textarea
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
        e.preventDefault();
        if (isLastField) {
          handleSubmit();
        } else {
          handleNext();
        }
      }
      if (e.key === 'Backspace' && currentIndex > 0) {
        // Only go back if the current input is empty
        const currentValue = values[currentField?.id ?? ''];
        if (!currentValue || currentValue === '') {
          handleBack();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, values, isLastField, handleNext]);

  // ── Success state ────────────────────────────────────────────────────────────

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

  if (!currentField) return null;

  const currentError = errors[currentField.id];
  const inputId = `field-${currentField.id}`;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[50vh] sm:min-h-[60vh] flex flex-col justify-center">
      {/* Progress section */}
      <div className="mb-8">
        <div className="h-1 bg-muted rounded-full overflow-hidden mb-2">
          <motion.div
            className="h-full bg-accent"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          />
        </div>
        <p className="text-small text-text-muted text-right">
          Question {currentIndex + 1} of {totalFields}
        </p>
      </div>

      {/* Animated question area */}
      <div className="flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            variants={questionTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Answer confirmation pulse wrapper */}
            <motion.div
              animate={confirmPulse ? { scale: [1, 1.01, 1] } : { scale: 1 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              {/* Question label */}
              {currentField.type !== 'checkbox' && (
                <label
                  htmlFor={inputId}
                  id={`${inputId}-label`}
                  className="block text-h2 font-semibold text-text-primary mb-2"
                >
                  {currentField.label}
                  {currentField.required && (
                    <span className="ml-1 text-error" aria-hidden="true">
                      *
                    </span>
                  )}
                </label>
              )}

              {/* Help text */}
              {currentField.helpText && !currentError && (
                <p className="text-body text-text-secondary mb-6">{currentField.helpText}</p>
              )}

              {/* Field renderer */}
              <FieldRenderer
                field={currentField}
                value={values[currentField.id] ?? null}
                onChange={(val) => handleChange(currentField.id, val)}
                error={currentError}
              />

              {/* Error message */}
              {currentError && (
                <p
                  id={`${inputId}-error`}
                  role="alert"
                  className="mt-2 text-xs text-error"
                >
                  {currentError}
                </p>
              )}
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Submit error */}
      {submitError && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-error/20 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {submitError}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8">
        <Button
          type="button"
          variant="ghost"
          onClick={handleBack}
          disabled={currentIndex === 0}
          aria-label="Go to previous question"
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Back
        </Button>

        {isLastField ? (
          <Button
            type="button"
            onClick={handleSubmit}
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
        ) : (
          <Button
            type="button"
            onClick={handleNext}
          >
            Next
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
