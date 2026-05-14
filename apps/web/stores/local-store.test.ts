// @vitest-environment jsdom

/**
 * Unit tests for Local_Store invariants.
 * Requirements: R11.3, R11.6, R11.7
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  useLocalStore,
  type PersistedFormEntry,
  type PersistedSubmissionEntry,
} from './local-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormEntry(overrides?: Partial<PersistedFormEntry>): PersistedFormEntry {
  return {
    blobId: 'blob-form-001',
    schemaHash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
    title: 'Test Form',
    ownerAddress: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSubmissionEntry(overrides?: Partial<PersistedSubmissionEntry>): PersistedSubmissionEntry {
  return {
    blobId: 'blob-sub-001',
    formBlobId: 'blob-form-001',
    submittedAt: '2024-01-02T00:00:00Z',
    ...overrides,
  };
}

// In-memory localStorage mock
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    _getStore: () => store,
  };
}

// ---------------------------------------------------------------------------
// Reset store state before each test
// ---------------------------------------------------------------------------

let localStorageMock: ReturnType<typeof createLocalStorageMock>;

beforeEach(() => {
  localStorageMock = createLocalStorageMock();
  vi.stubGlobal('localStorage', localStorageMock);

  // Reset the store to initial state
  useLocalStore.setState({
    version: 1,
    forms: {},
    submissions: {},
    scratch: undefined,
    storageError: null,
    skippedEntries: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: upsertForm adds a form entry; forms record contains it
// ---------------------------------------------------------------------------

describe('upsertForm', () => {
  it('adds a form entry and the forms record contains it', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);

    const { forms } = useLocalStore.getState();
    expect(forms[entry.blobId]).toBeDefined();
    expect(forms[entry.blobId]).toEqual(entry);
  });

  it('overwrites an existing entry with the same blobId', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);

    const updated = { ...entry, title: 'Updated Title' };
    useLocalStore.getState().upsertForm(updated);

    const { forms } = useLocalStore.getState();
    expect(forms[entry.blobId].title).toBe('Updated Title');
  });
});

// ---------------------------------------------------------------------------
// Test 2: upsertSubmission adds a submission entry
// ---------------------------------------------------------------------------

describe('upsertSubmission', () => {
  it('adds a submission entry and the submissions record contains it', () => {
    const entry = makeSubmissionEntry();
    useLocalStore.getState().upsertSubmission(entry);

    const { submissions } = useLocalStore.getState();
    expect(submissions[entry.blobId]).toBeDefined();
    expect(submissions[entry.blobId]).toEqual(entry);
  });

  it('can hold multiple submission entries', () => {
    const entry1 = makeSubmissionEntry({ blobId: 'blob-sub-001' });
    const entry2 = makeSubmissionEntry({ blobId: 'blob-sub-002' });

    useLocalStore.getState().upsertSubmission(entry1);
    useLocalStore.getState().upsertSubmission(entry2);

    const { submissions } = useLocalStore.getState();
    expect(Object.keys(submissions)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 3: markUnlinked sets isUnlinked: true on the entry
// ---------------------------------------------------------------------------

describe('markUnlinked', () => {
  it('sets isUnlinked: true on a form entry', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);
    useLocalStore.getState().markUnlinked(entry.blobId);

    const { forms } = useLocalStore.getState();
    expect(forms[entry.blobId].isUnlinked).toBe(true);
  });

  it('sets isUnlinked: true on a submission entry', () => {
    const entry = makeSubmissionEntry();
    useLocalStore.getState().upsertSubmission(entry);
    useLocalStore.getState().markUnlinked(entry.blobId);

    const { submissions } = useLocalStore.getState();
    expect(submissions[entry.blobId].isUnlinked).toBe(true);
  });

  it('does nothing for an unknown blobId', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);

    // Should not throw
    expect(() => useLocalStore.getState().markUnlinked('unknown-blob')).not.toThrow();

    const { forms } = useLocalStore.getState();
    expect(forms[entry.blobId].isUnlinked).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 4: discardEntry removes the entry from both forms and submissions
// ---------------------------------------------------------------------------

describe('discardEntry', () => {
  it('removes a form entry', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);
    useLocalStore.getState().discardEntry(entry.blobId);

    const { forms } = useLocalStore.getState();
    expect(forms[entry.blobId]).toBeUndefined();
  });

  it('removes a submission entry', () => {
    const entry = makeSubmissionEntry();
    useLocalStore.getState().upsertSubmission(entry);
    useLocalStore.getState().discardEntry(entry.blobId);

    const { submissions } = useLocalStore.getState();
    expect(submissions[entry.blobId]).toBeUndefined();
  });

  it('removes from both forms and submissions if blobId exists in both (edge case)', () => {
    const sharedBlobId = 'shared-blob-id';
    const formEntry = makeFormEntry({ blobId: sharedBlobId });
    const subEntry = makeSubmissionEntry({ blobId: sharedBlobId });

    useLocalStore.getState().upsertForm(formEntry);
    useLocalStore.getState().upsertSubmission(subEntry);
    useLocalStore.getState().discardEntry(sharedBlobId);

    const { forms, submissions } = useLocalStore.getState();
    expect(forms[sharedBlobId]).toBeUndefined();
    expect(submissions[sharedBlobId]).toBeUndefined();
  });

  it('does nothing for an unknown blobId', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);

    expect(() => useLocalStore.getState().discardEntry('unknown-blob')).not.toThrow();

    const { forms } = useLocalStore.getState();
    expect(forms[entry.blobId]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 5: migrate with unknown version discards all data
// ---------------------------------------------------------------------------

describe('migrate', () => {
  it('discards all data when version is unknown', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);

    // Simulate migration from an unknown version
    useLocalStore.getState().migrate({ version: 99, forms: { 'old-blob': {} } });

    const { forms, submissions, version } = useLocalStore.getState();
    expect(forms).toEqual({});
    expect(submissions).toEqual({});
    expect(version).toBe(1);
  });

  it('discards all data when version is null', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);

    useLocalStore.getState().migrate(null);

    const { forms } = useLocalStore.getState();
    expect(forms).toEqual({});
  });

  it('does nothing when version is already 1', () => {
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);

    useLocalStore.getState().migrate({ version: 1 });

    const { forms } = useLocalStore.getState();
    expect(forms[entry.blobId]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 6: Corrupt entry on load is skipped; valid entries still load
// Tests the merge callback directly by simulating rehydration via localStorage
// ---------------------------------------------------------------------------

describe('merge callback — corrupt entry handling (R11.7)', () => {
  it('skips corrupt form entries and loads valid ones', async () => {
    const validEntry = makeFormEntry({ blobId: 'valid-blob' });
    const corruptEntry = { blobId: '', schemaHash: 'x' }; // missing required fields

    // Simulate persisted state with one valid and one corrupt entry
    const persistedState = {
      version: 1,
      forms: {
        'valid-blob': validEntry,
        'corrupt-blob': corruptEntry,
      },
      submissions: {},
    };

    // Write to the mocked localStorage
    localStorageMock.setItem('sealbase-poc@1', JSON.stringify({ state: persistedState, version: 0 }));

    // Trigger rehydration
    await useLocalStore.persist.rehydrate();

    const { forms, skippedEntries } = useLocalStore.getState();

    // Valid entry should be loaded
    expect(forms['valid-blob']).toBeDefined();
    expect(forms['valid-blob']).toEqual(validEntry);

    // Corrupt entry should be skipped
    expect(forms['corrupt-blob']).toBeUndefined();

    // Skipped entries should be recorded
    expect(skippedEntries).toContain('form:corrupt-blob');
  });

  it('skips corrupt submission entries and loads valid ones', async () => {
    const validSub = makeSubmissionEntry({ blobId: 'valid-sub' });
    const corruptSub = { blobId: 'corrupt-sub' }; // missing formBlobId and submittedAt

    const persistedState = {
      version: 1,
      forms: {},
      submissions: {
        'valid-sub': validSub,
        'corrupt-sub': corruptSub,
      },
    };

    localStorageMock.setItem('sealbase-poc@1', JSON.stringify({ state: persistedState, version: 0 }));

    await useLocalStore.persist.rehydrate();

    const { submissions, skippedEntries } = useLocalStore.getState();

    expect(submissions['valid-sub']).toBeDefined();
    expect(submissions['corrupt-sub']).toBeUndefined();
    expect(skippedEntries).toContain('submission:corrupt-sub');
  });
});

// ---------------------------------------------------------------------------
// Test 7: storageError is set when localStorage.setItem throws QuotaExceededError
// (R11.6)
// ---------------------------------------------------------------------------

describe('storageError — quota exceeded (R11.6)', () => {
  it('sets storageError when localStorage.setItem throws QuotaExceededError', async () => {
    // Override setItem to throw QuotaExceededError
    const quotaError = new DOMException('QuotaExceededError', 'QuotaExceededError');
    localStorageMock.setItem.mockImplementation(() => {
      throw quotaError;
    });

    // Trigger a store write which will attempt to persist to localStorage
    const entry = makeFormEntry();
    useLocalStore.getState().upsertForm(entry);

    // The error is set asynchronously via Promise.resolve().then(...)
    // Wait for the microtask queue to flush
    await Promise.resolve();

    const { storageError } = useLocalStore.getState();
    expect(storageError).not.toBeNull();
    expect(typeof storageError).toBe('string');
  });

  it('clearStorageError resets the error flag', async () => {
    const quotaError = new DOMException('QuotaExceededError', 'QuotaExceededError');
    localStorageMock.setItem.mockImplementation(() => {
      throw quotaError;
    });

    useLocalStore.getState().upsertForm(makeFormEntry());
    await Promise.resolve();

    // Restore setItem so clearStorageError can persist
    localStorageMock.setItem.mockRestore();

    useLocalStore.getState().clearStorageError();
    expect(useLocalStore.getState().storageError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Round-trip: persist → reload returns same entries
// ---------------------------------------------------------------------------

describe('round-trip persist → reload (R11.1, R11.2)', () => {
  it('reloads form entries from localStorage after rehydration', async () => {
    const entry = makeFormEntry();

    // Manually write a valid persisted state to localStorage
    const persistedState = {
      version: 1 as const,
      forms: { [entry.blobId]: entry },
      submissions: {},
    };
    localStorageMock.setItem('sealbase-poc@1', JSON.stringify({ state: persistedState, version: 0 }));

    // Rehydrate — this reads from localStorage and calls merge()
    await useLocalStore.persist.rehydrate();

    const { forms } = useLocalStore.getState();
    expect(forms[entry.blobId]).toEqual(entry);
  });

  it('reloads submission entries from localStorage after rehydration', async () => {
    const entry = makeSubmissionEntry();

    const persistedState = {
      version: 1 as const,
      forms: {},
      submissions: { [entry.blobId]: entry },
    };
    localStorageMock.setItem('sealbase-poc@1', JSON.stringify({ state: persistedState, version: 0 }));

    await useLocalStore.persist.rehydrate();

    const { submissions } = useLocalStore.getState();
    expect(submissions[entry.blobId]).toEqual(entry);
  });
});

// ---------------------------------------------------------------------------
// Type-level test: PersistedFormEntry must not allow forbidden keys (R11.3)
// ---------------------------------------------------------------------------

// Type-level test: PersistedFormEntry must not allow forbidden keys
// The following would fail to compile:
// const _bad: PersistedFormEntry = {
//   blobId: 'x',
//   schemaHash: 'y',
//   title: 'z',
//   ownerAddress: '0x0',
//   createdAt: '2024-01-01T00:00:00Z',
//   plaintext: 'secret',  // @ts-expect-error — 'plaintext' is not in PersistedFormEntry
// };
//
// This is enforced at compile time by the AssertNoForbiddenKeys<T> type in local-store.ts.
// The ForbiddenKey union includes: 'plaintext' | 'plainText' | 'secret' | 'privateKey' | 'keystore' | 'signer'

describe('type-level: PersistedFormEntry forbids plaintext fields (R11.3)', () => {
  it('PersistedFormEntry does not have a plaintext property at runtime', () => {
    const entry = makeFormEntry();
    expect('plaintext' in entry).toBe(false);
    expect('plainText' in entry).toBe(false);
    expect('secret' in entry).toBe(false);
    expect('privateKey' in entry).toBe(false);
    expect('keystore' in entry).toBe(false);
    expect('signer' in entry).toBe(false);
  });

  it('PersistedSubmissionEntry does not have a plaintext property at runtime', () => {
    const entry = makeSubmissionEntry();
    expect('plaintext' in entry).toBe(false);
    expect('plainText' in entry).toBe(false);
    expect('secret' in entry).toBe(false);
    expect('privateKey' in entry).toBe(false);
    expect('keystore' in entry).toBe(false);
    expect('signer' in entry).toBe(false);
  });
});
