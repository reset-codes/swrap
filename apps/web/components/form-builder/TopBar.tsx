'use client';

/**
 * TopBar — full-width sticky bar for the Canvas_Builder editor.
 *
 * Layout:
 *   Left:   Back navigation icon + editable form title input
 *   Center: Autosave status badge (idle | saving | saved)
 *   Right:  Theme selector placeholder · Preview · Save Draft · Publish
 *
 * Task 13 (Wave 3): title is now a fully controlled prop wired to the
 * Zustand store's `title` / `setTitle`. The `initialTitle` prop and
 * the internal `title` useState have been removed.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import * as React from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { ThemeSelector } from './ThemeSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface TopBarProps {
  /**
   * Controlled title value — wired to `useFormBuilderStore().title`.
   * Defaults to empty string so TopBar renders safely without a store wrapper.
   */
  title?: string;
  /** Autosave status — wired to store `autosaveStatus`. */
  autosaveStatus?: AutosaveStatus;
  /** Called when the title input changes — wired to store `setTitle`. */
  onTitleChange?: (title: string) => void;
  /** Called when Save Draft is clicked */
  onSaveDraft?: () => void;
  /** Called when Publish is clicked */
  onPublish?: () => void;
  /** Whether the Publish button should be in loading state */
  publishLoading?: boolean;
  /** The blob ID used to construct the preview URL (optional for new forms) */
  formBlobId?: string;
  /** The database form ID used to construct the edit/preview URL */
  draftFormId?: string;
  /** Whether the user is unauthenticated (guest flow). */
  isGuest?: boolean;
}

// ---------------------------------------------------------------------------
// AutosaveBadge
// ---------------------------------------------------------------------------

interface AutosaveBadgeProps {
  status: AutosaveStatus;
  isGuest?: boolean;
}

function AutosaveBadge({ status, isGuest }: AutosaveBadgeProps) {
  if (isGuest) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-amber-50 dark:bg-amber-900/20 px-3 py-1 border border-amber-200 dark:border-amber-800">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
        <span className="text-token-xs font-medium text-amber-700 dark:text-amber-400">Guest Mode · Progress saved locally</span>
      </div>
    );
  }

  // idle → render nothing (hidden per spec)
  if (status === 'idle') {
    return <div className="w-40" aria-hidden="true" />;
  }

  if (status === 'saving') {
    return (
      <div
        className="flex items-center gap-1.5 text-text-tertiary"
        aria-live="polite"
        aria-label="Saving changes"
        role="status"
      >
        {/* Pulsing dot */}
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-text-tertiary"
          aria-hidden="true"
        />
        <span className="text-token-sm">Saving…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        className="flex items-center gap-1.5 text-red-500"
        aria-live="assertive"
        aria-label="Save failed"
        role="alert"
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
          aria-hidden="true"
        />
        <span className="text-token-sm">Save failed</span>
      </div>
    );
  }

  // status === 'saved'
  return (
    <div
      className="flex items-center gap-1.5 text-text-tertiary"
      aria-live="polite"
      aria-label="All changes saved"
      role="status"
    >
      <Check
        className="h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
        strokeWidth={2.5}
      />
      <span className="text-token-sm">Saved</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------

export function TopBar({
  title = '',
  autosaveStatus: externalAutosaveStatus,
  onTitleChange,
  onSaveDraft,
  onPublish,
  publishLoading = false,
  formBlobId,
  draftFormId,
  isGuest = false,
}: TopBarProps) {
  // autosaveStatus — prefer externally-controlled value (from store)
  const [localAutosaveStatus] = React.useState<AutosaveStatus>('idle');
  const autosaveStatus = externalAutosaveStatus ?? localAutosaveStatus;

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onTitleChange?.(e.target.value);
  }

  function handlePreview() {
    if (isGuest) {
      toast.info('Sign in to preview', {
        description: 'You need an account to preview forms.',
      });
      return;
    }
    // For Walrus-published forms: open the POC preview
    if (formBlobId) {
      window.open(`/poc/forms/${formBlobId}`, '_blank', 'noopener,noreferrer');
      return;
    }
    // For DB-saved drafts: open the dashboard edit page (best available preview)
    if (draftFormId) {
      window.open(`/dashboard/forms/${draftFormId}`, '_blank', 'noopener,noreferrer');
      return;
    }
    // Neither saved yet — trigger save first, then user can retry
    onSaveDraft?.();
  }

  function handleSaveDraft() {
    if (isGuest) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    onSaveDraft?.();
  }

  function handlePublish() {
    if (isGuest) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    onPublish?.();
  }

  function handleBack() {
    // Navigate to forms list — we are always nested under /dashboard/forms
    if (typeof window !== 'undefined') {
      window.location.href = isGuest ? '/' : '/dashboard/forms';
    }
  }

  return (
    <header
      className="flex h-14 w-full shrink-0 items-center border-b border-border-subtle bg-bg-surface px-6"
      role="banner"
      aria-label="Form builder top bar"
    >
      {/* ── Left: back + title ─────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label={isGuest ? "Back to landing" : "Go back"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors duration-fast hover:bg-bg-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled form"
          aria-label="Form title"
          className={[
            // Reset all native input chrome
            'min-w-0 flex-1 bg-transparent text-lg font-medium leading-none',
            'text-text-primary placeholder:text-text-tertiary',
            // No border/outline in default state — bare text feel
            'border-0 outline-none ring-0',
            // Subtle bottom underline on focus only
            'focus:border-b focus:border-border-strong focus:pb-px',
            'transition-colors duration-fast',
            // Truncate long titles gracefully
            'truncate',
          ].join(' ')}
          maxLength={200}
        />
      </div>

      {/* ── Center: autosave status ────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-center px-6">
        <AutosaveBadge status={autosaveStatus} isGuest={isGuest} />
      </div>

      {/* ── Right: actions ─────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2">
        {isGuest ? (
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveDraft}
            className="bg-amber-600 hover:bg-amber-700 text-white border-none"
          >
            Sign in to Save
          </Button>
        ) : (
          <>
            {/* Theme selector — full Radix Popover implementation (Task 18) */}
            <ThemeSelector />

            {/* Preview — opens in new tab */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePreview}
              aria-label="Preview form in new tab"
            >
              Preview
            </Button>

            {/* Save Draft — ghost outline */}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSaveDraft}
              aria-label="Save draft"
            >
              Save Draft
            </Button>

            {/* Publish — solid primary */}
            <Button
              variant="primary"
              size="sm"
              onClick={handlePublish}
              loading={publishLoading}
              disabled={publishLoading}
              aria-label={publishLoading ? 'Publishing…' : 'Publish form'}
            >
              Publish
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
