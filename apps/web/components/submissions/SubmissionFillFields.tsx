'use client';

/**
 * SubmissionFillFields — renders interactive form fields from a decrypted FormSchema.
 * Emits updated answers when any field changes.
 *
 * Requirements: R12.1, R12.5, R19.6, R19.7
 */

import * as React from 'react';
import type { FormSchema } from '@poc/shared';
import { FormField } from '../ui/FormField';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';

export interface SubmissionFillFieldsProps {
  formSchema: FormSchema;
  answers: Record<string, unknown>;
  onChange: (answers: Record<string, unknown>) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

export function SubmissionFillFields({
  formSchema,
  answers,
  onChange,
  errors,
  disabled,
}: SubmissionFillFieldsProps) {
  function handleFieldChange(fieldLabel: string, value: unknown) {
    onChange({ ...answers, [fieldLabel]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      {formSchema.fields.map((field, index) => {
        const fieldKey = field.label;
        const currentValue = answers[fieldKey];
        const fieldError = errors?.[fieldKey];
        const inputId = `field-${index}`;

        return (
          <FormField
            key={index}
            label={field.label}
            htmlFor={inputId}
            required={field.required}
            error={fieldError}
          >
            {field.type === 'textarea' ? (
              <Textarea
                id={inputId}
                value={typeof currentValue === 'string' ? currentValue : ''}
                onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                placeholder={field.label}
                variant={fieldError ? 'error' : 'default'}
                disabled={disabled}
                aria-required={field.required ? true : undefined}
              />
            ) : field.type === 'select' ? (
              <select
                id={inputId}
                value={typeof currentValue === 'string' ? currentValue : ''}
                onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                disabled={disabled}
                aria-required={field.required ? true : undefined}
                className="flex w-full rounded-md border border-border-subtle bg-bg-surface text-text-primary text-token-base h-8 px-3 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 hover:border-border-strong"
              >
                <option value="">Select an option</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === 'checkbox' ? (
              <div className="flex items-center gap-2 h-8">
                <input
                  id={inputId}
                  type="checkbox"
                  checked={typeof currentValue === 'boolean' ? currentValue : false}
                  onChange={(e) => handleFieldChange(fieldKey, e.target.checked)}
                  disabled={disabled}
                  aria-required={field.required ? true : undefined}
                  className="h-4 w-4 rounded border-border-subtle accent-accent-base focus-visible:ring-2 focus-visible:ring-border-focus"
                />
              </div>
            ) : (
              <Input
                id={inputId}
                type={
                  field.type === 'email'
                    ? 'email'
                    : field.type === 'number'
                      ? 'number'
                      : 'text'
                }
                value={typeof currentValue === 'string' || typeof currentValue === 'number' ? String(currentValue) : ''}
                onChange={(e) =>
                  handleFieldChange(
                    fieldKey,
                    field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                  )
                }
                placeholder={field.label}
                variant={fieldError ? 'error' : 'default'}
                disabled={disabled}
                aria-required={field.required ? true : undefined}
              />
            )}
          </FormField>
        );
      })}
    </div>
  );
}
