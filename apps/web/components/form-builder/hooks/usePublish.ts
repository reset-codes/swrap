'use client';

/**
 * usePublish — publishes the current form draft via the Next.js API.
 *
 * Flow:
 *   1. Ensure the form has been saved as a draft (draftFormId exists).
 *      If not, save it first, then publish.
 *   2. POST /api/forms/:draftFormId/publish
 *   3. The server reads draftSchema, writes to Walrus using the infra wallet,
 *      marks the form published, and returns publicUrl + slug.
 *   4. On success: show toast with public URL, update publishStatus.
 *   5. On failure: show error toast.
 *
 * No ZK Login, no wallet, no session token required.
 * Uses standard NextAuth session (cookies) for authentication.
 *
 * Requirements: Phase 3 Task 1 — infra-wallet publish, no user wallet needed.
 */

import { useFormBuilderStore } from '../../../stores/form-builder-store';
import { toast } from '../../ui/Toast';

export function usePublish() {
  const fields = useFormBuilderStore((s) => s.fields);
  const title = useFormBuilderStore((s) => s.title);
  const draftFormId = useFormBuilderStore((s) => s.draftFormId);
  const setPublishStatus = useFormBuilderStore((s) => s.setPublishStatus);
  const setDraftFormId = useFormBuilderStore((s) => s.setDraftFormId);
  const setAutosaveStatus = useFormBuilderStore((s) => s.setAutosaveStatus);

  async function publish() {
    // ── Validate ────────────────────────────────────────────────────────
    if (fields.length === 0) {
      setPublishStatus('error', 'Add at least one field before publishing.');
      toast.error('Cannot publish', {
        description: 'Add at least one field before publishing.',
      });
      return;
    }

    if (!title || title.trim().length === 0) {
      setPublishStatus('error', 'Add a form title before publishing.');
      toast.error('Cannot publish', {
        description: 'Add a form title before publishing.',
      });
      return;
    }

    setPublishStatus('publishing');

    // ── Ensure draft is saved first ─────────────────────────────────────
    let formId = draftFormId;

    if (!formId) {
      // Auto-save before publish
      try {
        setAutosaveStatus('saving');
        const saveRes = await saveDraftToApi({ title, fields });
        if (saveRes.ok && saveRes.formId) {
          formId = saveRes.formId;
          setDraftFormId(formId);
          setAutosaveStatus('saved');
        } else {
          setAutosaveStatus('error');
          setPublishStatus('error', 'Failed to save draft before publishing.');
          toast.error('Save failed', {
            description: 'Could not save your draft. Please try again.',
          });
          return;
        }
      } catch {
        setAutosaveStatus('error');
        setPublishStatus('error', 'Failed to save draft before publishing.');
        toast.error('Save failed', {
          description: 'Could not save your draft. Please try again.',
        });
        return;
      }
    } else {
      // Update the existing draft with latest content before publish
      try {
        setAutosaveStatus('saving');
        await updateDraftInApi({ formId, title, fields });
        setAutosaveStatus('saved');
      } catch {
        // Non-fatal — proceed with publish using existing draft data
        setAutosaveStatus('saved');
      }
    }

    // ── Publish via server ──────────────────────────────────────────────
    try {
      const response = await fetch(`/api/forms/${formId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
        const message = data?.error?.message ?? 'Publish failed. Please try again.';
        setPublishStatus('error', message);
        toast.error('Publish failed', { description: message });
        return;
      }

      const data = await response.json() as { data?: { publicUrl?: string; slug?: string } };
      const publicUrl = data?.data?.publicUrl ?? `${window.location.origin}/f/${data?.data?.slug}`;

      setPublishStatus('published');
      toast.success('Form published!', {
        description: `Your form is live at: ${publicUrl}`,
        action: publicUrl
          ? { label: 'Open', onClick: () => window.open(publicUrl, '_blank', 'noopener,noreferrer') }
          : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setPublishStatus('error', message);
      toast.error('Publish failed', { description: message });
    }
  }

  return { publish };
}

// ---------------------------------------------------------------------------
// Helpers — save/update draft before publish
// ---------------------------------------------------------------------------

function mapFieldType(type: string): string {
  const map: Record<string, string> = {
    text: 'short_text', textarea: 'long_text', number: 'short_text',
    email: 'short_text', phone: 'short_text', url: 'url',
    select: 'dropdown', checkbox: 'checkbox', star_rating: 'star_rating',
    wallet_address: 'short_text', file_upload: 'file_upload', image_upload: 'image_upload',
  };
  return map[type] ?? 'short_text';
}

function pocFieldToApi(f: import('../FieldCard').PocField, index: number) {
  return {
    id: f.id,
    type: mapFieldType(f.type),
    label: f.label || 'Untitled field',
    placeholder: f.placeholder,
    helpText: f.helpText,
    required: f.required ?? false,
    encrypted: f.encrypted ?? false,
    order: index,
    options: f.options && f.options.length > 0
      ? f.options.map((opt, i) => ({ id: `opt-${index}-${i}`, label: opt, value: opt.toLowerCase().replace(/\s+/g, '-') }))
      : undefined,
  };
}

async function saveDraftToApi(args: {
  title: string;
  fields: import('../FieldCard').PocField[];
}): Promise<{ ok: boolean; formId?: string }> {
  const response = await fetch('/api/forms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: args.title || 'Untitled Form',
      mode: 'table',
      encryptionMode: 'none',
      fields: args.fields.map((f, i) => pocFieldToApi(f, i)),
      isDraft: true,
    }),
  });
  if (!response.ok) return { ok: false };
  const data = await response.json() as { data?: { id?: string } };
  return { ok: true, formId: data?.data?.id };
}

async function updateDraftInApi(args: {
  formId: string;
  title: string;
  fields: import('../FieldCard').PocField[];
}): Promise<void> {
  await fetch(`/api/forms/${args.formId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: args.title || 'Untitled Form',
      mode: 'table',
      encryptionMode: 'none',
      fields: args.fields.map((f, i) => pocFieldToApi(f, i)),
      isDraft: true,
    }),
  });
}
