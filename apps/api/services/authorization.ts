/**
 * apps/api/services/authorization.ts
 *
 * Authorization service — ownership and viewer-permission checks.
 *
 * This module is the single place in `apps/api` that enforces ownership and
 * viewer-permission rules before any Seal decryption or metadata write is
 * allowed. Every function writes an audit entry via `audit-log.ts` on both
 * success and failure.
 *
 * Exposes:
 *   - `assertOwner(actorAddress, formId, db)` — throws `ForbiddenError` if
 *     the actor is not the form owner.
 *   - `assertViewerOrOwner(actorAddress, formId, submissionId, db)` — throws
 *     `ForbiddenError` if the actor is neither the form owner nor a viewer.
 *   - `assertDecryptionAuthorized(actorAddress, formId, submissionId, db)` —
 *     throws `ForbiddenError` if the actor is not authorized to decrypt; MUST
 *     be called before any `seal-orchestrator.decryptPayload` invocation.
 *
 * Security invariants:
 *   - `ForbiddenError` carries only `{ actorAddress, formId, submissionId?,
 *     reason }` — no payload contents, no ciphertext, no keys.
 *   - Every authorization check (pass or fail) produces exactly one audit
 *     entry via `writeAuditEntry`.
 *   - If the audit write itself fails, `AuditLogWriteError` is re-thrown so
 *     the caller can block the operation (Requirement 14.7).
 *   - If the form record is missing, the check is treated as a rejection
 *     (Requirement 7.3).
 *
 * Requirements: 2.2, 4.6, 7.3, 7.9, 12.3, 12.5, 13.3, 13.6
 */

import { writeAuditEntry, AuditLogWriteError } from './audit-log';
import type { FormRecord, SubmissionRecord } from './metadata-orchestrator';

// ---------------------------------------------------------------------------
// Db interface
// ---------------------------------------------------------------------------

/**
 * Minimal database interface required by the authorization service.
 *
 * This is a subset of the `Db` interface from `metadata-orchestrator.ts`,
 * extended with the viewer-permission lookup needed for authorization checks.
 *
 * The in-memory stubs in `routes/submissions.ts` and `routes/forms.ts`
 * satisfy this interface. A real Postgres implementation will satisfy it
 * without changing the authorization service.
 */
export interface AuthDb {
  /** Look up a form record by ID. Returns `undefined` if not found. */
  getForm(formId: string): FormRecord | undefined;

  /**
   * Look up a viewer permission grant for a specific (formId, granteeAddress)
   * pair. Returns `undefined` if no grant exists.
   *
   * The `capability` field on the returned record indicates what the grantee
   * is allowed to do: `'view'` | `'submit'` | `'manage'`.
   */
  getViewerPermission(
    formId: string,
    granteeAddress: string,
  ): ViewerPermissionRecord | undefined;

  /**
   * Look up a submission record by ID. Returns `undefined` if not found.
   * Used by `assertViewerOrOwner` when `submissionId` is provided.
   */
  getSubmission(submissionId: string): SubmissionRecord | undefined;
}

/**
 * A viewer permission grant record.
 *
 * Mirrors the `permissions` table in the Postgres schema (design.md §5).
 */
export interface ViewerPermissionRecord {
  formId: string;
  granteeAddress: string;
  capability: 'view' | 'submit' | 'manage';
  grantedByAddress: string;
}

// ---------------------------------------------------------------------------
// ForbiddenError
// ---------------------------------------------------------------------------

/**
 * Thrown when an authorization check fails.
 *
 * Carries structured context for structured logging. MUST NOT carry payload
 * contents, ciphertext, decryption keys, or Infrastructure_Wallet credentials.
 *
 * Requirements: 4.6, 7.3, 12.3, 12.5, 13.3, 13.6
 */
export class ForbiddenError extends Error {
  readonly code = 'Forbidden' as const;

  constructor(
    public readonly actorAddress: string,
    public readonly formId: string,
    public readonly reason: string,
    public readonly submissionId?: string,
  ) {
    super(`Forbidden: ${reason}`);
    this.name = 'ForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `actorAddress` is the owner of the form identified by
 * `formId`. Returns the form record on success.
 *
 * Throws `ForbiddenError` if:
 *   - The form is not found (treated as rejection per Requirement 7.3).
 *   - The actor address does not match the form's `ownerAddress`.
 */
function checkOwnership(
  actorAddress: string,
  formId: string,
  db: AuthDb,
): { authorized: true; form: FormRecord } | { authorized: false; reason: string } {
  const form = db.getForm(formId);

  if (!form) {
    return {
      authorized: false,
      reason: `Form '${formId}' not found — treating as authorization rejection`,
    };
  }

  if (form.ownerAddress === actorAddress) {
    return { authorized: true, form };
  }

  return {
    authorized: false,
    reason: `Actor is not the owner of form '${formId}'`,
  };
}

/**
 * Check whether `actorAddress` has a viewer permission grant for `formId`
 * with at least the specified minimum capability.
 *
 * Capability hierarchy (most permissive first): `manage` > `view` > `submit`.
 * For decryption, `capability = 'view'` or `'manage'` is required.
 * For general viewer access, any capability is accepted.
 */
function checkViewerPermission(
  actorAddress: string,
  formId: string,
  db: AuthDb,
  requiredCapabilities: ReadonlyArray<'view' | 'submit' | 'manage'>,
): boolean {
  const perm = db.getViewerPermission(formId, actorAddress);
  if (!perm) return false;
  return (requiredCapabilities as string[]).includes(perm.capability);
}

// ---------------------------------------------------------------------------
// assertOwner
// ---------------------------------------------------------------------------

/**
 * Assert that `actorAddress` is the owner of `formId`.
 *
 * Looks up `forms.owner_address` in the database and throws `ForbiddenError`
 * if `actorAddress !== owner_address`. Writes an audit entry on both success
 * and failure.
 *
 * SECURITY: If the audit write fails, `AuditLogWriteError` is re-thrown so
 * the caller can block the operation (Requirement 14.7).
 *
 * @param actorAddress The Sui address of the requester (Authorization_Identity).
 * @param formId       The form identifier to check ownership for.
 * @param db           Database interface for form lookups.
 * @param requestId    Optional request ID for audit correlation.
 *
 * @throws ForbiddenError       if the actor is not the form owner.
 * @throws AuditLogWriteError   if the audit write fails.
 *
 * Requirements: 2.2, 7.3, 12.3
 */
export async function assertOwner(
  actorAddress: string,
  formId: string,
  db: AuthDb,
  requestId: string = crypto.randomUUID(),
): Promise<void> {
  const result = checkOwnership(actorAddress, formId, db);

  if (!result.authorized) {
    // Write denied audit entry BEFORE throwing so the entry is always recorded.
    await writeAuditEntry({
      requestId,
      actorAddress,
      action: 'authorization.assertOwner',
      targetKind: 'form',
      targetId: formId,
      formId,
      submissionId: null,
      authorizationResult: 'denied',
      outcome: 'denied',
      httpStatus: 403,
      rejectionReason: result.reason,
    });

    throw new ForbiddenError(actorAddress, formId, result.reason);
  }

  // Write granted audit entry.
  await writeAuditEntry({
    requestId,
    actorAddress,
    action: 'authorization.assertOwner',
    targetKind: 'form',
    targetId: formId,
    formId,
    submissionId: null,
    authorizationResult: 'granted',
    outcome: 'ok',
    httpStatus: 200,
  });
}

// ---------------------------------------------------------------------------
// assertViewerOrOwner
// ---------------------------------------------------------------------------

/**
 * Assert that `actorAddress` is either the form owner OR has a viewer
 * permission grant for `formId`.
 *
 * Authorization passes if:
 *   - `actorAddress` is the form owner (ownership check), OR
 *   - `actorAddress` has any viewer permission grant for the form
 *     (`capability` ∈ `{ 'view', 'submit', 'manage' }`).
 *
 * Writes an audit entry on both success and failure.
 *
 * @param actorAddress  The Sui address of the requester.
 * @param formId        The form identifier.
 * @param submissionId  The submission identifier (may be `null` for form-level checks).
 * @param db            Database interface.
 * @param requestId     Optional request ID for audit correlation.
 *
 * @throws ForbiddenError       if the actor is neither owner nor viewer.
 * @throws AuditLogWriteError   if the audit write fails.
 *
 * Requirements: 4.6, 7.3, 12.3, 12.5
 */
export async function assertViewerOrOwner(
  actorAddress: string,
  formId: string,
  submissionId: string | null,
  db: AuthDb,
  requestId: string = crypto.randomUUID(),
): Promise<void> {
  const ownerResult = checkOwnership(actorAddress, formId, db);

  // Ownership check passes — authorized.
  if (ownerResult.authorized) {
    await writeAuditEntry({
      requestId,
      actorAddress,
      action: 'authorization.assertViewerOrOwner',
      targetKind: submissionId ? 'submission' : 'form',
      targetId: submissionId ?? formId,
      formId,
      submissionId,
      authorizationResult: 'granted',
      outcome: 'ok',
      httpStatus: 200,
    });
    return;
  }

  // If the form was not found, reject immediately (Requirement 7.3).
  const form = db.getForm(formId);
  if (!form) {
    const reason = `Form '${formId}' not found — treating as authorization rejection`;
    await writeAuditEntry({
      requestId,
      actorAddress,
      action: 'authorization.assertViewerOrOwner',
      targetKind: submissionId ? 'submission' : 'form',
      targetId: submissionId ?? formId,
      formId,
      submissionId,
      authorizationResult: 'denied',
      outcome: 'denied',
      httpStatus: 403,
      rejectionReason: reason,
    });
    throw new ForbiddenError(actorAddress, formId, reason, submissionId ?? undefined);
  }

  // Viewer permission check — any capability grants access.
  const hasViewerPermission = checkViewerPermission(
    actorAddress,
    formId,
    db,
    ['view', 'submit', 'manage'],
  );

  if (hasViewerPermission) {
    await writeAuditEntry({
      requestId,
      actorAddress,
      action: 'authorization.assertViewerOrOwner',
      targetKind: submissionId ? 'submission' : 'form',
      targetId: submissionId ?? formId,
      formId,
      submissionId,
      authorizationResult: 'granted',
      outcome: 'ok',
      httpStatus: 200,
    });
    return;
  }

  // Neither owner nor viewer — reject.
  const reason = `Actor is not the owner of form '${formId}' and has no viewer permission`;
  await writeAuditEntry({
    requestId,
    actorAddress,
    action: 'authorization.assertViewerOrOwner',
    targetKind: submissionId ? 'submission' : 'form',
    targetId: submissionId ?? formId,
    formId,
    submissionId,
    authorizationResult: 'denied',
    outcome: 'denied',
    httpStatus: 403,
    rejectionReason: reason,
  });

  throw new ForbiddenError(actorAddress, formId, reason, submissionId ?? undefined);
}

// ---------------------------------------------------------------------------
// assertDecryptionAuthorized
// ---------------------------------------------------------------------------

/**
 * Assert that `actorAddress` is authorized to decrypt the submission
 * identified by `submissionId` on form `formId`.
 *
 * Authorization passes if:
 *   - `actorAddress` is the form owner (ownership check), OR
 *   - `actorAddress` has a viewer permission with `capability = 'view'` or
 *     `capability = 'manage'` for the form.
 *
 * SECURITY INVARIANT: This function MUST be called before any
 * `seal-orchestrator.decryptPayload` invocation. If this function throws,
 * the caller MUST NOT invoke `sealDecrypt`.
 *
 * If the authorization check itself errors (e.g. form not found), the error
 * is treated as a rejection — the caller receives HTTP 403 (Requirement 7.3).
 *
 * If the audit write fails, `AuditLogWriteError` is re-thrown so the caller
 * can block the decryption response (Requirement 14.7).
 *
 * @param actorAddress  The Sui address of the requester.
 * @param formId        The form identifier.
 * @param submissionId  The submission identifier.
 * @param db            Database interface.
 * @param requestId     Optional request ID for audit correlation.
 *
 * @throws ForbiddenError       if the actor is not authorized to decrypt.
 * @throws AuditLogWriteError   if the audit write fails.
 *
 * Requirements: 2.2, 4.6, 7.3, 7.9, 12.3, 12.5, 13.3, 13.6
 */
export async function assertDecryptionAuthorized(
  actorAddress: string,
  formId: string,
  submissionId: string,
  db: AuthDb,
  requestId: string = crypto.randomUUID(),
): Promise<void> {
  const ownerResult = checkOwnership(actorAddress, formId, db);

  // Ownership check passes — authorized to decrypt.
  if (ownerResult.authorized) {
    await writeAuditEntry({
      requestId,
      actorAddress,
      action: 'submission.decrypt',
      targetKind: 'submission',
      targetId: submissionId,
      formId,
      submissionId,
      authorizationResult: 'granted',
      outcome: 'ok',
      httpStatus: 200,
    });
    return;
  }

  // If the form was not found, reject immediately (Requirement 7.3).
  const form = db.getForm(formId);
  if (!form) {
    const reason = `Form '${formId}' not found — treating as authorization rejection`;
    await writeAuditEntry({
      requestId,
      actorAddress,
      action: 'submission.decrypt',
      targetKind: 'submission',
      targetId: submissionId,
      formId,
      submissionId,
      authorizationResult: 'denied',
      outcome: 'denied',
      httpStatus: 403,
      rejectionReason: reason,
    });
    throw new ForbiddenError(actorAddress, formId, reason, submissionId);
  }

  // Viewer permission check — only 'view' or 'manage' capability authorizes
  // decryption (Requirement 4.6, 12.5).
  const hasDecryptPermission = checkViewerPermission(
    actorAddress,
    formId,
    db,
    ['view', 'manage'],
  );

  if (hasDecryptPermission) {
    await writeAuditEntry({
      requestId,
      actorAddress,
      action: 'submission.decrypt',
      targetKind: 'submission',
      targetId: submissionId,
      formId,
      submissionId,
      authorizationResult: 'granted',
      outcome: 'ok',
      httpStatus: 200,
    });
    return;
  }

  // Neither owner nor authorized viewer — reject.
  const reason =
    `Actor is not the owner of form '${formId}' and has no 'view' or 'manage' ` +
    `permission for submission '${submissionId}'`;

  await writeAuditEntry({
    requestId,
    actorAddress,
    action: 'submission.decrypt',
    targetKind: 'submission',
    targetId: submissionId,
    formId,
    submissionId,
    authorizationResult: 'denied',
    outcome: 'denied',
    httpStatus: 403,
    rejectionReason: reason,
  });

  throw new ForbiddenError(actorAddress, formId, reason, submissionId);
}

// ---------------------------------------------------------------------------
// Re-export AuditLogWriteError so callers can handle it without importing
// audit-log.ts directly.
// ---------------------------------------------------------------------------
export { AuditLogWriteError };
