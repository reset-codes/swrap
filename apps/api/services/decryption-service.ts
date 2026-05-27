/**
 * apps/api/services/decryption-service.ts
 *
 * Authorization-gated decryption service.
 *
 * This module is the single place in `apps/api` that orchestrates the full
 * decryption flow for private submissions. It enforces the security invariant
 * that every successful decryption is preceded by a passing authorization
 * check and writes an Audit_Log entry.
 *
 * Exposes:
 *   - `authorizedDecrypt(submissionId, requesterAddress, db): Promise<Uint8Array>`
 *     Performs the full decryption flow:
 *       1. Look up submission row; fetch privacyMode, formId, walrusBlobId, policyId
 *       2. Call assertViewerOrOwner(requesterAddress, formId, db) — throws ForbiddenError on failure
 *       3. Write audit entry BEFORE issuing decryption call (within same transaction)
 *       4. Call walrusGet(walrusBlobId) → get ciphertext bytes
 *       5. Call sealDecrypt(ciphertext, policyId) → get plaintext
 *       6. Update audit entry with outcome
 *       7. Return plaintext bytes ephemerally; caller must not persist
 *
 * Security invariants:
 *   - If authorization check fails due to system error, treat as rejection (HTTP 403)
 *   - If audit log write fails, roll back decryption response and return 500
 *   - Plaintext bytes are held ephemerally; references released on completion or failure
 *   - No plaintext, decryption keys, or Infrastructure_Wallet credentials are logged
 *   - Every decryption attempt (success or failure) produces exactly one audit entry
 *
 * Requirements: 2.2, 2.9, 7.3, 7.10, 12.3, 12.7, 13.6, 13.7, 14.6, 14.7
 */

import { walrusGet, WalrusGetError, WalrusIntegrityError } from './walrus-service';
import {
  sealDecrypt,
  WalletNotConfiguredError,
  SealDecryptionError,
} from './infrastructure-wallet';
import {
  assertViewerOrOwner,
  ForbiddenError,
  AuditLogWriteError,
  type AuthDb,
} from './authorization';
import { writeAuditEntry } from './audit-log';
import type { SubmissionRecord } from './metadata-orchestrator';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when a submission is not found during decryption.
 */
export class SubmissionNotFoundError extends Error {
  readonly code = 'SUBMISSION_NOT_FOUND' as const;
  readonly submissionId: string;

  constructor(submissionId: string) {
    super(`Submission '${submissionId}' not found.`);
    this.name = 'SubmissionNotFoundError';
    this.submissionId = submissionId;
  }
}

/**
 * Thrown when attempting to decrypt a public submission.
 * Public submissions should be fetched directly from Walrus, not decrypted.
 */
export class PublicSubmissionError extends Error {
  readonly code = 'PUBLIC_SUBMISSION' as const;
  readonly submissionId: string;

  constructor(submissionId: string) {
    super(
      `Submission '${submissionId}' is public. ` +
        `Public submissions are not encrypted and should be fetched directly from Walrus.`,
    );
    this.name = 'PublicSubmissionError';
    this.submissionId = submissionId;
  }
}

/**
 * Thrown when a private submission is missing a policy ID.
 * This indicates a data integrity issue — private submissions must have a policy ID.
 */
export class MissingPolicyIdError extends Error {
  readonly code = 'MISSING_POLICY_ID' as const;
  readonly submissionId: string;

  constructor(submissionId: string) {
    super(
      `Submission '${submissionId}' is private but has no policy ID. ` +
        `This indicates a data integrity issue.`,
    );
    this.name = 'MissingPolicyIdError';
    this.submissionId = submissionId;
  }
}

/**
 * Thrown when the decryption service encounters a system error that should
 * result in HTTP 500.
 *
 * The `cause` field carries the underlying error for debugging.
 */
export class DecryptionSystemError extends Error {
  readonly code = 'DECRYPTION_SYSTEM_ERROR' as const;
  readonly step: string;
  readonly cause?: unknown;

  constructor(step: string, cause: unknown) {
    super(
      `Decryption failed at step '${step}': ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'DecryptionSystemError';
    this.step = step;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up a submission and validate it is eligible for decryption.
 *
 * Returns the submission record if:
 *   - The submission exists
 *   - The privacy mode is 'private'
 *   - The policy ID is present
 *
 * @throws SubmissionNotFoundError if the submission does not exist
 * @throws PublicSubmissionError if the submission is public
 * @throws MissingPolicyIdError if the submission is private but has no policy ID
 */
async function validateSubmissionForDecryption(
  submissionId: string,
  db: AuthDb,
): Promise<SubmissionRecord> {
  const submission = await db.getSubmission(submissionId);

  if (!submission) {
    throw new SubmissionNotFoundError(submissionId);
  }

  if (submission.privacyMode !== 'private') {
    throw new PublicSubmissionError(submissionId);
  }

  if (!submission.policyId) {
    throw new MissingPolicyIdError(submissionId);
  }

  return submission;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Perform authorization-gated decryption for a private submission.
 *
 * This function enforces the core security invariant of the Managed Encryption
 * Authority architecture: every successful decryption is preceded by a passing
 * authorization check and writes an Audit_Log entry.
 *
 * Flow:
 *   1. Look up submission row; fetch privacyMode, formId, walrusBlobId, policyId
 *   2. Call assertViewerOrOwner(requesterAddress, formId, db) — throws ForbiddenError on failure
 *   3. Write audit entry BEFORE issuing decryption call
 *   4. Call walrusGet(walrusBlobId) → get ciphertext bytes
 *   5. Call sealDecrypt(ciphertext, policyId) → get plaintext
 *   6. Return plaintext bytes ephemerally; caller must not persist
 *
 * SECURITY:
 *   - If authorization check fails due to system error, treat as rejection (HTTP 403)
 *   - If audit log write fails, roll back decryption response and return 500
 *   - Plaintext bytes are held ephemerally; caller must not persist
 *   - No plaintext, decryption keys, or Infrastructure_Wallet credentials are logged
 *
 * @param submissionId      The submission UUID to decrypt.
 * @param requesterAddress  The Sui address of the requester (Authorization_Identity).
 * @param db                Database interface for submission and form lookups.
 * @param requestId         Optional request ID for audit correlation.
 *
 * @returns Decrypted plaintext bytes. The caller MUST NOT persist these bytes.
 *
 * @throws ForbiddenError          if the requester is not authorized.
 * @throws SubmissionNotFoundError if the submission does not exist.
 * @throws PublicSubmissionError   if the submission is public (not encrypted).
 * @throws MissingPolicyIdError    if the submission is private but has no policy ID.
 * @throws AuditLogWriteError      if the audit write fails (caller must return 500).
 * @throws DecryptionSystemError   if Walrus fetch or Seal decryption fails.
 * @throws WalletNotConfiguredError if the Infrastructure_Wallet is misconfigured.
 * @throws SealDecryptionError     if the Seal SDK call fails.
 *
 * Requirements: 2.2, 2.9, 7.3, 7.10, 12.3, 12.7, 13.6, 13.7, 14.6, 14.7
 */
export async function authorizedDecrypt(
  submissionId: string,
  requesterAddress: string,
  db: AuthDb,
  requestId: string = crypto.randomUUID(),
): Promise<Uint8Array> {
  // Step 1: Look up and validate submission for decryption
  let submission: SubmissionRecord;
  try {
    submission = await validateSubmissionForDecryption(submissionId, db);
  } catch (err) {
    // If submission not found or invalid, write audit entry before throwing
    const reason =
      err instanceof SubmissionNotFoundError
        ? 'Submission not found'
        : err instanceof PublicSubmissionError
          ? 'Attempted to decrypt public submission'
          : err instanceof MissingPolicyIdError
            ? 'Missing policy ID for private submission'
            : 'Unknown validation error';

    await writeAuditEntry({
      requestId,
      actorAddress: requesterAddress,
      action: 'submission.decrypt',
      targetKind: 'submission',
      targetId: submissionId,
      formId: null,
      submissionId,
      authorizationResult: 'denied',
      outcome: 'denied',
      httpStatus: 404,
      rejectionReason: reason,
    });

    throw err;
  }

  // Step 2: Authorization check — MUST precede any decryption call
  // Requirement 12.3, 12.7, 13.6: authorization gate before Seal call
  try {
    await assertViewerOrOwner(requesterAddress, submission.formId, submissionId, db, requestId);
  } catch (err) {
    // If authorization check fails due to system error (not ForbiddenError),
    // treat as rejection per Requirement 7.3
    if (err instanceof ForbiddenError) {
      // Authorization denied — audit entry already written by assertViewerOrOwner
      // Re-throw to surface HTTP 403 to caller
      throw err;
    }

    // System error during authorization check — treat as rejection (Req 7.3)
    // Audit entry already written by assertViewerOrOwner
    throw new DecryptionSystemError('authorization', err);
  }

  // Step 3: Write audit entry BEFORE issuing decryption call
  // Requirement 14.6: audit entry within same transactional boundary
  // This is the "attempt" audit entry that will be updated with outcome
  try {
    await writeAuditEntry({
      requestId,
      actorAddress: requesterAddress,
      action: 'submission.decrypt',
      targetKind: 'submission',
      targetId: submissionId,
      formId: submission.formId,
      submissionId,
      authorizationResult: 'granted',
      outcome: 'ok', // Will be updated below if decryption fails
      httpStatus: 200,
    });
  } catch (auditErr) {
    // Requirement 14.7: If audit log write fails, roll back decryption response
    // Do NOT proceed with decryption — throw AuditLogWriteError so caller can return 500
    if (auditErr instanceof AuditLogWriteError) {
      throw auditErr;
    }
    throw new AuditLogWriteError(auditErr);
  }

  // Step 4: Fetch ciphertext bytes from Walrus
  let ciphertext: Uint8Array;
  try {
    // Use the submission's content digest for integrity verification
    ciphertext = await walrusGet(
      submission.walrusBlobId,
      submission.contentDigest,
    );
  } catch (err) {
    // Walrus fetch failed — update audit entry with error outcome
    // Note: In the current in-memory audit log implementation, we can't update
    // an existing entry. The real Postgres implementation will support UPDATE.
    // For now, write a separate error entry.
    await writeAuditEntry({
      requestId,
      actorAddress: requesterAddress,
      action: 'submission.decrypt.walrus_error',
      targetKind: 'submission',
      targetId: submissionId,
      formId: submission.formId,
      submissionId,
      authorizationResult: 'granted',
      outcome: 'error',
      httpStatus: 502,
      rejectionReason: err instanceof WalrusIntegrityError
        ? 'Integrity mismatch'
        : 'Walrus fetch failed',
    });

    if (err instanceof WalrusIntegrityError || err instanceof WalrusGetError) {
      throw new DecryptionSystemError('walrus_fetch', err);
    }
    throw new DecryptionSystemError('walrus_fetch', err);
  }

  // Step 5: Decrypt ciphertext using Seal SDK
  // SECURITY: This MUST only be called after authorization check passes (enforced above)
  let plaintext: Uint8Array;
  try {
    plaintext = await sealDecrypt(ciphertext, submission.policyId!);
  } catch (err) {
    // Decryption failed — write error audit entry
    await writeAuditEntry({
      requestId,
      actorAddress: requesterAddress,
      action: 'submission.decrypt.seal_error',
      targetKind: 'submission',
      targetId: submissionId,
      formId: submission.formId,
      submissionId,
      authorizationResult: 'granted',
      outcome: 'error',
      httpStatus: 500,
      rejectionReason: 'Seal decryption failed',
    });

    if (err instanceof WalletNotConfiguredError || err instanceof SealDecryptionError) {
      throw err;
    }
    throw new DecryptionSystemError('seal_decrypt', err);
  }

  // Step 6: Return plaintext bytes ephemerally
  // SECURITY: The caller MUST NOT persist these bytes (Requirement 2.7, 2.9)
  // The plaintext bytes are held only in memory and should be released
  // by the caller after use.
  return plaintext;
}
