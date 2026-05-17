/**
 * apps/api/services/upload-state-machine.pbt.test.ts
 *
 * Feature: walrus-native-zk-login-architecture
 * Property 25: Upload state machine transition validity and initial state
 * Property 26: Retry from failed is idempotent
 *
 * Validates: Requirements 6.1–6.8, 6.10, 6.11
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createJob,
  transitionState,
  getRetryPoint,
  isOrphan,
  flagOrphan,
  InvalidTransitionError,
  UploadJobNotFoundError,
  ORPHAN_TIMEOUT_MS,
  type UploadState,
  type ArtifactKind,
  type PrivacyMode,
  type UploadJobRow,
  type UploadJobDb,
} from './upload-state-machine';

// ---------------------------------------------------------------------------
// In-memory DB stub
// ---------------------------------------------------------------------------

function makeDb(initial?: UploadJobRow): UploadJobDb {
  const store = new Map<string, UploadJobRow>();
  if (initial) store.set(initial.id, initial);

  return {
    async createUploadJob(row) {
      const now = new Date().toISOString();
      const full: UploadJobRow = { ...row, createdAt: now, updatedAt: now };
      store.set(full.id, full);
      return full;
    },
    async getUploadJob(jobId) {
      return store.get(jobId);
    },
    async updateUploadJobState(jobId, _from, to, updates) {
      const existing = store.get(jobId);
      if (!existing) throw new UploadJobNotFoundError(jobId);
      const updated: UploadJobRow = {
        ...existing,
        ...updates,
        state: to,
        updatedAt: new Date().toISOString(),
      };
      store.set(jobId, updated);
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const artifactKindArb = fc.constantFrom<ArtifactKind>('form', 'submission', 'file');
const privacyModeArb = fc.constantFrom<PrivacyMode>('public', 'private');
const addressArb = fc.stringMatching(/^[0-9a-f]{40,64}$/).map((h) => `0x${h}`);

// All declared valid transitions as (from, to) pairs
const VALID_TRANSITIONS: Array<[UploadState, UploadState]> = [
  ['pending', 'encrypting'],
  ['pending', 'uploading'],
  ['pending', 'failed'],
  ['encrypting', 'uploading'],
  ['encrypting', 'failed'],
  ['uploading', 'uploaded'],
  ['uploading', 'failed'],
  ['uploaded', 'indexed'],
  ['uploaded', 'failed'],
  ['failed', 'pending'],
];

const ALL_STATES: UploadState[] = [
  'pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed',
];

// ---------------------------------------------------------------------------
// Property 25: Upload state machine transition validity and initial state
// ---------------------------------------------------------------------------

describe('Property 25: Upload state machine transition validity and initial state', () => {
  it('Property 25a: every new job starts in pending state', async () => {
    await fc.assert(
      fc.asyncProperty(
        addressArb,
        artifactKindArb,
        privacyModeArb,
        async (ownerAddress, artifactKind, privacyMode) => {
          const db = makeDb();
          const job = await createJob(ownerAddress, artifactKind, privacyMode, db);
          expect(job.state).toBe('pending');
          expect(job.ownerAddress).toBe(ownerAddress);
          expect(job.artifactKind).toBe(artifactKind);
          expect(job.privacyMode).toBe(privacyMode);
          expect(job.isOrphan).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Property 25b: all declared transitions succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...VALID_TRANSITIONS),
        addressArb,
        async ([from, to], ownerAddress) => {
          const db = makeDb();
          const job = await createJob(ownerAddress, 'form', 'public', db);

          // Force the job into the `from` state by direct store manipulation
          const forcedJob: UploadJobRow = {
            ...job,
            state: from,
            updatedAt: new Date().toISOString(),
          };
          const forcedDb = makeDb(forcedJob);

          const result = await transitionState(forcedJob.id, from, to, forcedDb);
          expect(result.state).toBe(to);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 25c: undeclared transitions throw InvalidTransitionError', async () => {
    const validSet = new Set(VALID_TRANSITIONS.map(([f, t]) => `${f}→${t}`));

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_STATES),
        fc.constantFrom(...ALL_STATES),
        addressArb,
        async (from, to, ownerAddress) => {
          if (validSet.has(`${from}→${to}`)) return; // skip valid transitions

          const db = makeDb();
          const job = await createJob(ownerAddress, 'form', 'public', db);
          const forcedJob: UploadJobRow = {
            ...job,
            state: from,
            updatedAt: new Date().toISOString(),
          };
          const forcedDb = makeDb(forcedJob);

          await expect(
            transitionState(forcedJob.id, from, to, forcedDb),
          ).rejects.toThrow(InvalidTransitionError);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 25d: transitionState throws UploadJobNotFoundError for unknown job', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (unknownId) => {
          const db = makeDb();
          await expect(
            transitionState(unknownId, 'pending', 'uploading', db),
          ).rejects.toThrow(UploadJobNotFoundError);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Property 25e: transitionState throws if current state does not match from', async () => {
    await fc.assert(
      fc.asyncProperty(
        addressArb,
        async (ownerAddress) => {
          const db = makeDb();
          const job = await createJob(ownerAddress, 'form', 'public', db);
          // Job is in 'pending'; try to transition from 'uploading' (wrong from)
          await expect(
            transitionState(job.id, 'uploading', 'uploaded', db),
          ).rejects.toThrow(InvalidTransitionError);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 26: Retry from failed is idempotent
// ---------------------------------------------------------------------------

describe('Property 26: Retry from failed is idempotent', () => {
  it('Property 26a: getRetryPoint returns uploaded when blobId exists', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        addressArb,
        (blobId, ownerAddress) => {
          const job: UploadJobRow = {
            id: 'test-id',
            ownerAddress,
            artifactKind: 'submission',
            privacyMode: 'private',
            state: 'failed',
            blobId,
            isOrphan: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          expect(getRetryPoint(job)).toBe('uploaded');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 26b: getRetryPoint returns pending when no blobId', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PrivacyMode>('public', 'private'),
        addressArb,
        (privacyMode, ownerAddress) => {
          const job: UploadJobRow = {
            id: 'test-id',
            ownerAddress,
            artifactKind: 'form',
            privacyMode,
            state: 'failed',
            isOrphan: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          expect(getRetryPoint(job)).toBe('pending');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 26c: multiple retries from same recovery point produce same final state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        addressArb,
        async (retryCount, ownerAddress) => {
          // Simulate a failed job with a blobId (retry from uploaded)
          const blobId = 'test-blob-id';
          const results: UploadState[] = [];

          for (let i = 0; i < retryCount; i++) {
            const db = makeDb();
            const job = await createJob(ownerAddress, 'submission', 'private', db);

            // Force to failed state with blobId
            const failedJob: UploadJobRow = {
              ...job,
              state: 'failed',
              blobId,
              updatedAt: new Date().toISOString(),
            };
            const failedDb = makeDb(failedJob);

            // Retry: failed → pending
            const retried = await transitionState(failedJob.id, 'failed', 'pending', failedDb);
            results.push(retried.state);
          }

          // All retries should produce the same state
          expect(new Set(results).size).toBe(1);
          expect(results[0]).toBe('pending');
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Orphan detection tests
// ---------------------------------------------------------------------------

describe('Orphan detection', () => {
  it('isOrphan returns false for non-uploaded states', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<UploadState>('pending', 'encrypting', 'uploading', 'indexed', 'failed'),
        addressArb,
        (state, ownerAddress) => {
          const job: UploadJobRow = {
            id: 'test-id',
            ownerAddress,
            artifactKind: 'form',
            privacyMode: 'public',
            state,
            isOrphan: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          expect(isOrphan(job)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isOrphan returns false for recently uploaded jobs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: ORPHAN_TIMEOUT_MS - 1 }),
        addressArb,
        (ageMs, ownerAddress) => {
          const updatedAt = new Date(Date.now() - ageMs).toISOString();
          const job: UploadJobRow = {
            id: 'test-id',
            ownerAddress,
            artifactKind: 'form',
            privacyMode: 'public',
            state: 'uploaded',
            isOrphan: false,
            createdAt: updatedAt,
            updatedAt,
          };
          expect(isOrphan(job)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isOrphan returns true for uploaded jobs past the timeout', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: ORPHAN_TIMEOUT_MS + 1, max: ORPHAN_TIMEOUT_MS * 10 }),
        addressArb,
        (ageMs, ownerAddress) => {
          const updatedAt = new Date(Date.now() - ageMs).toISOString();
          const job: UploadJobRow = {
            id: 'test-id',
            ownerAddress,
            artifactKind: 'form',
            privacyMode: 'public',
            state: 'uploaded',
            isOrphan: false,
            createdAt: updatedAt,
            updatedAt,
          };
          expect(isOrphan(job)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('flagOrphan marks uploaded jobs past timeout as orphans', async () => {
    await fc.assert(
      fc.asyncProperty(
        addressArb,
        async (ownerAddress) => {
          const oldTime = new Date(Date.now() - ORPHAN_TIMEOUT_MS * 2).toISOString();
          const job: UploadJobRow = {
            id: 'orphan-job',
            ownerAddress,
            artifactKind: 'submission',
            privacyMode: 'private',
            state: 'uploaded',
            blobId: 'some-blob',
            isOrphan: false,
            createdAt: oldTime,
            updatedAt: oldTime,
          };
          const db = makeDb(job);
          const result = await flagOrphan(job.id, db);
          expect(result.isOrphan).toBe(true);
          expect(result.state).toBe('uploaded');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('flagOrphan does not mark recently uploaded jobs as orphans', async () => {
    await fc.assert(
      fc.asyncProperty(
        addressArb,
        async (ownerAddress) => {
          const recentTime = new Date(Date.now() - 1000).toISOString();
          const job: UploadJobRow = {
            id: 'recent-job',
            ownerAddress,
            artifactKind: 'form',
            privacyMode: 'public',
            state: 'uploaded',
            blobId: 'some-blob',
            isOrphan: false,
            createdAt: recentTime,
            updatedAt: recentTime,
          };
          const db = makeDb(job);
          const result = await flagOrphan(job.id, db);
          expect(result.isOrphan).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
