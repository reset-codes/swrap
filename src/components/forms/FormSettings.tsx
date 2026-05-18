'use client';

/**
 * @deprecated LEGACY — No longer the active form settings component.
 *
 * Replaced by: TopBar + InspectorPanel inside CanvasBuilderPage
 * Active route: /dashboard/forms/new → CanvasBuilderPage
 *
 * This file is retained for reference only. Do not import it from any
 * new route or feature. It will be deleted in a future cleanup pass.
 */

import { useState, useId, useEffect, useRef } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormMode, EncryptionMode } from '@/types/form';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormSettingsValues {
  title: string;
  description: string;
  slug: string;
  mode: FormMode;
  encryptionMode: EncryptionMode;
}

export interface FormSettingsProps {
  initialValues?: {
    title?: string;
    description?: string;
    slug?: string;
    mode?: FormMode;
    encryptionMode?: EncryptionMode;
  };
  /** If true, slug is locked (immutable after publish) */
  isPublished?: boolean;
  onSave: (values: FormSettingsValues) => void;
  isSaving?: boolean;
  onPublish?: () => void;
  isPublishing?: boolean;
  onChange?: (values: Partial<FormSettingsValues>) => void;
}

// ─── Slug generation ──────────────────────────────────────────────────────────

function generateSlugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FieldGroupProps {
  label: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  error?: string;
}

function FieldGroup({ label, htmlFor, children, error }: FieldGroupProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium text-text-primary">
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

// ─── Mode selector card ───────────────────────────────────────────────────────

interface ModeSelectorCardProps {
  id: string;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

function ModeSelectorCard({ id, title, description, selected, onSelect }: ModeSelectorCardProps) {
  return (
    <button
      type="button"
      id={id}
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={[
        'flex-1 cursor-pointer rounded-md border p-4 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        selected
          ? 'border-accent bg-accent-light'
          : 'border-border bg-white hover:bg-muted',
      ].join(' ')}
    >
      <p className={['text-sm font-medium', selected ? 'text-accent' : 'text-text-primary'].join(' ')}>
        {title}
      </p>
      <p className="text-small text-text-secondary mt-0.5">{description}</p>
    </button>
  );
}

// ─── Encryption option ────────────────────────────────────────────────────────

interface EncryptionOptionProps {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

function EncryptionOption({ id, label, description, selected, onSelect }: EncryptionOptionProps) {
  return (
    <label
      htmlFor={id}
      className={[
        'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
        selected ? 'border-accent bg-accent-light' : 'border-border bg-white hover:bg-muted',
      ].join(' ')}
    >
      <input
        type="radio"
        id={id}
        name="encryptionMode"
        checked={selected}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
      />
      <div>
        <p className={['text-sm font-medium', selected ? 'text-accent' : 'text-text-primary'].join(' ')}>
          {label}
        </p>
        <p className="text-small text-text-secondary mt-0.5">{description}</p>
      </div>
    </label>
  );
}

// ─── FormSettings ─────────────────────────────────────────────────────────────

export function FormSettings({
  initialValues,
  isPublished = false,
  onSave,
  isSaving = false,
  onPublish,
  isPublishing = false,
  onChange,
}: FormSettingsProps) {
  const uid = useId();

  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [slug, setSlug] = useState(initialValues?.slug ?? '');
  const [mode, setMode] = useState<FormMode>(initialValues?.mode ?? 'conversational');
  const [encryptionMode, setEncryptionMode] = useState<EncryptionMode>(
    initialValues?.encryptionMode ?? 'none',
  );

  // Notify parent of initial state and subsequent changes
  useEffect(() => {
    onChange?.({ title, description, slug, mode, encryptionMode });
  }, [title, description, slug, mode, encryptionMode, onChange]);

  const [titleError, setTitleError] = useState('');
  // Track whether the slug has been manually edited by the user
  const slugManuallyEdited = useRef(!!initialValues?.slug);

  // Auto-generate slug from title when title changes (unless slug was manually edited)
  useEffect(() => {
    if (!slugManuallyEdited.current && !isPublished) {
      setSlug(generateSlugFromTitle(title));
    }
  }, [title, isPublished]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTitle(value);
    if (value.trim()) setTitleError('');
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPublished) return;
    slugManuallyEdited.current = true;
    // Sanitise slug input in real-time
    const sanitised = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/--+/g, '-');
    setSlug(sanitised);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError('Form title is required');
      return;
    }
    onSave({ title: title.trim(), description, slug, mode, encryptionMode });
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const slugPreview = slug ? `${appUrl.replace(/^https?:\/\//, '')}/f/${slug}` : 'swrap.app/f/…';

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-white p-6 shadow-sm"
      noValidate
    >
      <h2 className="text-h3 font-semibold text-text-primary mb-6">Form Settings</h2>

      <div className="space-y-5">
        {/* ── Title ──────────────────────────────────────────────────────── */}
        <FieldGroup label="Form Title" htmlFor={`${uid}-title`} error={titleError}>
          <Input
            id={`${uid}-title`}
            value={title}
            onChange={handleTitleChange}
            placeholder="e.g. Bug Report, Feature Request…"
            required
            aria-invalid={!!titleError}
            aria-describedby={titleError ? `${uid}-title-error` : undefined}
          />
        </FieldGroup>

        {/* ── Description ────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-description`} className="text-sm font-medium text-text-primary">
            Description
            <span className="ml-1 text-small font-normal text-text-muted">(optional)</span>
          </Label>
          <textarea
            id={`${uid}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Briefly describe what this form is for…"
            rows={3}
            className={[
              'flex w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary shadow-sm',
              'placeholder:text-text-muted resize-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:border-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
            ].join(' ')}
          />
        </div>

        {/* ── Slug ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-slug`} className="text-sm font-medium text-text-primary">
            <span className="flex items-center gap-1.5">
              URL Slug
              {isPublished && (
                <Lock
                  className="h-3.5 w-3.5 text-text-muted"
                  aria-label="Slug is locked after publication"
                />
              )}
            </span>
          </Label>
          <Input
            id={`${uid}-slug`}
            value={slug}
            onChange={handleSlugChange}
            placeholder="my-form-slug"
            disabled={isPublished}
            aria-describedby={`${uid}-slug-preview`}
          />
          <div className="flex flex-col gap-1">
            <p
              id={`${uid}-slug-preview`}
              className="font-mono text-small text-text-muted mt-1"
            >
              {slugPreview}
            </p>
            {isPublished && (
              <a
                href={`${appUrl}/f/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-small text-accent hover:underline"
              >
                View Public Form ↗
              </a>
            )}
          </div>
        </div>

        {/* ── Form Mode ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text-primary" id={`${uid}-mode-label`}>
            Form Mode
          </span>
          <div
            className="flex gap-3"
            role="radiogroup"
            aria-labelledby={`${uid}-mode-label`}
          >
            <ModeSelectorCard
              id={`${uid}-mode-conversational`}
              title="Conversational"
              description="One question at a time, Typeform-style"
              selected={mode === 'conversational'}
              onSelect={() => setMode('conversational')}
            />
            <ModeSelectorCard
              id={`${uid}-mode-table`}
              title="Table"
              description="All fields visible, compact layout"
              selected={mode === 'table'}
              onSelect={() => setMode('table')}
            />
          </div>
        </div>

        {/* ── Encryption Mode ────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text-primary" id={`${uid}-enc-label`}>
            Encryption Mode
          </span>
          <div
            className="flex flex-col gap-2"
            role="radiogroup"
            aria-labelledby={`${uid}-enc-label`}
          >
            <EncryptionOption
              id={`${uid}-enc-none`}
              label="None"
              description="Submissions stored as plaintext on Walrus"
              selected={encryptionMode === 'none'}
              onSelect={() => setEncryptionMode('none')}
            />
            <EncryptionOption
              id={`${uid}-enc-field`}
              label="Field-level"
              description="Individual fields encrypted via Seal"
              selected={encryptionMode === 'field_level'}
              onSelect={() => setEncryptionMode('field_level')}
            />
            <EncryptionOption
              id={`${uid}-enc-full`}
              label="Full submission"
              description="Entire payload encrypted via Seal"
              selected={encryptionMode === 'full_submission'}
              onSelect={() => setEncryptionMode('full_submission')}
            />
          </div>
        </div>
      </div>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div className="mt-6 flex items-center gap-3">
        <Button type="submit" disabled={isSaving || isPublishing}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            'Save Settings'
          )}
        </Button>

        {!isPublished && onPublish && (
          <Button
            type="button"
            variant="secondary"
            onClick={onPublish}
            disabled={isSaving || isPublishing}
          >
            {isPublishing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Publishing…
              </>
            ) : (
              'Publish Form'
            )}
          </Button>
        )}
      </div>
    </form>
  );
}
