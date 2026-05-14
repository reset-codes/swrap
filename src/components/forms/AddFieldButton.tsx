'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldTypeIcon } from './FieldTypeIcon';
import { FIELD_TYPE_LABELS } from './FieldTypeLabel';
import type { FieldType } from '@/types/form';

const FIELD_TYPES: FieldType[] = [
  'short_text',
  'long_text',
  'rich_text',
  'dropdown',
  'multi_select',
  'checkbox',
  'star_rating',
  'url',
  'image_upload',
  'video_upload',
  'file_upload',
];

interface AddFieldButtonProps {
  onAddField: (type: FieldType) => void;
}

export function AddFieldButton({ onAddField }: AddFieldButtonProps) {
  const [open, setOpen] = useState(false);

  function handleSelect(type: FieldType) {
    onAddField(type);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="default"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Add field"
      >
        <Plus className="h-4 w-4" />
        Add Field
      </Button>

      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />

          <div
            role="listbox"
            aria-label="Field types"
            className="absolute left-0 top-full z-20 mt-1 w-52 rounded-md border border-border bg-white py-1 shadow-md max-h-80 overflow-y-auto"
          >
            {FIELD_TYPES.map((type) => (
              <button
                key={type}
                role="option"
                aria-selected={false}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-body text-text-primary hover:bg-muted focus:bg-muted focus:outline-none"
                onClick={() => handleSelect(type)}
              >
                <span className="text-text-secondary">
                  <FieldTypeIcon type={type} className="h-4 w-4" />
                </span>
                <span>{FIELD_TYPE_LABELS[type]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
