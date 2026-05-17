/**
 * Property-based tests for orphan detection in the Upload_State_Machine.
 *
 * **Validates: Requirements 6.13**
 *
 * Property 28: Orphan detection after timeout
 *   - For any Upload_Job in state `uploaded` continuously for longer than
 *     `ORPHAN_TIMEOUT_MS`, `isOrphan(job)` is true and UI exposes both
 *     `reconcile` and `discard` affordances.
 *
 * Key behaviors tested:
 * 1. `isOrphan(job)` returns true when `job.state === 'uploaded'` AND
 *    `Date.now() - job.updatedAt > ORPHAN_TIMEOUT_MS`
 * 2. `isOrphan(job)` returns false for any other state regardless of time
 * 3. `isOrphan(job)` returns false for `uploaded` jobs within the timeout
 * 4. `discard(job)` transitions an uploaded job to `failed`
 * 5. `getRetryPoint(job)` returns `'uploaded'` when blobId exists, `'pending'` otherwise
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  createJob,
  transition,
  isOrphan,
  discard,
  getRetryPoint,
  ORPHAN_TIMEOUT_MS,
  type UploadState,
  type UploadJob,
  type ArtifactKind,
  type PrivacyMode,
} from './upload-state-machine';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_STATES: UploadState[] = [
  'pending',
  'encrypting',
  'uploading',
  'uploaded',
  'indexed',
  'failed',
];

const NON_UPLOADED_STATES: UploadState[] = [
  'pending',
  'encrypting',
  'uploading',
  'indexed',
  'failed',
];

const ALL_ARTIFACT_KINDS: ArtifactKind[] = ['form', 'submission', 'file'];
const ALL_PRIVACY_MODES: PrivacyMode[] = ['public', 'private'];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const artifactKindArb: fc.Arbitrary<ArtifactKind> = fc.constantFrom(...ALL_ARTIFACT_KINDS);
const privacyModeArb: fc.Arbitrary<PrivacyMode> = fc.constantFrom(...ALL_PRIVACY_MODES);
const formIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 36 });
const nonUploadedStateArb: fc.Arbitrary<UploadState> = fc.constantFrom(...NON_UPLOADED_STATES);

/**
 * Generates a time delta that exceeds the orphan timeout.
 * Range: ORPHAN_TIMEOUT_MS + 1 to ORPHAN_TIMEOUT_MS + 1 hour.
 */
const expiredDeltaArb: fc.Arbitrary<number> = fc.integer({
  min: ORPHAN_TIMEOUT_MS + 1,
  max: ORPHAN_TIMEOUT_MS + 3_600_000,
});

/**
 * Generates a time delta within the orphan timeout (not expired).
 * Range: 0 to ORPHAN_TIMEOUT_MS - 1.
 */
const freshDeltaArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: ORPHAN_TIMEOUT_MS - 1,
});

/**
 * Generates a blob ID string (simulating a Walrus blob identifier).
 */
const blobIdArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 16, maxLength: 64 })
  .map((nums) => nums.map((n) => n.toString(16)).join(''));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an UploadJob in the `uploaded` state with a specific updatedAt timestamp.
 */
function makeUploadedJob(
  artifactKind: ArtifactKind,
  formId: string,
  privacyMode: PrivacyMode,
  updatedAt: number,
  blobId?: string,
): UploadJob {
  return {
    id: `test-job-${Date.now()}-${Math.random()}`,
    artifactKind,
    formId,
    privacyMode,
    state: 'uploaded',
    blobId,
    createdAt: updatedAt - 1000,
    updatedAt,
  };
}

/**
 * Creates an UploadJob in a specified state with a specific updatedAt timestamp.
 */
function makeJobInState(
  state: UploadState,
  artifactKind: ArtifactKind,
  formId: string,
  privacyMode: PrivacyMode,
  updatedAt: number,
  blobId?: string,
): UploadJob {
  return {
    id: `test-job-${Date.now()}-${Math.random()}`,
    artifactKind,
    formId,
    privacyMode,
    state,
    blobId,
    createdAt: updatedAt - 1000,
    updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Property 28: Orphan detection after timeout
// ---------------------------------------------------------------------------

describe('Property 28: Orphan detection after timeout', () => {
  /**
   * **Validates: Requirements 6.13**
   *
   * `isOrphan(job)` returns true when `job.state === 'uploaded'` AND
   * `Date.now() - job.updatedAt > ORPHAN_TIMEOUT_MS`.
   */
  it('Property 28a: uploaded jobs past ORPHAN_TIMEOUT_MS are detected as orphans', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        expiredDeltaArb,
        (kind, formId, privacy, delta) => {
          const now = Date.now();
          const updatedAt = now - delta; // delta > ORPHAN_TIMEOUT_MS, so updatedAt is far in the past

          vi.spyOn(Date, 'now').mockReturnValue(now);

          const job = makeUploadedJob(kind, formId, privacy, updatedAt);
          expect(isOrphan(job)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.13**
   *
   * `isOrphan(job)` returns false for any state other than `uploaded`,
   * regardless of how much time has elapsed.
   */
  it('Property 28b: non-uploaded jobs are never orphans regardless of time', () => {
    fc.assert(
      fc.property(
        nonUploadedStateArb,
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        expiredDeltaArb,
        (state, kind, formId, privacy, delta) => {
          const now = Date.now();
          const updatedAt = now - delta; // Even with expired time

          vi.spyOn(Date, 'now').mockReturnValue(now);

          const job = makeJobInState(state, kind, formId, privacy, updatedAt);
          expect(isOrphan(job)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.13**
   *
   * `isOrphan(job)` returns false for `uploaded` jobs within the timeout window.
   */
  it('Property 28c: uploaded jobs within ORPHAN_TIMEOUT_MS are not orphans', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        freshDeltaArb,
        (kind, formId, privacy, delta) => {
          const now = Date.now();
          const updatedAt = now - delta; // delta < ORPHAN_TIMEOUT_MS

          vi.spyOn(Date, 'now').mockReturnValue(now);

          const job = makeUploadedJob(kind, formId, privacy, updatedAt);
          expect(isOrphan(job)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.13**
   *
   * `discard(job)` transitions an uploaded job to `failed`.
   * This validates the "discard" affordance for orphaned jobs.
   */
  it('Property 28d: discard transitions uploaded jobs to failed', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        expiredDeltaArb,
        (kind, formId, privacy, delta) => {
          const now = Date.now();
          const updatedAt = now - delta;

          vi.spyOn(Date, 'now').mockReturnValue(now);

          const job = makeUploadedJob(kind, formId, privacy, updatedAt);

          // Verify it's an orphan
          expect(isOrphan(job)).toBe(true);

          // Discard should transition to failed
          const discarded = discard(job);
          expect(discarded.state).toBe('failed');
          expect(discarded.id).toBe(job.id);
          expect(discarded.artifactKind).toBe(job.artifactKind);
          expect(discarded.formId).toBe(job.formId);
          expect(discarded.privacyMode).toBe(job.privacyMode);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.13**
   *
   * `getRetryPoint(job)` returns `'uploaded'` when blobId exists (blob is on Walrus,
   * only metadata write needed), and `'pending'` otherwise (full re-upload needed).
   * This validates the "reconcile" affordance for orphaned jobs.
   */
  it('Property 28e: getRetryPoint returns uploaded when blobId exists, pending otherwise', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        expiredDeltaArb,
        fc.boolean(),
        blobIdArb,
        (kind, formId, privacy, delta, hasBlobId, blobId) => {
          const now = Date.now();
          const updatedAt = now - delta;

          vi.spyOn(Date, 'now').mockReturnValue(now);

          const job = makeUploadedJob(
            kind,
            formId,
            privacy,
            updatedAt,
            hasBlobId ? blobId : undefined,
          );

          const retryPoint = getRetryPoint(job);

          if (hasBlobId) {
            expect(retryPoint).toBe('uploaded');
          } else {
            expect(retryPoint).toBe('pending');
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.13**
   *
   * Orphan detection is a pure function of state and time — the same job
   * transitions from non-orphan to orphan as time passes the threshold.
   */
  it('Property 28f: orphan status transitions at exactly ORPHAN_TIMEOUT_MS boundary', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        (kind, formId, privacy) => {
          const baseTime = 1_700_000_000_000; // Fixed base timestamp
          const job = makeUploadedJob(kind, formId, privacy, baseTime);

          // At exactly ORPHAN_TIMEOUT_MS, should NOT be orphan (not strictly greater)
          vi.spyOn(Date, 'now').mockReturnValue(baseTime + ORPHAN_TIMEOUT_MS);
          expect(isOrphan(job)).toBe(false);

          // At ORPHAN_TIMEOUT_MS + 1, should be orphan
          vi.spyOn(Date, 'now').mockReturnValue(baseTime + ORPHAN_TIMEOUT_MS + 1);
          expect(isOrphan(job)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.13**
   *
   * After discard, the job is no longer an orphan (it's in `failed` state).
   * This ensures the discard affordance resolves the orphan condition.
   */
  it('Property 28g: discarded orphans are no longer detected as orphans', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        expiredDeltaArb,
        (kind, formId, privacy, delta) => {
          const now = Date.now();
          const updatedAt = now - delta;

          vi.spyOn(Date, 'now').mockReturnValue(now);

          const job = makeUploadedJob(kind, formId, privacy, updatedAt);
          expect(isOrphan(job)).toBe(true);

          const discarded = discard(job);
          expect(isOrphan(discarded)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.13**
   *
   * Both reconcile (getRetryPoint) and discard affordances are available
   * for any orphaned job — getRetryPoint returns a valid state and discard
   * produces a valid failed job.
   */
  it('Property 28h: orphaned jobs expose both reconcile and discard affordances', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        expiredDeltaArb,
        blobIdArb,
        (kind, formId, privacy, delta, blobId) => {
          const now = Date.now();
          const updatedAt = now - delta;

          vi.spyOn(Date, 'now').mockReturnValue(now);

          // Create an orphaned job with a blobId (typical orphan scenario)
          const job = makeUploadedJob(kind, formId, privacy, updatedAt, blobId);
          expect(isOrphan(job)).toBe(true);

          // Reconcile affordance: getRetryPoint returns a valid UploadState
          const retryPoint = getRetryPoint(job);
          expect(ALL_STATES).toContain(retryPoint);
          expect(retryPoint).toBe('uploaded'); // Has blobId, so retry from uploaded

          // Discard affordance: discard produces a valid failed job
          const discarded = discard(job);
          expect(discarded.state).toBe('failed');
          expect(discarded.id).toBe(job.id);
        },
      ),
      { numRuns: 200 },
    );
  });
});
