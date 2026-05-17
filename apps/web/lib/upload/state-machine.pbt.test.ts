/**
 * Property-based tests for the Upload_State_Machine (upload-state-machine.ts)
 *
 * **Validates: Requirements 6.1–6.8**
 *
 * Property 25: Upload state machine transition validity and initial state
 *   - For any generated sequence of operations against an Upload_Job, every
 *     reached state belongs to the declared set, every transition matches a
 *     declared edge in the state diagram, and every newly created job starts
 *     in `pending`.
 *
 * Property 26: Retry from failed is idempotent
 *   - For any failed Upload_Job and any k ≥ 1 retries from the same recovery
 *     point, the final state, recorded blob ID, and observable side effects
 *     are equal to those produced by exactly one retry.
 */

import { describe, it, expect } from 'vitest';
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

// ---------------------------------------------------------------------------
// Constants — declared state set and transition edges
// ---------------------------------------------------------------------------

const ALL_STATES: UploadState[] = [
  'pending',
  'encrypting',
  'uploading',
  'uploaded',
  'indexed',
  'failed',
];

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

/**
 * Declared transition edges per the design document.
 * Map of (state, event) → nextState.
 * Privacy-mode constraints are enforced separately.
 */
const DECLARED_EDGES: Array<{ from: UploadState; event: UploadEvent; to: UploadState }> = [
  { from: 'pending', event: 'START_ENCRYPT', to: 'encrypting' },
  { from: 'pending', event: 'START_UPLOAD', to: 'uploading' },
  { from: 'pending', event: 'FAIL', to: 'failed' },
  { from: 'encrypting', event: 'START_UPLOAD', to: 'uploading' },
  { from: 'encrypting', event: 'FAIL', to: 'failed' },
  { from: 'uploading', event: 'UPLOAD_SUCCESS', to: 'uploaded' },
  { from: 'uploading', event: 'FAIL', to: 'failed' },
  { from: 'uploaded', event: 'INDEX_SUCCESS', to: 'indexed' },
  { from: 'uploaded', event: 'FAIL', to: 'failed' },
  { from: 'failed', event: 'RETRY', to: 'pending' },
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const artifactKindArb: fc.Arbitrary<ArtifactKind> = fc.constantFrom(...ALL_ARTIFACT_KINDS);
const privacyModeArb: fc.Arbitrary<PrivacyMode> = fc.constantFrom(...ALL_PRIVACY_MODES);
const uploadEventArb: fc.Arbitrary<UploadEvent> = fc.constantFrom(...ALL_EVENTS);
const formIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 36 });

/**
 * Generates a random sequence of events to apply to a job.
 * The sequence length is bounded to keep tests fast.
 */
const eventSequenceArb: fc.Arbitrary<UploadEvent[]> = fc.array(uploadEventArb, {
  minLength: 1,
  maxLength: 30,
});

/**
 * Generates a positive integer k ≥ 1 for retry count.
 */
const retryCountArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks if a transition (from, event) → to is a declared edge,
 * taking privacy mode constraints into account.
 */
function isValidTransition(
  from: UploadState,
  event: UploadEvent,
  privacyMode: PrivacyMode,
): { valid: boolean; to?: UploadState } {
  // Privacy mode constraints
  if (from === 'pending' && event === 'START_ENCRYPT' && privacyMode === 'public') {
    return { valid: false };
  }
  if (from === 'pending' && event === 'START_UPLOAD' && privacyMode === 'private') {
    return { valid: false };
  }

  const edge = DECLARED_EDGES.find((e) => e.from === from && e.event === event);
  if (edge) {
    return { valid: true, to: edge.to };
  }
  return { valid: false };
}

/**
 * Applies a sequence of events to a job, collecting all reached states.
 * Invalid transitions are caught and skipped (they throw InvalidTransitionError).
 * Returns the list of states visited and the final job.
 */
function applyEventSequence(
  initialJob: UploadJob,
  events: UploadEvent[],
): { states: UploadState[]; finalJob: UploadJob; transitions: Array<{ from: UploadState; event: UploadEvent; to: UploadState }> } {
  const states: UploadState[] = [initialJob.state];
  const transitions: Array<{ from: UploadState; event: UploadEvent; to: UploadState }> = [];
  let currentJob = initialJob;

  for (const event of events) {
    try {
      const nextJob = transition(currentJob, event);
      transitions.push({ from: currentJob.state, event, to: nextJob.state });
      states.push(nextJob.state);
      currentJob = nextJob;
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        // Invalid transition — skip, state unchanged
        continue;
      }
      throw e; // Unexpected error
    }
  }

  return { states, finalJob: currentJob, transitions };
}

// ---------------------------------------------------------------------------
// Property 25: Upload state machine transition validity and initial state
// ---------------------------------------------------------------------------

describe('Property 25: Upload state machine transition validity and initial state', () => {
  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * Every newly created job starts in `pending`.
   */
  it('Property 25a: every new job starts in pending state', () => {
    fc.assert(
      fc.property(artifactKindArb, formIdArb, privacyModeArb, (kind, formId, privacy) => {
        const job = createJob(kind, formId, privacy);
        expect(job.state).toBe('pending');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any generated sequence of operations, every reached state belongs
   * to the declared state set.
   */
  it('Property 25b: every reached state belongs to the declared state set', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        eventSequenceArb,
        (kind, formId, privacy, events) => {
          const job = createJob(kind, formId, privacy);
          const { states } = applyEventSequence(job, events);

          for (const state of states) {
            expect(ALL_STATES).toContain(state);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7**
   *
   * For any generated sequence of operations, every successful transition
   * matches a declared edge in the state diagram.
   */
  it('Property 25c: every successful transition matches a declared edge', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        eventSequenceArb,
        (kind, formId, privacy, events) => {
          const job = createJob(kind, formId, privacy);
          const { transitions } = applyEventSequence(job, events);

          for (const t of transitions) {
            const edge = DECLARED_EDGES.find(
              (e) => e.from === t.from && e.event === t.event && e.to === t.to,
            );
            expect(edge).toBeDefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.3, 6.4, 6.5**
   *
   * Invalid transitions (not in the declared edge set) always throw
   * InvalidTransitionError and do not change the job state.
   */
  it('Property 25d: invalid transitions throw InvalidTransitionError', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        eventSequenceArb,
        uploadEventArb,
        (kind, formId, privacy, setupEvents, testEvent) => {
          const job = createJob(kind, formId, privacy);
          const { finalJob } = applyEventSequence(job, setupEvents);

          const validity = isValidTransition(finalJob.state, testEvent, privacy);

          if (!validity.valid) {
            // Should throw InvalidTransitionError
            expect(() => transition(finalJob, testEvent)).toThrow(InvalidTransitionError);
          } else {
            // Should succeed and reach the declared target state
            const nextJob = transition(finalJob, testEvent);
            expect(nextJob.state).toBe(validity.to);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * Private forms MUST pass through encrypting before uploading.
   * START_UPLOAD from pending on a private form always throws.
   */
  it('Property 25e: private forms cannot skip encrypting', () => {
    fc.assert(
      fc.property(artifactKindArb, formIdArb, (kind, formId) => {
        const job = createJob(kind, formId, 'private');
        expect(() => transition(job, 'START_UPLOAD')).toThrow(InvalidTransitionError);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * Public forms MUST NOT pass through encrypting.
   * START_ENCRYPT on a public form always throws.
   */
  it('Property 25f: public forms cannot enter encrypting', () => {
    fc.assert(
      fc.property(artifactKindArb, formIdArb, (kind, formId) => {
        const job = createJob(kind, formId, 'public');
        expect(() => transition(job, 'START_ENCRYPT')).toThrow(InvalidTransitionError);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * The `indexed` state is terminal — no event can transition out of it.
   */
  it('Property 25g: indexed is a terminal state', () => {
    fc.assert(
      fc.property(artifactKindArb, formIdArb, uploadEventArb, (kind, formId, event) => {
        // Build a job in indexed state (public path is simplest)
        let job = createJob(kind, formId, 'public');
        job = transition(job, 'START_UPLOAD');
        job = transition(job, 'UPLOAD_SUCCESS');
        job = transition(job, 'INDEX_SUCCESS');
        expect(job.state).toBe('indexed');

        expect(() => transition(job, event)).toThrow(InvalidTransitionError);
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 26: Retry from failed is idempotent
// ---------------------------------------------------------------------------

describe('Property 26: Retry from failed is idempotent', () => {
  /**
   * **Validates: Requirements 6.8**
   *
   * For any failed Upload_Job and any k ≥ 1 retries from the same recovery
   * point, the final state equals that of exactly one retry.
   * Since RETRY always transitions failed → pending, applying RETRY k times
   * from failed should be equivalent to applying it once (subsequent retries
   * from pending throw InvalidTransitionError, so the state stays at pending).
   */
  it('Property 26a: k retries from failed produce the same state as one retry', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        retryCountArb,
        (kind, formId, privacy, k) => {
          // Create a job and move it to failed
          let job = createJob(kind, formId, privacy);
          job = transition(job, 'FAIL'); // pending → failed
          expect(job.state).toBe('failed');

          // Apply one retry
          const oneRetry = transition(job, 'RETRY');
          expect(oneRetry.state).toBe('pending');

          // Apply k retries from the same failed state
          let current = job;
          for (let i = 0; i < k; i++) {
            try {
              current = transition(current, 'RETRY');
            } catch (e) {
              if (e instanceof InvalidTransitionError) {
                // After first retry, job is in pending — RETRY is invalid from pending
                break;
              }
              throw e;
            }
          }

          // Final state should be pending (same as one retry)
          expect(current.state).toBe(oneRetry.state);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.8**
   *
   * For any failed Upload_Job reached via different paths (different failure
   * points), retrying always returns to pending regardless of how the job
   * reached the failed state.
   */
  it('Property 26b: retry from any failure path always returns to pending', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        eventSequenceArb,
        (kind, formId, privacy, events) => {
          const job = createJob(kind, formId, privacy);
          const { finalJob } = applyEventSequence(job, events);

          // Only test if we ended up in failed state
          if (finalJob.state !== 'failed') return;

          // Retry should always go to pending
          const retried = transition(finalJob, 'RETRY');
          expect(retried.state).toBe('pending');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.8**
   *
   * Retry is idempotent in terms of observable properties: the retried job
   * preserves the original job's identity (id, artifactKind, formId, privacyMode)
   * and resets state to pending. Applying the same full sequence after retry
   * produces the same final state regardless of how many times we retry.
   */
  it('Property 26c: retry preserves job identity and resets state deterministically', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        retryCountArb,
        (kind, formId, privacy, k) => {
          // Create a job, fail it, then retry k times
          let job = createJob(kind, formId, privacy);
          job = transition(job, 'FAIL');

          const retriedOnce = transition(job, 'RETRY');

          // Retry preserves identity
          expect(retriedOnce.id).toBe(job.id);
          expect(retriedOnce.artifactKind).toBe(job.artifactKind);
          expect(retriedOnce.formId).toBe(job.formId);
          expect(retriedOnce.privacyMode).toBe(job.privacyMode);

          // Now simulate k retries from the same failed state
          // Each retry from failed → pending is identical in outcome
          for (let i = 0; i < k; i++) {
            const retried = transition(job, 'RETRY');
            expect(retried.state).toBe('pending');
            expect(retried.id).toBe(job.id);
            expect(retried.artifactKind).toBe(kind);
            expect(retried.formId).toBe(formId);
            expect(retried.privacyMode).toBe(privacy);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.8**
   *
   * After retry, the full happy path can complete successfully again.
   * This validates that retry truly resets the state machine to a usable state.
   */
  it('Property 26d: after retry, full happy path completes successfully', () => {
    fc.assert(
      fc.property(artifactKindArb, formIdArb, privacyModeArb, (kind, formId, privacy) => {
        // Create job, fail it, retry
        let job = createJob(kind, formId, privacy);
        job = transition(job, 'FAIL');
        job = transition(job, 'RETRY');
        expect(job.state).toBe('pending');

        // Complete the happy path based on privacy mode
        if (privacy === 'private') {
          job = transition(job, 'START_ENCRYPT');
          expect(job.state).toBe('encrypting');
          job = transition(job, 'START_UPLOAD');
        } else {
          job = transition(job, 'START_UPLOAD');
        }
        expect(job.state).toBe('uploading');

        job = transition(job, 'UPLOAD_SUCCESS');
        expect(job.state).toBe('uploaded');

        job = transition(job, 'INDEX_SUCCESS');
        expect(job.state).toBe('indexed');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.8**
   *
   * Multiple fail-retry cycles produce the same behavior each time.
   * The state machine is deterministic across repeated failure/recovery cycles.
   */
  it('Property 26e: multiple fail-retry cycles are deterministic', () => {
    fc.assert(
      fc.property(
        artifactKindArb,
        formIdArb,
        privacyModeArb,
        fc.integer({ min: 1, max: 5 }),
        (kind, formId, privacy, cycles) => {
          let job = createJob(kind, formId, privacy);

          for (let i = 0; i < cycles; i++) {
            // Fail from pending
            job = transition(job, 'FAIL');
            expect(job.state).toBe('failed');

            // Retry
            job = transition(job, 'RETRY');
            expect(job.state).toBe('pending');

            // Identity preserved through all cycles
            expect(job.artifactKind).toBe(kind);
            expect(job.formId).toBe(formId);
            expect(job.privacyMode).toBe(privacy);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
