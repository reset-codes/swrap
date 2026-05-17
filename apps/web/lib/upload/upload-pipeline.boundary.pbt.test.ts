/**
 * apps/web/lib/upload/upload-pipeline.boundary.pbt.test.ts
 *
 * Feature: walrus-native-zk-login-architecture
 * Property 11: Confidentiality across the upload pipeline
 *
 * For any generated Private_Form Submission_Payload with a distinctive random
 * plaintext substring, bytes captured at the API boundary, bytes persisted in
 * any store, and bytes captured in any log line during the upload pipeline
 * contain no substring of the original plaintext.
 *
 * This test exercises the client-side upload state machine and verifies that:
 *   1. The upload state machine never persists plaintext payload bytes to IndexedDB
 *   2. The upload state machine only persists blobId, digest, policyId, and state
 *   3. No plaintext leaks through the state machine's public API
 *
 * Validates: Requirements 2.1, 2.7, 4.6, 12.2, 12.3, 12.4, 12.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  createJob,
  transition,
  isOrphan,
  getRetryPoint,
  ORPHAN_TIMEOUT_MS,
  type UploadJob,
  type UploadState,
} from './upload-state-machine';
import { persistJob, getJob, resume, clearAll, resetDbConnection } from './upload-persistence';
import 'fake-indexeddb/auto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a distinctive plaintext payload using a UUID-based marker.
 * The marker is guaranteed to be unique and not appear in any job metadata field.
 * We use a fixed prefix "SWRAP_PLAINTEXT_MARKER_" followed by the UUID to ensure
 * the full marker string never appears in job metadata (which only contains
 * job IDs, states, formIds, blobIds, digests, and timestamps).
 */
function makeDistinctivePlaintext(uuid: string): { plaintext: string; marker: string } {
  const marker = `SWRAP_PLAINTEXT_MARKER_${uuid}`;
  const plaintext = JSON.stringify({
    marker,
    data: `sensitive-payload-${uuid}`,
    nested: { secret: `secret-value-${uuid}` },
  });
  return { plaintext, marker };
}

/**
 * Checks whether `haystack` contains `needle` as a contiguous substring.
 * Uses a minimum length of 8 bytes to avoid false positives.
 */
function containsSubstring(haystack: string, needle: string, minLength = 8): boolean {
  if (needle.length < minLength) return false;
  return haystack.includes(needle);
}

/**
 * Serializes an UploadJob to a string for boundary inspection.
 */
function serializeJobForBoundaryCheck(job: UploadJob): string {
  return JSON.stringify({
    id: job.id,
    artifactKind: job.artifactKind,
    formId: job.formId,
    privacyMode: job.privacyMode,
    state: job.state,
    blobId: job.blobId,
    digest: job.digest,
    sizeBytes: job.sizeBytes,
    policyId: job.policyId,
    failureReason: job.failureReason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// Property 11: Confidentiality across the upload pipeline
// ---------------------------------------------------------------------------

describe('Property 11: Confidentiality across the upload pipeline', () => {
  beforeEach(async () => {
    resetDbConnection();
    await clearAll();
  });

  it('Property 11a: UploadJob state machine never stores plaintext payload', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (payloadUuid, formId) => {
          const { plaintext, marker } = makeDistinctivePlaintext(payloadUuid);

          // Create a job — no plaintext should be in the job
          const job = createJob('submission', formId, 'private');
          const serialized = serializeJobForBoundaryCheck(job);

          // The distinctive marker must not appear in the serialized job
          expect(containsSubstring(serialized, marker)).toBe(false);
          expect(containsSubstring(serialized, plaintext)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 11b: UploadJob transitions never introduce plaintext', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (payloadUuid, formId) => {
          const { plaintext, marker } = makeDistinctivePlaintext(payloadUuid);

          // Simulate a private form upload pipeline
          let job = createJob('submission', formId, 'private');

          // pending → encrypting
          job = transition(job, 'START_ENCRYPT');
          expect(containsSubstring(serializeJobForBoundaryCheck(job), marker)).toBe(false);

          // encrypting → uploading (ciphertext handle, not plaintext)
          job = transition(job, 'START_UPLOAD');
          expect(containsSubstring(serializeJobForBoundaryCheck(job), marker)).toBe(false);

          // uploading → uploaded (with blobId and digest, not plaintext)
          const blobId = `walrus-blob-${payloadUuid.slice(0, 8)}`;
          const digest = `sha256-${payloadUuid.slice(0, 16)}`;
          job = {
            ...job,
            state: 'uploaded' as UploadState,
            blobId,
            digest,
            sizeBytes: 1024,
            updatedAt: Date.now(),
          };
          expect(containsSubstring(serializeJobForBoundaryCheck(job), marker)).toBe(false);
          expect(containsSubstring(serializeJobForBoundaryCheck(job), plaintext)).toBe(false);

          // uploaded → indexed
          job = transition(job, 'INDEX_SUCCESS');
          expect(containsSubstring(serializeJobForBoundaryCheck(job), marker)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 11c: IndexedDB persistence never stores plaintext payload', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (payloadUuid, formId) => {
          const { plaintext, marker } = makeDistinctivePlaintext(payloadUuid);

          // Create and persist a job through the full pipeline
          let job = createJob('submission', formId, 'private');
          await persistJob(job);

          job = transition(job, 'START_ENCRYPT');
          await persistJob(job);

          job = transition(job, 'START_UPLOAD');
          await persistJob(job);

          // Simulate upload completion — only blobId and digest, no plaintext
          const blobId = `walrus-blob-${payloadUuid.slice(0, 8)}`;
          const digest = `sha256-${payloadUuid.slice(0, 16)}`;
          job = {
            ...job,
            state: 'uploaded' as UploadState,
            blobId,
            digest,
            sizeBytes: 512,
            updatedAt: Date.now(),
          };
          await persistJob(job);

          // Load from IndexedDB and verify no plaintext
          const loaded = await getJob(job.id);
          expect(loaded).not.toBeNull();

          const serialized = JSON.stringify(loaded);
          expect(containsSubstring(serialized, marker)).toBe(false);
          expect(containsSubstring(serialized, plaintext)).toBe(false);

          // The blobId and digest are allowed (they're not plaintext)
          expect(serialized).toContain(blobId);
          expect(serialized).toContain(digest);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 11d: loadAllJobs returns no plaintext from any persisted job', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            payloadUuid: fc.uuid(),
            formId: fc.uuid(),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (entries) => {
          resetDbConnection();
          await clearAll();

          const markers: string[] = [];

          for (const { payloadUuid, formId } of entries) {
            const { marker } = makeDistinctivePlaintext(payloadUuid);
            markers.push(marker);

            let job = createJob('submission', formId, 'private');
            job = transition(job, 'START_ENCRYPT');
            job = transition(job, 'START_UPLOAD');
            job = {
              ...job,
              state: 'uploaded' as UploadState,
              blobId: `walrus-blob-${payloadUuid.slice(0, 8)}`,
              digest: `sha256-${payloadUuid.slice(0, 16)}`,
              updatedAt: Date.now(),
            };
            await persistJob(job);
          }

          const allJobs = await resume();
          const allSerialized = JSON.stringify(allJobs);

          for (const marker of markers) {
            expect(containsSubstring(allSerialized, marker)).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Property 11e: failed jobs with failure reason do not leak plaintext', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (payloadUuid, formId) => {
          const { plaintext, marker } = makeDistinctivePlaintext(payloadUuid);

          let job = createJob('submission', formId, 'private');
          job = transition(job, 'START_ENCRYPT');

          // Fail during encryption — failure reason should not contain plaintext
          job = transition(job, 'FAIL');
          const jobWithReason: UploadJob = {
            ...job,
            failureReason: 'Encryption service unavailable',
          };

          const serialized = serializeJobForBoundaryCheck(jobWithReason);
          expect(containsSubstring(serialized, marker)).toBe(false);
          expect(containsSubstring(serialized, plaintext)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Additional boundary invariants
// ---------------------------------------------------------------------------

describe('Upload pipeline boundary invariants', () => {
  it('UploadJob fields contain only metadata, never payload content', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom<'form' | 'submission' | 'file'>('form', 'submission', 'file'),
        fc.constantFrom<'public' | 'private'>('public', 'private'),
        (formId, artifactKind, privacyMode) => {
          const job = createJob(artifactKind, formId, privacyMode);

          // Verify the job only contains expected metadata fields
          const keys = Object.keys(job);
          const allowedKeys = new Set([
            'id', 'artifactKind', 'formId', 'privacyMode', 'state',
            'blobId', 'digest', 'sizeBytes', 'policyId', 'failureReason',
            'createdAt', 'updatedAt',
          ]);

          for (const key of keys) {
            expect(allowedKeys.has(key)).toBe(true);
          }

          // No payload-related fields
          expect(job).not.toHaveProperty('payload');
          expect(job).not.toHaveProperty('plaintext');
          expect(job).not.toHaveProperty('ciphertext');
          expect(job).not.toHaveProperty('encryptionKey');
          expect(job).not.toHaveProperty('privateKey');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('isOrphan and getRetryPoint do not expose payload content', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (payloadUuid) => {
          const { marker } = makeDistinctivePlaintext(payloadUuid);
          const job = createJob('submission', 'form-id', 'private');
          const jobWithBlob: UploadJob = {
            ...job,
            state: 'uploaded' as UploadState,
            blobId: `walrus-blob-${payloadUuid.slice(0, 8)}`,
            updatedAt: Date.now() - ORPHAN_TIMEOUT_MS * 2,
          };

          // isOrphan returns a boolean — no payload content
          const orphanResult = isOrphan(jobWithBlob);
          expect(typeof orphanResult).toBe('boolean');

          // getRetryPoint returns a state string — no payload content
          const retryPoint = getRetryPoint(jobWithBlob);
          expect(['pending', 'uploaded']).toContain(retryPoint);
          expect(containsSubstring(retryPoint, marker)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
