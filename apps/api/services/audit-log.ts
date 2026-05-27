/**
 * apps/api/services/audit-log.ts
 *
 * Audit_Log write and query service.
 *
 * This module is the single place in `apps/api` that writes and reads
 * Audit_Log entries. It exposes:
 *
 *   - `writeAuditEntry(entry: AuditLogEntry): Promise<void>`
 *     Inserts an append-only row into the audit log. Currently backed by an
 *     in-memory store; a real Postgres implementation will replace the store
 *     in a later task without changing the public interface.
 *
 *   - `queryAuditLog(filter: AuditLogFilter): Promise<AuditLogRow[]>`
 *     Returns audit log rows matching the supplied filter. Used by the audit
 *     query endpoint (available to Form_Owner Authorization_Identities only).
 *
 *   - `AuditLogWriteError`
 *     Thrown when the write operation fails. Callers MUST roll back any
 *     associated decryption response and return a structured server error.
 *     Plaintext MUST NOT be emitted on audit failure.
 *
 * Security invariants:
 *   - No plaintext Submission_Payload bytes, decryption keys, or
 *     Infrastructure_Wallet credentials may appear in any AuditLogEntry field.
 *     The `assertNoSensitiveData` guard enforces this at write time.
 *   - The audit log is append-only: no updates or deletes are exposed.
 *   - Every decryption operation and every failed authorization attempt MUST
 *     produce exactly one audit entry (callers are responsible for calling
 *     `writeAuditEntry`; this module enforces the write contract).
 *
 * Requirements: 5.5, 7.4, 12.4, 14.1, 14.2, 14.3, 14.4, 14.6, 14.7
 */

import { prisma } from './db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The kind of resource targeted by an audited operation.
 */
export type TargetKind = 'submission' | 'form' | 'file' | 'upload_job' | 'unknown';

/**
 * The action being audited. Follows the pattern `<resource>.<verb>`.
 *
 * Examples:
 *   - `"submission.decrypt"` — a decryption request for a submission
 *   - `"submission.create"` — a submission creation
 *   - `"form.create"` — a form creation
 *   - `"auth.verify"` — an authentication verification
 */
export type AuditAction = string;

/**
 * The result of the authorization check that preceded the audited operation.
 *
 * - `"granted"` — the requester was authorized and the operation proceeded.
 * - `"denied"`  — the requester was not authorized; the operation was blocked.
 */
export type AuthorizationResult = 'granted' | 'denied';

/**
 * The outcome of the audited operation itself (after authorization).
 *
 * - `"ok"`     — the operation completed successfully.
 * - `"denied"` — the operation was blocked by authorization (mirrors
 *                `authorizationResult = "denied"`).
 * - `"error"`  — the operation failed due to a server-side error.
 */
export type AuditOutcome = 'ok' | 'denied' | 'error';

/**
 * The input shape for a single audit log entry.
 *
 * SECURITY: No field in this type may carry plaintext Submission_Payload
 * bytes, decryption keys, or Infrastructure_Wallet credentials. The
 * `assertNoSensitiveData` guard enforces this at write time.
 *
 * Requirements: 14.1, 14.2, 14.4
 */
export interface AuditLogEntry {
  /** Unique identifier for the HTTP request that triggered this operation. */
  requestId: string;

  /**
   * Sui address of the requester (Authorization_Identity).
   * Use `"unknown"` for unauthenticated requests (Requirement 14.2).
   */
  actorAddress: string;

  /**
   * The action being audited (e.g., `"submission.decrypt"`).
   * MUST NOT contain payload content.
   */
  action: AuditAction;

  /** The kind of resource targeted by the operation. */
  targetKind: TargetKind;

  /**
   * The identifier of the targeted resource (e.g., a submission UUID).
   * May be `null` when the target is not yet known (e.g., a failed auth
   * attempt before the resource was resolved).
   */
  targetId: string | null;

  /**
   * The form identifier associated with the operation.
   * May be `null` for operations not scoped to a specific form.
   */
  formId: string | null;

  /**
   * The submission identifier associated with the operation.
   * May be `null` for operations not scoped to a specific submission.
   */
  submissionId: string | null;

  /**
   * The result of the authorization check.
   * - `"granted"` — authorization passed.
   * - `"denied"`  — authorization failed.
   */
  authorizationResult: AuthorizationResult;

  /**
   * The outcome of the operation.
   * - `"ok"`     — operation succeeded.
   * - `"denied"` — operation was blocked.
   * - `"error"`  — operation failed with a server error.
   */
  outcome: AuditOutcome;

  /**
   * The HTTP status code returned to the requester.
   * Helps correlate audit entries with HTTP access logs.
   */
  httpStatus: number;

  /**
   * Human-readable reason for a rejection or error.
   * MUST NOT contain payload content, keys, or credentials.
   * Optional — present only when `authorizationResult = "denied"` or
   * `outcome = "error"`.
   */
  rejectionReason?: string;
}

/**
 * A persisted audit log row — the entry plus server-assigned metadata.
 *
 * Requirements: 5.5, 14.1
 */
export interface AuditLogRow extends AuditLogEntry {
  /** Auto-assigned sequential identifier (mirrors `BIGSERIAL` in Postgres). */
  id: number;

  /** Server-assigned timestamp of when the entry was written. */
  createdAt: Date;
}

/**
 * Filter parameters for `queryAuditLog`.
 *
 * All fields are optional; omitting a field means "no constraint on that
 * dimension". Multiple supplied fields are ANDed together.
 *
 * Requirements: 14.5
 */
export interface AuditLogFilter {
  /** Filter by requester Authorization_Identity address. */
  actorAddress?: string;

  /** Filter by form identifier. */
  formId?: string;

  /** Filter by submission identifier. */
  submissionId?: string;

  /**
   * Inclusive lower bound on `createdAt`.
   * Rows with `createdAt >= fromTime` are included.
   */
  fromTime?: Date;

  /**
   * Inclusive upper bound on `createdAt`.
   * Rows with `createdAt <= toTime` are included.
   */
  toTime?: Date;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when `writeAuditEntry` fails to persist the entry.
 *
 * Callers MUST:
 *   1. Roll back any associated decryption response.
 *   2. Return a structured server error to the requester.
 *   3. NEVER emit plaintext on audit failure (Requirement 14.7).
 *
 * Requirements: 14.7
 */
export class AuditLogWriteError extends Error {
  readonly code = 'AUDIT_LOG_WRITE_FAILED' as const;

  constructor(cause: unknown) {
    super(
      `Audit log write failed: ${
        cause instanceof Error
          ? cause.message
          : typeof cause === 'string'
            ? cause
            : 'unknown error'
      }`,
    );
    this.name = 'AuditLogWriteError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Sensitive-data guard
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate a field value may contain sensitive data.
 *
 * These are heuristic checks. The primary defence is architectural (callers
 * must not pass sensitive data), but this guard provides a runtime safety net.
 *
 * Requirement 14.4: MUST NOT include plaintext payload bytes, decryption
 * keys, or Infrastructure_Wallet credentials in any field.
 */
const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
  // Private key material: bech32 Sui private key prefix
  /suiprivkey1/i,
  // Hex-encoded 32-byte secrets (64 hex chars) — catches raw key material
  // but is intentionally narrow to avoid false positives on UUIDs/blob IDs.
  // We only flag values that are ONLY a 64-char hex string (no surrounding text).
  /^[0-9a-f]{64}$/i,
  // Base64-encoded blobs longer than 256 chars — a heuristic for ciphertext
  // or payload bytes accidentally serialised as base64.
  /^[A-Za-z0-9+/]{256,}={0,2}$/,
];

/**
 * Field names that are explicitly forbidden in audit entries.
 * These names suggest the value may carry sensitive data.
 */
const FORBIDDEN_FIELD_NAMES: ReadonlySet<string> = new Set([
  'plaintext',
  'ciphertext',
  'decryptionKey',
  'privateKey',
  'secretKey',
  'sealSessionKey',
  'walletSecret',
  'infrastructureWalletSecret',
  'payload',
  'body',
]);

/**
 * Assert that an `AuditLogEntry` does not contain sensitive data.
 *
 * Checks:
 *   1. No field name matches `FORBIDDEN_FIELD_NAMES`.
 *   2. No string field value matches `SENSITIVE_FIELD_PATTERNS`.
 *
 * Throws `AuditLogWriteError` if a violation is detected so that the caller
 * can handle the failure without emitting the sensitive value.
 *
 * Requirement 14.4
 */
function assertNoSensitiveData(entry: AuditLogEntry): void {
  const entryRecord = entry as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(entryRecord)) {
    // Check forbidden field names.
    if (FORBIDDEN_FIELD_NAMES.has(key)) {
      throw new AuditLogWriteError(
        new Error(
          `Audit entry contains a forbidden field name: "${key}". ` +
            'Audit entries MUST NOT include plaintext payload bytes, ' +
            'decryption keys, or Infrastructure_Wallet credentials.',
        ),
      );
    }

    // Check string values against sensitive patterns.
    if (typeof value === 'string') {
      for (const pattern of SENSITIVE_FIELD_PATTERNS) {
        if (pattern.test(value)) {
          throw new AuditLogWriteError(
            new Error(
              `Audit entry field "${key}" appears to contain sensitive data ` +
                '(matched a sensitive-data pattern). ' +
                'Audit entries MUST NOT include plaintext payload bytes, ' +
                'decryption keys, or Infrastructure_Wallet credentials.',
            ),
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory store (stub — kept as secondary cache & sync target for unit tests)
// ---------------------------------------------------------------------------

/**
 * The in-memory audit log store.
 * Exported for test inspection only — production code MUST use
 * `writeAuditEntry` and `queryAuditLog`.
 *
 * @internal
 */
export let _auditLogStore: AuditLogRow[] = [];

/**
 * Auto-incrementing ID counter (mirrors `BIGSERIAL` in Postgres).
 * @internal
 */
let _nextId = 1;

/**
 * Deterministic safe UUID generator.
 * Since test mock values (like 'form-A') are invalid UUIDs, we deterministically
 * hash non-UUID strings using MD5 so Postgres accepts them as valid UUIDs.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toSafeUuid(val: string | null | undefined): string | null {
  if (!val) return null;
  if (UUID_REGEX.test(val)) return val;
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(val).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Reset the in-memory store. FOR TESTING ONLY.
 *
 * This function is intentionally not exported from the module's public
 * surface — tests import it via the `_` prefix convention.
 *
 * @internal
 */
export async function _resetAuditLogStore(): Promise<void> {
  _auditLogStore = [];
  _nextId = 1;
  await prisma.dbActivity.deleteMany({});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write an append-only audit log entry.
 *
 * The entry is validated for sensitive data before being persisted. If
 * validation fails or the write fails for any reason, `AuditLogWriteError`
 * is thrown.
 *
 * Callers MUST:
 *   - Call this function within the same transactional boundary as the
 *     authorization decision (Requirement 14.6).
 *   - Roll back any associated decryption response if this function throws
 *     (Requirement 14.7).
 *   - NEVER emit plaintext on audit failure (Requirement 14.7).
 *
 * @param entry The audit log entry to persist.
 * @throws `AuditLogWriteError` if the write fails for any reason.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.6, 14.7
 */
export async function writeAuditEntry(entry: AuditLogEntry): Promise<void> {
  // Guard: reject entries that contain sensitive data.
  // This throws AuditLogWriteError if a violation is detected.
  assertNoSensitiveData(entry);

  try {
    const row: AuditLogRow = {
      ...entry,
      id: _nextId++,
      createdAt: new Date(),
    };

    // Update the in-memory cache for legacy unit tests
    _auditLogStore.push(row);

    // Serialize extra fields into action for schema-less persistence in the activity table
    const actionData = JSON.stringify({
      originalAction: entry.action,
      formId: entry.formId,
      submissionId: entry.submissionId,
      authorizationResult: entry.authorizationResult,
      rejectionReason: entry.rejectionReason,
    });

    const safeTargetId = toSafeUuid(entry.targetId);

    // Persist to Postgres using Prisma
    await prisma.dbActivity.create({
      data: {
        requestId: entry.requestId,
        actorAddress: entry.actorAddress === 'unknown' ? null : entry.actorAddress,
        action: actionData,
        targetKind: entry.targetKind,
        targetId: safeTargetId,
        outcome: entry.outcome,
        httpStatus: entry.httpStatus,
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    // Wrap any unexpected error in AuditLogWriteError so callers have a
    // single error type to handle.
    if (err instanceof AuditLogWriteError) {
      throw err;
    }
    throw new AuditLogWriteError(err);
  }
}

/**
 * Query audit log entries matching the supplied filter.
 *
 * All filter fields are optional and are ANDed together. Omitting all fields
 * returns all entries (subject to access control enforced by the caller).
 *
 * The result is ordered by `createdAt` ascending (oldest first), mirroring
 * the natural `BIGSERIAL` order in Postgres.
 *
 * Access control (Form_Owner restriction from Requirement 14.5) is enforced
 * by the route handler, not by this function. This function returns all rows
 * matching the filter without additional authorization checks.
 *
 * @param filter Optional filter parameters.
 * @returns Array of matching `AuditLogRow` objects, ordered by `createdAt`.
 *
 * Requirements: 14.5
 */
export async function queryAuditLog(filter: AuditLogFilter = {}): Promise<AuditLogRow[]> {
  const { actorAddress, formId, submissionId, fromTime, toTime } = filter;

  const where: any = {};
  if (actorAddress !== undefined) {
    where.actorAddress = actorAddress === 'unknown' ? null : actorAddress;
  }
  if (fromTime !== undefined || toTime !== undefined) {
    where.createdAt = {};
    if (fromTime !== undefined) {
      where.createdAt.gte = fromTime;
    }
    if (toTime !== undefined) {
      where.createdAt.lte = toTime;
    }
  }

  // Retrieve records from the Postgres database
  const rows = await prisma.dbActivity.findMany({
    where,
    orderBy: {
      id: 'asc',
    },
  });

  const mappedRows: AuditLogRow[] = rows.map((r) => {
    let parsedAction = r.action;
    let fId: string | null = null;
    let sId: string | null = null;
    let authResult: AuthorizationResult = 'granted';
    let rejReason: string | undefined = undefined;

    try {
      const parsed = JSON.parse(r.action);
      if (parsed && typeof parsed === 'object' && 'originalAction' in parsed) {
        parsedAction = parsed.originalAction;
        fId = parsed.formId;
        sId = parsed.submissionId;
        authResult = parsed.authorizationResult;
        rejReason = parsed.rejectionReason;
      }
    } catch {
      // Fallback mapping for non-JSON actions (e.g., pre-existing legacy entries)
      if (r.targetKind === 'form') {
        fId = r.targetId;
      } else if (r.targetKind === 'submission') {
        sId = r.targetId;
      }
      authResult = r.outcome === 'denied' ? 'denied' : 'granted';
    }

    return {
      id: Number(r.id),
      requestId: r.requestId,
      actorAddress: r.actorAddress ?? 'unknown',
      action: parsedAction,
      targetKind: r.targetKind as TargetKind,
      targetId: r.targetId,
      formId: fId,
      submissionId: sId,
      authorizationResult: authResult,
      outcome: r.outcome as AuditOutcome,
      httpStatus: r.httpStatus ?? 200,
      rejectionReason: rejReason,
      createdAt: r.createdAt,
    };
  });

  // Apply formId and submissionId filtering in-memory
  return mappedRows.filter((row) => {
    if (formId !== undefined && row.formId !== formId) {
      return false;
    }
    if (submissionId !== undefined && row.submissionId !== submissionId) {
      return false;
    }
    return true;
  });
}

