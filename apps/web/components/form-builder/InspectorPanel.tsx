'use client';

/**
 * InspectorPanel — Task 11 (Wave 2).
 *
 * Wired to the real PocField type. All controls are fully controlled
 * (value + onChange), not uncontrolled (defaultValue).
 *
 * Props:
 *   selectedField   — the currently selected PocField | null
 *   onUpdateField   — (id, patch) => void — patches the field in local state
 *
 * Content controls:
 *   - Label input      → updates field.label (live — no save button)
 *   - Placeholder input → updates field.placeholder
 *   - Help text input  → updates field.helpText
 *   - Required toggle  → flips field.required
 *   - Encryption toggle → flips field.encrypted
 *
 * Type-conditional Validation section (below Required toggle):
 *   text | textarea    → Min length + Max length (number inputs)
 *   number             → Min value + Max value (number inputs)
 *   select             → Option list editor (add/edit/remove per row)
 *   star_rating        → Max stars select (3–10)
 *   url                → Static note: "URL format validated on submit"
 *   wallet_address     → Static note: "SUI wallet address validated on submit"
 *
 * Responsive:
 *   xl (>=1280px): 320px fixed sidebar
 *   md (768–1279px): slide-over drawer (absolute, z-50)
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10
 */

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import * as Switch from '@radix-ui/react-switch';
import { Settings2, Lock, Plus, Trash2, Info } from 'lucide-react';
import { type PocField } from './FieldCard';

// ---------------------------------------------------------------------------
// Motion variants
// ---------------------------------------------------------------------------

const panelVariants = {
  hidden: { x: '100%', opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.2, ease: [0.2, 0, 0, 1] as number[] },
  },
  exit: {
    x: '100%',
    opacity: 0,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] as number[] },
  },
} as const;

const instantVariants = {
  hidden: { x: '100%', opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0 } },
  exit: { x: '100%', opacity: 0, transition: { duration: 0 } },
} as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Section label that sits above each control group */
function ControlLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold uppercase tracking-wide text-text-secondary"
    >
      {children}
    </label>
  );
}

/** Fully-controlled text input control group */
function TextControl({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <ControlLabel htmlFor={id}>{label}</ControlLabel>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 hover:border-border-strong"
      />
    </div>
  );
}

/** Fully-controlled number input control group */
function NumberControl({
  id,
  label,
  value,
  placeholder,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number | undefined;
  placeholder?: string;
  min?: number;
  max?: number;
  onChange: (val: number | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <ControlLabel htmlFor={id}>{label}</ControlLabel>
      <input
        id={id}
        type="number"
        value={value ?? ''}
        placeholder={placeholder}
        min={min}
        max={max}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
        className="w-full rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 hover:border-border-strong"
      />
    </div>
  );
}

/** Fully-controlled toggle control group (Radix Switch) */
function ToggleControl({
  id,
  label,
  checked,
  icon,
  onChange,
}: {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  icon?: React.ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-text-tertiary">{icon}</span>}
        <ControlLabel htmlFor={id}>{label}</ControlLabel>
      </div>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent-base"
        aria-label={typeof label === 'string' ? label : undefined}
      >
        <Switch.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-fast data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
      </Switch.Root>
    </div>
  );
}

/** Static informational note */
function StaticNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-bg-muted px-3 py-2.5 text-xs text-text-secondary">
      <Info size={13} className="mt-0.5 shrink-0 text-text-tertiary" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option list editor (for select type)
// ---------------------------------------------------------------------------

interface OptionListEditorProps {
  options: string[];
  onChange: (options: string[]) => void;
}

function OptionListEditor({ options, onChange }: OptionListEditorProps) {
  function updateOption(index: number, value: string) {
    const next = [...options];
    next[index] = value;
    onChange(next);
  }

  function removeOption(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }

  function addOption() {
    onChange([...options, '']);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ControlLabel>Options</ControlLabel>
      <div className="flex flex-col gap-1.5">
        {options.map((opt, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              type="text"
              value={opt}
              placeholder={`Option ${index + 1}`}
              onChange={(e) => updateOption(index, e.target.value)}
              aria-label={`Option ${index + 1}`}
              className="min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 hover:border-border-strong"
            />
            <button
              type="button"
              onClick={() => removeOption(index)}
              aria-label={`Remove option ${index + 1}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-muted hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addOption}
        className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        <Plus size={12} aria-hidden="true" />
        Add option
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type-conditional Validation section
// ---------------------------------------------------------------------------

interface ValidationSectionProps {
  field: PocField;
  onUpdate: (patch: Partial<PocField>) => void;
}

function ValidationSection({ field, onUpdate }: ValidationSectionProps) {
  const { type, validation, options = [], maxStars } = field;

  // text / textarea — min/max length
  if (type === 'text' || type === 'textarea') {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Validation
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberControl
            id={`inspector-minlength-${field.id}`}
            label="Min length"
            value={validation?.minLength}
            placeholder="0"
            min={0}
            onChange={(val) =>
              onUpdate({
                validation: { ...validation, minLength: val },
              })
            }
          />
          <NumberControl
            id={`inspector-maxlength-${field.id}`}
            label="Max length"
            value={validation?.maxLength}
            placeholder="No limit"
            min={1}
            onChange={(val) =>
              onUpdate({
                validation: { ...validation, maxLength: val },
              })
            }
          />
        </div>
      </div>
    );
  }

  // number — min/max value
  if (type === 'number') {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Validation
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberControl
            id={`inspector-minvalue-${field.id}`}
            label="Min value"
            value={validation?.minValue}
            placeholder="No min"
            onChange={(val) =>
              onUpdate({
                validation: { ...validation, minValue: val },
              })
            }
          />
          <NumberControl
            id={`inspector-maxvalue-${field.id}`}
            label="Max value"
            value={validation?.maxValue}
            placeholder="No max"
            onChange={(val) =>
              onUpdate({
                validation: { ...validation, maxValue: val },
              })
            }
          />
        </div>
      </div>
    );
  }

  // select — option list editor
  if (type === 'select') {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Validation
        </div>
        <OptionListEditor
          options={options}
          onChange={(newOptions) => onUpdate({ options: newOptions })}
        />
      </div>
    );
  }

  // star_rating — max stars selector (3–10)
  if (type === 'star_rating') {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Validation
        </div>
        <div className="flex flex-col gap-1.5">
          <ControlLabel htmlFor={`inspector-maxstars-${field.id}`}>Max stars</ControlLabel>
          <select
            id={`inspector-maxstars-${field.id}`}
            value={maxStars ?? 5}
            onChange={(e) => onUpdate({ maxStars: Number(e.target.value) })}
            className="w-full rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-sm text-text-primary transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 hover:border-border-strong"
            aria-label="Maximum number of stars"
          >
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n} stars
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  // url — static note
  if (type === 'url') {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Validation
        </div>
        <StaticNote>URL format validated on submit</StaticNote>
      </div>
    );
  }

  // wallet_address — static note
  if (type === 'wallet_address') {
    return (
      <div className="flex flex-col gap-4 pt-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Validation
        </div>
        <StaticNote>SUI wallet address validated on submit</StaticNote>
      </div>
    );
  }

  // All other types (email, checkbox) — no validation controls
  return null;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Settings2
        className="text-text-tertiary"
        size={32}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <p className="text-sm text-text-tertiary">Select a field to configure</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field controls (shown when a field is selected)
// ---------------------------------------------------------------------------

interface FieldControlsProps {
  field: PocField;
  onUpdate: (patch: Partial<PocField>) => void;
}

function FieldControls({ field, onUpdate }: FieldControlsProps) {
  return (
    <div className="space-y-5">
      {/* Label — live update: every keystroke patches the field */}
      <TextControl
        id={`inspector-label-${field.id}`}
        label="Label"
        value={field.label}
        placeholder="Field label"
        onChange={(val) => onUpdate({ label: val })}
      />

      {/* Placeholder */}
      <TextControl
        id={`inspector-placeholder-${field.id}`}
        label="Placeholder"
        value={field.placeholder ?? ''}
        placeholder="Placeholder text"
        onChange={(val) => onUpdate({ placeholder: val })}
      />

      {/* Help text */}
      <TextControl
        id={`inspector-help-text-${field.id}`}
        label="Help text"
        value={field.helpText ?? ''}
        placeholder="Optional help text"
        onChange={(val) => onUpdate({ helpText: val })}
      />

      {/* Required toggle */}
      <ToggleControl
        id={`inspector-required-${field.id}`}
        label="Required"
        checked={field.required ?? false}
        onChange={(checked) => onUpdate({ required: checked })}
      />

      {/* Type-conditional validation section */}
      <ValidationSection field={field} onUpdate={onUpdate} />

      {/* Divider before Privacy section */}
      <hr className="border-border-subtle" />

      {/* Encryption toggle */}
      <ToggleControl
        id={`inspector-encryption-${field.id}`}
        label="Encryption"
        checked={field.encrypted ?? false}
        icon={<Lock size={13} strokeWidth={2} aria-hidden="true" />}
        onChange={(checked) => onUpdate({ encrypted: checked })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectorPanel
// ---------------------------------------------------------------------------

export interface InspectorPanelProps {
  /**
   * The currently selected field. Pass null / undefined to show the empty
   * state prompting the user to select a field.
   */
  selectedField?: PocField | null;
  /**
   * Called when the user changes any control in the inspector.
   * The patch is a partial PocField; callers should merge it into their
   * field state.
   */
  onUpdateField?: (id: string, patch: Partial<PocField>) => void;
}

export function InspectorPanel({
  selectedField = null,
  onUpdateField,
}: InspectorPanelProps) {
  const prefersReducedMotion = useReducedMotion();
  const variants = prefersReducedMotion ? instantVariants : panelVariants;

  const isOpen = selectedField !== null && selectedField !== undefined;

  function handleUpdate(patch: Partial<PocField>) {
    if (selectedField) {
      onUpdateField?.(selectedField.id, patch);
    }
  }

  const content = isOpen ? (
    <motion.div
      key={`field-controls-${selectedField.id}`}
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <FieldControls field={selectedField} onUpdate={handleUpdate} />
    </motion.div>
  ) : (
    <motion.div
      key="empty-state"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <EmptyState />
    </motion.div>
  );

  return (
    <>
      {/* Fixed sidebar — fills the grid column always visible */}
      <div
        className="flex h-full flex-col bg-bg-surface"
        aria-label="Inspector panel"
        role="complementary"
      >
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <AnimatePresence mode="wait" initial={false}>
            {content}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
