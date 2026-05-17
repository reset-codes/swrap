'use client';

/**
 * useUndoRedoKeys — global keyboard shortcut handler for undo/redo.
 *
 * Shortcuts:
 *   Ctrl/Cmd + Z             → undo()
 *   Ctrl/Cmd + Shift + Z     → redo()
 *   Ctrl/Cmd + Y             → redo()  (Windows convention)
 *
 * All matched shortcuts call preventDefault() to prevent the browser's native
 * text-field undo/redo from interfering with the store's undo/redo.
 *
 * The event listener is added to `window` on mount and removed on unmount.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import { useEffect } from 'react';
import { useFormBuilderStore } from '../../../stores/form-builder-store';

export function useUndoRedoKeys(): void {
  const undo = useFormBuilderStore((s) => s.undo);
  const redo = useFormBuilderStore((s) => s.redo);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (e.key === 'z' && !e.shiftKey) {
        // Ctrl/Cmd + Z → undo
        e.preventDefault();
        undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        // Ctrl/Cmd + Shift + Z  OR  Ctrl/Cmd + Y → redo
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);
}
