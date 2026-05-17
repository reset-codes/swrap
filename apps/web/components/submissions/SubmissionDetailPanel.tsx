'use client';

/**
 * SubmissionDetailPanel — read-only view of a decrypted submission's answers.
 * Used in the owner's submission detail view.
 *
 * Uses UX_Vocabulary helpers to mask raw chain identifiers in primary flows.
 * Raw blob IDs are only shown when advancedView is enabled.
 *
 * Requirements: R12.5, R19.6, R19.7, 8.1, 8.3
 */

import * as React from 'react';
import type { Submission, FormSchema } from '@poc/shared';
import { FormField } from '../ui/FormField';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Badge } from '../ui/Badge';
import { EncryptedSubmissionIndicator } from './EncryptedSubmissionIndicator';
import { maskBlobId, useAdvancedView } from '../../lib/copy/advanced-view';

export interface SubmissionDetailPanelProps {
  submission: Submission;
  formSchema?: FormSchema;
}

/** Formats an answer value for display. */
function formatAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > 0 ? value : '—';
  return String(value);
}

export function SubmissionDetailPanel({
  submission,
  formSchema,
}: SubmissionDetailPanelProps) {
  const [advancedView] = useAdvancedView();

  // Build a map from field label → answer value using the answers record
  const answersMap = submission.answers as Record<string, unknown>;

  // Determine which fields to display: prefer formSchema order, fall back to answer keys
  const fieldEntries: Array<{ key: string; label: string; type?: string }> = formSchema
    ? formSchema.fields.map((f) => ({ key: f.label, label: f.label, type: f.type }))
    : Object.keys(answersMap).map((k) => ({ key: k, label: k, type: 'text' }));

  return (
    <div className="flex flex-col gap-6">
      {/* Header metadata */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-border-subtle">
        <div className="flex flex-col gap-1">
          <span className="text-token-sm font-medium text-text-secondary">
            Submitted
          </span>
          <span className="text-token-base text-text-primary">
            {new Date(submission.submitted_at).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        </div>
        <EncryptedSubmissionIndicator />
      </div>

      {/* Submission reference — masked unless advanced view is enabled */}
      <div className="flex flex-col gap-1">
        <span className="text-token-xs font-medium text-text-tertiary uppercase tracking-wide">
          Submission reference
        </span>
        <span className="font-mono text-token-sm text-text-secondary">
          {maskBlobId(submission.form_blob_id, advancedView)}
        </span>
      </div>

      {/* Answer grid */}
      {fieldEntries.length > 0 ? (
        <div className="flex flex-col gap-4">
          <span className="text-token-sm font-medium text-text-secondary">
            Responses
          </span>
          <div className="grid gap-3">
            {fieldEntries.map(({ key, label, type }) => {
              const value = answersMap[key];
              const displayValue = formatAnswerValue(value);
              const inputId = `detail-${key}`;

              return (
                <FormField key={key} label={label} htmlFor={inputId}>
                  {type === 'textarea' ? (
                    <Textarea
                      id={inputId}
                      value={displayValue === '—' ? '' : displayValue}
                      readOnly
                      disabled
                      placeholder="No response"
                    />
                  ) : type === 'checkbox' ? (
                    <div className="flex items-center gap-2 h-8">
                      <Badge
                        variant={value === true ? 'success' : 'default'}
                        size="sm"
                      >
                        {displayValue}
                      </Badge>
                    </div>
                  ) : (
                    <Input
                      id={inputId}
                      value={displayValue === '—' ? '' : displayValue}
                      readOnly
                      disabled
                      placeholder="No response"
                    />
                  )}
                </FormField>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="py-6 text-center">
          <span className="text-token-sm text-text-tertiary">
            No responses recorded
          </span>
        </div>
      )}
    </div>
  );
}
