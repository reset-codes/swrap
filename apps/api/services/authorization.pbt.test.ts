/**
 * Property-based tests for the authorization service.
 *
 * **Validates: Requirements 7.4**
 *
 * Properties implemented:
 *
 *   Property 30: Authorization gating on metadata writes
 *     For generated metadata write requests where session address differs from
 *     form owner, assert API returns 403, no row is written, and an `activity`
 *     row with `outcome = "denied"` is appended.
 *
 *   Property 12.1: Authorization precedence invariant
 *     `seal-orchestrator.decryptPayload` is only called after a passing
 *     `assertDecryptionAuthorized` check.
 *
 *   Property 12.2: Rejection invariant
 *     For generated unauthorized Authorization_Identity requests, API returns
 *     HTTP 403 and no Seal decryption operation is invoked.
 *
 *   Property 12.3: Audit completeness
 *     For generated decryption operations, count of `audit_log` entries equals
 *     count of decryption attempts.
 *
 * Test strategy:
 *   All four properties are tested directly against the authorization service
 *   functions (`assertOwner`, `assertViewerOrOwner`, `assertDecryptionAuthorized`)
 *   from `authorization.ts`. No HTTP server is needed — the service functions
 *   are pure async functions that accept a minimal `AuthDb` interface.
 *
 *   The `sealDecrypt` function is tracked via a call counter to verify the
 *   authorization-precedence and rejection invariants (Properties 12.1, 12.2).
 *
 * Requirements: 7.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  assertOwner,
  assertViewerOrOwner,
  assertDecryptionAuthorized,
  ForbiddenError,
  type AuthDb,
  type ViewerPermissionRecord,
} from './authorization';
import {
  _auditLogStore,
  _resetAuditLogStore,
} from './audit-log';
import type { FormRecord, SubmissionRecord } from './metadata-orchestrator';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetAuditLogStore();
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a valid Sui address (0x + 64 hex chars) */
const suiAddressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/)
  .filter((s) => s.length === 64)
  .map((hex) => `0x${hex}`);

/** Generate a UUID */
const uuidArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[0-9a-f]{8}$/).filter((s) => s.length === 8),
    fc.stringMatching(/^[0-9a-f]{4}$/).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{4}$/).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{4}$/).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{12}$/).filter((s) => s.length === 12),
  )
  .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

/** Generate a pair of distinct Sui addresses */
const distinctAddressPairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(suiAddressArb, suiAddressArb)
  .filter(([a, b]) => a !== b);

/** Generate a FormRecord */
const formRecordArb: fc.Arbitrary<FormRecord> = fc
  .tuple(uuidArb, suiAddressArb)
  .map(([id, ownerAddress]) => ({
    id,
    privacyMode: 'private' as const,
    ownerAddress,
    walrusBlobId: `blob-${id.slice(0, 8)}`,
    policyId: `policy-${id.slice(0, 8)}`,
    version: 1,
    predecessorId: null,
    state: 'indexed' as const,
    contentDigest: 'a'.repeat(64),
    sizeBytes: 100,
    createdAt: new Date().toISOString(),
  }));

/** Generate a SubmissionRecord */
const submissionRecordArb: fc.Arbitrary<SubmissionRecord> = fc
  .tuple(uuidArb, uuidArb, suiAddressArb)
  .map(([id, formId, submitterAddress]) => ({
    id,
    formId,
    formVersion: 1,
    submitterAddress,
    walrusBlobId: `sub-blob-${id.slice(0, 8)}`,
    privacyMode: 'private' as const,
    contentDigest: 'b'.repeat(64),
    sizeBytes: 50,
    state: 'indexed' as const,
    policyId: `policy-${formId.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
  }));

// ---------------------------------------------------------------------------
// AuthDb factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal AuthDb backed by in-memory maps.
 */
function buildDb(
  forms: FormRecord[] = [],
  permissions: ViewerPermissionRecord[] = [],
  submissions: SubmissionRecord[] = [],
): AuthDb {
  const formMap = new Map(forms.map((f) => [f.id, f]));
  const permMap = new Map(
    permissions.map((p) => [`${p.formId}:${p.granteeAddress}`, p]),
  );
  const subMap = new Map(submissions.map((s) => [s.id, s]));

  return {
    getForm: (formId) => formMap.get(formId),
    getViewerPermission: (formId, granteeAddress) =>
      permMap.get(`${formId}:${granteeAddress}`),
    getSubmission: (submissionId) => subMap.get(submissionId),
  };
}

// ---------------------------------------------------------------------------
// Property 30: Authorization gating on metadata writes
//
// **Validates: Requirements 7.4**
//
// For generated metadata write requests where session address differs from
// form owner, assertOwner MUST:
//   1. Throw ForbiddenError (→ caller returns 403)
//   2. Write no submission row (caller responsibility, but the throw ensures it)
//   3. Append an audit_log row with outcome = "denied"
// ---------------------------------------------------------------------------

describe('Property 30: Authorization gating on metadata writes', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated (form, actorAddress) pairs where actorAddress ≠ ownerAddress,
   * assertOwner MUST throw ForbiddenError and append exactly one audit entry
   * with authorizationResult = "denied" and outcome = "denied".
   */
  it('Property 30a: assertOwner throws ForbiddenError and records denied audit entry when actor ≠ owner', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        async (form, actorAddress) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const db = buildDb([form]);

          await expect(
            assertOwner(actorAddress, form.id, db),
          ).rejects.toThrow(ForbiddenError);

          // Exactly one audit entry must be written
          expect(_auditLogStore).toHaveLength(1);
          const entry = _auditLogStore[0];
          expect(entry.authorizationResult).toBe('denied');
          expect(entry.outcome).toBe('denied');
          expect(entry.httpStatus).toBe(403);
          expect(entry.actorAddress).toBe(actorAddress);
          expect(entry.formId).toBe(form.id);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated forms, assertOwner MUST succeed (not throw) when the
   * actor address equals the form owner address, and append an audit entry
   * with authorizationResult = "granted" and outcome = "ok".
   */
  it('Property 30b: assertOwner succeeds and records granted audit entry when actor === owner', async () => {
    await fc.assert(
      fc.asyncProperty(formRecordArb, async (form) => {
        _resetAuditLogStore();
        const db = buildDb([form]);

        await expect(
          assertOwner(form.ownerAddress, form.id, db),
        ).resolves.toBeUndefined();

        expect(_auditLogStore).toHaveLength(1);
        const entry = _auditLogStore[0];
        expect(entry.authorizationResult).toBe('granted');
        expect(entry.outcome).toBe('ok');
        expect(entry.actorAddress).toBe(form.ownerAddress);
        expect(entry.formId).toBe(form.id);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated distinct address pairs (owner, actor):
   *   - owner passes → audit entry with outcome = "ok"
   *   - actor fails → audit entry with outcome = "denied"
   *
   * Authorization is asymmetric.
   */
  it('Property 30c: authorization is asymmetric — owner passes, non-owner fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        distinctAddressPairArb,
        async (form, [ownerAddr, actorAddr]) => {
          const formWithOwner = { ...form, ownerAddress: ownerAddr };

          // Non-owner attempt
          _resetAuditLogStore();
          const db = buildDb([formWithOwner]);

          await expect(
            assertOwner(actorAddr, form.id, db),
          ).rejects.toThrow(ForbiddenError);

          expect(_auditLogStore[0].outcome).toBe('denied');
          expect(_auditLogStore[0].httpStatus).toBe(403);

          // Owner attempt
          _resetAuditLogStore();
          const db2 = buildDb([formWithOwner]);

          await expect(
            assertOwner(ownerAddr, form.id, db2),
          ).resolves.toBeUndefined();

          expect(_auditLogStore[0].outcome).toBe('ok');
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * assertOwner MUST always record exactly one audit entry per call —
   * never zero, never more than one.
   */
  it('Property 30d: assertOwner always records exactly one audit entry per call', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        async (form, actorAddress) => {
          _resetAuditLogStore();
          const db = buildDb([form]);

          try {
            await assertOwner(actorAddress, form.id, db);
          } catch {
            // ForbiddenError expected for non-owners
          }

          expect(_auditLogStore).toHaveLength(1);
          expect(['ok', 'denied', 'error']).toContain(_auditLogStore[0].outcome);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * ForbiddenError MUST carry the actor address and form ID for structured
   * logging, but MUST NOT contain sensitive payload content.
   */
  it('Property 30e: ForbiddenError carries actor address and form ID, not payload content', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        fc.string({ minLength: 8, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9]+$/.test(s)),
        async (form, actorAddress, sensitivePayload) => {
          fc.pre(actorAddress !== form.ownerAddress);
          fc.pre(!form.ownerAddress.includes(sensitivePayload));
          fc.pre(!actorAddress.includes(sensitivePayload));
          fc.pre(!form.id.includes(sensitivePayload));

          _resetAuditLogStore();
          const db = buildDb([form]);

          let caughtError: ForbiddenError | null = null;
          try {
            await assertOwner(actorAddress, form.id, db);
          } catch (err) {
            if (err instanceof ForbiddenError) {
              caughtError = err;
            }
          }

          expect(caughtError).not.toBeNull();
          expect(caughtError!.actorAddress).toBe(actorAddress);
          expect(caughtError!.formId).toBe(form.id);
          expect(caughtError!.message).not.toContain(sensitivePayload);
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * assertViewerOrOwner MUST throw ForbiddenError and record a denied audit
   * entry when the actor is neither the form owner nor has a viewer permission.
   */
  it('Property 30f: assertViewerOrOwner throws ForbiddenError when actor has no access', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        async (form, actorAddress) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          // No viewer permissions granted
          const db = buildDb([form]);

          await expect(
            assertViewerOrOwner(actorAddress, form.id, null, db),
          ).rejects.toThrow(ForbiddenError);

          expect(_auditLogStore).toHaveLength(1);
          expect(_auditLogStore[0].authorizationResult).toBe('denied');
          expect(_auditLogStore[0].outcome).toBe('denied');
          expect(_auditLogStore[0].httpStatus).toBe(403);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * assertViewerOrOwner MUST succeed when the actor has a viewer permission
   * grant for the form.
   */
  it('Property 30g: assertViewerOrOwner succeeds when actor has viewer permission', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        fc.constantFrom('view' as const, 'submit' as const, 'manage' as const),
        async (form, actorAddress, capability) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const permission: ViewerPermissionRecord = {
            formId: form.id,
            granteeAddress: actorAddress,
            capability,
            grantedByAddress: form.ownerAddress,
          };
          const db = buildDb([form], [permission]);

          await expect(
            assertViewerOrOwner(actorAddress, form.id, null, db),
          ).resolves.toBeUndefined();

          expect(_auditLogStore).toHaveLength(1);
          expect(_auditLogStore[0].authorizationResult).toBe('granted');
          expect(_auditLogStore[0].outcome).toBe('ok');
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12.1: Authorization precedence invariant
//
// **Validates: Requirements 7.4**
//
// `seal-orchestrator.decryptPayload` is only called after a passing
// `assertDecryptionAuthorized` check. We model this by tracking whether
// assertDecryptionAuthorized threw before a hypothetical sealDecrypt call.
// ---------------------------------------------------------------------------

describe('Property 12.1: Authorization precedence invariant', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated authorized actors (form owner), assertDecryptionAuthorized
   * MUST resolve (not throw), meaning sealDecrypt would be allowed to proceed.
   * The audit entry must have authorizationResult = "granted".
   */
  it('Property 12.1a: assertDecryptionAuthorized resolves for the form owner (sealDecrypt may proceed)', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        uuidArb,
        async (form, submissionId) => {
          _resetAuditLogStore();
          const db = buildDb([form]);

          // Track whether authorization passed before a hypothetical sealDecrypt call
          let authorizationPassed = false;

          await assertDecryptionAuthorized(form.ownerAddress, form.id, submissionId, db);
          authorizationPassed = true;

          // sealDecrypt would only be called here, after authorization passed
          expect(authorizationPassed).toBe(true);

          // Audit entry must record granted authorization
          expect(_auditLogStore).toHaveLength(1);
          expect(_auditLogStore[0].authorizationResult).toBe('granted');
          expect(_auditLogStore[0].outcome).toBe('ok');
          expect(_auditLogStore[0].action).toBe('submission.decrypt');
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated unauthorized actors, assertDecryptionAuthorized MUST
   * throw ForbiddenError BEFORE any sealDecrypt call could be made.
   * This enforces the authorization-precedence invariant.
   */
  it('Property 12.1b: assertDecryptionAuthorized throws before sealDecrypt for unauthorized actors', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const db = buildDb([form]);

          // Track whether sealDecrypt would have been called
          let sealDecryptWouldBeCalled = false;

          try {
            await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
            // If we reach here, authorization passed — sealDecrypt would be called
            sealDecryptWouldBeCalled = true;
          } catch (err) {
            // Authorization failed — sealDecrypt must NOT be called
            expect(err).toBeInstanceOf(ForbiddenError);
            sealDecryptWouldBeCalled = false;
          }

          // For unauthorized actors, sealDecrypt must never be reached
          expect(sealDecryptWouldBeCalled).toBe(false);

          // Audit entry must record denied authorization
          expect(_auditLogStore).toHaveLength(1);
          expect(_auditLogStore[0].authorizationResult).toBe('denied');
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated actors with 'view' or 'manage' viewer permission,
   * assertDecryptionAuthorized MUST resolve (authorization passes, sealDecrypt
   * may proceed). Actors with only 'submit' permission must be rejected.
   */
  it('Property 12.1c: assertDecryptionAuthorized respects capability hierarchy (view/manage pass, submit fails)', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          // Test 'view' capability — should pass
          _resetAuditLogStore();
          const viewPerm: ViewerPermissionRecord = {
            formId: form.id,
            granteeAddress: actorAddress,
            capability: 'view',
            grantedByAddress: form.ownerAddress,
          };
          const dbView = buildDb([form], [viewPerm]);

          await expect(
            assertDecryptionAuthorized(actorAddress, form.id, submissionId, dbView),
          ).resolves.toBeUndefined();
          expect(_auditLogStore[0].authorizationResult).toBe('granted');

          // Test 'manage' capability — should pass
          _resetAuditLogStore();
          const managePerm: ViewerPermissionRecord = {
            formId: form.id,
            granteeAddress: actorAddress,
            capability: 'manage',
            grantedByAddress: form.ownerAddress,
          };
          const dbManage = buildDb([form], [managePerm]);

          await expect(
            assertDecryptionAuthorized(actorAddress, form.id, submissionId, dbManage),
          ).resolves.toBeUndefined();
          expect(_auditLogStore[0].authorizationResult).toBe('granted');

          // Test 'submit' capability — should fail (submit does not grant decryption)
          _resetAuditLogStore();
          const submitPerm: ViewerPermissionRecord = {
            formId: form.id,
            granteeAddress: actorAddress,
            capability: 'submit',
            grantedByAddress: form.ownerAddress,
          };
          const dbSubmit = buildDb([form], [submitPerm]);

          await expect(
            assertDecryptionAuthorized(actorAddress, form.id, submissionId, dbSubmit),
          ).rejects.toThrow(ForbiddenError);
          expect(_auditLogStore[0].authorizationResult).toBe('denied');
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * When the form is not found, assertDecryptionAuthorized MUST treat the
   * missing form as an authorization rejection (Requirement 7.3) and throw
   * ForbiddenError. sealDecrypt must not be called.
   */
  it('Property 12.1d: assertDecryptionAuthorized rejects when form is not found (treats as denial)', async () => {
    await fc.assert(
      fc.asyncProperty(
        suiAddressArb,
        uuidArb,
        uuidArb,
        async (actorAddress, formId, submissionId) => {
          _resetAuditLogStore();
          // Empty db — form does not exist
          const db = buildDb([]);

          await expect(
            assertDecryptionAuthorized(actorAddress, formId, submissionId, db),
          ).rejects.toThrow(ForbiddenError);

          // Audit entry must record denied authorization
          expect(_auditLogStore).toHaveLength(1);
          expect(_auditLogStore[0].authorizationResult).toBe('denied');
          expect(_auditLogStore[0].outcome).toBe('denied');
          expect(_auditLogStore[0].httpStatus).toBe(403);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12.2: Rejection invariant
//
// **Validates: Requirements 7.4**
//
// For generated unauthorized Authorization_Identity requests, API returns
// HTTP 403 and no Seal decryption operation is invoked.
//
// We model "no Seal decryption invoked" by verifying that assertDecryptionAuthorized
// throws ForbiddenError before any sealDecrypt call could be made. A sealDecrypt
// call counter tracks whether decryption was attempted.
// ---------------------------------------------------------------------------

describe('Property 12.2: Rejection invariant', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated unauthorized actors (not owner, no viewer permission),
   * assertDecryptionAuthorized MUST throw ForbiddenError with HTTP 403 context,
   * and the sealDecrypt call counter MUST remain at zero.
   */
  it('Property 12.2a: unauthorized actor gets ForbiddenError (403) and sealDecrypt is never called', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const db = buildDb([form]); // No viewer permissions

          // Track sealDecrypt invocations
          let sealDecryptCallCount = 0;
          const mockSealDecrypt = () => {
            sealDecryptCallCount++;
          };

          let threwForbidden = false;
          try {
            await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
            // If we reach here, authorization passed — call mock sealDecrypt
            mockSealDecrypt();
          } catch (err) {
            if (err instanceof ForbiddenError) {
              threwForbidden = true;
            } else {
              throw err;
            }
          }

          // Must have thrown ForbiddenError
          expect(threwForbidden).toBe(true);

          // sealDecrypt must NOT have been called
          expect(sealDecryptCallCount).toBe(0);

          // Audit entry must record denied authorization with HTTP 403
          expect(_auditLogStore).toHaveLength(1);
          expect(_auditLogStore[0].authorizationResult).toBe('denied');
          expect(_auditLogStore[0].httpStatus).toBe(403);
          expect(_auditLogStore[0].actorAddress).toBe(actorAddress);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated authorized actors (form owner), assertDecryptionAuthorized
   * MUST resolve, and sealDecrypt IS allowed to be called (call count = 1).
   * This is the positive case confirming the invariant is not over-restrictive.
   */
  it('Property 12.2b: authorized actor (owner) allows sealDecrypt to be called', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        uuidArb,
        async (form, submissionId) => {
          _resetAuditLogStore();
          const db = buildDb([form]);

          let sealDecryptCallCount = 0;
          const mockSealDecrypt = () => {
            sealDecryptCallCount++;
          };

          await assertDecryptionAuthorized(form.ownerAddress, form.id, submissionId, db);
          // Authorization passed — sealDecrypt may be called
          mockSealDecrypt();

          expect(sealDecryptCallCount).toBe(1);
          expect(_auditLogStore[0].authorizationResult).toBe('granted');
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated actors with 'submit'-only permission (insufficient for
   * decryption), assertDecryptionAuthorized MUST throw ForbiddenError and
   * sealDecrypt must not be called.
   */
  it('Property 12.2c: actor with submit-only permission gets 403 and sealDecrypt is not called', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const submitPerm: ViewerPermissionRecord = {
            formId: form.id,
            granteeAddress: actorAddress,
            capability: 'submit',
            grantedByAddress: form.ownerAddress,
          };
          const db = buildDb([form], [submitPerm]);

          let sealDecryptCallCount = 0;
          const mockSealDecrypt = () => {
            sealDecryptCallCount++;
          };

          let threwForbidden = false;
          try {
            await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
            mockSealDecrypt();
          } catch (err) {
            if (err instanceof ForbiddenError) {
              threwForbidden = true;
            } else {
              throw err;
            }
          }

          expect(threwForbidden).toBe(true);
          expect(sealDecryptCallCount).toBe(0);
          expect(_auditLogStore[0].authorizationResult).toBe('denied');
          expect(_auditLogStore[0].httpStatus).toBe(403);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated actors with 'view' permission, assertDecryptionAuthorized
   * MUST resolve and sealDecrypt IS allowed to be called.
   */
  it('Property 12.2d: actor with view permission allows sealDecrypt to be called', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const viewPerm: ViewerPermissionRecord = {
            formId: form.id,
            granteeAddress: actorAddress,
            capability: 'view',
            grantedByAddress: form.ownerAddress,
          };
          const db = buildDb([form], [viewPerm]);

          let sealDecryptCallCount = 0;
          const mockSealDecrypt = () => {
            sealDecryptCallCount++;
          };

          await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
          mockSealDecrypt();

          expect(sealDecryptCallCount).toBe(1);
          expect(_auditLogStore[0].authorizationResult).toBe('granted');
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12.3: Audit completeness
//
// **Validates: Requirements 7.4**
//
// For generated decryption operations, count of `audit_log` entries equals
// count of decryption attempts. Every call to assertDecryptionAuthorized
// (whether it succeeds or fails) MUST produce exactly one audit entry.
// ---------------------------------------------------------------------------

describe('Property 12.3: Audit completeness', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated sequences of N decryption attempts (mix of authorized
   * and unauthorized), the audit_log MUST contain exactly N entries.
   *
   * This is the core audit completeness invariant: one audit entry per
   * decryption attempt, regardless of outcome.
   */
  it('Property 12.3a: audit_log entry count equals decryption attempt count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(formRecordArb, suiAddressArb, uuidArb),
          { minLength: 1, maxLength: 8 },
        ),
        async (attempts) => {
          _resetAuditLogStore();

          let attemptCount = 0;

          for (const [form, actorAddress, submissionId] of attempts) {
            const db = buildDb([form]);
            try {
              await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
            } catch {
              // ForbiddenError expected for non-owners — still counts as an attempt
            }
            attemptCount++;
          }

          // Audit log must have exactly one entry per attempt
          expect(_auditLogStore).toHaveLength(attemptCount);
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated single decryption attempts, assertDecryptionAuthorized
   * MUST produce exactly one audit entry — never zero, never more than one.
   */
  it('Property 12.3b: each assertDecryptionAuthorized call produces exactly one audit entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          _resetAuditLogStore();
          const db = buildDb([form]);

          try {
            await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
          } catch {
            // ForbiddenError expected for non-owners
          }

          expect(_auditLogStore).toHaveLength(1);
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated successful decryption operations (authorized actor),
   * the audit entry MUST reference the same actorAddress, formId, and
   * submissionId as the operation (attribution invariant).
   */
  it('Property 12.3c: audit entry attributes match the decryption operation (attribution invariant)', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        uuidArb,
        async (form, submissionId) => {
          _resetAuditLogStore();
          const db = buildDb([form]);

          await assertDecryptionAuthorized(form.ownerAddress, form.id, submissionId, db);

          expect(_auditLogStore).toHaveLength(1);
          const entry = _auditLogStore[0];
          expect(entry.actorAddress).toBe(form.ownerAddress);
          expect(entry.formId).toBe(form.id);
          expect(entry.submissionId).toBe(submissionId);
          expect(entry.action).toBe('submission.decrypt');
          expect(entry.authorizationResult).toBe('granted');
          expect(entry.outcome).toBe('ok');
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated failed authorization attempts, the audit entry MUST
   * have authorizationResult = "denied" and httpStatus = 403.
   * (Rejection-audit invariant)
   */
  it('Property 12.3d: rejected decryption attempts produce audit entries with authorizationResult = denied', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const db = buildDb([form]); // No viewer permissions

          await expect(
            assertDecryptionAuthorized(actorAddress, form.id, submissionId, db),
          ).rejects.toThrow(ForbiddenError);

          expect(_auditLogStore).toHaveLength(1);
          const entry = _auditLogStore[0];
          expect(entry.authorizationResult).toBe('denied');
          expect(entry.httpStatus).toBe(403);
          expect(entry.actorAddress).toBe(actorAddress);
          expect(entry.formId).toBe(form.id);
          expect(entry.submissionId).toBe(submissionId);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated sequences of N assertOwner calls (mix of authorized
   * and unauthorized), the audit_log MUST contain exactly N entries.
   *
   * Extends audit completeness to metadata write operations (Property 30).
   */
  it('Property 12.3e: audit_log entry count equals assertOwner call count (metadata write completeness)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(formRecordArb, suiAddressArb),
          { minLength: 1, maxLength: 8 },
        ),
        async (attempts) => {
          _resetAuditLogStore();

          let callCount = 0;

          for (const [form, actorAddress] of attempts) {
            const db = buildDb([form]);
            try {
              await assertOwner(actorAddress, form.id, db);
            } catch {
              // ForbiddenError expected for non-owners
            }
            callCount++;
          }

          expect(_auditLogStore).toHaveLength(callCount);
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated sequences of N assertViewerOrOwner calls, the
   * audit_log MUST contain exactly N entries.
   */
  it('Property 12.3f: audit_log entry count equals assertViewerOrOwner call count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(formRecordArb, suiAddressArb),
          { minLength: 1, maxLength: 8 },
        ),
        async (attempts) => {
          _resetAuditLogStore();

          let callCount = 0;

          for (const [form, actorAddress] of attempts) {
            const db = buildDb([form]);
            try {
              await assertViewerOrOwner(actorAddress, form.id, null, db);
            } catch {
              // ForbiddenError expected for non-owners without viewer permission
            }
            callCount++;
          }

          expect(_auditLogStore).toHaveLength(callCount);
        },
      ),
      { numRuns: 15 },
    );
  });
});
