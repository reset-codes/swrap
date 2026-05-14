'use client';

/**
 * FieldRow — renders a single field with up/down reorder buttons and a remove button.
 * Reorder is via chevron Buttons only — no @dnd-kit (R19.9 enforced by no-restricted-imports).
 * Requirements: R10.1, R10.2, R19.6, R19.9
 */

import * as React from 'react';
import type { PocField } from '@poc/shared';
import { Button } from '../ui/Button';
import { FieldEditor } from './FieldEditor';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

export interface FieldRowProps {
  field: PocField;
  index: number;
  total: number;
  onChange: (updated: PocField) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  labelError?: string;
  disabled?: boolean;
}

export function FieldRow({
  field,
  index,
  total,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  labelError,
  disabled,
}: FieldRowProps) {
  return (
    <div className="flex gap-3 rounded-md border border-border-subtle bg-bg-surface p-3">
      {/* Reorder controls */}
      <div className="flex flex-col gap-1 pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onMoveUp}
          disabled={disabled || index === 0}
          aria-label={`Move field ${index + 1} up`}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onMoveDown}
          disabled={disabled || index === total - 1}
          aria-label={`Move field ${index + 1} down`}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Field editor */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-token-xs font-medium text-text-tertiary uppercase tracking-wide">
            Field {index + 1}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove field ${index + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5 text-status-error" aria-hidden="true" />
          </Button>
        </div>
        <FieldEditor
          field={field}
          onChange={onChange}
          labelError={labelError}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
