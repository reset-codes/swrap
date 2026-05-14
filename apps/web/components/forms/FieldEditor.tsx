'use client';

/**
 * FieldEditor — edit a single field's type, label, required flag, and options (for select).
 * Label is 1–100 characters (R10.2).
 * Requirements: R10.2, R19.6, R19.9
 */

import * as React from 'react';
import type { PocField, FieldType } from '@poc/shared';
import { FormField } from '../ui/FormField';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { FieldTypePicker } from './FieldTypePicker';
import { X, Plus } from 'lucide-react';

const LABEL_MAX = 100;

export interface FieldEditorProps {
  field: PocField;
  onChange: (updated: PocField) => void;
  labelError?: string;
  disabled?: boolean;
}

export function FieldEditor({ field, onChange, labelError, disabled }: FieldEditorProps) {
  const labelId = React.useId();
  const requiredId = React.useId();

  function handleTypeChange(type: FieldType) {
    // When switching away from select, drop options; when switching to select, seed one empty option.
    const options = type === 'select' ? (field.options ?? ['']) : undefined;
    onChange({ ...field, type, options });
  }

  function handleLabelChange(label: string) {
    onChange({ ...field, label });
  }

  function handleRequiredChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...field, required: e.target.checked });
  }

  function handleOptionChange(index: number, value: string) {
    const options = [...(field.options ?? [])];
    options[index] = value;
    onChange({ ...field, options });
  }

  function handleAddOption() {
    const options = [...(field.options ?? []), ''];
    onChange({ ...field, options });
  }

  function handleRemoveOption(index: number) {
    const options = (field.options ?? []).filter((_, i) => i !== index);
    onChange({ ...field, options });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Type picker */}
      <div className="flex items-center gap-2">
        <span className="text-token-sm font-medium text-text-secondary min-w-10">Type</span>
        <FieldTypePicker value={field.type} onChange={handleTypeChange} disabled={disabled} />
      </div>

      {/* Label */}
      <FormField
        label="Label"
        htmlFor={labelId}
        required
        error={labelError}
        description={`${field.label.length} / ${LABEL_MAX}`}
      >
        <Input
          id={labelId}
          value={field.label}
          onChange={(e) => handleLabelChange(e.target.value)}
          maxLength={LABEL_MAX}
          placeholder="Field label"
          variant={labelError ? 'error' : 'default'}
          size="sm"
          disabled={disabled}
        />
      </FormField>

      {/* Required toggle */}
      <div className="flex items-center gap-2">
        <input
          id={requiredId}
          type="checkbox"
          checked={!!field.required}
          onChange={handleRequiredChange}
          disabled={disabled}
          className="h-4 w-4 rounded border-border-subtle accent-accent-base focus-visible:ring-2 focus-visible:ring-border-focus"
          aria-label="Required field"
        />
        <label htmlFor={requiredId} className="text-token-sm text-text-primary select-none cursor-pointer">
          Required
        </label>
      </div>

      {/* Options — only for select type */}
      {field.type === 'select' && (
        <div className="flex flex-col gap-2">
          <span className="text-token-sm font-medium text-text-secondary">Options</span>
          {(field.options ?? []).map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={opt}
                onChange={(e) => handleOptionChange(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                size="sm"
                disabled={disabled}
                aria-label={`Option ${i + 1}`}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveOption(i)}
                disabled={disabled || (field.options ?? []).length <= 1}
                aria-label={`Remove option ${i + 1}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAddOption}
            disabled={disabled}
            leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            Add option
          </Button>
        </div>
      )}
    </div>
  );
}
