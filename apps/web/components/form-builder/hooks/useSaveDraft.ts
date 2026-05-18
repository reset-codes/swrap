'use client';

/**
 * useSaveDraft — saves the current form to the backend API as a draft.
 *
 * Maps canvas builder field types to the API's FieldTypeSchema types,
 * then POSTs to /api/forms (for new forms) or PUT to /api/forms/:id (for updates).
 *
 * Falls back gracefully if the API is unavailable — saves to localStorage only.
 * This ensures the draft always persists locally, with the DB as a bonus.
 *
 * Status is communicated via the store's autosaveStatus:
 *   - 'saving' while in-flight
 *   - 'saved'  on success
 *   - 'error'  on failure (surfaces a toast)
 *
 * Requirements: Phase 1 Task 4+5 (drafts persist, preview works)
 */

import { useFormBuilderStore } from '../../../stores/form-builder-store';
import type { PocField } from '../FieldCard';
import { toast } from '../../ui/Toast';

// ---------------------------------------------------------------------------
// Type mapping from canvas builder → API FieldTypeSchema
// ---------------------------------------------------------------------------

/**
 * Maps canvas field types to the API's FieldTypeSchema enum values.
 * Unknown types fall back to 'short_text' (safe default).
 */
function mapFieldType(type: string): string {
  const map: Record<string, string> = {
    text: 'short_text',
    textarea: 'long_text',
    number: 'short_text',      // API doesn't have 'number' yet
    email: 'short_text',
    phone: 'short_text',
    url: 'url',
    select: 'dropdown',
    checkbox: 'checkbox',
    star_rating: 'star_rating',
    wallet_address: 'short_text',
    file_upload: 'file_upload',
    image_upload: 'image_upload',
  };
  return map[type] ?? 'short_text';
}

/**
 * Convert a PocField from the canvas builder to the API request format.
 * For POST (create): matches CreateFieldSchema (no id/order).
 * For PUT (update): matches FieldConfigSchema (requires id/order).
 */
function pocFieldToApiField(f: PocField, index: number, includeIdAndOrder = false) {
  const base = {
    type: mapFieldType(f.type),
    label: f.label || 'Untitled field',
    placeholder: f.placeholder,
    helpText: f.helpText,
    required: f.required ?? false,
    encrypted: f.encrypted ?? false,
    validation: f.validation
      ? {
          minLength: f.validation.minLength,
          maxLength: f.validation.maxLength,
          minValue: f.validation.minValue,
          maxValue: f.validation.maxValue,
        }
      : undefined,
    options:
      f.options && f.options.length > 0
        ? f.options.map((opt, i) => ({
            id: `opt-${index}-${i}`,
            label: opt,
            value: opt.toLowerCase().replace(/\s+/g, '-'),
          }))
        : undefined,
  };

  if (includeIdAndOrder) {
    return { ...base, id: f.id, order: index };
  }
  return base;
}

// ---------------------------------------------------------------------------
// localStorage key
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'swrap-builder-draft@1';

function saveToLocalStorage(title: string, fields: PocField[]): void {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ title, fields, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Quota exceeded — ignore; we'll still try the API path
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSaveDraft() {
  const fields = useFormBuilderStore((s) => s.fields);
  const title = useFormBuilderStore((s) => s.title);
  const draftFormId = useFormBuilderStore((s) => s.draftFormId);
  const setAutosaveStatus = useFormBuilderStore((s) => s.setAutosaveStatus);
  const setDraftFormId = useFormBuilderStore((s) => s.setDraftFormId);

  async function saveDraft() {
    setAutosaveStatus('saving');

    // 1. Always save to localStorage first (instant, offline-safe)
    saveToLocalStorage(title, fields);

    // 2. Try to persist to the backend API
    try {
      const apiFields = fields.map((f, i) => pocFieldToApiField(f, i, false));
      const body = {
        title: title || 'Untitled Form',
        mode: 'table' as const,
        encryptionMode: 'none' as const,
        fields: apiFields,
        isDraft: true,  // skip Walrus write — create DB-only draft
      };

      let response: Response;

      if (draftFormId) {
        // Update existing draft — pass fields using the loose draft format
        const updateFields = fields.map((f, i) => pocFieldToApiField(f, i, true));
        response = await fetch(`/api/forms/${draftFormId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title || 'Untitled Form',
            mode: 'table' as const,
            encryptionMode: 'none' as const,
            fields: updateFields,
            isDraft: true,
          }),
        });
      } else {
        // Create new draft — no id/order needed (service assigns them)
        response = await fetch('/api/forms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      if (response.ok) {
        const data = await response.json() as { data?: { id?: string } };
        if (!draftFormId && data?.data?.id) {
          const newId = data.data.id;
          setDraftFormId(newId);
          // Update the browser URL to include ?draft=:id so page refresh
          // restores the correct draft context (no navigation, no flicker).
          try {
            const url = new URL(window.location.href);
            url.searchParams.set('draft', newId);
            window.history.replaceState(null, '', url.toString());
          } catch {
            // URL update is best-effort — non-fatal
          }
        }
        setAutosaveStatus('saved');
        toast.success('Draft saved', { description: 'Your form has been saved.' });
      } else if (response.status === 401) {
        // Genuinely unauthenticated — session expired or not signed in
        setAutosaveStatus('saved');
        toast.success('Saved locally', {
          description: 'Sign in to sync across devices.',
        });
      } else {
        // API error (5xx, 4xx) but localStorage succeeded — surface as error
        setAutosaveStatus('error');
        const errorBody = await response.json().catch(() => ({})) as { error?: { message?: string } };
        const message = errorBody?.error?.message ?? 'Save failed. Retrying next time.';
        toast.error('Save failed', { description: message });
      }
    } catch {
      // Network error — localStorage succeeded, show warning not fake success
      setAutosaveStatus('error');
      toast.error('Save failed', {
        description: 'Could not reach the server. Draft saved locally.',
      });
    }
  }

  return { saveDraft };
}
