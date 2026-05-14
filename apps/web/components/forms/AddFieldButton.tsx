'use client';

/**
 * AddFieldButton — opens a Dropdown seeded from FIELD_TYPES to add a new field.
 * No @dnd-kit imports (R19.9).
 * Requirements: R10.1, R10.2, R19.6, R19.9
 */

import * as React from 'react';
import { FIELD_TYPES, type FieldType } from '@poc/shared';
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
} from '../ui/Dropdown';
import { Button } from '../ui/Button';
import { Plus } from 'lucide-react';

/** Human-readable labels for each field type. */
const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text:     'Short text',
  textarea: 'Long text',
  email:    'Email',
  number:   'Number',
  select:   'Dropdown',
  checkbox: 'Checkbox',
};

export interface AddFieldButtonProps {
  onAdd: (type: FieldType) => void;
  disabled?: boolean;
}

export function AddFieldButton({ onAdd, disabled }: AddFieldButtonProps) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button
          variant="secondary"
          size="md"
          disabled={disabled}
          leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
          aria-label="Add a new field"
        >
          Add field
        </Button>
      </DropdownTrigger>
      <DropdownContent align="start" size="lg">
        <DropdownLabel>Field type</DropdownLabel>
        {FIELD_TYPES.map((type) => (
          <DropdownItem key={type} onSelect={() => onAdd(type)}>
            {FIELD_TYPE_LABELS[type]}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
