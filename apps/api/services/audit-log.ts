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
// In-memory store (stub — replaced by Postgres in a later task)
// ---------------------------------------------------------------------------

/**
 * The in-memory audit log store.
 *
 * This is an append-only array. No element is ever removed or mutated after
 * insertion. The real Postgres implementation will use an `INSERT`-only
 * pattern against the `activity` table (see design.md §5 Postgres Schema).
 *
 * Exported for test inspection only — production code MUST use
 * `writeAuditEntry` and `queryAuditLog`.
 *
 * @internal
 */
export const _auditLogStore: AuditLogRow[] = [];

/**
 * Auto-incrementing ID counter (mirrors `BIGSERIAL` in Postgres).
 * @internal
 */
let _nextId = 1;

/**
 * Reset the in-memory store. FOR TESTING ONLY.
 *
 * This function is intentionally not exported from the module's public
 * surface — tests import it via the `_` prefix convention.
 *
 * @internal
 */
export function _resetAuditLogStore(): void {
  _auditLogStore.length = 0;
  _nextId = 1;
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

    // Append-only: push to the store. In the Postgres implementation this
    // becomes an INSERT with no UPDATE or DELETE counterpart.
    _auditLogStore.push(row);
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

  return _auditLogStore.filter((row) => {
    if (actorAddress !== undefined && row.actorAddress !== actorAddress) {
      return false;
    }
    if (formId !== undefined && row.formId !== formId) {
      return false;
    }
    if (submissionId !== undefined && row.submissionId !== submissionId) {
      return false;
    }
    if (fromTime !== undefined && row.createdAt < fromTime) {
      return false;
    }
    if (toTime !== undefined && row.createdAt > toTime) {
      return false;
    }
    return true;
  });
}
