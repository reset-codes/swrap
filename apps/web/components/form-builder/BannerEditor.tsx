'use client';

/**
 * BannerEditor — optional cover image above the form title.
 *
 * Supports three input methods:
 *   1. Drag and drop a local image file
 *   2. Click to file-browse
 *   3. Paste a URL (fallback)
 *
 * States:
 *   1. `bannerUrl === null`, input hidden   → shows "+ Add cover" button
 *   2. `bannerUrl === null`, input visible  → shows upload dropzone + URL input
 *   3. `bannerUrl !== null`                → shows full-width cover image with hover remove
 *
 * URL validation:
 *   - Must start with `https://`
 *   - Must be parseable by `new URL()`
 *   - Image must successfully load via a hidden <img> element
 *
 * Requirements: 11.1–11.6, Phase 2 Task 8 (drag/drop upload)
 */

import * as React from 'react';
import { Upload } from 'lucide-react';
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
// File size limit: 5MB
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

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
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [isHoveringBanner, setIsHoveringBanner] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isInputOpen) {
      inputRef.current?.focus();
    }
  }, [isInputOpen]);

  // ── File handling ────────────────────────────────────────────────────────

  function handleFileLoad(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Only image files are supported (PNG, JPG, GIF, WebP).');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError('Image must be smaller than 5MB.');
      return;
    }

    setError(null);
    setIsVerifying(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setBannerUrl(dataUrl);
      setIsInputOpen(false);
      setInputValue('');
      setIsVerifying(false);
    };
    reader.onerror = () => {
      setError('Failed to read the image file.');
      setIsVerifying(false);
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileLoad(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileLoad(file);
  }

  // ── URL handling ────────────────────────────────────────────────────────

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
    if (error) setError(null);
  }

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
      inputRef.current?.blur();
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
        {/* Cover image — 3:1 ratio */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bannerUrl}
          alt="Form cover"
          className="w-full rounded-xl object-cover"
          style={{ aspectRatio: '3/1' }}
        />

        {isHoveringBanner && (
          <div className="absolute inset-0 flex items-end justify-end rounded-xl bg-black/20 p-3">
            <button
              type="button"
              onClick={handleRemoveCover}
              className="rounded-md bg-white/90 px-3 py-1 text-sm font-medium text-text-primary shadow-sm backdrop-blur-sm transition-colors hover:bg-white hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
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
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleFileInputChange}
          aria-label="Upload cover image file"
          tabIndex={-1}
        />

        {/* Dropzone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop an image here or click to browse"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={[
            'mb-3 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed',
            'px-6 py-8 text-center cursor-pointer transition-colors',
            isDragOver
              ? 'border-accent-base bg-accent-base/5'
              : 'border-border-subtle bg-bg-app hover:border-border-strong hover:bg-bg-muted',
            isVerifying ? 'opacity-60 pointer-events-none' : '',
          ].join(' ')}
        >
          <Upload
            className={['h-6 w-6', isDragOver ? 'text-accent-base' : 'text-text-tertiary'].join(' ')}
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-text-secondary">
              {isVerifying ? 'Loading…' : 'Drag & drop or click to upload'}
            </p>
            <p className="mt-0.5 text-xs text-text-tertiary">PNG, JPG, GIF, WebP — max 5MB</p>
          </div>
        </div>

        {/* URL fallback */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="url"
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder="Or paste a URL: https://…"
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
          </div>
          <button
            type="button"
            onClick={() => {
              setIsInputOpen(false);
              setInputValue('');
              setError(null);
            }}
            className="shrink-0 rounded-md px-3 py-2 text-sm text-text-tertiary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Cancel
          </button>
        </div>

        {error && (
          <p id="banner-url-error" role="alert" className="mt-1.5 text-xs text-red-500">
            {error}
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
        onClick={() => setIsInputOpen(true)}
        className="text-sm text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 rounded"
      >
        + Add cover
      </button>
    </div>
  );
}
