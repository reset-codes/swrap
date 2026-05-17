'use client';

/**
 * FieldTypePicker — dropdown to select a field type from the FIELD_TYPES palette.
 * Palette is exactly: text, textarea, email, number, select, checkbox (R19.9).
 * Requirements: R10.2, R19.6, R19.9
 */

import * as React from 'react';
import { FIELD_TYPES, type FieldType } from '@poc/shared';
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
} from '../ui/Dropdown';
import { Button } from '../ui/Button';
import { ChevronDown } from 'lucide-react';

/** Human-readable labels for each field type. */
const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text:           'Short text',
  textarea:       'Long text',
  email:          'Email',
  number:         'Number',
  select:         'Dropdown',
  checkbox:       'Checkbox',
  url:            'URL',
  star_rating:    'Star rating',
  wallet_address: 'Wallet address',
};

export interface FieldTypePickerProps {
  value: FieldType;
  onChange: (type: FieldType) => void;
  disabled?: boolean;
}

export function FieldTypePicker({ value, onChange, disabled }: FieldTypePickerProps) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          rightIcon={<ChevronDown className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />}
          aria-label={`Field type: ${FIELD_TYPE_LABELS[value]}`}
        >
          {FIELD_TYPE_LABELS[value]}
        </Button>
      </DropdownTrigger>
      <DropdownContent align="start" size="md">
        {FIELD_TYPES.map((type) => (
          <DropdownItem
            key={type}
            onSelect={() => onChange(type)}
            aria-current={type === value ? 'true' : undefined}
          >
            {FIELD_TYPE_LABELS[type]}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
