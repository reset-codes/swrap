'use client';

/**
 * usePublish — orchestrates the Walrus publish pipeline for the Canvas_Builder.
 *
 * Responsibilities:
 *   1. Reads form content from `useFormBuilderStore` (fields, title, theme, bannerUrl).
 *   2. Reads `upsertForm` from `useLocalStore` for post-publish indexing.
 *   3. Assembles a `FormSchema` object and runs client-side `FormSchemaSchema.safeParse`.
 *      If validation fails, sets publish status to 'error' with a descriptive message
 *      and returns early — the Walrus pipeline is NOT invoked.
 *   4. Invokes `createForm` from the metadata-client with the serialized schema.
 *   5. On success: calls `upsertForm(blobRow)` then `setPublishStatus('published')`;
 *      shows a success toast.
 *   6. On failure: calls `setPublishStatus('error', message)`; shows an error toast.
 *
 * Security invariants:
 *   - Session token is obtained from `getSessionToken()` — never hardcoded.
 *   - If no session exists, `RequiresReauthError` is caught and surfaced as a
 *     user-visible error toast prompting re-authentication.
 *   - This hook MUST NOT be called during autosave or Save Draft (R13.5).
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 2.8, 2.9, 2.10
 */

import { useFormBuilderStore } from '../../../stores/form-builder-store';
import { useLocalStore } from '../../../stores/local-store';
import { createForm } from '../../../lib/api/metadata-client';
import { getSessionToken, RequiresReauthError } from '../../../lib/auth/auth-client';
import { FormSchemaSchema } from '@poc/shared';
import type { FormSchema } from '@poc/shared';
import { toast } from '../../ui/Toast';

export function usePublish() {
  // ── Store selectors ────────────────────────────────────────────────────
  const fields = useFormBuilderStore((s) => s.fields);
  const title = useFormBuilderStore((s) => s.title);
  const theme = useFormBuilderStore((s) => s.theme);
  const bannerUrl = useFormBuilderStore((s) => s.bannerUrl);
  const setPublishStatus = useFormBuilderStore((s) => s.setPublishStatus);

  // `useLocalStore(s => s.upsertForm)` follows the existing pattern in the
  // old FormBuilderPage — only the publish hook touches useLocalStore.
  const upsertForm = useLocalStore((s) => s.upsertForm);

  async function publish() {
    // ── 1. Assemble FormSchema from store state ─────────────────────────
    const schema: FormSchema = {
      title,
      // Cast is safe: the store validates types via PocField; unknown extras
      // (e.g. a field type not in FieldType) will be caught by safeParse below.
      fields: fields as unknown as FormSchema['fields'],
      version: 1 as const,
      created_at: new Date().toISOString(),
      theme: theme ?? undefined,
      bannerUrl: bannerUrl ?? undefined,
    };

    // ── 2. Client-side validation ───────────────────────────────────────
    const parseResult = FormSchemaSchema.safeParse(schema);
    if (!parseResult.success) {
      // Surface the first validation error to the user as a toast; the caller
      // can inspect publishError for the full message if needed.
      const firstError = parseResult.error.errors[0];
      const errorMessage = firstError
        ? `Validation error: ${firstError.path.join('.') || 'form'} — ${firstError.message}`
        : 'Form validation failed. Please review your fields.';

      setPublishStatus('error', errorMessage);
      toast.error('Cannot publish', {
        description: errorMessage,
      });
      return;
    }

    // ── 3. Begin publishing ─────────────────────────────────────────────
    setPublishStatus('publishing');

    // ── 4. Obtain session token ─────────────────────────────────────────
    let sessionToken: string;
    try {
      sessionToken = await getSessionToken();
    } catch (err) {
      const isReauth = err instanceof RequiresReauthError;
      const message = isReauth
        ? 'Your session has expired. Please sign in again to publish.'
        : err instanceof Error
          ? err.message
          : 'Authentication failed.';

      setPublishStatus('error', message);
      toast.error('Authentication required', {
        description: message,
      });
      return;
    }

    // ── 5. Invoke Walrus pipeline via metadata-client ───────────────────
    try {
      const result = await createForm(
        {
          formDefinition: parseResult.data as unknown as Record<string, unknown>,
          privacyMode: 'public',
        },
        sessionToken,
      );

      if (!result.ok) {
        const message = result.error.message ?? 'Publish failed. Please try again.';
        setPublishStatus('error', message);
        toast.error('Publish failed', {
          description: message,
        });
        return;
      }

      // ── 6. On success: index the form in Local_Store ──────────────────
      const formRow = result.result;
      upsertForm({
        blobId: formRow.walrusBlobId,
        schemaHash: formRow.contentDigest,
        title,
        ownerAddress: formRow.ownerAddress,
        createdAt: formRow.createdAt,
      });

      setPublishStatus('published');
      toast.success('Form published', {
        description: 'Your form is now live on Walrus.',
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred during publish.';
      setPublishStatus('error', message);
      toast.error('Publish failed', {
        description: message,
      });
    }
  }

  return { publish };
}
