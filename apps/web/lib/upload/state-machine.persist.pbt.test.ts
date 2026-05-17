/**
 * Property-based tests for Upload_Job state persistence round-trip
 *
 * **Validates: Requirements 6.14**
 *
 * Property 27: Upload_Job state persistence round-trip
 *   - For any generated sequence of state machine transitions, persisting every
 *     transition to IndexedDB and reloading produces a state machine whose state,
 *     blob ID, digest, and policy ID equal the originals.
 *
 * Uses `fast-check` for property-based testing with `fake-indexeddb/auto` for
 * IndexedDB simulation.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  createJob,
  transition,
  InvalidTransitionError,
  type UploadState,
  type UploadEvent,
  type ArtifactKind,
  type PrivacyMode,
  type UploadJob,
} from './upload-state-machine';
import { persistJob, resume, getJob, clearAll, resetDbConnection } from './upload-persistence';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_EVENTS: UploadEvent[] = [
  'START_ENCRYPT',
  'START_UPLOAD',
  'UPLOAD_SUCCESS',
  'INDEX_SUCCESS',
  'FAIL',
  'RETRY',
];

const ALL_ARTIFACT_KINDS: ArtifactKind[] = ['form', 'submission', 'file'];
const ALL_PRIVACY_MODES: PrivacyMode[] = ['public', 'private'];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const artifactKindArb: fc.Arbitrary<ArtifactKind> = fc.constantFrom(...ALL_ARTIFACT_KINDS);
const privacyModeArb: fc.Arbitrary<PrivacyMode> = fc.constantFrom(...ALL_PRIVACY_MODES);
const uploadEventArb: fc.Arbitrary<UploadEvent> = fc.constantFrom(...ALL_EVENTS);
const formIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 36 });

/**
 * Generates a random sequence of events to apply to a job.
 */
const eventSequenceArb: fc.Arbitrary<UploadEvent[]> = fc.array(uploadEventArb, {
  minLength: 1,
  maxLength: 20,
});

/**
 * Generates optional metadata fields that might be set on a job during transitions.
 */
const blobIdArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.string({ minLength: 5, maxLength: 40 }),
  { nil: undefined },
);
const digestArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.string({ minLength: 10, maxLength: 64 }),
  { nil: undefined },
);
const policyIdArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.string({ minLength: 5, maxLength: 40 }),
  { nil: undefined },
);
const sizeBytesArb: fc.Arbitrary<number | undefined> = fc.option(
  fc.integer({ min: 1, max: 10_000_000 }),
  { nil: undefined },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Applies a sequence of events to a job, persisting at each step.
 * Invalid transitions are caught and skipped.
 * Returns the final job after all valid transitions.
 */
async function applyAndPersistSequence(
  initialJob: UploadJob,
  events: UploadEvent[],
): Promise<UploadJob> {
  let currentJob = initialJob;
  await persistJob(currentJob);

  for (const event of events) {
    try {
      const nextJob = transition(currentJob, event);
      currentJob = nextJob;
      await persistJob(currentJob);
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        // Invalid transition — skip, state unchanged
        continue;
      }
      throw e;
    }
  }

  return currentJob;
}

/**
 * Applies metadata fields to a job (simulating what happens during real transitions).
 */
function withMetadata(
  job: UploadJob,
  meta: { blobId?: string; digest?: string; policyId?: string; sizeBytes?: number },
): UploadJob {
  return {
    ...job,
    ...(meta.blobId !== undefined && { blobId: meta.blobId }),
    ...(meta.digest !== undefined && { digest: meta.digest }),
    ...(meta.policyId !== undefined && { policyId: meta.policyId }),
    ...(meta.sizeBytes !== undefined && { sizeBytes: meta.sizeBytes }),
  };
}

// ---------------------------------------------------------------------------
// Property 27: Upload_Job state persistence round-trip
// ---------------------------------------------------------------------------

describe('Property 27: Upload_Job state persistence round-trip', () => {
  beforeEach(async () => {
    resetDbConnection();
    await clearAll();
  });

  /**
   * **Validates: Requirements 6.14**
   *
   * For any generated sequence of state machine transitions, persisting every
   * transition to IndexedDB and reloading via getJob produces a job whose
   * state equals the original.
   */
  it('Property 27a: persisted state equals original state after transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        eventSequenceArb,
        async (kind, formId, privacy, events) => {
          resetDbConnection();
          await clearAll();

          const job = createJob(kind, formId, privacy);
          const finalJob = await applyAndPersistSequence(job, events);

          // Reload from IndexedDB
          const loaded = await getJob(finalJob.id);
          expect(loaded).toBeDefined();
          expect(loaded!.state).toBe(finalJob.state);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.14**
   *
   * For any generated sequence of transitions with metadata set at various
   * points, persisting and reloading preserves blobId, digest, and policyId.
   */
  it('Property 27b: persisted metadata (blobId, digest, policyId) equals originals', async () => {
    await fc.assert(
      fc.asyncProperty(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        eventSequenceArb,
        blobIdArb,
        digestArb,
        policyIdArb,
        sizeBytesArb,
        async (kind, formId, privacy, events, blobId, digest, policyId, sizeBytes) => {
          resetDbConnection();
          await clearAll();

          const job = createJob(kind, formId, privacy);
          let currentJob = await applyAndPersistSequence(job, events);

          // Apply metadata to the final job and persist
          currentJob = withMetadata(currentJob, { blobId, digest, policyId, sizeBytes });
          await persistJob(currentJob);

          // Reload from IndexedDB
          const loaded = await getJob(currentJob.id);
          expect(loaded).toBeDefined();
          expect(loaded!.blobId).toBe(currentJob.blobId);
          expect(loaded!.digest).toBe(currentJob.digest);
          expect(loaded!.policyId).toBe(currentJob.policyId);
          expect(loaded!.sizeBytes).toBe(currentJob.sizeBytes);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.14**
   *
   * For any generated sequence of transitions, persisting every transition
   * and calling resume() returns a list containing a job whose state, blobId,
   * digest, and policyId equal the originals.
   */
  it('Property 27c: resume() round-trip preserves state and metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        eventSequenceArb,
        blobIdArb,
        digestArb,
        policyIdArb,
        async (kind, formId, privacy, events, blobId, digest, policyId) => {
          resetDbConnection();
          await clearAll();

          const job = createJob(kind, formId, privacy);
          let currentJob = await applyAndPersistSequence(job, events);

          // Apply metadata and persist final state
          currentJob = withMetadata(currentJob, { blobId, digest, policyId });
          await persistJob(currentJob);

          // Reload all jobs via resume
          const allJobs = await resume();
          const loaded = allJobs.find((j) => j.id === currentJob.id);

          expect(loaded).toBeDefined();
          expect(loaded!.state).toBe(currentJob.state);
          expect(loaded!.blobId).toBe(currentJob.blobId);
          expect(loaded!.digest).toBe(currentJob.digest);
          expect(loaded!.policyId).toBe(currentJob.policyId);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.14**
   *
   * For any generated sequence of transitions on multiple jobs, persisting
   * all and resuming preserves each job's state independently.
   */
  it('Property 27d: multiple jobs persist and resume independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(artifactKindArb, formIdArb, privacyModeArb, eventSequenceArb),
          { minLength: 2, maxLength: 5 },
        ),
        async (jobSpecs) => {
          resetDbConnection();
          await clearAll();

          const finalJobs: UploadJob[] = [];

          for (const [kind, formId, privacy, events] of jobSpecs) {
            const job = createJob(kind, formId, privacy);
            const finalJob = await applyAndPersistSequence(job, events);
            finalJobs.push(finalJob);
          }

          // Resume all jobs
          const allJobs = await resume();
          expect(allJobs).toHaveLength(finalJobs.length);

          for (const expected of finalJobs) {
            const loaded = allJobs.find((j) => j.id === expected.id);
            expect(loaded).toBeDefined();
            expect(loaded!.state).toBe(expected.state);
            expect(loaded!.artifactKind).toBe(expected.artifactKind);
            expect(loaded!.formId).toBe(expected.formId);
            expect(loaded!.privacyMode).toBe(expected.privacyMode);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 6.14**
   *
   * For any generated job that goes through the full happy path (with metadata
   * set at appropriate stages), persisting at every step and reloading at the
   * end preserves all fields exactly.
   *
   * Note: policyId is only set for private forms (Seal encryption context).
   */
  it('Property 27e: full lifecycle with metadata persists correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        fc.string({ minLength: 5, maxLength: 40 }),
        fc.string({ minLength: 10, maxLength: 64 }),
        fc.string({ minLength: 5, maxLength: 40 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        async (kind, formId, privacy, blobId, digest, policyId, sizeBytes) => {
          resetDbConnection();
          await clearAll();

          // Create job
          let job = createJob(kind, formId, privacy);
          await persistJob(job);

          // Walk through the happy path based on privacy mode
          if (privacy === 'private') {
            job = transition(job, 'START_ENCRYPT');
            job = withMetadata(job, { policyId });
            await persistJob(job);

            job = transition(job, 'START_UPLOAD');
            await persistJob(job);
          } else {
            job = transition(job, 'START_UPLOAD');
            await persistJob(job);
          }

          job = transition(job, 'UPLOAD_SUCCESS');
          job = withMetadata(job, { blobId, digest, sizeBytes });
          await persistJob(job);

          job = transition(job, 'INDEX_SUCCESS');
          await persistJob(job);

          // Reload and verify all fields
          const loaded = await getJob(job.id);
          expect(loaded).toBeDefined();
          expect(loaded!.state).toBe('indexed');
          expect(loaded!.blobId).toBe(blobId);
          expect(loaded!.digest).toBe(digest);
          expect(loaded!.sizeBytes).toBe(sizeBytes);
          expect(loaded!.artifactKind).toBe(kind);
          expect(loaded!.formId).toBe(formId);
          expect(loaded!.privacyMode).toBe(privacy);
          expect(loaded!.id).toBe(job.id);
          expect(loaded!.createdAt).toBe(job.createdAt);

          // policyId is only set for private forms
          if (privacy === 'private') {
            expect(loaded!.policyId).toBe(policyId);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 6.14**
   *
   * For any generated job that fails and retries, the persisted state after
   * retry correctly reflects the reset to pending while preserving identity.
   */
  it('Property 27f: fail-retry cycle persists correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        eventSequenceArb,
        async (kind, formId, privacy, events) => {
          resetDbConnection();
          await clearAll();

          const job = createJob(kind, formId, privacy);
          let currentJob = await applyAndPersistSequence(job, events);

          // If not in failed state, force a failure
          if (currentJob.state !== 'failed' && currentJob.state !== 'indexed') {
            try {
              currentJob = transition(currentJob, 'FAIL');
              await persistJob(currentJob);
            } catch {
              // If FAIL is invalid from current state (indexed), skip
              return;
            }
          }

          if (currentJob.state === 'failed') {
            // Retry
            currentJob = transition(currentJob, 'RETRY');
            await persistJob(currentJob);

            // Verify persistence
            const loaded = await getJob(currentJob.id);
            expect(loaded).toBeDefined();
            expect(loaded!.state).toBe('pending');
            expect(loaded!.id).toBe(job.id);
            expect(loaded!.artifactKind).toBe(kind);
            expect(loaded!.formId).toBe(formId);
            expect(loaded!.privacyMode).toBe(privacy);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
