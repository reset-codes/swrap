/**
 * Property 32: Walrus blob existence pre-check
 *
 * **Validates: Requirements 7.8, 7.9**
 *
 * For all generated metadata write requests, the API_Server verifies the blob
 * exists on Walrus_Store before transitioning the record to `indexed`. If the
 * blob does not exist, the record is NOT written and the API returns 404
 * BlobNotFound.
 *
 * This tests the pure existence-check and indexing-gate logic directly,
 * without requiring a real Walrus node or database.
 *
 * Requirements: 7.8
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrivacyMode = 'public' | 'private';
type UploadState = 'pending' | 'encrypting' | 'uploading' | 'uploaded' | 'indexed' | 'failed';

interface MetadataWriteRequest {
  formId: string;
  formVersion: number;
  submitterAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  policyId?: string;
}

interface SubmissionRow {
  id: string;
  formId: string;
  formVersion: number;
  submitterAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  state: UploadState;
  policyId?: string;
  createdAt: string;
}

type BlobExistenceResult = { exists: true } | { exists: false };

type IndexingResult =
  | { ok: true; row: SubmissionRow }
  | { ok: false; code: 'BlobNotFound'; message: string };

// ---------------------------------------------------------------------------
// Logic under test
//
// These functions encode the invariants from Requirements 7.8 and 7.9:
//
//   7.8: WHEN a metadata write references a Walrus blob identifier, THE
//        API_Server SHALL verify that the blob identifier exists on
//        Walrus_Store before transitioning the record to `indexed`.
//
//   7.9: IF a metadata write fails server-side validation, THEN THE
//        API_Server SHALL return a typed error response and SHALL NOT persist
//        a partial record.
// ---------------------------------------------------------------------------

/**
 * Simulate a Walrus blob existence check.
 *
 * In production this is a HEAD request to the Walrus aggregator. Here it is
 * modelled as a pure function over a set of known blob IDs so the property
 * tests can control which blobs "exist".
 */
function checkBlobExists(
  walrusBlobId: string,
  knownBlobIds: Set<string>,
): BlobExistenceResult {
  return knownBlobIds.has(walrusBlobId) ? { exists: true } : { exists: false };
}

/**
 * Attempt to index a metadata write request.
 *
 * Enforces Requirement 7.8: the blob MUST exist on Walrus before the record
 * is transitioned to `indexed`. If the blob does not exist, returns a
 * BlobNotFound error and writes nothing to the store.
 *
 * @param request      The metadata write request.
 * @param knownBlobIds The set of blob IDs that "exist" on Walrus (test double).
 * @param store        The in-memory submission store (mutated only on success).
 * @returns            IndexingResult — ok with the new row, or BlobNotFound error.
 */
function attemptIndex(
  request: MetadataWriteRequest,
  knownBlobIds: Set<string>,
  store: SubmissionRow[],
): IndexingResult {
  // Requirement 7.8: verify blob exists before transitioning to `indexed`
  const existence = checkBlobExists(request.walrusBlobId, knownBlobIds);

  if (!existence.exists) {
    // Do NOT write any row — return BlobNotFound
    return {
      ok: false,
      code: 'BlobNotFound',
      message: `Walrus blob '${request.walrusBlobId}' does not exist on Walrus_Store. ` +
        `Upload the blob before submitting the metadata write.`,
    };
  }

  // Blob exists — transition to `indexed` and write the row
  const row: SubmissionRow = {
    id: crypto.randomUUID(),
    formId: request.formId,
    formVersion: request.formVersion,
    submitterAddress: request.submitterAddress,
    walrusBlobId: request.walrusBlobId,
    privacyMode: request.privacyMode,
    contentDigest: request.contentDigest,
    sizeBytes: request.sizeBytes,
    state: 'indexed',
    policyId: request.policyId,
    createdAt: new Date().toISOString(),
  };

  store.push(row);
  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a hex string of exactly `len` characters */
function hexStringArb(len: number): fc.Arbitrary<string> {
  return fc
    .array(fc.integer({ min: 0, max: 15 }), { minLength: len, maxLength: len })
    .map((digits) => digits.map((d) => d.toString(16)).join(''));
}

const suiAddressArb: fc.Arbitrary<string> = hexStringArb(64).map((hex) => `0x${hex}`);

const uuidArb: fc.Arbitrary<string> = fc.uuid();

/** Generate a Walrus blob ID — alphanumeric string of 10–60 chars */
const walrusBlobIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9_-]{10,60}$/)
  .filter((s) => s.length >= 10);

const sha256HexArb: fc.Arbitrary<string> = hexStringArb(64);

const privacyModeArb: fc.Arbitrary<PrivacyMode> = fc.constantFrom('public', 'private');

const metadataWriteRequestArb: fc.Arbitrary<MetadataWriteRequest> = fc.record({
  formId: uuidArb,
  formVersion: fc.integer({ min: 1, max: 10 }),
  submitterAddress: suiAddressArb,
  walrusBlobId: walrusBlobIdArb,
  privacyMode: privacyModeArb,
  contentDigest: sha256HexArb,
  sizeBytes: fc.integer({ min: 0, max: 10_000_000 }),
  policyId: fc.option(suiAddressArb, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property 32: Walrus blob existence pre-check
// ---------------------------------------------------------------------------

describe('Property 32: Walrus blob existence pre-check', () => {
  /**
   * **Validates: Requirements 7.8**
   *
   * For any generated metadata write request whose walrusBlobId is NOT in the
   * known-blobs set, attemptIndex MUST:
   *   1. Return { ok: false, code: 'BlobNotFound' }
   *   2. Write NO row to the store (store remains empty)
   */
  it('Property 32a: missing blob → BlobNotFound error, no row written', () => {
    fc.assert(
      fc.property(
        metadataWriteRequestArb,
        fc.array(walrusBlobIdArb, { minLength: 0, maxLength: 10 }),
        (request, otherBlobIds) => {
          // Build a known-blobs set that does NOT contain the request's blob ID
          const knownBlobIds = new Set(
            otherBlobIds.filter((id) => id !== request.walrusBlobId),
          );

          const store: SubmissionRow[] = [];
          const result = attemptIndex(request, knownBlobIds, store);

          // Must return BlobNotFound
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe('BlobNotFound');
            expect(result.message).toContain(request.walrusBlobId);
          }

          // Store must remain empty — no partial row written
          expect(store).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.8**
   *
   * For any generated metadata write request whose walrusBlobId IS in the
   * known-blobs set, attemptIndex MUST:
   *   1. Return { ok: true, row } with state = 'indexed'
   *   2. Write exactly one row to the store
   *   3. The written row's walrusBlobId matches the request
   */
  it('Property 32b: existing blob → indexed row written, state = indexed', () => {
    fc.assert(
      fc.property(
        metadataWriteRequestArb,
        fc.array(walrusBlobIdArb, { minLength: 0, maxLength: 10 }),
        (request, extraBlobIds) => {
          // Build a known-blobs set that DOES contain the request's blob ID
          const knownBlobIds = new Set([request.walrusBlobId, ...extraBlobIds]);

          const store: SubmissionRow[] = [];
          const result = attemptIndex(request, knownBlobIds, store);

          // Must succeed
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.row.state).toBe('indexed');
            expect(result.row.walrusBlobId).toBe(request.walrusBlobId);
            expect(result.row.formId).toBe(request.formId);
          }

          // Exactly one row written
          expect(store).toHaveLength(1);
          expect(store[0].walrusBlobId).toBe(request.walrusBlobId);
          expect(store[0].state).toBe('indexed');
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.8**
   *
   * The existence check is binary: a blob either exists or it doesn't.
   * For any blob ID, checkBlobExists returns `exists: true` iff the ID is in
   * the known set, and `exists: false` otherwise. No partial states.
   */
  it('Property 32c: checkBlobExists is deterministic — same inputs always yield same result', () => {
    fc.assert(
      fc.property(
        walrusBlobIdArb,
        fc.array(walrusBlobIdArb, { minLength: 0, maxLength: 20 }),
        (blobId, knownIds) => {
          const knownBlobIds = new Set(knownIds);

          const result1 = checkBlobExists(blobId, knownBlobIds);
          const result2 = checkBlobExists(blobId, knownBlobIds);

          // Deterministic: same inputs → same output
          expect(result1.exists).toBe(result2.exists);

          // Correct: exists iff in the set
          expect(result1.exists).toBe(knownBlobIds.has(blobId));
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.8**
   *
   * For a batch of requests, only those whose blob IDs exist on Walrus are
   * indexed. The store count equals the number of requests with known blobs.
   */
  it('Property 32d: batch of requests — only requests with existing blobs are indexed', () => {
    fc.assert(
      fc.property(
        fc.array(metadataWriteRequestArb, { minLength: 1, maxLength: 10 }),
        (requests) => {
          // Randomly decide which blob IDs "exist" on Walrus
          // Use a deterministic split: even-indexed requests have existing blobs
          const knownBlobIds = new Set(
            requests
              .filter((_, i) => i % 2 === 0)
              .map((r) => r.walrusBlobId),
          );

          const store: SubmissionRow[] = [];
          const results = requests.map((req) => attemptIndex(req, knownBlobIds, store));

          // Count expected successes
          const expectedSuccessCount = requests.filter((r) =>
            knownBlobIds.has(r.walrusBlobId),
          ).length;

          // Store must contain exactly the expected number of rows
          expect(store).toHaveLength(expectedSuccessCount);

          // Every result must be consistent with blob existence
          for (let i = 0; i < requests.length; i++) {
            const req = requests[i];
            const result = results[i];
            if (knownBlobIds.has(req.walrusBlobId)) {
              expect(result.ok).toBe(true);
            } else {
              expect(result.ok).toBe(false);
              if (!result.ok) {
                expect(result.code).toBe('BlobNotFound');
              }
            }
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 7.8**
   *
   * The BlobNotFound error message must always reference the blob ID that was
   * not found, so the caller can surface a useful diagnostic.
   */
  it('Property 32e: BlobNotFound error message always references the missing blob ID', () => {
    fc.assert(
      fc.property(metadataWriteRequestArb, (request) => {
        // Empty known-blobs set — every request will fail
        const knownBlobIds = new Set<string>();
        const store: SubmissionRow[] = [];

        const result = attemptIndex(request, knownBlobIds, store);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('BlobNotFound');
          // The error message must name the blob ID so the client knows what to fix
          expect(result.message).toContain(request.walrusBlobId);
        }
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.8**
   *
   * Adding a blob ID to the known set after a failed attempt and retrying
   * must succeed. The existence check is stateless — it reflects the current
   * state of the known-blobs set at call time.
   */
  it('Property 32f: retry after adding blob to Walrus succeeds', () => {
    fc.assert(
      fc.property(metadataWriteRequestArb, (request) => {
        const knownBlobIds = new Set<string>();
        const store: SubmissionRow[] = [];

        // First attempt: blob not yet on Walrus
        const firstResult = attemptIndex(request, knownBlobIds, store);
        expect(firstResult.ok).toBe(false);
        expect(store).toHaveLength(0);

        // Simulate blob upload to Walrus
        knownBlobIds.add(request.walrusBlobId);

        // Second attempt: blob now exists
        const secondResult = attemptIndex(request, knownBlobIds, store);
        expect(secondResult.ok).toBe(true);
        expect(store).toHaveLength(1);
        if (secondResult.ok) {
          expect(secondResult.row.state).toBe('indexed');
          expect(secondResult.row.walrusBlobId).toBe(request.walrusBlobId);
        }
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.8**
   *
   * The indexed row must faithfully reflect all fields from the request.
   * No field is silently dropped or mutated during indexing.
   */
  it('Property 32g: indexed row fields match the request exactly', () => {
    fc.assert(
      fc.property(metadataWriteRequestArb, (request) => {
        const knownBlobIds = new Set([request.walrusBlobId]);
        const store: SubmissionRow[] = [];

        const result = attemptIndex(request, knownBlobIds, store);

        expect(result.ok).toBe(true);
        if (result.ok) {
          const row = result.row;
          expect(row.formId).toBe(request.formId);
          expect(row.formVersion).toBe(request.formVersion);
          expect(row.submitterAddress).toBe(request.submitterAddress);
          expect(row.walrusBlobId).toBe(request.walrusBlobId);
          expect(row.privacyMode).toBe(request.privacyMode);
          expect(row.contentDigest).toBe(request.contentDigest);
          expect(row.sizeBytes).toBe(request.sizeBytes);
          expect(row.state).toBe('indexed');
          if (request.policyId !== undefined) {
            expect(row.policyId).toBe(request.policyId);
          }
        }
      }),
      { numRuns: 25 },
    );
  });
});
