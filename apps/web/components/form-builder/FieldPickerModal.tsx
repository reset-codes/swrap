'use client';

/**
 * FieldPickerModal — modal/popover for selecting a field type before insertion.
 *
 * Opens when the user clicks a "+" InsertHandle on the canvas.
 * Shows all field types grouped by category from the centralized fieldRegistry.
 *
 * On field type selection: calls onSelect(type) and closes.
 * On backdrop click or Escape: closes without selecting.
 *
 * Requirements: Phase 1 Task 2 (field picker instead of instant insertion)
 */

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  FIELD_CATEGORIES,
  FIELDS_BY_CATEGORY,
  type FieldCategory,
} from './fieldRegistry';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FieldPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user selects a field type. */
  onSelect: (type: string) => void;
}

// ---------------------------------------------------------------------------
// FieldPickerModal component
// ---------------------------------------------------------------------------

export function FieldPickerModal({ open, onClose, onSelect }: FieldPickerModalProps) {
  function handleSelect(type: string) {
    onSelect(type);
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* Panel */}
        <Dialog.Content
          className={[
            'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl border border-border-subtle bg-bg-surface shadow-elevation-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
            'max-h-[80vh] overflow-y-auto',
          ].join(' ')}
          aria-describedby="field-picker-description"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-text-primary">
              Add a field
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close field picker"
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <p id="field-picker-description" className="sr-only">
            Select a field type to add to your form
          </p>

          {/* Field categories */}
          <div className="px-5 py-4 flex flex-col gap-5">
            {FIELD_CATEGORIES.map((category: FieldCategory) => {
              const fields = FIELDS_BY_CATEGORY[category];
              return (
                <div key={category}>
                  {/* Category label */}
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    {category}
                  </p>

                  {/* Field grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {fields.map((entry) => {
                      const Icon = entry.icon;
                      return (
                        <button
                          key={entry.type}
                          type="button"
                          onClick={() => handleSelect(entry.type)}
                          className={[
                            'flex flex-col items-center gap-2 rounded-xl border border-border-subtle',
                            'bg-bg-app px-3 py-4 text-center',
                            'transition-all duration-100',
                            'hover:border-accent-base hover:bg-accent-base/5 hover:shadow-sm',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1',
                          ].join(' ')}
                          aria-label={`Add ${entry.label} field`}
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-muted text-text-secondary">
                            <Icon size={16} aria-hidden="true" />
                          </span>
                          <span className="text-xs font-medium text-text-primary leading-tight">
                            {entry.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
