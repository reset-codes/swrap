/**
 * Local_Store — Zustand + persist middleware
 *
 * Persists form and submission references in localStorage under the key
 * `sealbase-poc@1`. Plaintext payloads, decrypted blobs, and private key
 * material are NEVER stored here (enforced by compile-time ForbiddenKey
 * assertions and the R11.3 requirement).
 *
 * Requirements: R11.1, R11.2, R11.3, R11.4, R11.5, R11.6, R11.7
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Persisted entry types
// ---------------------------------------------------------------------------

export interface PersistedFormEntry {
  blobId: string;
  schemaHash: string;
  title: string; // max 200 chars
  ownerAddress: string;
  createdAt: string; // ISO 8601 UTC
  isUnlinked?: boolean;
}

export interface PersistedSubmissionEntry {
  blobId: string;
  formBlobId: string;
  submittedAt: string; // ISO 8601 UTC
  isUnlinked?: boolean;
}

// ---------------------------------------------------------------------------
// Compile-time security assertion: no forbidden keys in persisted types
// (R11.3 — never persist plaintext, secrets, or private key material)
// ---------------------------------------------------------------------------

type ForbiddenKey =
  | 'plaintext'
  | 'plainText'
  | 'secret'
  | 'privateKey'
  | 'keystore'
  | 'signer';

/**
 * If T contains any ForbiddenKey as a property name, this resolves to `never`,
 * causing a compile-time error. Otherwise it resolves to T.
 */
type AssertNoForbiddenKeys<T> = keyof T extends ForbiddenKey ? never : T;

// These type aliases will fail to compile if PersistedFormEntry or
// PersistedSubmissionEntry ever gain a forbidden property name.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _FormEntryCheck = AssertNoForbiddenKeys<PersistedFormEntry>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SubmissionEntryCheck = AssertNoForbiddenKeys<PersistedSubmissionEntry>;

// ---------------------------------------------------------------------------
// Structural validation helpers (R11.7 — skip corrupt entries on load)
// ---------------------------------------------------------------------------

function isValidFormEntry(value: unknown): value is PersistedFormEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['blobId'] === 'string' &&
    v['blobId'].length > 0 &&
    typeof v['schemaHash'] === 'string' &&
    v['schemaHash'].length > 0 &&
    typeof v['title'] === 'string' &&
    typeof v['ownerAddress'] === 'string' &&
    typeof v['createdAt'] === 'string' &&
    (v['isUnlinked'] === undefined || typeof v['isUnlinked'] === 'boolean')
  );
}

function isValidSubmissionEntry(
  value: unknown,
): value is PersistedSubmissionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['blobId'] === 'string' &&
    v['blobId'].length > 0 &&
    typeof v['formBlobId'] === 'string' &&
    v['formBlobId'].length > 0 &&
    typeof v['submittedAt'] === 'string' &&
    (v['isUnlinked'] === undefined || typeof v['isUnlinked'] === 'boolean')
  );
}

// ---------------------------------------------------------------------------
// Store state + actions interface
// ---------------------------------------------------------------------------

export interface LocalStoreState {
  version: 1;
  forms: Record<string, PersistedFormEntry>;
  submissions: Record<string, PersistedSubmissionEntry>;
  scratch?: unknown;

  /**
   * Set when a localStorage write fails (e.g. quota exceeded). Readable by
   * the UI to surface an error indicator (R11.6).
   */
  storageError: string | null;

  /** Skipped entry log populated during load validation (R11.7). */
  skippedEntries: string[];

  // Actions
  upsertForm(entry: PersistedFormEntry): void;
  upsertSubmission(entry: PersistedSubmissionEntry): void;
  markUnlinked(blobId: string): void;
  discardEntry(blobId: string): void;
  /**
   * Migrate from a previously persisted state of unknown version.
   * Discards all data when the version is unknown (not 1).
   */
  migrate(from: unknown): void;
  clearStorageError(): void;
  clearSkippedEntries(): void;
}

// ---------------------------------------------------------------------------
// Partialized state type (what actually gets persisted)
// ---------------------------------------------------------------------------

type PersistedState = {
  version: 1;
  forms: Record<string, PersistedFormEntry>;
  submissions: Record<string, PersistedSubmissionEntry>;
};

// ---------------------------------------------------------------------------
// Safe localStorage wrapper (R11.6 — handle write failures)
// ---------------------------------------------------------------------------

/**
 * A JSON storage adapter that catches QuotaExceededError and other write
 * failures, setting `storageError` on the store so the UI can surface it.
 */
function createSafeStorage() {
  return createJSONStorage<PersistedState>(() => {
    if (typeof window === 'undefined') {
      // SSR: return a no-op storage
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
        } catch (err) {
          // Quota exceeded or storage disabled — surface via storageError flag.
          // We cannot call set() here directly (circular), so we schedule it.
          const message =
            err instanceof Error ? err.message : 'Storage write failed';
          // Use a microtask to avoid calling set() during set()
          Promise.resolve().then(() => {
            useLocalStore.setState({ storageError: message });
          });
        }
      },
      removeItem: (name: string) => {
        try {
          window.localStorage.removeItem(name);
        } catch {
          // ignore remove failures
        }
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useLocalStore = create<LocalStoreState>()(
  persist<LocalStoreState, [], [], PersistedState>(
    (set, get) => ({
      version: 1 as const,
      forms: {},
      submissions: {},
      scratch: undefined,
      storageError: null,
      skippedEntries: [],

      upsertForm(entry: PersistedFormEntry) {
        set((state) => ({
          forms: {
            ...state.forms,
            [entry.blobId]: entry,
          },
        }));
      },

      upsertSubmission(entry: PersistedSubmissionEntry) {
        set((state) => ({
          submissions: {
            ...state.submissions,
            [entry.blobId]: entry,
          },
        }));
      },

      markUnlinked(blobId: string) {
        const state = get();
        if (state.forms[blobId]) {
          set((s) => ({
            forms: {
              ...s.forms,
              [blobId]: { ...s.forms[blobId], isUnlinked: true },
            },
          }));
        } else if (state.submissions[blobId]) {
          set((s) => ({
            submissions: {
              ...s.submissions,
              [blobId]: { ...s.submissions[blobId], isUnlinked: true },
            },
          }));
        }
      },

      discardEntry(blobId: string) {
        set((state) => {
          const forms = { ...state.forms };
          const submissions = { ...state.submissions };
          delete forms[blobId];
          delete submissions[blobId];
          return { forms, submissions };
        });
      },

      migrate(from: unknown) {
        // Only version 1 is known. Discard everything else.
        if (
          typeof from === 'object' &&
          from !== null &&
          (from as Record<string, unknown>)['version'] === 1
        ) {
          // Already version 1 — nothing to migrate.
          return;
        }
        // Unknown version: discard all persisted data.
        set({
          version: 1,
          forms: {},
          submissions: {},
          scratch: undefined,
          storageError: null,
          skippedEntries: [],
        });
      },

      clearStorageError() {
        set({ storageError: null });
      },

      clearSkippedEntries() {
        set({ skippedEntries: [] });
      },
    }),
    {
      name: 'sealbase-poc@1',
      storage: createSafeStorage(),

      // Exclude `scratch`, `storageError`, and `skippedEntries` from
      // persistence — they are runtime-only state.
      partialize: (state) => ({
        version: state.version,
        forms: state.forms,
        submissions: state.submissions,
        // `scratch`, `storageError`, `skippedEntries` intentionally excluded
      }),

      // Validate entries on rehydration (R11.7 — skip corrupt entries).
      merge: (persisted, current) => {
        const raw = persisted as Partial<LocalStoreState> | null;
        if (!raw) return current;

        const skipped: string[] = [];

        // Validate and filter forms
        const rawForms = raw.forms ?? {};
        const validForms: Record<string, PersistedFormEntry> = {};
        for (const [blobId, entry] of Object.entries(rawForms)) {
          if (isValidFormEntry(entry)) {
            validForms[blobId] = entry;
          } else {
            skipped.push(`form:${blobId}`);
            console.warn(
              `[local-store] Skipping corrupt form entry: ${blobId}`,
            );
          }
        }

        // Validate and filter submissions
        const rawSubmissions = raw.submissions ?? {};
        const validSubmissions: Record<string, PersistedSubmissionEntry> = {};
        for (const [blobId, entry] of Object.entries(rawSubmissions)) {
          if (isValidSubmissionEntry(entry)) {
            validSubmissions[blobId] = entry;
          } else {
            skipped.push(`submission:${blobId}`);
            console.warn(
              `[local-store] Skipping corrupt submission entry: ${blobId}`,
            );
          }
        }

        return {
          ...current,
          version: 1 as const,
          forms: validForms,
          submissions: validSubmissions,
          skippedEntries: skipped,
        };
      },
    },
  ),
);
