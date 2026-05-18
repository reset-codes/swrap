/**
 * draft-session-store — Zustand + persist middleware
 *
 * Persists the last active draft session so the canvas builder can recover
 * after refresh, browser close, or re-navigation.
 *
 * IMPORTANT: This is NOT the source of truth — the DB draftSchema column is.
 * This store only holds the minimum needed to re-open the correct DB record:
 *   - lastDraftFormId  → passed as initialDraftFormId to CanvasBuilderPage
 *   - lastDraftTitle   → shown in the restore banner before DB fetch completes
 *   - lastSavedAt      → lets us warn if the draft is stale (> 24h)
 *
 * On mount, CanvasBuilderPage checks this store when no ?draft= param is in
 * the URL. If a saved ID is found it fetches from the DB first (DB wins over
 * everything). Local-storage field data is only used if the DB fetch fails.
 *
 * Security: only IDs, titles, and timestamps are stored — no field content,
 * no credentials, no encrypted data.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// State + actions
// ---------------------------------------------------------------------------

export interface DraftSessionState {
  /** UUID of the last draft that was saved to the DB. null = no saved draft. */
  lastDraftFormId: string | null;
  /** Title of the last saved draft — for display only, not authoritative. */
  lastDraftTitle: string | null;
  /** ISO 8601 timestamp of the last save. */
  lastSavedAt: string | null;

  /** Record a new draft save event. */
  recordDraftSave(id: string, title: string): void;
  /** Clear the session (e.g. after publish or explicit discard). */
  clearDraftSession(): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDraftSessionStore = create<DraftSessionState>()(
  persist(
    (set) => ({
      lastDraftFormId: null,
      lastDraftTitle: null,
      lastSavedAt: null,

      recordDraftSave(id: string, title: string) {
        set({
          lastDraftFormId: id,
          lastDraftTitle: title || 'Untitled Form',
          lastSavedAt: new Date().toISOString(),
        });
      },

      clearDraftSession() {
        set({
          lastDraftFormId: null,
          lastDraftTitle: null,
          lastSavedAt: null,
        });
      },
    }),
    {
      name: 'swrap-draft-session@1',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          // SSR: no-op storage
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return {
          getItem: (name: string) => {
            try {
              return window.localStorage.getItem(name);
            } catch {
              return null;
            }
          },
          setItem: (name: string, value: string) => {
            try {
              window.localStorage.setItem(name, value);
            } catch {
              // Quota exceeded — best effort
            }
          },
          removeItem: (name: string) => {
            try {
              window.localStorage.removeItem(name);
            } catch {
              // ignore
            }
          },
        };
      }),
    },
  ),
);
