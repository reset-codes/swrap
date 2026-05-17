/**
 * Property-based tests for audit log completeness.
 *
 * **Validates: Requirements 14.1, 14.2, 14.3**
 *
 * Properties implemented:
 *
 *   Property 14.1: Audit completeness invariant
 *     For all generated decryption operations, the count of audit_log entries
 *     equals the count of decryption attempts. Every decryption attempt (successful
 *     or rejected) produces exactly one audit entry.
 *
 *   Property 14.2: Attribution invariant
 *     For all generated successful decryption operations, the audit entry
 *     references the same actorAddress, formId, and submissionId as the operation.
 *     This ensures correct attribution for compliance and debugging.
 *
 *   Property 14.3: Rejection-audit invariant
 *     For all generated failed authorization attempts, an audit entry exists
 *     with authorizationResult = 'denied' and httpStatus 401 or 403.
 *     Unauthorized access attempts are always logged for security monitoring.
 *
 * Test strategy:
 *   All properties are tested against the audit-log service functions
 *   (writeAuditEntry, queryAuditLog) and the authorization service functions
 *   (assertOwner, assertViewerOrOwner, assertDecryptionAuthorized) which are
 *   required to write audit entries as part of their contract.
 *
 *   The tests use fast-check generators to create:
 *   - Random decryption operation requests (authorized and unauthorized)
 *   - Random audit log entries (valid entries only)
 *   - Random sequences of operations to test completeness across multiple calls
 *
 * Requirements: 14.1, 14.2, 14.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  writeAuditEntry,
  queryAuditLog,
  AuditLogWriteError,
  _auditLogStore,
  _resetAuditLogStore,
  type AuditLogEntry,
  type AuditLogRow,
  type AuthorizationResult,
  type AuditOutcome,
  type TargetKind,
} from './audit-log';
import {
  assertOwner,
  assertViewerOrOwner,
  assertDecryptionAuthorized,
  ForbiddenError,
  type AuthDb,
  type ViewerPermissionRecord,
} from './authorization';
import type { FormRecord, SubmissionRecord } from './metadata-orchestrator';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetAuditLogStore();
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A decryption operation to test.
 */
interface DecryptionOperation {
  actorAddress: string;
  formId: string;
  submissionId: string;
  isAuthorized: boolean;
}

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

/** Generate a request ID */
const requestIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 8, maxLength: 32 })
  .filter((s) => /^[a-zA-Z0-9-]+$/.test(s));

/** Generate a valid authorization result */
const authorizationResultArb: fc.Arbitrary<AuthorizationResult> = fc.constantFrom(
  'granted',
  'denied',
);

/** Generate a valid audit outcome */
const outcomeArb: fc.Arbitrary<AuditOutcome> = fc.constantFrom('ok', 'denied', 'error');

/** Generate an HTTP status code */
const httpStatusArb: fc.Arbitrary<number> = fc.integer({ min: 100, max: 599 });

/** Generate an HTTP 401 or 403 status (unauthorized/forbidden) */
const unauthorizedHttpStatusArb: fc.Arbitrary<number> = fc.constantFrom(401, 403);

/** Generate a valid audit action */
const actionArb: fc.Arbitrary<string> = fc.constantFrom(
  'submission.decrypt',
  'submission.create',
  'form.create',
  'form.update',
  'auth.verify',
);

/** Generate a target kind */
const targetKindArb: fc.Arbitrary<TargetKind> = fc.constantFrom(
  'submission',
  'form',
  'file',
  'upload_job',
  'unknown',
);

/** Generate a rejection reason */
const rejectionReasonArb: fc.Arbitrary<string> = fc.string({
  minLength: 5,
  maxLength: 100,
});

/**
 * Generate a valid AuditLogEntry for decryption operations.
 */
const decryptionAuditEntryArb: fc.Arbitrary<AuditLogEntry> = fc.record({
  requestId: requestIdArb,
  actorAddress: suiAddressArb,
  action: fc.constant('submission.decrypt'),
  targetKind: fc.constant('submission'),
  targetId: uuidArb,
  formId: uuidArb,
  submissionId: uuidArb,
  authorizationResult: authorizationResultArb,
  outcome: outcomeArb,
  httpStatus: httpStatusArb,
  rejectionReason: fc.option(rejectionReasonArb, { nil: undefined }),
});

/**
 * Generate a valid AuditLogEntry for failed authorization attempts.
 */
const failedAuthAuditEntryArb: fc.Arbitrary<AuditLogEntry> = fc.record({
  requestId: requestIdArb,
  actorAddress: suiAddressArb,
  action: actionArb,
  targetKind: targetKindArb,
  targetId: fc.option(uuidArb, { nil: null }),
  formId: fc.option(uuidArb, { nil: null }),
  submissionId: fc.option(uuidArb, { nil: null }),
  authorizationResult: fc.constant<'denied'>('denied'),
  outcome: fc.constant<'denied'>('denied'),
  httpStatus: unauthorizedHttpStatusArb,
  rejectionReason: fc.option(rejectionReasonArb, { nil: undefined }),
});

/**
 * Generate a FormRecord.
 */
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

/**
 * Generate a SubmissionRecord.
 */
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

/**
 * Generate a decryption operation (authorized or unauthorized).
 */
const decryptionOperationArb: fc.Arbitrary<DecryptionOperation> = fc
  .tuple(suiAddressArb, uuidArb, uuidArb, fc.boolean())
  .map(([actorAddress, formId, submissionId, isAuthorized]) => ({
    actorAddress,
    formId,
    submissionId,
    isAuthorized,
  }));

/**
 * Generate a sequence of decryption operations.
 */
const decryptionOperationSequenceArb: fc.Arbitrary<DecryptionOperation[]> = fc.array(
  decryptionOperationArb,
  { minLength: 1, maxLength: 10 },
);

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
// Property 14.1: Audit completeness invariant
//
// **Validates: Requirements 14.1, 14.3**
//
// For all generated decryption operations, the count of audit_log entries
// equals the count of decryption attempts. Every decryption attempt (successful
// or rejected) produces exactly one audit entry.
// ---------------------------------------------------------------------------

describe('Property 14.1: Audit completeness invariant', () => {
  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated sequences of N decryption attempts (mix of authorized
   * and unauthorized), the audit_log MUST contain exactly N entries.
   *
   * This is the core audit completeness invariant: one audit entry per
   * decryption attempt, regardless of outcome.
   */
  it('Property 14.1a: audit_log entry count equals decryption attempt count', async () => {
    await fc.assert(
      fc.asyncProperty(
        decryptionOperationSequenceArb,
        async (operations) => {
          _resetAuditLogStore();

          // For each operation, simulate an audit entry being written
          // (In production, this is done by assertDecryptionAuthorized)
          for (const op of operations) {
            const entry: AuditLogEntry = {
              requestId: `req-${crypto.randomUUID().slice(0, 8)}`,
              actorAddress: op.actorAddress,
              action: 'submission.decrypt',
              targetKind: 'submission',
              targetId: op.submissionId,
              formId: op.formId,
              submissionId: op.submissionId,
              authorizationResult: op.isAuthorized ? 'granted' : 'denied',
              outcome: op.isAuthorized ? 'ok' : 'denied',
              httpStatus: op.isAuthorized ? 200 : 403,
            };
            await writeAuditEntry(entry);
          }

          // Audit log must have exactly one entry per operation
          expect(_auditLogStore).toHaveLength(operations.length);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated single decryption attempts, writeAuditEntry MUST
   * produce exactly one audit entry — never zero, never more than one.
   */
  it('Property 14.1b: each writeAuditEntry call produces exactly one audit entry', async () => {
    await fc.assert(
      fc.asyncProperty(decryptionAuditEntryArb, async (entry) => {
        _resetAuditLogStore();

        await writeAuditEntry(entry);

        expect(_auditLogStore).toHaveLength(1);
      }),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated sequences of audit writes, the audit log size grows
   * monotonically. No write reduces the log size.
   */
  it('Property 14.1c: audit log size grows monotonically with each write', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(decryptionAuditEntryArb, { minLength: 1, maxLength: 10 }),
        async (entries) => {
          _resetAuditLogStore();

          let expectedSize = 0;
          for (const entry of entries) {
            await writeAuditEntry(entry);
            expectedSize++;
            expect(_auditLogStore).toHaveLength(expectedSize);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated decryption attempts via assertDecryptionAuthorized,
   * exactly one audit entry is written per call, whether authorization
   * passes or fails.
   */
  it('Property 14.1d: assertDecryptionAuthorized writes exactly one audit entry per call', async () => {
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
            // ForbiddenError expected for non-owners — still counts as an attempt
          }

          // Exactly one audit entry must be written
          expect(_auditLogStore).toHaveLength(1);
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated sequences of assertDecryptionAuthorized calls,
   * the audit log contains exactly one entry per call.
   */
  it('Property 14.1e: audit completeness holds across multiple assertDecryptionAuthorized calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(formRecordArb, suiAddressArb, uuidArb), {
          minLength: 1,
          maxLength: 8,
        }),
        async (attempts) => {
          _resetAuditLogStore();

          for (const [form, actorAddress, submissionId] of attempts) {
            const db = buildDb([form]);
            try {
              await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
            } catch {
              // ForbiddenError expected for non-owners
            }
          }

          // Audit log must have exactly one entry per attempt
          expect(_auditLogStore).toHaveLength(attempts.length);
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated decryption operations, every entry in the audit log
   * has all required fields populated (no partial entries).
   */
  it('Property 14.1f: every audit entry has all required fields', async () => {
    await fc.assert(
      fc.asyncProperty(decryptionAuditEntryArb, async (entry) => {
        _resetAuditLogStore();

        await writeAuditEntry(entry);

        const row = _auditLogStore[0];
        expect(row.id).toBeDefined();
        expect(typeof row.id).toBe('number');
        expect(row.requestId).toBe(entry.requestId);
        expect(row.actorAddress).toBe(entry.actorAddress);
        expect(row.action).toBe(entry.action);
        expect(row.targetKind).toBe(entry.targetKind);
        expect(row.authorizationResult).toBeDefined();
        expect(row.outcome).toBeDefined();
        expect(typeof row.httpStatus).toBe('number');
        expect(row.createdAt).toBeInstanceOf(Date);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * Audit entries are ordered by insertion time (id ascending).
   */
  it('Property 14.1g: audit entries are ordered by insertion (id ascending)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(decryptionAuditEntryArb, { minLength: 2, maxLength: 10 }),
        async (entries) => {
          _resetAuditLogStore();

          for (const entry of entries) {
            await writeAuditEntry(entry);
          }

          // Verify IDs are strictly increasing
          for (let i = 1; i < _auditLogStore.length; i++) {
            expect(_auditLogStore[i].id).toBeGreaterThan(_auditLogStore[i - 1].id);
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14.2: Attribution invariant
//
// **Validates: Requirements 14.1, 14.2**
//
// For all generated successful decryption operations, the audit entry
// references the same actorAddress, formId, and submissionId as the operation.
// This ensures correct attribution for compliance and debugging.
// ---------------------------------------------------------------------------

describe('Property 14.2: Attribution invariant', () => {
  /**
   * **Validates: Requirements 14.1, 14.2**
   *
   * For all generated successful decryption operations (authorized actor),
   * the audit entry MUST reference the same actorAddress, formId, and
   * submissionId as the operation.
   */
  it('Property 14.2a: audit entry attributes successful decryption to correct actor', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        uuidArb,
        async (form, submissionId) => {
          _resetAuditLogStore();
          const db = buildDb([form]);

          await assertDecryptionAuthorized(form.ownerAddress, form.id, submissionId, db);

          const entry = _auditLogStore[0];
          expect(entry.actorAddress).toBe(form.ownerAddress);
          expect(entry.formId).toBe(form.id);
          expect(entry.submissionId).toBe(submissionId);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.2**
   *
   * For all generated failed decryption operations (unauthorized actor),
   * the audit entry MUST still reference the actor who attempted access,
   * enabling security monitoring of unauthorized access attempts.
   */
  it('Property 14.2b: audit entry attributes failed decryption attempt to correct actor', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const db = buildDb([form]);

          try {
            await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
          } catch {
            // Expected ForbiddenError
          }

          const entry = _auditLogStore[0];
          expect(entry.actorAddress).toBe(actorAddress);
          expect(entry.formId).toBe(form.id);
          expect(entry.submissionId).toBe(submissionId);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.2**
   *
   * For all generated audit entries written via writeAuditEntry, the
   * persisted row MUST preserve all attribution fields exactly.
   */
  it('Property 14.2c: persisted audit entry preserves attribution fields exactly', async () => {
    await fc.assert(
      fc.asyncProperty(decryptionAuditEntryArb, async (entry) => {
        _resetAuditLogStore();

        await writeAuditEntry(entry);

        const row = _auditLogStore[0];
        expect(row.actorAddress).toBe(entry.actorAddress);
        expect(row.formId).toBe(entry.formId);
        expect(row.submissionId).toBe(entry.submissionId);
        expect(row.targetId).toBe(entry.targetId);
        expect(row.action).toBe(entry.action);
      }),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.2**
   *
   * For all generated decryption operations with viewer permissions,
   * the audit entry MUST attribute the operation to the viewer (not the owner).
   */
  it('Property 14.2d: audit entry attributes viewer decryption to viewer (not owner)', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, viewerAddress, submissionId) => {
          fc.pre(viewerAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const permission: ViewerPermissionRecord = {
            formId: form.id,
            granteeAddress: viewerAddress,
            capability: 'view',
            grantedByAddress: form.ownerAddress,
          };
          const db = buildDb([form], [permission]);

          await assertDecryptionAuthorized(viewerAddress, form.id, submissionId, db);

          const entry = _auditLogStore[0];
          expect(entry.actorAddress).toBe(viewerAddress);
          expect(entry.formId).toBe(form.id);
          expect(entry.submissionId).toBe(submissionId);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.2**
   *
   * For all generated sequences of decryption operations, each audit entry
   * can be uniquely identified and correlated back to its operation.
   */
  it('Property 14.2e: each audit entry is uniquely identifiable and traceable', async () => {
    await fc.assert(
      fc.asyncProperty(
        requestIdArb,
        decryptionOperationArb,
        async (requestId, op) => {
          _resetAuditLogStore();

          const entry: AuditLogEntry = {
            requestId,
            actorAddress: op.actorAddress,
            action: 'submission.decrypt',
            targetKind: 'submission',
            targetId: op.submissionId,
            formId: op.formId,
            submissionId: op.submissionId,
            authorizationResult: op.isAuthorized ? 'granted' : 'denied',
            outcome: op.isAuthorized ? 'ok' : 'denied',
            httpStatus: op.isAuthorized ? 200 : 403,
          };

          await writeAuditEntry(entry);

          // Query by requestId to find the entry
          const rows = await queryAuditLog({});
          const found = rows.find((r) => r.requestId === requestId);
          expect(found).toBeDefined();
          expect(found!.actorAddress).toBe(op.actorAddress);
          expect(found!.formId).toBe(op.formId);
          expect(found!.submissionId).toBe(op.submissionId);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.2**
   *
   * Query operations preserve attribution: filtering by actorAddress returns
   * only entries for that actor.
   */
  it('Property 14.2f: query by actorAddress returns only entries for that actor', async () => {
    await fc.assert(
      fc.asyncProperty(
        suiAddressArb,
        suiAddressArb,
        fc.array(decryptionAuditEntryArb, { minLength: 2, maxLength: 5 }),
        async (targetActor, otherActor, entries) => {
          fc.pre(targetActor !== otherActor);

          _resetAuditLogStore();

          // Write entries with mixed actors
          for (const entry of entries) {
            await writeAuditEntry({ ...entry, actorAddress: targetActor });
          }
          await writeAuditEntry({
            ...entries[0],
            actorAddress: otherActor,
            requestId: 'req-other',
          });

          // Query for target actor only
          const rows = await queryAuditLog({ actorAddress: targetActor });
          expect(rows.every((r) => r.actorAddress === targetActor)).toBe(true);
          expect(rows).toHaveLength(entries.length);
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14.3: Rejection-audit invariant
//
// **Validates: Requirements 14.1, 14.3**
//
// For all generated failed authorization attempts, an audit entry exists
// with authorizationResult = 'denied' and httpStatus 401 or 403.
// Unauthorized access attempts are always logged for security monitoring.
// ---------------------------------------------------------------------------

describe('Property 14.3: Rejection-audit invariant', () => {
  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated failed authorization attempts via assertOwner,
   * an audit entry MUST exist with authorizationResult = 'denied' and
   * httpStatus 403.
   */
  it('Property 14.3a: assertOwner denial produces audit entry with denied and 403', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        async (form, actorAddress) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const db = buildDb([form]);

          await expect(assertOwner(actorAddress, form.id, db)).rejects.toThrow(
            ForbiddenError,
          );

          expect(_auditLogStore).toHaveLength(1);
          const entry = _auditLogStore[0];
          expect(entry.authorizationResult).toBe('denied');
          expect(entry.outcome).toBe('denied');
          expect(entry.httpStatus).toBe(403);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated failed authorization attempts via assertViewerOrOwner
   * (no permissions), an audit entry MUST exist with authorizationResult = 'denied'
   * and httpStatus 403.
   */
  it('Property 14.3b: assertViewerOrOwner denial produces audit entry with denied and 403', async () => {
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
          const entry = _auditLogStore[0];
          expect(entry.authorizationResult).toBe('denied');
          expect(entry.outcome).toBe('denied');
          expect(entry.httpStatus).toBe(403);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated failed authorization attempts via assertDecryptionAuthorized,
   * an audit entry MUST exist with authorizationResult = 'denied' and
   * httpStatus 403.
   */
  it('Property 14.3c: assertDecryptionAuthorized denial produces audit entry with denied and 403', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const db = buildDb([form]);

          await expect(
            assertDecryptionAuthorized(actorAddress, form.id, submissionId, db),
          ).rejects.toThrow(ForbiddenError);

          expect(_auditLogStore).toHaveLength(1);
          const entry = _auditLogStore[0];
          expect(entry.authorizationResult).toBe('denied');
          expect(entry.outcome).toBe('denied');
          expect(entry.httpStatus).toBe(403);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated failed authorization attempts written directly via
   * writeAuditEntry, the entry MUST have authorizationResult = 'denied' and
   * httpStatus 401 or 403.
   */
  it('Property 14.3d: manual failed auth entry has denied status and 401/403', async () => {
    await fc.assert(
      fc.asyncProperty(failedAuthAuditEntryArb, async (entry) => {
        _resetAuditLogStore();

        await writeAuditEntry(entry);

        const row = _auditLogStore[0];
        expect(row.authorizationResult).toBe('denied');
        expect(row.outcome).toBe('denied');
        expect([401, 403]).toContain(row.httpStatus);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated actors with 'submit'-only permission (insufficient for
   * decryption), assertDecryptionAuthorized MUST produce an audit entry with
   * authorizationResult = 'denied' and httpStatus 403.
   */
  it('Property 14.3e: submit-only permission produces denial audit entry', async () => {
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

          await expect(
            assertDecryptionAuthorized(actorAddress, form.id, submissionId, db),
          ).rejects.toThrow(ForbiddenError);

          expect(_auditLogStore).toHaveLength(1);
          expect(_auditLogStore[0].authorizationResult).toBe('denied');
          expect(_auditLogStore[0].httpStatus).toBe(403);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated failed authorization attempts against a non-existent form,
   * an audit entry MUST still be written (treats missing form as denial).
   */
  it('Property 14.3f: missing form produces denial audit entry', async () => {
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
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated sequences of mixed authorized and unauthorized attempts,
   * every unauthorized attempt has a corresponding 'denied' audit entry.
   */
  it('Property 14.3g: every unauthorized attempt has a denied audit entry in sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(formRecordArb, suiAddressArb, uuidArb), {
          minLength: 2,
          maxLength: 8,
        }),
        async (attempts) => {
          _resetAuditLogStore();

          let expectedDeniedCount = 0;

          for (const [form, actorAddress, submissionId] of attempts) {
            const db = buildDb([form]);
            try {
              await assertDecryptionAuthorized(actorAddress, form.id, submissionId, db);
            } catch {
              expectedDeniedCount++;
            }
          }

          // Count entries with authorizationResult = 'denied'
          const deniedEntries = _auditLogStore.filter(
            (e) => e.authorizationResult === 'denied',
          );
          expect(deniedEntries).toHaveLength(expectedDeniedCount);

          // All denied entries must have 403 httpStatus
          for (const entry of deniedEntries) {
            expect(entry.httpStatus).toBe(403);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 14.1, 14.3**
   *
   * For all generated failed authorization attempts, the audit entry MUST
   * include a rejection reason (optional field, but recommended for debugging).
   */
  it('Property 14.3h: denial audit entries may include rejection reason', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        uuidArb,
        async (form, actorAddress, submissionId) => {
          fc.pre(actorAddress !== form.ownerAddress);

          _resetAuditLogStore();
          const db = buildDb([form]);

          await expect(
            assertDecryptionAuthorized(actorAddress, form.id, submissionId, db),
          ).rejects.toThrow(ForbiddenError);

          const entry = _auditLogStore[0];
          // rejectionReason is optional but if present, must be a non-empty string
          if (entry.rejectionReason) {
            expect(typeof entry.rejectionReason).toBe('string');
            expect(entry.rejectionReason.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
