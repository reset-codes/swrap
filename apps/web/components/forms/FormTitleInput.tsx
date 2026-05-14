'use client';

/**
 * FormTitleInput — controlled input for the form title.
 * Enforces 1–200 character limit (R10.1).
 * Requirements: R10.1, R19.6
 */

import * as React from 'react';
import { FormField } from '../ui/FormField';
import { Input } from '../ui/Input';

export interface FormTitleInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

const TITLE_MAX = 200;

export function FormTitleInput({ value, onChange, error, disabled }: FormTitleInputProps) {
  const id = 'form-title';

  return (
    <FormField
      label="Form title"
      htmlFor={id}
      required
      error={error}
      description={`${value.length} / ${TITLE_MAX} characters`}
    >
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={TITLE_MAX}
        placeholder="Untitled form"
        variant={error ? 'error' : 'default'}
        disabled={disabled}
        aria-label="Form title"
      />
    </FormField>
  );
}
