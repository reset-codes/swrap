'use client';

/**
 * useAutosave — debounced autosave to localStorage + API.
 *
 * Watches form fields + title. On any change (after initial mount):
 *   1. Sets status to 'saving'
 *   2. After 1200ms debounce:
 *      a. Writes to localStorage (always — offline safety net)
 *      b. If draftFormId exists: PUT /api/forms/:id (DB sync)
 *         If no draftFormId yet: localStorage-only (first save requires explicit Save Draft)
 *   3. On success: sets 'saved'
 *   4. On failure: sets 'error'
 *
 * Requirements: Phase 1 Task 6 (autosave UX)
 */

import { useEffect, useRef, useCallback } from 'react';
import { useFormBuilderStore } from '../../../stores/form-builder-store';
import { useDraftSessionStore } from '../../../stores/draft-session-store';
import type { PocField } from '../FieldCard';

const DRAFT_KEY = 'swrap-builder-draft@1';
const DEBOUNCE_MS = 1200;

function mapFieldType(type: string): string {
  const map: Record<string, string> = {
    text: 'short_text', textarea: 'long_text', number: 'short_text',
    email: 'short_text', phone: 'short_text', url: 'url',
    select: 'dropdown', checkbox: 'checkbox', star_rating: 'star_rating',
    wallet_address: 'short_text', file_upload: 'file_upload', image_upload: 'image_upload',
  };
  return map[type] ?? 'short_text';
}

function pocFieldToApiField(f: PocField, index: number) {
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

export function useAutosave(): void {
  const fields = useFormBuilderStore((s) => s.fields);
  const title = useFormBuilderStore((s) => s.title);
  const draftFormId = useFormBuilderStore((s) => s.draftFormId);
  const setAutosaveStatus = useFormBuilderStore((s) => s.setAutosaveStatus);
  const setSyncStatus = useFormBuilderStore((s) => s.setSyncStatus);
  const incrementDraftVersion = useFormBuilderStore((s) => s.incrementDraftVersion);
  const recordDraftSave = useDraftSessionStore((s) => s.recordDraftSave);

  // Stable ref for draftFormId to avoid re-triggering the effect on ID change
  const draftFormIdRef = useRef<string | null>(draftFormId);
  useEffect(() => { draftFormIdRef.current = draftFormId; }, [draftFormId]);

  // Stable ref for recordDraftSave (stable function reference from Zustand)
  const recordDraftSaveRef = useRef(recordDraftSave);
  useEffect(() => { recordDraftSaveRef.current = recordDraftSave; }, [recordDraftSave]);

  // Skip first render
  const isInitialMount = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequenceRef = useRef<number>(0);

  const doAutosave = useCallback(
    async (currentTitle: string, currentFields: PocField[], currentSequence: number) => {
      const nextVersion = useFormBuilderStore.getState().draftVersion;

      // 1. Always write to localStorage (instant, offline-safe)
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            title: currentTitle,
            fields: currentFields,
            savedAt: new Date().toISOString(),
            version: 1,
            draftVersion: nextVersion,
            syncStatus: draftFormIdRef.current ? 'syncing' : 'local-only',
          }),
        );
        if (currentSequence === sequenceRef.current) {
          setSyncStatus(draftFormIdRef.current ? 'syncing' : 'local-only', new Date().toISOString());
        }
      } catch {
        // Quota exceeded — ignore
      }

      // 2. If we have a draftFormId, sync to the API too
      const formId = draftFormIdRef.current;
      if (!formId) {
        // No DB record yet — localStorage is the only fallback until explicit save
        if (currentSequence === sequenceRef.current) {
          setAutosaveStatus('saved');
        }
        return;
      }

      try {
        const response = await fetch(`/api/forms/${formId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: currentTitle || 'Untitled Form',
            mode: 'table' as const,
            encryptionMode: 'none' as const,
            fields: currentFields.map((f, i) => pocFieldToApiField(f, i)),
            isDraft: true,
          }),
        });

        // Verify sequence is still current
        if (currentSequence !== sequenceRef.current) {
          return;
        }

        if (response.ok) {
          // Keep session store in sync with the latest title
          recordDraftSaveRef.current(formId, currentTitle || 'Untitled Form');
          setSyncStatus('synced', new Date().toISOString());
          setAutosaveStatus('saved');

          // Update local storage to synced status
          try {
            localStorage.setItem(
              DRAFT_KEY,
              JSON.stringify({
                title: currentTitle,
                fields: currentFields,
                savedAt: new Date().toISOString(),
                version: 1,
                draftVersion: nextVersion,
                syncStatus: 'synced',
              }),
            );
          } catch {}
        } else if (response.status === 401) {
          // Session expired — still saved locally
          setSyncStatus('local-only');
          setAutosaveStatus('saved');
        } else {
          setSyncStatus('sync-failed');
          setAutosaveStatus('error');
        }
      } catch {
        // Network error — localStorage succeeded
        if (currentSequence === sequenceRef.current) {
          setSyncStatus('sync-failed');
          setAutosaveStatus('error');
        }
      }
    },
    [setAutosaveStatus, setSyncStatus, recordDraftSaveRef],
  );

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setAutosaveStatus('saving');
    setSyncStatus('syncing');

    if (timerRef.current) clearTimeout(timerRef.current);

    // Capture current values for the debounced callback
    const capturedTitle = title;
    const capturedFields = fields;

    timerRef.current = setTimeout(() => {
      incrementDraftVersion();
      const currentSequence = ++sequenceRef.current;

      doAutosave(capturedTitle, capturedFields, currentSequence).catch(() => {
        if (currentSequence === sequenceRef.current) {
          setAutosaveStatus('error');
          setSyncStatus('sync-failed');
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fields, title, setAutosaveStatus, setSyncStatus, incrementDraftVersion, doAutosave]);

  // Auto-retry when connection comes back online
  useEffect(() => {
    function handleOnline() {
      const formId = draftFormIdRef.current;
      const status = useFormBuilderStore.getState().syncStatus;
      if (formId && status === 'sync-failed') {
        console.log('[Autosave] Browser online, triggering auto-retry sync...');
        setAutosaveStatus('saving');
        setSyncStatus('syncing');
        const currentSequence = ++sequenceRef.current;
        doAutosave(title, fields, currentSequence).catch(() => {
          if (currentSequence === sequenceRef.current) {
            setAutosaveStatus('error');
            setSyncStatus('sync-failed');
          }
        });
      }
    }

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [fields, title, doAutosave, setAutosaveStatus, setSyncStatus]);
}
