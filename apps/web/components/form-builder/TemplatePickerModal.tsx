'use client';

/**
 * TemplatePickerModal — shown when creating a new form.
 *
 * Displays 5 templates: Feedback, Survey, Review, Waitlist, Blank.
 * On selection: loads the template's fields into the form builder store
 * and navigates to /dashboard/forms/new.
 *
 * Requirements: Phase 2 Task 8
 */

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  MessageSquare,
  BarChart2,
  Star,
  Clock,
  Plus,
  X,
} from 'lucide-react';
import { FORM_TEMPLATES, type FormTemplate } from './templates';

// ---------------------------------------------------------------------------
// Template icons (kept simple — no import from registry needed)
// ---------------------------------------------------------------------------

const TEMPLATE_ICONS: Record<string, React.ElementType> = {
  feedback: MessageSquare,
  survey: BarChart2,
  review: Star,
  waitlist: Clock,
  blank: Plus,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TemplatePickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user picks a template */
  onSelect: (template: FormTemplate) => void;
}

// ---------------------------------------------------------------------------
// TemplatePickerModal
// ---------------------------------------------------------------------------

export function TemplatePickerModal({ open, onClose, onSelect }: TemplatePickerModalProps) {
  function handleSelect(template: FormTemplate) {
    onSelect(template);
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <Dialog.Content
          className={[
            'fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl border border-border-subtle bg-bg-surface shadow-elevation-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
            'max-h-[85vh] overflow-y-auto',
          ].join(' ')}
          aria-describedby="template-picker-desc"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-subtle px-6 py-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-text-primary">
                Start with a template
              </Dialog.Title>
              <p id="template-picker-desc" className="mt-0.5 text-sm text-text-secondary">
                Choose a template or start from scratch
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {/* Template grid */}
          <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3">
            {FORM_TEMPLATES.map((template) => {
              const Icon = TEMPLATE_ICONS[template.id] ?? Plus;
              const isBlank = template.id === 'blank';

              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleSelect(template)}
                  className={[
                    'flex flex-col items-start gap-3 rounded-xl border p-4 text-left',
                    'transition-all duration-100 group',
                    isBlank
                      ? 'border-dashed border-border-subtle bg-bg-app hover:border-accent-base hover:bg-accent-base/5'
                      : 'border-border-subtle bg-bg-app hover:border-accent-base hover:bg-accent-base/5 hover:shadow-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1',
                  ].join(' ')}
                  aria-label={`Use ${template.title} template`}
                >
                  {/* Icon */}
                  <span
                    className={[
                      'flex h-9 w-9 items-center justify-center rounded-lg',
                      'transition-colors duration-100',
                      isBlank
                        ? 'bg-bg-muted text-text-tertiary group-hover:bg-accent-base/10 group-hover:text-accent-base'
                        : 'bg-accent-base/10 text-accent-base',
                    ].join(' ')}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </span>

                  {/* Info */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary leading-tight">
                      {template.title}
                    </p>
                    <p className="mt-0.5 text-xs text-text-tertiary leading-snug line-clamp-2">
                      {template.description}
                    </p>
                  </div>

                  {/* Field count badge */}
                  {template.fields.length > 0 && (
                    <span className="mt-auto text-xs text-text-tertiary">
                      {template.fields.length} field{template.fields.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
