'use client';

/**
 * BannerEditor — optional cover image above the form title.
 *
 * States:
 *   1. `bannerUrl === null`, input hidden  → shows "+ Add cover" button
 *   2. `bannerUrl === null`, input visible → shows URL input with validation
 *   3. `bannerUrl !== null`               → shows full-width cover image
 *                                           with "Remove cover" overlay on hover
 *
 * URL validation:
 *   - Must start with `https://`
 *   - Must be parseable by `new URL()`
 *   - Image must successfully load via a hidden <img> element
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import * as React from 'react';
import { useFormBuilderStore } from '../../stores/form-builder-store';

// ---------------------------------------------------------------------------
// URL validation helper (pure, testable)
// ---------------------------------------------------------------------------

export function validateBannerUrl(url: string): { valid: boolean; error?: string } {
  if (!url.trim()) {
    return { valid: false, error: 'Please enter a URL.' };
  }
  if (!url.startsWith('https://')) {
    return { valid: false, error: 'Banner URL must start with https://.' };
  }
  try {
    new URL(url);
  } catch {
    return { valid: false, error: 'Enter a valid URL.' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// BannerEditor component
// ---------------------------------------------------------------------------

export function BannerEditor() {
  const bannerUrl = useFormBuilderStore((s) => s.bannerUrl);
  const setBannerUrl = useFormBuilderStore((s) => s.setBannerUrl);

  // ── Local UI state ──────────────────────────────────────────────────────
  const [isInputOpen, setIsInputOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isVerifying, setIsVerifying] = React.useState(false);
  const [isHoveringBanner, setIsHoveringBanner] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Focus the input whenever it opens
  React.useEffect(() => {
    if (isInputOpen) {
      inputRef.current?.focus();
    }
  }, [isInputOpen]);

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleAddCoverClick() {
    setIsInputOpen(true);
    setInputValue('');
    setError(null);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
    // Clear error while user is typing
    if (error) setError(null);
  }

  /**
   * Verify that the URL resolves to a loadable image by mounting a hidden
   * <img> element. Calls setBannerUrl on success, sets error on failure.
   */
  function verifyAndSetBanner(url: string) {
    setIsVerifying(true);
    setError(null);

    const img = document.createElement('img');
    img.onload = () => {
      setIsVerifying(false);
      setBannerUrl(url);
      setIsInputOpen(false);
      setInputValue('');
    };
    img.onerror = () => {
      setIsVerifying(false);
      setError("Couldn't load image. Check that the URL points to an image file.");
    };
    img.src = url;
  }

  function handleBlur() {
    const url = inputValue.trim();

    // Allow dismissing an empty input without showing an error
    if (!url) {
      setError(null);
      setIsInputOpen(false);
      return;
    }

    const validation = validateBannerUrl(url);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid URL.');
      return;
    }

    verifyAndSetBanner(url);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur(); // triggers handleBlur
    }
    if (e.key === 'Escape') {
      setIsInputOpen(false);
      setInputValue('');
      setError(null);
    }
  }

  function handleRemoveCover() {
    setBannerUrl(null);
    setIsHoveringBanner(false);
  }

  // ── Render: banner is set ───────────────────────────────────────────────
  if (bannerUrl !== null) {
    return (
      <div
        className="relative mb-6"
        onMouseEnter={() => setIsHoveringBanner(true)}
        onMouseLeave={() => setIsHoveringBanner(false)}
      >
        {/* Cover image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bannerUrl}
          alt="Form cover"
          className="h-48 w-full rounded-xl object-cover"
        />

        {/* Remove cover overlay — visible on hover */}
        {isHoveringBanner && (
          <div className="absolute inset-0 flex items-end justify-end rounded-xl bg-black/20 p-3">
            <button
              type="button"
              onClick={handleRemoveCover}
              className={[
                'rounded-md bg-white/90 px-3 py-1 text-sm font-medium',
                'text-text-primary shadow-sm backdrop-blur-sm',
                'transition-colors hover:bg-white hover:text-red-600',
                'focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-border-focus focus-visible:ring-offset-2',
              ].join(' ')}
            >
              Remove cover
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Render: input mode ──────────────────────────────────────────────────
  if (isInputOpen) {
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="url"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="https://..."
            aria-label="Cover image URL"
            aria-describedby={error ? 'banner-url-error' : undefined}
            disabled={isVerifying}
            className={[
              'w-full rounded-lg border px-3 py-2 text-sm',
              'bg-bg-surface text-text-primary placeholder:text-text-tertiary',
              'outline-none transition-colors',
              'focus:ring-2 focus:ring-border-focus focus:ring-offset-1',
              error
                ? 'border-red-400 focus:ring-red-400'
                : 'border-border-subtle focus:border-border-focus',
              isVerifying ? 'opacity-60' : '',
            ].join(' ')}
          />
          {isVerifying && (
            <span className="text-xs text-text-tertiary whitespace-nowrap">
              Checking…
            </span>
          )}
        </div>

        {/* Inline error message */}
        {error && (
          <p
            id="banner-url-error"
            role="alert"
            className="mt-1.5 text-xs text-red-500"
          >
            {error}
          </p>
        )}

        {/* Dismiss hint */}
        {!error && !isVerifying && (
          <p className="mt-1 text-xs text-text-tertiary">
            Press Enter to confirm or Escape to cancel.
          </p>
        )}
      </div>
    );
  }

  // ── Render: default — "Add cover" button ────────────────────────────────
  return (
    <div className="mb-4">
      <button
        type="button"
        aria-label="Add cover image"
        onClick={handleAddCoverClick}
        className="text-sm text-text-tertiary transition-colors hover:text-text-primary"
      >
        + Add cover
      </button>
    </div>
  );
}
