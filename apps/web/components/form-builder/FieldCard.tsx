'use client';

/**
 * FieldCard — Task 6 (Wave 1)
 *
 * Visual card for a single form field on the Canvas.
 *
 * Features:
 *   - Card: bg-bg-surface rounded-xl border border-border-subtle shadow-sm px-5 py-4
 *   - Header row: click-to-edit label input (NO contentEditable), type badge pill,
 *     required asterisk
 *   - Body: muted placeholder preview text (italic, text-text-tertiary)
 *   - Selected state: ring-2 ring-border-focus ring-offset-2
 *   - Hover controls (opacity-0 -> group-hover:opacity-100 transition-opacity
 *     duration-150): GripVertical drag handle, Copy duplicate, Star required toggle,
 *     Trash2 delete
 *   - Framer Motion: initial {opacity:0, y:8} -> animate {opacity:1, y:0} 200ms
 *                    exit {opacity:0, y:-4} 140ms; useReducedMotion() guard
 *   - role="article", aria-label={label || 'Unnamed field'}, tabIndex={0}
 *   - Mock field data exported for Canvas stub (Wave 1)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 12.1, 12.2
 */

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { GripVertical, Copy, Trash2, Star } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Local PocField interface for Wave 1/2.
 * Replaced with the shared PocField from packages/shared in Wave 3.
 *
 * All fields are optional except id, type, and label so that partial
 * constructions (e.g. freshly-inserted fields) are valid.
 */
export interface PocField {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  encrypted?: boolean;
  /** For 'select' fields: the list of option strings. */
  options?: string[];
  /** For 'star_rating' fields: maximum number of stars (3–10, default 5). */
  maxStars?: number;
  /** Width hint for the public form renderer: full | half | third. */
  width?: 'full' | 'half' | 'third';
  /** Type-specific validation constraints. */
  validation?: {
    minLength?: number;  // 'text' | 'textarea'
    maxLength?: number;
    minValue?: number;   // 'number'
    maxValue?: number;
  };
}

export interface FieldCardProps {
  field: PocField;
  /** Whether this card is currently selected in the canvas. */
  isSelected?: boolean;
  /**
   * Theme card classes from `THEME_CONFIG[theme].card` — applied to the card
   * wrapper in place of the default `bg-bg-surface border-border-subtle` classes.
   * When omitted, falls back to the default surface styling.
   */
  themeCardClass?: string;
  /** Called when the card is clicked or keyboard-activated. */
  onSelect?: () => void;
  /** Called when the duplicate control is triggered. */
  onDuplicate?: () => void;
  /** Called when the delete control is triggered. */
  onDelete?: () => void;
  /** Called with the committed label string after inline editing completes. */
  onLabelChange?: (label: string) => void;
  /** Called when the required toggle control is triggered. */
  onRequiredToggle?: () => void;
  /**
   * Ref callback for the drag handle element (from useSortable).
   * When provided, only the GripVertical icon initiates a drag.
   */
  dragHandleRef?: (element: HTMLElement | null) => void;
  /** dnd-kit pointer/keyboard listeners for the drag handle. */
  dragHandleListeners?: React.HTMLAttributes<HTMLElement>;
  /** dnd-kit ARIA attributes for the drag handle. */
  dragHandleAttributes?: React.HTMLAttributes<HTMLElement>;
}

// ---------------------------------------------------------------------------
// Type badge label map
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  text: 'Short Text',
  textarea: 'Long Text',
  email: 'Email',
  url: 'URL',
  select: 'Dropdown',
  checkbox: 'Checkbox',
  star_rating: 'Star Rating',
  wallet_address: 'Wallet Address',
};

function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

// ---------------------------------------------------------------------------
// Placeholder preview copy
// ---------------------------------------------------------------------------

function getPlaceholderPreview(field: PocField): string {
  if (field.placeholder) return field.placeholder;
  const defaults: Record<string, string> = {
    text: 'Type your answer\u2026',
    textarea: 'Write something\u2026',
    email: 'you@example.com',
    url: 'https://\u2026',
    select: 'Choose an option\u2026',
    checkbox: 'Check if applicable',
    star_rating: '\u2605 \u2605 \u2605 \u2605 \u2605',
    wallet_address: '0x\u2026',
  };
  return defaults[field.type] ?? 'Enter a value\u2026';
}

// ---------------------------------------------------------------------------
// Framer Motion variants
// ---------------------------------------------------------------------------

const cardVariants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: [0.2, 0, 0, 1] as [number, number, number, number],
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: {
      duration: 0.14,
      ease: [0.4, 0, 1, 1] as [number, number, number, number],
    },
  },
};

/** Instant, no-movement variant for users who prefer reduced motion. */
const reducedMotionVariants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0 } },
  exit: { opacity: 0, y: 0, transition: { duration: 0 } },
};

// ---------------------------------------------------------------------------
// FieldCard component
// ---------------------------------------------------------------------------

export function FieldCard({
  field,
  isSelected = false,
  themeCardClass,
  onSelect,
  onDuplicate,
  onDelete,
  onLabelChange,
  onRequiredToggle,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
}: FieldCardProps) {
  const prefersReduced = useReducedMotion();
  const variants = prefersReduced ? reducedMotionVariants : cardVariants;

  // Local hover state drives control strip opacity for keyboard/focus users.
  const [isHovered, setIsHovered] = React.useState(false);

  // Inline label editing.
  const [isEditingLabel, setIsEditingLabel] = React.useState(false);
  const [labelDraft, setLabelDraft] = React.useState(field.label);
  const labelInputRef = React.useRef<HTMLInputElement>(null);

  // Sync draft when label changes externally (e.g. store update) and not editing.
  React.useEffect(() => {
    if (!isEditingLabel) {
      setLabelDraft(field.label);
    }
  }, [field.label, isEditingLabel]);

  // Auto-focus + select-all when edit mode activates.
  React.useEffect(() => {
    if (isEditingLabel) {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    }
  }, [isEditingLabel]);

  function handleLabelSpanClick(e: React.MouseEvent) {
    e.stopPropagation(); // Don't bubble up to card onSelect.
    setIsEditingLabel(true);
  }

  function commitLabel() {
    const trimmed = labelDraft.trim();
    const next = trimmed.length > 0 ? trimmed : field.label;
    setLabelDraft(next);
    setIsEditingLabel(false);
    if (next !== field.label) {
      onLabelChange?.(next);
    }
  }

  function handleLabelKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      commitLabel();
    }
    if (e.key === 'Escape') {
      setLabelDraft(field.label); // Discard draft.
      setIsEditingLabel(false);
    }
  }

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      layout
      // Accessibility
      role="article"
      aria-label={field.label || 'Unnamed field'}
      tabIndex={0}
      // Mouse interactions
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      // Keyboard interactions
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      // Focus/blur for keyboard-driven hover state.
      onFocus={() => setIsHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsHovered(false);
        }
      }}
      // Styling — "group" class enables group-hover on the control strip.
      className={[
        'group relative cursor-pointer rounded-xl',
        // Theme card classes override default surface; fallback to original styling
        themeCardClass
          ? themeCardClass
          : 'bg-bg-surface border border-border-subtle shadow-sm',
        'px-5 py-4',
        'transition-shadow duration-150',
        'focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-border-focus focus-visible:ring-offset-2',
        isSelected
          ? 'ring-2 ring-border-focus ring-offset-2'
          : 'hover:shadow-md',
      ].join(' ')}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Card header row: label + type badge + required asterisk             */}
      {/* pr-24 reserves space so content never slides under the control strip */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2 pr-24">
        {/* Inline label — click to enter edit mode */}
        {isEditingLabel ? (
          <input
            ref={labelInputRef}
            type="text"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={handleLabelKeyDown}
            onClick={(e) => e.stopPropagation()}
            aria-label="Edit field label"
            className={[
              'min-w-0 flex-1 rounded border border-border-focus bg-transparent',
              'px-1 py-0 text-sm font-medium text-text-primary',
              'focus:outline-none',
            ].join(' ')}
          />
        ) : (
          <span
            role="button"
            tabIndex={-1}
            onClick={handleLabelSpanClick}
            title="Click to edit label"
            className={[
              'cursor-text select-none truncate text-sm font-medium',
              field.label ? 'text-text-primary' : 'italic text-text-tertiary',
              'transition-colors duration-100 hover:text-accent-base',
            ].join(' ')}
          >
            {field.label || 'Unnamed field'}
          </span>
        )}

        {/* Type badge */}
        <span className="shrink-0 rounded-full bg-bg-muted px-2 py-0.5 text-xs text-text-secondary">
          {getTypeLabel(field.type)}
        </span>

        {/* Required asterisk — only shown when required */}
        {field.required && (
          <span
            className="shrink-0 text-sm font-bold text-red-500"
            aria-label="Required field"
            title="Required"
          >
            *
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Card body — muted placeholder preview                               */}
      {/* ------------------------------------------------------------------ */}
      <p className="mt-2 text-sm italic text-text-tertiary">
        {getPlaceholderPreview(field)}
      </p>

      {/* Help text preview */}
      {field.helpText && (
        <p className="mt-1 text-xs text-text-tertiary">{field.helpText}</p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Hover control strip                                                  */}
      {/*                                                                      */}
      {/* Positioned absolutely on the right. Visibility is driven by both:  */}
      {/*   1. CSS group-hover (mouse users)                                  */}
      {/*   2. Local isHovered state (keyboard / focus users)                 */}
      {/* The strip never pushes card layout — absolute positioning only.    */}
      {/* ------------------------------------------------------------------ */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={[
          'absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5',
          'rounded-lg border border-border-subtle bg-bg-surface p-1 shadow-sm',
          // CSS group-hover + JS state compose cleanly (both add opacity-100).
          'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
          isHovered ? 'opacity-100' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden={!isHovered}
      >
        {/* Drag handle — GripVertical (wired to useSortable via dragHandleRef) */}
        <span
          ref={dragHandleRef}
          {...dragHandleListeners}
          {...dragHandleAttributes}
          role="button"
          tabIndex={0}
          aria-label="Drag to reorder"
          className="cursor-grab rounded p-1 text-text-tertiary transition-colors hover:text-text-primary active:cursor-grabbing"
        >
          <GripVertical size={15} />
        </span>

        {/* Duplicate */}
        <button
          type="button"
          onClick={onDuplicate}
          tabIndex={isHovered ? 0 : -1}
          aria-label="Duplicate field"
          className="rounded p-1 text-text-tertiary transition-colors hover:text-text-primary"
        >
          <Copy size={15} />
        </button>

        {/* Required toggle — Star, filled when required */}
        <button
          type="button"
          onClick={onRequiredToggle}
          tabIndex={isHovered ? 0 : -1}
          aria-label={field.required ? 'Mark as optional' : 'Mark as required'}
          aria-pressed={field.required ?? false}
          className={[
            'rounded p-1 transition-colors',
            field.required
              ? 'text-amber-500 hover:text-red-500'
              : 'text-text-tertiary hover:text-text-primary',
          ].join(' ')}
        >
          <Star
            size={15}
            className={field.required ? 'fill-current' : 'fill-none'}
          />
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          tabIndex={isHovered ? 0 : -1}
          aria-label="Delete field"
          className="rounded p-1 text-text-tertiary transition-colors hover:text-red-500"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Mock field data
// Used by Canvas stub (Wave 1) until the Zustand store is wired (Wave 3).
// ---------------------------------------------------------------------------

export const MOCK_FIELDS: PocField[] = [
  {
    id: 'mock-1',
    type: 'text',
    label: 'Full name',
    required: true,
    placeholder: 'e.g. Jane Doe',
  },
  {
    id: 'mock-2',
    type: 'email',
    label: 'Email address',
    placeholder: 'you@example.com',
  },
  {
    id: 'mock-3',
    type: 'wallet_address',
    label: 'SUI wallet address',
    placeholder: '0x\u2026',
    helpText: 'Must be a valid SUI address \u2014 validated on submit.',
  },
];
