'use client';

/**
 * ValidationSummary — displays a list of validation errors for the form.
 * Renders nothing when there are no errors.
 * Requirements: R10.7, R19.6
 */

import * as React from 'react';

export interface ValidationError {
  /** Human-readable field label or 'Form title' for the title field. */
  field: string;
  /** Specific rule violated. */
  message: string;
}

export interface ValidationSummaryProps {
  errors: ValidationError[];
}

export function ValidationSummary({ errors }: ValidationSummaryProps) {
  if (errors.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-md border border-status-error bg-status-error-bg p-3"
    >
      <p className="text-token-sm font-medium text-status-error mb-1.5">
        Please fix the following before saving:
      </p>
      <ul className="list-disc list-inside flex flex-col gap-0.5">
        {errors.map((err, i) => (
          <li key={i} className="text-token-sm text-status-error">
            <span className="font-medium">{err.field}:</span> {err.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
