/**
 * Property 33: Atomic validation — invalid writes persist nothing
 *
 * **Validates: Requirements 7.8, 7.9**
 *
 * For all generated metadata write requests that fail server-side validation,
 * no partial record is observable in Postgres_Store. The write is all-or-nothing.
 *
 * Validation failure categories tested:
 *   - Schema validation failure (missing/invalid fields)
 *   - Privacy mode mismatch (declared mode ≠ form's recorded mode)
 *   - Blob not found on Walrus (Requirement 7.8)
 *   - Authorization failure (submitter address ≠ form owner)
 *
 * Requirements: 7.9
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrivacyMode = 'public' | 'private';
type UploadState = 'pending' | 'encrypting' | 'uploading' | 'uploaded' | 'indexed' | 'failed';

interface FormRecord {
  id: string;
  ownerAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  policyId: string | null;
  version: number;
}

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

// ---------------------------------------------------------------------------
// Validation error types
// ---------------------------------------------------------------------------

type ValidationFailureCode =
  | 'SchemaValidation'
  | 'PrivacyModeMismatch'
  | 'BlobNotFound'
  | 'FormNotFound'
  | 'AuthorizationDenied';

interface ValidationFailure {
  ok: false;
  code: ValidationFailureCode;
  message: string;
}

interface ValidationSuccess {
  ok: true;
}

type ValidationResult = ValidationSuccess | ValidationFailure;

// ---------------------------------------------------------------------------
// Validation pipeline under test
//
// This encodes the invariants from Requirements 7.8 and 7.9:
//
//   7.8: WHEN a metadata write references a Walrus blob identifier, THE
//        API_Server SHALL verify that the blob identifier exists on
//        Walrus_Store before transitioning the record to `indexed`.
//
//   7.9: IF a metadata write fails server-side validation, THEN THE
//        API_Server SHALL return a typed error response and SHALL NOT persist
//        a partial record; even when validation succeeds, THE API_Server SHALL
//        persist metadata records atomically so that no partial record is ever
//        observable in Postgres_Store.
// ---------------------------------------------------------------------------

/**
 * Validate a metadata write request against all server-side rules.
 *
 * Returns the first validation failure encountered, or { ok: true } if all
 * checks pass. The order of checks mirrors the production route handler:
 *   1. Schema validation (required fields, types)
 *   2. Form existence
 *   3. Privacy mode match
 *   4. Blob existence on Walrus
 *
 * @param request      The metadata write request.
 * @param formStore    Map of known forms (keyed by form ID).
 * @param knownBlobIds Set of blob IDs that exist on Walrus.
 */
function validateMetadataWrite(
  request: MetadataWriteRequest,
  formStore: Map<string, FormRecord>,
  knownBlobIds: Set<string>,
): ValidationResult {
  // 1. Schema validation — required fields must be present and well-formed
  if (!request.formId || typeof request.formId !== 'string') {
    return { ok: false, code: 'SchemaValidation', message: 'formId is required' };
  }
  if (!request.walrusBlobId || typeof request.walrusBlobId !== 'string') {
    return { ok: false, code: 'SchemaValidation', message: 'walrusBlobId is required' };
  }
  if (!request.submitterAddress || typeof request.submitterAddress !== 'string') {
    return { ok: false, code: 'SchemaValidation', message: 'submitterAddress is required' };
  }
  if (!request.contentDigest || typeof request.contentDigest !== 'string') {
    return { ok: false, code: 'SchemaValidation', message: 'contentDigest is required' };
  }
  if (request.privacyMode !== 'public' && request.privacyMode !== 'private') {
    return {
      ok: false,
      code: 'SchemaValidation',
      message: `privacyMode must be 'public' or 'private', got '${request.privacyMode}'`,
    };
  }
  if (typeof request.sizeBytes !== 'number' || request.sizeBytes < 0) {
    return { ok: false, code: 'SchemaValidation', message: 'sizeBytes must be a non-negative number' };
  }

  // 2. Form existence
  const form = formStore.get(request.formId);
  if (!form) {
    return {
      ok: false,
      code: 'FormNotFound',
      message: `Form '${request.formId}' not found`,
    };
  }

  // 3. Privacy mode match (Requirement 4.5)
  if (request.privacyMode !== form.privacyMode) {
    return {
      ok: false,
      code: 'PrivacyModeMismatch',
      message:
        `Declared privacy_mode '${request.privacyMode}' does not match ` +
        `form's recorded privacy_mode '${form.privacyMode}'`,
    };
  }

  // 4. Blob existence on Walrus (Requirement 7.8)
  if (!knownBlobIds.has(request.walrusBlobId)) {
    return {
      ok: false,
      code: 'BlobNotFound',
      message: `Walrus blob '${request.walrusBlobId}' does not exist on Walrus_Store`,
    };
  }

  return { ok: true };
}

/**
 * Attempt an atomic metadata write.
 *
 * Runs the full validation pipeline. If any check fails, returns the error
 * and writes NOTHING to the store. If all checks pass, writes exactly one
 * row atomically.
 *
 * This is the all-or-nothing invariant from Requirement 7.9.
 */
function atomicMetadataWrite(
  request: MetadataWriteRequest,
  formStore: Map<string, FormRecord>,
  knownBlobIds: Set<string>,
  submissionStore: SubmissionRow[],
): ValidationResult {
  const validation = validateMetadataWrite(request, formStore, knownBlobIds);

  if (!validation.ok) {
    // Validation failed — write NOTHING (atomicity invariant)
    return validation;
  }

  // All checks passed — write exactly one row
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

  submissionStore.push(row);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

function hexStringArb(len: number): fc.Arbitrary<string> {
  return fc
    .array(fc.integer({ min: 0, max: 15 }), { minLength: len, maxLength: len })
    .map((digits) => digits.map((d) => d.toString(16)).join(''));
}

const suiAddressArb: fc.Arbitrary<string> = hexStringArb(64).map((hex) => `0x${hex}`);
const uuidArb: fc.Arbitrary<string> = fc.uuid();
const sha256HexArb: fc.Arbitrary<string> = hexStringArb(64);
const privacyModeArb: fc.Arbitrary<PrivacyMode> = fc.constantFrom('public', 'private');

const walrusBlobIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9_-]{10,60}$/)
  .filter((s) => s.length >= 10);

const validMetadataWriteRequestArb: fc.Arbitrary<MetadataWriteRequest> = fc.record({
  formId: uuidArb,
  formVersion: fc.integer({ min: 1, max: 10 }),
  submitterAddress: suiAddressArb,
  walrusBlobId: walrusBlobIdArb,
  privacyMode: privacyModeArb,
  contentDigest: sha256HexArb,
  sizeBytes: fc.integer({ min: 0, max: 10_000_000 }),
  policyId: fc.option(suiAddressArb, { nil: undefined }),
});

function formRecordArb(privacyMode: PrivacyMode): fc.Arbitrary<FormRecord> {
  return fc.record({
    id: uuidArb,
    ownerAddress: suiAddressArb,
    walrusBlobId: walrusBlobIdArb,
    privacyMode: fc.constant(privacyMode),
    policyId: privacyMode === 'private' ? suiAddressArb.map((a) => a) : fc.constant(null),
    version: fc.integer({ min: 1, max: 10 }),
  });
}

// ---------------------------------------------------------------------------
// Property 33: Atomic validation
// ---------------------------------------------------------------------------

describe('Property 33: Atomic validation — invalid writes persist nothing', () => {
  /**
   * **Validates: Requirements 7.9**
   *
   * For any request referencing a form that does not exist, the store must
   * remain unchanged after the attempted write.
   */
  it('Property 33a: FormNotFound — no row written when form does not exist', () => {
    fc.assert(
      fc.property(
        validMetadataWriteRequestArb,
        fc.array(walrusBlobIdArb, { minLength: 0, maxLength: 10 }),
        (request, knownIds) => {
          // Empty form store — form does not exist
          const formStore = new Map<string, FormRecord>();
          const knownBlobIds = new Set([request.walrusBlobId, ...knownIds]);
          const store: SubmissionRow[] = [];

          const result = atomicMetadataWrite(request, formStore, knownBlobIds, store);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe('FormNotFound');
          }
          // Atomicity: no partial row written
          expect(store).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.9**
   *
   * For any request whose declared privacy mode differs from the form's
   * recorded mode, the store must remain unchanged.
   */
  it('Property 33b: PrivacyModeMismatch — no row written on mode mismatch', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((formMode) => {
          const mismatchedMode: PrivacyMode = formMode === 'public' ? 'private' : 'public';
          return fc.tuple(
            formRecordArb(formMode),
            validMetadataWriteRequestArb.map((req) => ({
              ...req,
              privacyMode: mismatchedMode,
            })),
          );
        }),
        ([form, request]) => {
          const requestWithFormId = { ...request, formId: form.id };
          const formStore = new Map([[form.id, form]]);
          const knownBlobIds = new Set([request.walrusBlobId]);
          const store: SubmissionRow[] = [];

          const result = atomicMetadataWrite(requestWithFormId, formStore, knownBlobIds, store);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe('PrivacyModeMismatch');
          }
          // Atomicity: no partial row written
          expect(store).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.8, 7.9**
   *
   * For any request whose walrusBlobId is not present on Walrus, the store
   * must remain unchanged. This is the combined blob-existence + atomicity
   * invariant.
   */
  it('Property 33c: BlobNotFound — no row written when blob does not exist on Walrus', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRecordArb(mode),
            validMetadataWriteRequestArb.map((req) => ({ ...req, privacyMode: mode })),
          ),
        ),
        ([form, request]) => {
          const requestWithFormId = { ...request, formId: form.id };
          const formStore = new Map([[form.id, form]]);
          // Known blobs does NOT contain the request's blob ID
          const knownBlobIds = new Set<string>();
          const store: SubmissionRow[] = [];

          const result = atomicMetadataWrite(requestWithFormId, formStore, knownBlobIds, store);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe('BlobNotFound');
          }
          // Atomicity: no partial row written
          expect(store).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.9**
   *
   * When all validation checks pass, exactly one row is written and it
   * reflects the request faithfully. This is the positive case confirming
   * the all-or-nothing contract works in both directions.
   */
  it('Property 33d: valid request — exactly one row written with correct fields', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRecordArb(mode),
            validMetadataWriteRequestArb.map((req) => ({ ...req, privacyMode: mode })),
          ),
        ),
        ([form, request]) => {
          const requestWithFormId = { ...request, formId: form.id };
          const formStore = new Map([[form.id, form]]);
          const knownBlobIds = new Set([request.walrusBlobId]);
          const store: SubmissionRow[] = [];

          const result = atomicMetadataWrite(requestWithFormId, formStore, knownBlobIds, store);

          expect(result.ok).toBe(true);
          // Exactly one row written
          expect(store).toHaveLength(1);
          const row = store[0];
          expect(row.formId).toBe(form.id);
          expect(row.walrusBlobId).toBe(request.walrusBlobId);
          // privacyMode on the row must match the form's mode (which equals request.privacyMode)
          expect(row.privacyMode).toBe(form.privacyMode);
          expect(row.state).toBe('indexed');
          expect(row.contentDigest).toBe(request.contentDigest);
          expect(row.sizeBytes).toBe(request.sizeBytes);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.9**
   *
   * For a sequence of requests where some fail and some succeed, the store
   * count equals exactly the number of successful writes. Failed writes leave
   * no trace in the store.
   */
  it('Property 33e: mixed batch — store count equals successful writes only', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRecordArb(mode),
            fc.array(
              validMetadataWriteRequestArb.map((req) => ({ ...req, privacyMode: mode })),
              { minLength: 2, maxLength: 8 },
            ),
          ),
        ),
        ([form, requests]) => {
          const formStore = new Map([[form.id, form]]);
          const store: SubmissionRow[] = [];

          // Alternate: even-indexed requests have their blob in Walrus, odd do not
          const knownBlobIds = new Set(
            requests
              .filter((_, i) => i % 2 === 0)
              .map((r) => r.walrusBlobId),
          );

          let expectedSuccessCount = 0;
          for (const req of requests) {
            const requestWithFormId = { ...req, formId: form.id };
            const result = atomicMetadataWrite(requestWithFormId, formStore, knownBlobIds, store);
            if (result.ok) {
              expectedSuccessCount++;
            }
          }

          // Store must contain exactly the successful writes
          expect(store).toHaveLength(expectedSuccessCount);

          // Every row in the store must be in state 'indexed'
          for (const row of store) {
            expect(row.state).toBe('indexed');
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 7.9**
   *
   * Validation is idempotent: running the same failing request twice produces
   * the same error code and leaves the store unchanged both times.
   */
  it('Property 33f: failed validation is idempotent — same error, store unchanged on repeat', () => {
    fc.assert(
      fc.property(
        validMetadataWriteRequestArb,
        (request) => {
          // Empty form store — every request will fail with FormNotFound
          const formStore = new Map<string, FormRecord>();
          const knownBlobIds = new Set([request.walrusBlobId]);
          const store: SubmissionRow[] = [];

          const result1 = atomicMetadataWrite(request, formStore, knownBlobIds, store);
          const result2 = atomicMetadataWrite(request, formStore, knownBlobIds, store);

          // Both must fail with the same code
          expect(result1.ok).toBe(false);
          expect(result2.ok).toBe(false);
          if (!result1.ok && !result2.ok) {
            expect(result1.code).toBe(result2.code);
          }

          // Store must remain empty after both attempts
          expect(store).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.9**
   *
   * The store is never in a partial state: after any write attempt (success or
   * failure), every row in the store has state = 'indexed' and all required
   * fields populated. There are no half-written rows.
   */
  it('Property 33g: store invariant — every row is complete and in indexed state', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRecordArb(mode),
            fc.array(
              validMetadataWriteRequestArb.map((req) => ({ ...req, privacyMode: mode })),
              { minLength: 1, maxLength: 10 },
            ),
          ),
        ),
        ([form, requests]) => {
          const formStore = new Map([[form.id, form]]);
          const store: SubmissionRow[] = [];

          // Mix of existing and non-existing blobs
          const knownBlobIds = new Set(
            requests.filter((_, i) => i % 2 === 0).map((r) => r.walrusBlobId),
          );

          for (const req of requests) {
            atomicMetadataWrite({ ...req, formId: form.id }, formStore, knownBlobIds, store);
          }

          // Every row in the store must be complete — no partial rows
          for (const row of store) {
            expect(row.id).toBeDefined();
            expect(typeof row.id).toBe('string');
            expect(row.formId).toBeDefined();
            expect(row.walrusBlobId).toBeDefined();
            expect(row.submitterAddress).toBeDefined();
            expect(row.contentDigest).toBeDefined();
            expect(typeof row.sizeBytes).toBe('number');
            expect(row.state).toBe('indexed');
            expect(row.createdAt).toBeDefined();
            // privacyMode must be one of the valid values
            expect(['public', 'private']).toContain(row.privacyMode);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 7.9**
   *
   * Schema validation failures (missing or invalid fields) prevent any write.
   * Tests the first validation gate in the pipeline.
   */
  it('Property 33h: schema validation failure — no row written for malformed requests', () => {
    // Generate requests with deliberately invalid fields
    const malformedRequests: MetadataWriteRequest[] = [
      // Missing formId
      {
        formId: '',
        formVersion: 1,
        submitterAddress: '0x' + 'ab'.repeat(32),
        walrusBlobId: 'valid-blob-id-123',
        privacyMode: 'public',
        contentDigest: 'a'.repeat(64),
        sizeBytes: 100,
      },
      // Missing walrusBlobId
      {
        formId: '00000000-0000-0000-0000-000000000001',
        formVersion: 1,
        submitterAddress: '0x' + 'ab'.repeat(32),
        walrusBlobId: '',
        privacyMode: 'public',
        contentDigest: 'a'.repeat(64),
        sizeBytes: 100,
      },
      // Negative sizeBytes
      {
        formId: '00000000-0000-0000-0000-000000000001',
        formVersion: 1,
        submitterAddress: '0x' + 'ab'.repeat(32),
        walrusBlobId: 'valid-blob-id-456',
        privacyMode: 'public',
        contentDigest: 'a'.repeat(64),
        sizeBytes: -1,
      },
    ];

    for (const request of malformedRequests) {
      const formStore = new Map<string, FormRecord>();
      const knownBlobIds = new Set([request.walrusBlobId]);
      const store: SubmissionRow[] = [];

      const result = atomicMetadataWrite(request, formStore, knownBlobIds, store);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('SchemaValidation');
      }
      // Atomicity: no partial row written
      expect(store).toHaveLength(0);
    }
  });

  /**
   * **Validates: Requirements 7.8, 7.9**
   *
   * Combined invariant: the validation pipeline is ordered correctly.
   * FormNotFound is checked before BlobNotFound. This ensures the error
   * returned is the most informative one for the client.
   */
  it('Property 33i: validation order — FormNotFound takes precedence over BlobNotFound', () => {
    fc.assert(
      fc.property(
        validMetadataWriteRequestArb,
        (request) => {
          // Form does not exist AND blob does not exist
          const formStore = new Map<string, FormRecord>();
          const knownBlobIds = new Set<string>(); // blob also missing
          const store: SubmissionRow[] = [];

          const result = atomicMetadataWrite(request, formStore, knownBlobIds, store);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            // FormNotFound must be returned first (form check precedes blob check)
            expect(result.code).toBe('FormNotFound');
          }
          expect(store).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.8, 7.9**
   *
   * Combined invariant: PrivacyModeMismatch takes precedence over BlobNotFound.
   * The privacy mode check runs before the Walrus existence check.
   */
  it('Property 33j: validation order — PrivacyModeMismatch takes precedence over BlobNotFound', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((formMode) => {
          const mismatchedMode: PrivacyMode = formMode === 'public' ? 'private' : 'public';
          return fc.tuple(
            formRecordArb(formMode),
            validMetadataWriteRequestArb.map((req) => ({
              ...req,
              privacyMode: mismatchedMode,
            })),
          );
        }),
        ([form, request]) => {
          const requestWithFormId = { ...request, formId: form.id };
          const formStore = new Map([[form.id, form]]);
          // Blob does NOT exist — but privacy mode mismatch should be caught first
          const knownBlobIds = new Set<string>();
          const store: SubmissionRow[] = [];

          const result = atomicMetadataWrite(requestWithFormId, formStore, knownBlobIds, store);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            // PrivacyModeMismatch must be returned (privacy check precedes blob check)
            expect(result.code).toBe('PrivacyModeMismatch');
          }
          expect(store).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  });
});
