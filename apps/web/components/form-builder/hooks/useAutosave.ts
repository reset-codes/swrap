'use client';

/**
 * useAutosave — subscribes to form content changes (fields + title) and drives
 * the autosave status badge in TopBar.
 *
 * Behaviour:
 *   - Skips the initial mount (ref guard) so the badge stays idle on load.
 *   - On any subsequent change: immediately sets status to 'saving', then after
 *     1500 ms sets it to 'saved'.
 *   - If the dependency changes again before the timer fires, the previous timer
 *     is cancelled via the useEffect cleanup (standard debounce pattern).
 *   - No network calls, no localStorage writes — the Zustand store IS the
 *     in-memory state; Walrus is the durable store (invoked only on explicit Publish).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import { useEffect, useRef } from 'react';
import { useFormBuilderStore } from '../../../stores/form-builder-store';

export function useAutosave(): void {
  const fields = useFormBuilderStore((s) => s.fields);
  const title = useFormBuilderStore((s) => s.title);
  const setAutosaveStatus = useFormBuilderStore((s) => s.setAutosaveStatus);

  // Guard: skip the very first render so the badge stays 'idle' on mount.
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Immediately signal that a save is in progress.
    setAutosaveStatus('saving');

    const timer = setTimeout(() => {
      // Pure in-memory status transition — no I/O.
      setAutosaveStatus('saved');
    }, 1500);

    // Cancel the pending timer if fields/title change again before it fires.
    return () => clearTimeout(timer);
  }, [fields, title, setAutosaveStatus]);
}
