'use client';

import { useState, useEffect, useId } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FieldConfig, FieldOption, FieldType } from '@/types/form';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldConfigPanelProps {
  field: FieldConfig | null; // null = panel closed
  onSave: (updates: Partial<Omit<FieldConfig, 'id' | 'order'>>) => void;
  onClose: () => void;
}

// ─── Local form state ─────────────────────────────────────────────────────────

interface LocalFieldState {
  label: string;
  placeholder: string;
  helpText: string;
  required: boolean;
  encrypted: boolean;
  // dropdown / multi_select
  options: FieldOption[];
  // star_rating
  maxStars: string;
  // upload fields
  maxFileSizeMB: string;
  allowedTypes: string;
  // text fields
  minLength: string;
  maxLength: string;
}

function initState(field: FieldConfig): LocalFieldState {
  return {
    label: field.label,
    placeholder: field.placeholder ?? '',
    helpText: field.helpText ?? '',
    required: field.required,
    encrypted: field.encrypted,
    options: field.options ? [...field.options] : [],
    maxStars: field.validation?.maxValue != null ? String(field.validation.maxValue) : '5',
    maxFileSizeMB:
      field.validation?.maxFileSizeBytes != null
        ? String(Math.round(field.validation.maxFileSizeBytes / (1024 * 1024)))
        : '',
    allowedTypes: field.validation?.allowedMimeTypes?.join(', ') ?? '',
    minLength: field.validation?.minLength != null ? String(field.validation.minLength) : '',
    maxLength: field.validation?.maxLength != null ? String(field.validation.maxLength) : '',
  };
}

// ─── Helper: field type groups ────────────────────────────────────────────────

const DROPDOWN_TYPES: FieldType[] = ['dropdown', 'multi_select'];
const UPLOAD_TYPES: FieldType[] = ['image_upload', 'video_upload', 'file_upload'];
const TEXT_TYPES: FieldType[] = ['short_text', 'long_text'];
const PLACEHOLDER_TYPES: FieldType[] = ['short_text', 'long_text', 'url'];

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ToggleRowProps {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ id, label, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="cursor-pointer">
        {label}
      </Label>
      {/* Native checkbox styled as a toggle */}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
          'transition-colors duration-200 ease-in-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
          checked ? 'bg-accent' : 'bg-border',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm',
            'transform transition-transform duration-200 ease-in-out',
            checked ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  );
}

interface FieldGroupProps {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  error?: string;
}

function FieldGroup({ label, htmlFor, children, error }: FieldGroupProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-small font-medium text-text-primary">
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-small text-error mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── FieldConfigPanel ─────────────────────────────────────────────────────────

export function FieldConfigPanel({ field, onSave, onClose }: FieldConfigPanelProps) {
  const uid = useId();
  const [state, setState] = useState<LocalFieldState>(() =>
    field ? initState(field) : initState({ id: '', type: 'short_text', label: '', required: false, encrypted: false, order: 0 }),
  );
  const [labelError, setLabelError] = useState('');

  // Re-initialise local state whenever the field being edited changes
  useEffect(() => {
    if (field) {
      setState(initState(field));
      setLabelError('');
    }
  }, [field]);

  if (!field) return null;

  const fieldType = field.type;

  // ── Helpers ──────────────────────────────────────────────────────────────

  const set = <K extends keyof LocalFieldState>(key: K, value: LocalFieldState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const addOption = () => {
    const newOption: FieldOption = {
      id: crypto.randomUUID(),
      label: '',
      value: '',
    };
    set('options', [...state.options, newOption]);
  };

  const updateOption = (index: number, field: keyof Omit<FieldOption, 'id'>, value: string) => {
    const next = state.options.map((opt, i) =>
      i === index ? { ...opt, [field]: value } : opt,
    );
    set('options', next);
  };

  const removeOption = (index: number) => {
    set('options', state.options.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (!state.label.trim()) {
      setLabelError('Label is required');
      return;
    }
    setLabelError('');

    const updates: Partial<Omit<FieldConfig, 'id' | 'order'>> = {
      label: state.label.trim(),
      required: state.required,
      encrypted: state.encrypted,
    };

    if (state.placeholder) updates.placeholder = state.placeholder;
    if (state.helpText) updates.helpText = state.helpText;

    // Options
    if (DROPDOWN_TYPES.includes(fieldType)) {
      updates.options = state.options;
    }

    // Validation
    const validation: FieldConfig['validation'] = {};

    if (fieldType === 'star_rating') {
      const max = parseInt(state.maxStars, 10);
      if (!isNaN(max) && max >= 1 && max <= 10) {
        validation.maxValue = max;
      }
    }

    if (UPLOAD_TYPES.includes(fieldType)) {
      const mb = parseFloat(state.maxFileSizeMB);
      if (!isNaN(mb) && mb > 0) {
        validation.maxFileSizeBytes = Math.round(mb * 1024 * 1024);
      }
      if (fieldType === 'file_upload' && state.allowedTypes.trim()) {
        validation.allowedMimeTypes = state.allowedTypes
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    }

    if (TEXT_TYPES.includes(fieldType)) {
      const min = parseInt(state.minLength, 10);
      const max = parseInt(state.maxLength, 10);
      if (!isNaN(min) && min >= 0) validation.minLength = min;
      if (!isNaN(max) && max > 0) validation.maxLength = max;
    }

    if (Object.keys(validation).length > 0) {
      updates.validation = validation;
    }

    onSave(updates);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-border bg-white p-6 shadow-sm">
      {/* Header */}
      <h3 className="text-h3 font-semibold text-text-primary mb-4">Configure Field</h3>

      <div className="space-y-4">
        {/* Label */}
        <FieldGroup label="Label" htmlFor={`${uid}-label`} error={labelError}>
          <Input
            id={`${uid}-label`}
            value={state.label}
            onChange={(e) => {
              set('label', e.target.value);
              if (e.target.value.trim()) setLabelError('');
            }}
            placeholder="Field label"
            aria-invalid={!!labelError}
            aria-describedby={labelError ? `${uid}-label-error` : undefined}
          />
        </FieldGroup>

        {/* Placeholder — only for text/URL fields */}
        {PLACEHOLDER_TYPES.includes(fieldType) && (
          <FieldGroup label="Placeholder" htmlFor={`${uid}-placeholder`}>
            <Input
              id={`${uid}-placeholder`}
              value={state.placeholder}
              onChange={(e) => set('placeholder', e.target.value)}
              placeholder="Placeholder text (optional)"
            />
          </FieldGroup>
        )}

        {/* Help text */}
        <FieldGroup label="Help text" htmlFor={`${uid}-help`}>
          <Input
            id={`${uid}-help`}
            value={state.helpText}
            onChange={(e) => set('helpText', e.target.value)}
            placeholder="Additional guidance for respondents (optional)"
          />
        </FieldGroup>

        {/* Required toggle */}
        <ToggleRow
          id={`${uid}-required`}
          label="Required"
          checked={state.required}
          onChange={(v) => set('required', v)}
        />

        {/* Encryption toggle */}
        <ToggleRow
          id={`${uid}-encrypted`}
          label={
            <span className="flex items-center gap-1.5">
              Encrypt field
              {state.encrypted && (
                <Lock className="h-4 w-4 text-seal-brand" aria-label="Encryption enabled" />
              )}
            </span>
          }
          checked={state.encrypted}
          onChange={(v) => set('encrypted', v)}
        />

        {/* ── Type-specific controls ─────────────────────────────────────── */}

        {/* Dropdown / Multi-select options */}
        {DROPDOWN_TYPES.includes(fieldType) && (
          <div className="flex flex-col gap-2">
            <span className="text-small font-medium text-text-primary">Options</span>
            {state.options.map((opt, index) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Input
                  value={opt.label}
                  onChange={(e) => updateOption(index, 'label', e.target.value)}
                  placeholder="Option label"
                  aria-label={`Option ${index + 1} label`}
                />
                <Input
                  value={opt.value}
                  onChange={(e) => updateOption(index, 'value', e.target.value)}
                  placeholder="Value"
                  aria-label={`Option ${index + 1} value`}
                  className="w-32 shrink-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeOption(index)}
                  aria-label={`Remove option ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4 text-text-secondary" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addOption}
              className="self-start"
            >
              <Plus className="h-4 w-4" />
              Add option
            </Button>
          </div>
        )}

        {/* Star rating — max stars */}
        {fieldType === 'star_rating' && (
          <FieldGroup label="Max stars (1–10)" htmlFor={`${uid}-maxstars`}>
            <Input
              id={`${uid}-maxstars`}
              type="number"
              min={1}
              max={10}
              value={state.maxStars}
              onChange={(e) => set('maxStars', e.target.value)}
              className="w-24"
            />
          </FieldGroup>
        )}

        {/* Upload fields */}
        {UPLOAD_TYPES.includes(fieldType) && (
          <>
            <FieldGroup label="Max file size (MB)" htmlFor={`${uid}-maxsize`}>
              <Input
                id={`${uid}-maxsize`}
                type="number"
                min={1}
                value={state.maxFileSizeMB}
                onChange={(e) => set('maxFileSizeMB', e.target.value)}
                placeholder="e.g. 10"
                className="w-32"
              />
            </FieldGroup>
            {fieldType === 'file_upload' && (
              <FieldGroup label="Allowed MIME types" htmlFor={`${uid}-mimetypes`}>
                <Input
                  id={`${uid}-mimetypes`}
                  value={state.allowedTypes}
                  onChange={(e) => set('allowedTypes', e.target.value)}
                  placeholder="e.g. application/pdf, image/png"
                />
              </FieldGroup>
            )}
          </>
        )}

        {/* Text fields — min/max length */}
        {TEXT_TYPES.includes(fieldType) && (
          <div className="flex gap-4">
            <FieldGroup label="Min length" htmlFor={`${uid}-minlen`}>
              <Input
                id={`${uid}-minlen`}
                type="number"
                min={0}
                value={state.minLength}
                onChange={(e) => set('minLength', e.target.value)}
                placeholder="0"
                className="w-24"
              />
            </FieldGroup>
            <FieldGroup label="Max length" htmlFor={`${uid}-maxlen`}>
              <Input
                id={`${uid}-maxlen`}
                type="number"
                min={1}
                value={state.maxLength}
                onChange={(e) => set('maxLength', e.target.value)}
                placeholder="—"
                className="w-24"
              />
            </FieldGroup>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-6">
        <Button type="button" onClick={handleSave}>
          Save Field
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
