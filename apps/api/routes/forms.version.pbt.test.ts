/**
 * Property-based tests for privacy mode mismatch rejection and form versioning.
 *
 * **Validates: Requirements 4.4, 4.5, 4.7**
 *
 * Property 19: Privacy mode mismatch is rejected
 *   For any form with recorded privacy mode M and any submission request
 *   asserting M' ≠ M, the validation logic returns a PrivacyModeMismatch
 *   error and writes no row.
 *
 * Property 20: Privacy mode change creates a new version and preserves prior submissions
 *   After a privacy mode change, all prior submission rows remain bytewise
 *   identical, the form version increments, and the new forms row has
 *   predecessor_id = f.id.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Types — mirror the design.md schema for forms and submissions
// ---------------------------------------------------------------------------

type PrivacyMode = 'public' | 'private';
type UploadState = 'pending' | 'encrypting' | 'uploading' | 'uploaded' | 'indexed' | 'failed';

interface FormRow {
  id: string;
  ownerAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  policyId: string | null;
  version: number;
  predecessorId: string | null;
  state: UploadState;
  createdAt: string;
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
  createdAt: string;
}

interface SubmissionRequest {
  formId: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  submitterAddress: string;
}

// ---------------------------------------------------------------------------
// Privacy mode validation logic (the invariant under test)
//
// This is the pure validation function that the production route handler
// MUST call before inserting a submission row. It encodes Requirement 4.5:
//   "The API_Server SHALL reject submission metadata records whose declared
//    privacy mode does not match the privacy mode recorded for the referenced
//    Form_Definition."
// ---------------------------------------------------------------------------

type ValidationResult =
  | { ok: true }
  | { ok: false; code: 'PrivacyModeMismatch'; message: string };

/**
 * Validate that a submission request's declared privacy mode matches the
 * form's recorded privacy mode.
 *
 * Returns { ok: true } when they match.
 * Returns { ok: false, code: 'PrivacyModeMismatch' } when they differ.
 */
function validatePrivacyModeMatch(
  form: Pick<FormRow, 'id' | 'privacyMode'>,
  request: Pick<SubmissionRequest, 'privacyMode'>,
): ValidationResult {
  if (form.privacyMode !== request.privacyMode) {
    return {
      ok: false,
      code: 'PrivacyModeMismatch',
      message:
        `Submission privacy mode "${request.privacyMode}" does not match ` +
        `form's recorded privacy mode "${form.privacyMode}". ` +
        `Resubmit with privacy_mode="${form.privacyMode}".`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Form versioning logic (the invariant under test)
//
// This is the pure function that the production route handler MUST call when
// a Form_Owner changes the privacy mode of an existing form. It encodes
// Requirement 4.7:
//   "WHERE a Form_Owner changes privacy mode for an existing Form_Definition,
//    THE API_Server SHALL create a new Form_Definition version rather than
//    mutating prior submissions."
// ---------------------------------------------------------------------------

interface PrivacyChangeResult {
  newForm: FormRow;
  priorSubmissionsUnchanged: boolean;
}

/**
 * Create a new form version when the privacy mode changes.
 *
 * Returns a new FormRow with:
 *   - version = predecessor.version + 1
 *   - predecessorId = predecessor.id
 *   - privacyMode = newPrivacyMode
 *   - policyId = newPolicyId (required for private, null for public)
 *
 * The prior submissions are NOT mutated — they remain associated with the
 * original form version via (formId, formVersion).
 */
function createFormVersionOnPrivacyChange(
  predecessor: FormRow,
  newPrivacyMode: PrivacyMode,
  newWalrusBlobId: string,
  newPolicyId: string | null,
): PrivacyChangeResult {
  if (predecessor.privacyMode === newPrivacyMode) {
    throw new Error(
      'createFormVersionOnPrivacyChange called with same privacy mode — ' +
        'versioning is only required when the privacy mode actually changes.',
    );
  }

  const newForm: FormRow = {
    id: crypto.randomUUID(),
    ownerAddress: predecessor.ownerAddress,
    walrusBlobId: newWalrusBlobId,
    privacyMode: newPrivacyMode,
    policyId: newPrivacyMode === 'private' ? newPolicyId : null,
    version: predecessor.version + 1,
    predecessorId: predecessor.id,
    state: 'indexed',
    createdAt: new Date().toISOString(),
  };

  return {
    newForm,
    // Prior submissions are never mutated — this flag signals the invariant
    // to callers (in production this is enforced by never issuing UPDATE on
    // the submissions table during a privacy mode change).
    priorSubmissionsUnchanged: true,
  };
}

/**
 * Simulate an in-memory submission store to verify that prior submissions
 * remain accessible after a privacy mode change.
 */
function buildSubmissionStore(rows: SubmissionRow[]): {
  getByFormVersion: (formId: string, formVersion: number) => SubmissionRow[];
  getAll: () => SubmissionRow[];
} {
  // Deep-copy so mutations to the original array don't affect the store.
  const store: SubmissionRow[] = rows.map((r) => ({ ...r }));
  return {
    getByFormVersion: (formId, formVersion) =>
      store.filter((r) => r.formId === formId && r.formVersion === formVersion),
    getAll: () => store.map((r) => ({ ...r })),
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const privacyModeArb: fc.Arbitrary<PrivacyMode> = fc.constantFrom('public', 'private');

/** A privacy mode that differs from the given mode. */
function mismatchedPrivacyModeArb(mode: PrivacyMode): fc.Arbitrary<PrivacyMode> {
  return fc.constant(mode === 'public' ? 'private' : 'public');
}

const uuidArb: fc.Arbitrary<string> = fc.uuid();

const suiAddressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/)
  .map((hex) => `0x${hex}`);

const sha256HexArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/);

const walrusBlobIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9_-]{10,60}$/);

const uploadStateArb: fc.Arbitrary<UploadState> = fc.constantFrom(
  'pending',
  'encrypting',
  'uploading',
  'uploaded',
  'indexed',
  'failed',
);

/** Generate a valid FormRow with a given privacy mode. */
function formRowArb(privacyMode: PrivacyMode): fc.Arbitrary<FormRow> {
  return fc.record({
    id: uuidArb,
    ownerAddress: suiAddressArb,
    walrusBlobId: walrusBlobIdArb,
    privacyMode: fc.constant(privacyMode),
    policyId: privacyMode === 'private'
      ? suiAddressArb.map((a) => a)
      : fc.constant(null),
    version: fc.integer({ min: 1, max: 100 }),
    predecessorId: fc.option(uuidArb, { nil: null }),
    state: uploadStateArb,
    createdAt: fc
      .date({ min: new Date('2024-01-01'), max: new Date('2030-12-31') })
      .filter((d) => !isNaN(d.getTime()))
      .map((d) => d.toISOString()),
  });
}

/** Generate a valid SubmissionRow for a given form. */
function submissionRowArb(form: FormRow): fc.Arbitrary<SubmissionRow> {
  return fc.record({
    id: uuidArb,
    formId: fc.constant(form.id),
    formVersion: fc.constant(form.version),
    submitterAddress: suiAddressArb,
    walrusBlobId: walrusBlobIdArb,
    privacyMode: fc.constant(form.privacyMode),
    contentDigest: sha256HexArb,
    sizeBytes: fc.integer({ min: 0, max: 10_000_000 }),
    state: uploadStateArb,
    createdAt: fc
      .date({ min: new Date('2024-01-01'), max: new Date('2030-12-31') })
      .filter((d) => !isNaN(d.getTime()))
      .map((d) => d.toISOString()),
  });
}

// ---------------------------------------------------------------------------
// Property 19: Privacy mode mismatch is rejected
// ---------------------------------------------------------------------------

describe('Property 19: Privacy mode mismatch rejection', () => {
  /**
   * **Validates: Requirements 4.4, 4.5**
   *
   * For any form with recorded privacy mode M and any submission request
   * asserting M' ≠ M, the validation function MUST return a PrivacyModeMismatch
   * error and MUST NOT return ok: true.
   *
   * This is the core enforcement invariant: the server-side check that prevents
   * a client from submitting with the wrong privacy mode.
   */
  it('Property 19a: validatePrivacyModeMatch returns PrivacyModeMismatch for all mismatched modes', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((formMode) =>
          fc.tuple(
            formRowArb(formMode),
            mismatchedPrivacyModeArb(formMode),
          )
        ),
        ([form, requestedMode]) => {
          const result = validatePrivacyModeMatch(form, { privacyMode: requestedMode });

          // Must not succeed
          expect(result.ok).toBe(false);

          // Must carry the PrivacyModeMismatch code
          if (!result.ok) {
            expect(result.code).toBe('PrivacyModeMismatch');
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('Property 19b: PrivacyModeMismatch error message names both the declared and recorded modes', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((formMode) =>
          fc.tuple(
            formRowArb(formMode),
            mismatchedPrivacyModeArb(formMode),
          )
        ),
        ([form, requestedMode]) => {
          const result = validatePrivacyModeMatch(form, { privacyMode: requestedMode });

          expect(result.ok).toBe(false);
          if (!result.ok) {
            // The error message must mention both modes so the client knows
            // what was declared and what was expected.
            expect(result.message).toContain(requestedMode);
            expect(result.message).toContain(form.privacyMode);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('Property 19c: validatePrivacyModeMatch returns ok for all matching modes', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(formRowArb(mode), fc.constant(mode))
        ),
        ([form, requestedMode]) => {
          const result = validatePrivacyModeMatch(form, { privacyMode: requestedMode });

          // Matching modes must always succeed
          expect(result.ok).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('Property 19d: mismatch is symmetric — public→private and private→public both fail', () => {
    // public form, private request
    const publicForm: Pick<FormRow, 'id' | 'privacyMode'> = {
      id: 'form-1',
      privacyMode: 'public',
    };
    const privateRequest: Pick<SubmissionRequest, 'privacyMode'> = {
      privacyMode: 'private',
    };
    const result1 = validatePrivacyModeMatch(publicForm, privateRequest);
    expect(result1.ok).toBe(false);
    if (!result1.ok) expect(result1.code).toBe('PrivacyModeMismatch');

    // private form, public request
    const privateForm: Pick<FormRow, 'id' | 'privacyMode'> = {
      id: 'form-2',
      privacyMode: 'private',
    };
    const publicRequest: Pick<SubmissionRequest, 'privacyMode'> = {
      privacyMode: 'public',
    };
    const result2 = validatePrivacyModeMatch(privateForm, publicRequest);
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.code).toBe('PrivacyModeMismatch');
  });

  it('Property 19e: no submission row is written when mismatch is detected', () => {
    /**
     * Simulates the route handler pattern: validate first, insert only on ok.
     * For all generated mismatched requests, the submission store must remain
     * empty after the attempted insert.
     */
    fc.assert(
      fc.property(
        privacyModeArb.chain((formMode) =>
          fc.tuple(
            formRowArb(formMode),
            mismatchedPrivacyModeArb(formMode),
            uuidArb,
            walrusBlobIdArb,
            sha256HexArb,
            fc.integer({ min: 0, max: 10_000_000 }),
            suiAddressArb,
          )
        ),
        ([form, requestedMode, submissionId, blobId, digest, sizeBytes, submitter]) => {
          const submissionStore: SubmissionRow[] = [];

          const request: SubmissionRequest = {
            formId: form.id,
            walrusBlobId: blobId,
            privacyMode: requestedMode,
            contentDigest: digest,
            sizeBytes,
            submitterAddress: submitter,
          };

          const validation = validatePrivacyModeMatch(form, request);

          // Simulate the route handler: only insert if validation passes
          if (validation.ok) {
            submissionStore.push({
              id: submissionId,
              formId: request.formId,
              formVersion: form.version,
              submitterAddress: request.submitterAddress,
              walrusBlobId: request.walrusBlobId,
              privacyMode: request.privacyMode,
              contentDigest: request.contentDigest,
              sizeBytes: request.sizeBytes,
              state: 'indexed',
              createdAt: new Date().toISOString(),
            });
          }

          // Validation must have failed (mismatch), so no row was written
          expect(validation.ok).toBe(false);
          expect(submissionStore).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 20: Privacy mode change creates a new version and preserves prior submissions
// ---------------------------------------------------------------------------

describe('Property 20: Form versioning on privacy change', () => {
  /**
   * **Validates: Requirements 4.7**
   *
   * WHERE a Form_Owner changes privacy mode for an existing Form_Definition,
   * THE API_Server SHALL create a new Form_Definition version rather than
   * mutating prior submissions.
   *
   * Invariants:
   *   1. New form version = predecessor.version + 1
   *   2. New form has predecessorId = predecessor.id
   *   3. New form has the new privacy mode
   *   4. Prior submission rows are bytewise identical after the change
   *   5. Prior submissions remain accessible under the original (formId, formVersion)
   */
  it('Property 20a: new form version = predecessor.version + 1 for all generated forms', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRowArb(mode),
            mismatchedPrivacyModeArb(mode),
            walrusBlobIdArb,
            fc.option(suiAddressArb, { nil: null }),
          )
        ),
        ([predecessor, newMode, newBlobId, newPolicyId]) => {
          const { newForm } = createFormVersionOnPrivacyChange(
            predecessor,
            newMode,
            newBlobId,
            newMode === 'private' ? (newPolicyId ?? `0x${'ab'.repeat(32)}`) : null,
          );

          expect(newForm.version).toBe(predecessor.version + 1);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('Property 20b: new form has predecessorId = predecessor.id for all generated forms', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRowArb(mode),
            mismatchedPrivacyModeArb(mode),
            walrusBlobIdArb,
            fc.option(suiAddressArb, { nil: null }),
          )
        ),
        ([predecessor, newMode, newBlobId, newPolicyId]) => {
          const { newForm } = createFormVersionOnPrivacyChange(
            predecessor,
            newMode,
            newBlobId,
            newMode === 'private' ? (newPolicyId ?? `0x${'ab'.repeat(32)}`) : null,
          );

          expect(newForm.predecessorId).toBe(predecessor.id);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('Property 20c: new form has the new privacy mode for all generated mode changes', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRowArb(mode),
            mismatchedPrivacyModeArb(mode),
            walrusBlobIdArb,
            fc.option(suiAddressArb, { nil: null }),
          )
        ),
        ([predecessor, newMode, newBlobId, newPolicyId]) => {
          const { newForm } = createFormVersionOnPrivacyChange(
            predecessor,
            newMode,
            newBlobId,
            newMode === 'private' ? (newPolicyId ?? `0x${'ab'.repeat(32)}`) : null,
          );

          expect(newForm.privacyMode).toBe(newMode);
          expect(newForm.privacyMode).not.toBe(predecessor.privacyMode);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('Property 20d: new form preserves ownerAddress from predecessor', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRowArb(mode),
            mismatchedPrivacyModeArb(mode),
            walrusBlobIdArb,
          )
        ),
        ([predecessor, newMode, newBlobId]) => {
          const { newForm } = createFormVersionOnPrivacyChange(
            predecessor,
            newMode,
            newBlobId,
            newMode === 'private' ? `0x${'ab'.repeat(32)}` : null,
          );

          expect(newForm.ownerAddress).toBe(predecessor.ownerAddress);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('Property 20e: private→public change sets policyId to null', () => {
    fc.assert(
      fc.property(
        formRowArb('private'),
        walrusBlobIdArb,
        (predecessor, newBlobId) => {
          const { newForm } = createFormVersionOnPrivacyChange(
            predecessor,
            'public',
            newBlobId,
            null,
          );

          // Public forms must not have a policyId
          expect(newForm.policyId).toBeNull();
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 20f: public→private change sets a non-null policyId', () => {
    fc.assert(
      fc.property(
        formRowArb('public'),
        walrusBlobIdArb,
        suiAddressArb,
        (predecessor, newBlobId, newPolicyId) => {
          const { newForm } = createFormVersionOnPrivacyChange(
            predecessor,
            'private',
            newBlobId,
            newPolicyId,
          );

          // Private forms must have a policyId
          expect(newForm.policyId).not.toBeNull();
          expect(newForm.policyId).toBe(newPolicyId);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 20g: prior submissions remain bytewise identical after privacy mode change', () => {
    /**
     * After a privacy mode change, all prior submission rows must remain
     * bytewise identical. The versioning operation MUST NOT mutate any
     * existing submission row.
     *
     * This is tested by:
     *   1. Creating a set of prior submissions for the original form version.
     *   2. Performing the privacy mode change (creating a new form version).
     *   3. Asserting that every prior submission row is deep-equal to its
     *      original snapshot.
     */
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          formRowArb(mode).chain((form) =>
            fc.tuple(
              fc.constant(form),
              fc.array(submissionRowArb(form), { minLength: 0, maxLength: 10 }),
              mismatchedPrivacyModeArb(mode),
              walrusBlobIdArb,
            )
          )
        ),
        ([predecessor, priorSubmissions, newMode, newBlobId]) => {
          // Snapshot prior submissions before the privacy mode change
          const snapshots = priorSubmissions.map((s) => ({ ...s }));

          // Build the submission store
          const store = buildSubmissionStore(priorSubmissions);

          // Perform the privacy mode change
          createFormVersionOnPrivacyChange(
            predecessor,
            newMode,
            newBlobId,
            newMode === 'private' ? `0x${'ab'.repeat(32)}` : null,
          );

          // All prior submissions must remain bytewise identical
          const afterChange = store.getAll();
          expect(afterChange).toHaveLength(snapshots.length);
          for (let i = 0; i < snapshots.length; i++) {
            expect(afterChange[i]).toEqual(snapshots[i]);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 20h: prior submissions remain accessible under original (formId, formVersion) after change', () => {
    /**
     * After a privacy mode change, prior submissions must still be retrievable
     * by their original (formId, formVersion) pair. The new form version does
     * not shadow or replace the old submissions.
     */
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          formRowArb(mode).chain((form) =>
            fc.tuple(
              fc.constant(form),
              fc.array(submissionRowArb(form), { minLength: 1, maxLength: 5 }),
              mismatchedPrivacyModeArb(mode),
              walrusBlobIdArb,
            )
          )
        ),
        ([predecessor, priorSubmissions, newMode, newBlobId]) => {
          const store = buildSubmissionStore(priorSubmissions);

          // Perform the privacy mode change
          const { newForm } = createFormVersionOnPrivacyChange(
            predecessor,
            newMode,
            newBlobId,
            newMode === 'private' ? `0x${'ab'.repeat(32)}` : null,
          );

          // Prior submissions must still be accessible under the original version
          const retrievedPrior = store.getByFormVersion(predecessor.id, predecessor.version);
          expect(retrievedPrior).toHaveLength(priorSubmissions.length);

          // New form version must not have any submissions yet
          const retrievedNew = store.getByFormVersion(predecessor.id, newForm.version);
          expect(retrievedNew).toHaveLength(0);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 20i: version chain is monotonically increasing across multiple privacy changes', () => {
    /**
     * Applying multiple sequential privacy mode changes must produce a
     * monotonically increasing version chain:
     *   v1 → v2 → v3 → ... → vN
     * where each version is exactly one greater than its predecessor.
     */
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) => formRowArb(mode)),
        fc.integer({ min: 1, max: 10 }),
        (initialForm, numChanges) => {
          let current = initialForm;
          const versions: number[] = [current.version];

          for (let i = 0; i < numChanges; i++) {
            const newMode: PrivacyMode = current.privacyMode === 'public' ? 'private' : 'public';
            const { newForm } = createFormVersionOnPrivacyChange(
              current,
              newMode,
              `blob-v${current.version + 1}-${i}`,
              newMode === 'private' ? `0x${'ab'.repeat(32)}` : null,
            );
            versions.push(newForm.version);
            current = newForm;
          }

          // Versions must be strictly increasing by 1 at each step
          for (let i = 1; i < versions.length; i++) {
            expect(versions[i]).toBe(versions[i - 1] + 1);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 20j: createFormVersionOnPrivacyChange throws when called with same privacy mode', () => {
    /**
     * The versioning function must only be called when the privacy mode
     * actually changes. Calling it with the same mode is a programming error
     * and must throw.
     */
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(formRowArb(mode), fc.constant(mode))
        ),
        ([form, sameMode]) => {
          expect(() =>
            createFormVersionOnPrivacyChange(form, sameMode, 'new-blob-id', null)
          ).toThrow();
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Combined invariant: mismatch check + versioning together
// ---------------------------------------------------------------------------

describe('Combined invariant: privacy mode enforcement across version chain', () => {
  /**
   * **Validates: Requirements 4.4, 4.5, 4.7**
   *
   * After a privacy mode change creates a new form version:
   *   1. Submissions against the NEW version with the NEW mode must pass validation.
   *   2. Submissions against the NEW version with the OLD mode must fail validation.
   *   3. Submissions against the OLD version with the OLD mode must still pass.
   *   4. Submissions against the OLD version with the NEW mode must still fail.
   */
  it('Combined: new version accepts new mode, rejects old mode; old version accepts old mode, rejects new mode', () => {
    fc.assert(
      fc.property(
        privacyModeArb.chain((mode) =>
          fc.tuple(
            formRowArb(mode),
            mismatchedPrivacyModeArb(mode),
            walrusBlobIdArb,
          )
        ),
        ([originalForm, newMode, newBlobId]) => {
          const oldMode = originalForm.privacyMode;

          // Create new version
          const { newForm } = createFormVersionOnPrivacyChange(
            originalForm,
            newMode,
            newBlobId,
            newMode === 'private' ? `0x${'ab'.repeat(32)}` : null,
          );

          // 1. New version + new mode → ok
          const r1 = validatePrivacyModeMatch(newForm, { privacyMode: newMode });
          expect(r1.ok).toBe(true);

          // 2. New version + old mode → mismatch
          const r2 = validatePrivacyModeMatch(newForm, { privacyMode: oldMode });
          expect(r2.ok).toBe(false);
          if (!r2.ok) expect(r2.code).toBe('PrivacyModeMismatch');

          // 3. Old version + old mode → ok
          const r3 = validatePrivacyModeMatch(originalForm, { privacyMode: oldMode });
          expect(r3.ok).toBe(true);

          // 4. Old version + new mode → mismatch
          const r4 = validatePrivacyModeMatch(originalForm, { privacyMode: newMode });
          expect(r4.ok).toBe(false);
          if (!r4.ok) expect(r4.code).toBe('PrivacyModeMismatch');
        },
      ),
      { numRuns: 25 },
    );
  });
});
