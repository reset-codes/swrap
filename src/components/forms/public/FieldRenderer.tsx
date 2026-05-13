'use client';

/**
 * FieldRenderer — renders a single form field based on its type.
 *
 * Supports all 11 field types defined in FieldType:
 *   short_text, long_text, rich_text, dropdown, multi_select,
 *   checkbox, star_rating, url, image_upload, video_upload, file_upload
 *
 * Requirements: R6, R14
 */

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FieldConfig } from '@/types/form';
import type { FieldValue } from '@/types/submission';

export interface FieldRendererProps {
  field: FieldConfig;
  value: FieldValue['value'];
  onChange: (value: FieldValue['value']) => void;
  error?: string;
}

// ─── Shared input class ───────────────────────────────────────────────────────

const inputClass =
  'h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-text-primary placeholder:text-text-muted ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-[invalid=true]:border-error aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-error/20';

// ─── Star Rating ──────────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  maxStars = 5,
  hasError,
}: {
  value: number;
  onChange: (v: number) => void;
  maxStars?: number;
  hasError?: boolean;
}) {
  return (
    <div
      className={cn('flex gap-1', hasError && 'rounded-md ring-2 ring-error/20')}
      role="group"
      aria-label="Star rating"
    >
      {Array.from({ length: maxStars }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i + 1)}
          aria-label={`${i + 1} star${i + 1 !== 1 ? 's' : ''}`}
          aria-pressed={value > i}
          className={cn(
            'h-8 w-8 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
            value > i ? 'text-warning' : 'text-border hover:text-warning/60',
          )}
        >
          <Star className="h-6 w-6 fill-current" />
        </button>
      ))}
    </div>
  );
}

// ─── File Upload Field ────────────────────────────────────────────────────────

interface FileUploadFieldProps {
  id: string;
  accept?: string;
  field: FieldConfig;
  value: FieldValue['value'];
  onChange: (value: FieldValue['value']) => void;
  hasError: boolean;
  ariaInvalid: 'true' | undefined;
}

function FileUploadField({
  id,
  accept,
  field: _field,
  value,
  onChange,
  hasError,
  ariaInvalid,
}: FileUploadFieldProps) {
  const selectedName = typeof value === 'string' ? value : null;

  return (
    <div className="flex flex-col gap-1.5">
      <input
        id={id}
        type="file"
        accept={accept}
        className={cn(
          'w-full cursor-pointer rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary',
          'file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs file:font-medium file:text-text-primary',
          'focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent',
          hasError && 'border-error ring-2 ring-error/20',
        )}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          onChange(file ? file.name : null);
        }}
        aria-invalid={ariaInvalid}
        aria-describedby={
          hasError
            ? `${id}-error`
            : selectedName
              ? `${id}-selected`
              : undefined
        }
      />
      {selectedName && (
        <p
          id={`${id}-selected`}
          className="text-xs text-text-muted"
          aria-live="polite"
        >
          File selected: {selectedName}
        </p>
      )}
    </div>
  );
}

// ─── Main renderer ────────────────────────────────────────────────────────────

export function FieldRenderer({ field, value, onChange, error }: FieldRendererProps) {
  const hasError = Boolean(error);
  const ariaInvalid = hasError ? ('true' as const) : undefined;
  const inputId = `field-${field.id}`;

  switch (field.type) {
    // ── short_text ────────────────────────────────────────────────────────────
    case 'short_text':
      return (
        <input
          id={inputId}
          type="text"
          className={inputClass}
          placeholder={field.placeholder}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={ariaInvalid}
          aria-describedby={hasError ? `${inputId}-error` : undefined}
          maxLength={field.validation?.maxLength}
        />
      );

    // ── long_text ─────────────────────────────────────────────────────────────
    case 'long_text':
      return (
        <textarea
          id={inputId}
          className={cn(
            'w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'aria-[invalid=true]:border-error aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-error/20',
            'min-h-[100px] resize-y',
          )}
          placeholder={field.placeholder}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={ariaInvalid}
          aria-describedby={hasError ? `${inputId}-error` : undefined}
          maxLength={field.validation?.maxLength}
        />
      );

    // ── rich_text (basic textarea for MVP) ────────────────────────────────────
    case 'rich_text':
      return (
        <textarea
          id={inputId}
          className={cn(
            'w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'aria-[invalid=true]:border-error aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-error/20',
            'min-h-[120px] resize-y',
          )}
          placeholder={field.placeholder ?? 'Enter rich text…'}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={ariaInvalid}
          aria-describedby={hasError ? `${inputId}-error` : undefined}
        />
      );

    // ── dropdown ──────────────────────────────────────────────────────────────
    case 'dropdown':
      return (
        <select
          id={inputId}
          className={cn(
            inputClass,
            'cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%236B7280\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")] bg-[right_12px_center] bg-no-repeat pr-8',
          )}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={ariaInvalid}
          aria-describedby={hasError ? `${inputId}-error` : undefined}
        >
          <option value="">Select an option…</option>
          {field.options?.map((opt) => (
            <option key={opt.id} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    // ── multi_select ──────────────────────────────────────────────────────────
    case 'multi_select': {
      const selected = (value as string[]) ?? [];
      return (
        <div
          className={cn(
            'flex flex-col gap-2',
            hasError && 'rounded-md p-2 ring-2 ring-error/20',
          )}
          role="group"
          aria-labelledby={`${inputId}-label`}
        >
          {field.options?.map((opt) => {
            const checked = selected.includes(opt.value);
            const checkId = `${inputId}-${opt.id}`;
            return (
              <label key={opt.id} htmlFor={checkId} className="flex cursor-pointer items-center gap-2">
                <input
                  id={checkId}
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-accent focus:ring-2 focus:ring-accent/20"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onChange([...selected, opt.value]);
                    } else {
                      onChange(selected.filter((v) => v !== opt.value));
                    }
                  }}
                />
                <span className="text-sm text-text-primary">{opt.label}</span>
              </label>
            );
          })}
        </div>
      );
    }

    // ── checkbox ──────────────────────────────────────────────────────────────
    case 'checkbox':
      return (
        <label htmlFor={inputId} className="flex cursor-pointer items-center gap-2">
          <input
            id={inputId}
            type="checkbox"
            className={cn(
              'h-4 w-4 rounded border-border text-accent focus:ring-2 focus:ring-accent/20',
              hasError && 'border-error ring-2 ring-error/20',
            )}
            checked={(value as boolean) ?? false}
            onChange={(e) => onChange(e.target.checked)}
            aria-invalid={ariaInvalid}
            aria-describedby={hasError ? `${inputId}-error` : undefined}
          />
          <span className="text-sm text-text-primary">
            {field.placeholder ?? field.label}
          </span>
        </label>
      );

    // ── star_rating ───────────────────────────────────────────────────────────
    case 'star_rating':
      return (
        <StarRating
          value={(value as number) ?? 0}
          onChange={(v) => onChange(v)}
          maxStars={field.validation?.maxValue ?? 5}
          hasError={hasError}
        />
      );

    // ── url ───────────────────────────────────────────────────────────────────
    case 'url':
      return (
        <input
          id={inputId}
          type="url"
          className={inputClass}
          placeholder={field.placeholder ?? 'https://'}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={ariaInvalid}
          aria-describedby={hasError ? `${inputId}-error` : undefined}
        />
      );

    // ── image_upload ──────────────────────────────────────────────────────────
    case 'image_upload':
      return (
        <FileUploadField
          id={inputId}
          accept="image/*"
          field={field}
          value={value}
          onChange={onChange}
          hasError={hasError}
          ariaInvalid={ariaInvalid}
        />
      );

    // ── video_upload ──────────────────────────────────────────────────────────
    case 'video_upload':
      return (
        <FileUploadField
          id={inputId}
          accept="video/*"
          field={field}
          value={value}
          onChange={onChange}
          hasError={hasError}
          ariaInvalid={ariaInvalid}
        />
      );

    // ── file_upload ───────────────────────────────────────────────────────────
    case 'file_upload':
      return (
        <FileUploadField
          id={inputId}
          accept={field.validation?.allowedMimeTypes?.join(',') ?? undefined}
          field={field}
          value={value}
          onChange={onChange}
          hasError={hasError}
          ariaInvalid={ariaInvalid}
        />
      );

    default:
      return (
        <p className="text-sm text-text-muted">
          Unsupported field type: {(field as FieldConfig).type}
        </p>
      );
  }
}
