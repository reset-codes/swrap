'use client';

/**
 * useAutosave — debounced autosave to localStorage.
 *
 * Watches form fields + title. On any change (after initial mount):
 *   1. Sets status to 'saving'
 *   2. After 1200ms debounce, writes to localStorage
 *   3. On success: sets 'saved'
 *   4. On failure: sets 'error'
 *
 * The debounce timer is cancelled if content changes again before it fires,
 * preventing excessive writes on rapid keystrokes.
 *
 * Requirements: Phase 1 Task 6 (autosave UX)
 */

import { useEffect, useRef } from 'react';
import { useFormBuilderStore } from '../../../stores/form-builder-store';

const DRAFT_KEY = 'swrap-builder-draft@1';
const DEBOUNCE_MS = 1200;

export function useAutosave(): void {
  const fields = useFormBuilderStore((s) => s.fields);
  const title = useFormBuilderStore((s) => s.title);
  const setAutosaveStatus = useFormBuilderStore((s) => s.setAutosaveStatus);

  // Skip first render
  const isInitialMount = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setAutosaveStatus('saving');

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      try {
        const payload = JSON.stringify({ title, fields, savedAt: new Date().toISOString() });
        localStorage.setItem(DRAFT_KEY, payload);
        setAutosaveStatus('saved');
      } catch {
        setAutosaveStatus('error');
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fields, title, setAutosaveStatus]);
}
