/**
 * apps/api/services/metadata-orchestrator.ts
 *
 * Single upload orchestration module for the Swrap API server.
 *
 * This is the ONLY module in `apps/api` that invokes `sealEncrypt` or
 * `walrusPut`. All form, submission, and file creation flows go through here.
 *
 * Exposes:
 *   - `orchestrateFormCreate(req, actorAddress, db)` — full form creation
 *     pipeline: upload job → canonicalize → (encrypt if private) → Walrus
 *     PUT → metadata index → audit entry.
 *   - `orchestrateSubmissionCreate(req, actorAddress, db)` — same pattern
 *     for submissions; validates privacy mode matches parent form.
 *   - `orchestrateFileCreate(req, actorAddress, db)` — upload file bytes to
 *     Walrus and index metadata.
 *
 * Upload state machine transitions tracked per artifact:
 *   Public:  pending → uploading → uploaded → indexed
 *   Private: pending → encrypting → uploading → uploaded → indexed
 *   Failure: any step → failed
 *
 * Security invariants:
 *   - Plaintext bytes are held ephemerally; references released after
 *     encryption or after Walrus PUT for public artifacts.
 *   - Plaintext, ciphertext keys, and Infrastructure_Wallet credentials are
 *     NEVER logged at any log level.
 *   - Postgres MUST NOT receive payload bodies, ciphertext bodies, or file
 *     bytes — only blob IDs, digests, sizes, and state.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 6.11
 */

import { createHash } from 'node:crypto';
import {
  sealEncrypt,
  WalletNotConfiguredError,
  SealEncryptionError,
} from './infrastructure-wallet';
import {
  walrusPut,
  walrusBlobExists,
  WalrusPutError,
  WalrusGetError,
} from './walrus-service';
import {
  writeAuditEntry,
  AuditLogWriteError,
} from './audit-log';
import type { AuditLogEntry } from './audit-log';

// ---------------------------------------------------------------------------
// Upload state machine types
// ---------------------------------------------------------------------------

export type UploadState =
  | 'pending'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'indexed'
  | 'failed';

export type PrivacyMode = 'public' | 'private';
export type ArtifactKind = 'form' | 'submission' | 'file';

// ---------------------------------------------------------------------------
// Db interface (stub — in-memory stores from routes; replaced by Postgres)
// ---------------------------------------------------------------------------

/**
 * Minimal database interface used by the orchestrator.
 *
 * The Db parameter is a stub interface for now — backed by the in-memory
 * stores from routes/forms.ts and routes/submissions.ts. A real Postgres
 * implementation will satisfy this interface without changing the orchestrator.
 */
export interface Db {
  /** Look up a form record by ID. */
  getForm(formId: string): FormRecord | undefined;
  /** Insert a new form record. Returns the inserted record. */
  insertForm(row: FormRecord): FormRecord;
  /** Look up a submission record by ID. */
  getSubmission(submissionId: string): SubmissionRecord | undefined;
  /** Insert a new submission record. Returns the inserted record. */
  insertSubmission(row: SubmissionRecord): SubmissionRecord;
  /** Look up a file record by ID. */
  getFile(fileId: string): FileRecord | undefined;
  /** Insert a new file record. Returns the inserted record. */
  insertFile(row: FileRecord): FileRecord;
  /** Insert a new upload job record. Returns the inserted record. */
  insertUploadJob(row: UploadJobRecord): UploadJobRecord;
  /** Update an upload job's state and optional failure reason. */
  updateUploadJobState(
    jobId: string,
    state: UploadState,
    failureReason?: string,
  ): void;
  /**
   * Find an existing form by (ownerAddress, walrusBlobId) for idempotent
   * reconcile. Returns undefined if not found.
   */
  findFormByBlob(ownerAddress: string, walrusBlobId: string): FormRecord | undefined;
  /**
   * Find an existing submission by (formId, walrusBlobId) for idempotent
   * reconcile. Returns undefined if not found.
   */
  findSubmissionByBlob(formId: string, walrusBlobId: string): SubmissionRecord | undefined;
}

// ---------------------------------------------------------------------------
// Record types (mirrors Postgres schema from design.md §5)
// ---------------------------------------------------------------------------

export interface FormRecord {
  id: string;
  ownerAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  policyId: string | null;
  version: number;
  predecessorId: string | null;
  state: UploadState;
  contentDigest: string;
  sizeBytes: number;
  createdAt: string;
}

export interface SubmissionRecord {
  id: string;
  formId: string;
  formVersion: number;
  submitterAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  state: UploadState;
  policyId: string | null;
  createdAt: string;
}

export interface FileRecord {
  id: string;
  submissionId: string;
  walrusBlobId: string;
  contentType: string;
  sizeBytes: number;
  contentDigest: string;
  state: UploadState;
  createdAt: string;
}

export interface UploadJobRecord {
  id: string;
  ownerAddress: string;
  artifactKind: ArtifactKind;
  artifactId: string | null;
  walrusBlobId: string | null;
  state: UploadState;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Request / Result types
// ---------------------------------------------------------------------------

export interface CreateFormRequest {
  /** The form definition JSON object to canonicalize and store. */
  formDefinition: Record<string, unknown>;
  privacyMode: PrivacyMode;
  /**
   * Seal policy ID — required when privacyMode is 'private'.
   * For private forms the orchestrator uses this as the policyOwnerAddress
   * for sealEncrypt so the Infrastructure_Wallet encrypts under the correct
   * policy.
   */
  policyId?: string;
  /** Form version (default 1 for new forms). */
  version?: number;
  /** Predecessor form ID for privacy-mode-change versioning. */
  predecessorId?: string;
}

export interface CreateFormResult {
  formId: string;
  walrusBlobId: string;
  contentDigest: string;
  sizeBytes: number;
  state: 'indexed';
  privacyMode: PrivacyMode;
  policyId: string | null;
  createdAt: string;
  uploadJobId: string;
}

export interface CreateSubmissionRequest {
  formId: string;
  formVersion: number;
  /** The submission payload — either a JSON object (canonicalized before storage) or a raw string (stored as UTF-8 bytes as-is). */
  payload: Record<string, unknown> | string;
  privacyMode: PrivacyMode;
}

export interface CreateSubmissionResult {
  submissionId: string;
  formId: string;
  walrusBlobId: string;
  contentDigest: string;
  sizeBytes: number;
  state: 'indexed';
  privacyMode: PrivacyMode;
  policyId: string | null;
  createdAt: string;
  uploadJobId: string;
}

export interface CreateFileRequest {
  submissionId: string;
  /** Raw file bytes to upload to Walrus. */
  fileBytes: Uint8Array;
  contentType: string;
}

export interface CreateFileResult {
  fileId: string;
  submissionId: string;
  walrusBlobId: string;
  contentDigest: string;
  sizeBytes: number;
  contentType: string;
  state: 'indexed';
  createdAt: string;
  uploadJobId: string;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the declared privacy mode of a submission does not match the
 * privacy mode recorded for the parent form.
 *
 * Requirements: 4.5
 */
export class PrivacyModeMismatchError extends Error {
  readonly code = 'PrivacyModeMismatch' as const;

  constructor(
    public readonly declared: PrivacyMode,
    public readonly recorded: PrivacyMode,
    public readonly formId: string,
  ) {
    super(
      `Declared privacy mode '${declared}' does not match form '${formId}' recorded mode '${recorded}'.`,
    );
    this.name = 'PrivacyModeMismatchError';
  }
}

/**
 * Thrown when the parent form referenced by a submission is not found.
 */
export class FormNotFoundError extends Error {
  readonly code = 'NotFound' as const;

  constructor(public readonly formId: string) {
    super(`Form '${formId}' not found.`);
    this.name = 'FormNotFoundError';
  }
}

/**
 * Thrown when the parent submission referenced by a file is not found.
 */
export class SubmissionNotFoundError extends Error {
  readonly code = 'NotFound' as const;

  constructor(public readonly submissionId: string) {
    super(`Submission '${submissionId}' not found.`);
    this.name = 'SubmissionNotFoundError';
  }
}

/**
 * Thrown when a Walrus blob existence check fails before indexing.
 *
 * Requirements: 7.8
 */
export class BlobNotFoundError extends Error {
  readonly code = 'BlobNotFound' as const;

  constructor(public readonly walrusBlobId: string) {
    super(
      `Blob '${walrusBlobId}' was not found on Walrus. ` +
        'The publisher may still be propagating — retry after a short delay.',
    );
    this.name = 'BlobNotFoundError';
  }
}

/**
 * Thrown when any step in the orchestration pipeline fails.
 * Wraps the underlying cause and carries the upload job ID for state
 * machine bookkeeping.
 */
export class OrchestrationError extends Error {
  readonly code = 'Internal' as const;

  constructor(
    public readonly step: string,
    public readonly uploadJobId: string,
    cause: unknown,
  ) {
    super(
      `Orchestration failed at step '${step}': ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'OrchestrationError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute a hex-encoded SHA-256 digest over `bytes`.
 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Canonicalize a JSON object: sort keys recursively, no whitespace.
 * This ensures stable digests over equal inputs regardless of key insertion
 * order.
 */
function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map((k) => {
      const v = (obj as Record<string, unknown>)[k];
      return JSON.stringify(k) + ':' + canonicalizeJson(v);
    });
  return '{' + sorted.join(',') + '}';
}

/**
 * Encode a string as UTF-8 bytes.
 */
function toUtf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Create a new upload job record in `pending` state.
 */
function createUploadJob(
  ownerAddress: string,
  artifactKind: ArtifactKind,
  db: Db,
): UploadJobRecord {
  const now = new Date().toISOString();
  const job: UploadJobRecord = {
    id: crypto.randomUUID(),
    ownerAddress,
    artifactKind,
    artifactId: null,
    walrusBlobId: null,
    state: 'pending',
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };
  return db.insertUploadJob(job);
}

/**
 * Transition an upload job to a new state.
 * Logs the transition at debug level (no sensitive data).
 */
function transitionJob(
  jobId: string,
  to: UploadState,
  db: Db,
  failureReason?: string,
): void {
  db.updateUploadJobState(jobId, to, failureReason);
}

/**
 * Write an audit entry, swallowing AuditLogWriteError to avoid masking the
 * primary error. Callers that require audit-write success (e.g. decryption)
 * should handle AuditLogWriteError themselves.
 */
async function tryWriteAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await writeAuditEntry(entry);
  } catch (auditErr) {
    // Log the audit failure without sensitive content.
    // The primary operation result is not affected.
    console.error(
      JSON.stringify({
        event: 'audit_write_failed',
        action: entry.action,
        requestId: entry.requestId,
        // SECURITY: never log payload, keys, or credentials
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// orchestrateFormCreate
// ---------------------------------------------------------------------------

/**
 * Orchestrate the full form creation pipeline.
 *
 * Steps:
 *   1. Create upload job (pending)
 *   2. Canonicalize form definition JSON
 *   3. If privacyMode = 'private': transition to encrypting, call sealEncrypt,
 *      transition to uploading; if public: transition directly to uploading
 *   4. Upload to Walrus (walrusPut)
 *   5. Transition to uploaded
 *   6. Verify blob exists on Walrus (walrusBlobExists)
 *   7. Write metadata row (state = indexed)
 *   8. Transition job to indexed
 *   9. Write audit entry
 *  10. Return CreateFormResult
 *
 * On any step failure: transition job to failed, record failureReason, write
 * audit entry, re-throw the error.
 *
 * SECURITY: Plaintext bytes are held ephemerally and released after
 * encryption (private) or after Walrus PUT (public). No payload bytes are
 * persisted to Postgres.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 3.3
 */
export async function orchestrateFormCreate(
  req: CreateFormRequest,
  actorAddress: string,
  db: Db,
): Promise<CreateFormResult> {
  const requestId = crypto.randomUUID();
  const formId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Step 1: Create upload job (pending) — Requirement 6.2
  const job = createUploadJob(actorAddress, 'form', db);
  const jobId = job.id;

  let walrusBlobId: string;
  let contentDigest: string;
  let sizeBytes: number;
  let policyId: string | null = null;

  try {
    // Step 2: Canonicalize form definition JSON
    const canonicalJson = canonicalizeJson(req.formDefinition);
    let plaintextBytes: Uint8Array = toUtf8Bytes(canonicalJson);

    if (req.privacyMode === 'private') {
      // Step 3a: Private — transition to encrypting, encrypt, transition to uploading
      // Requirement 6.3: transition to encrypting before Seal call
      transitionJob(jobId, 'encrypting', db);

      const ownerAddress = req.policyId ?? actorAddress;

      let encryptResult: { ciphertext: Uint8Array; policyId: string; digest: string };
      try {
        encryptResult = await sealEncrypt(plaintextBytes, ownerAddress);
        // plaintextBytes reference is released by sealEncrypt (it fills with zeros)
        // Drop our local reference too
        plaintextBytes = new Uint8Array(0);
      } catch (encErr) {
        // Requirement 6.10: transition to failed on error
        transitionJob(jobId, 'failed', db, `Seal encryption failed: ${encErr instanceof Error ? encErr.message : String(encErr)}`);
        await tryWriteAudit({
          requestId,
          actorAddress,
          action: 'form.create',
          targetKind: 'form',
          targetId: formId,
          formId,
          submissionId: null,
          authorizationResult: 'granted',
          outcome: 'error',
          httpStatus: 500,
          rejectionReason: 'Seal encryption failed',
        });
        if (encErr instanceof WalletNotConfiguredError || encErr instanceof SealEncryptionError) {
          throw encErr;
        }
        throw new OrchestrationError('encrypting', jobId, encErr);
      }

      policyId = encryptResult.policyId;
      contentDigest = encryptResult.digest;

      // Transition to uploading — Requirement 6.5
      transitionJob(jobId, 'uploading', db);

      // Step 4: Upload ciphertext to Walrus
      let putResult: { blobId: string; sizeBytes: number };
      try {
        putResult = await walrusPut(encryptResult.ciphertext);
      } catch (putErr) {
        transitionJob(jobId, 'failed', db, `Walrus PUT failed: ${putErr instanceof Error ? putErr.message : String(putErr)}`);
        await tryWriteAudit({
          requestId,
          actorAddress,
          action: 'form.create',
          targetKind: 'form',
          targetId: formId,
          formId,
          submissionId: null,
          authorizationResult: 'granted',
          outcome: 'error',
          httpStatus: 502,
          rejectionReason: 'Walrus PUT failed',
        });
        throw new OrchestrationError('uploading', jobId, putErr);
      }

      walrusBlobId = putResult.blobId;
      sizeBytes = putResult.sizeBytes;
    } else {
      // Step 3b: Public — transition directly to uploading
      // Requirement 6.4: pending → uploading for public forms
      transitionJob(jobId, 'uploading', db);

      contentDigest = sha256Hex(plaintextBytes);

      // Step 4: Upload plaintext bytes to Walrus
      let putResult: { blobId: string; sizeBytes: number };
      try {
        putResult = await walrusPut(plaintextBytes);
        // Release plaintext reference after upload
        plaintextBytes = new Uint8Array(0);
      } catch (putErr) {
        transitionJob(jobId, 'failed', db, `Walrus PUT failed: ${putErr instanceof Error ? putErr.message : String(putErr)}`);
        await tryWriteAudit({
          requestId,
          actorAddress,
          action: 'form.create',
          targetKind: 'form',
          targetId: formId,
          formId,
          submissionId: null,
          authorizationResult: 'granted',
          outcome: 'error',
          httpStatus: 502,
          rejectionReason: 'Walrus PUT failed',
        });
        throw new OrchestrationError('uploading', jobId, putErr);
      }

      walrusBlobId = putResult.blobId;
      sizeBytes = putResult.sizeBytes;
    }

    // Step 5: Transition to uploaded — Requirement 6.6
    transitionJob(jobId, 'uploaded', db);

    // Check for idempotent reconcile — if same blob already indexed, return it
    const existing = db.findFormByBlob(actorAddress, walrusBlobId);
    if (existing) {
      transitionJob(jobId, 'indexed', db);
      return {
        formId: existing.id,
        walrusBlobId: existing.walrusBlobId,
        contentDigest: existing.contentDigest,
        sizeBytes: existing.sizeBytes,
        state: 'indexed',
        privacyMode: existing.privacyMode,
        policyId: existing.policyId,
        createdAt: existing.createdAt,
        uploadJobId: jobId,
      };
    }

    // Step 6: Verify blob exists on Walrus before indexing — Requirement 7.8
    let blobExists: boolean;
    try {
      blobExists = await walrusBlobExists(walrusBlobId);
    } catch (existsErr) {
      transitionJob(jobId, 'failed', db, `Walrus existence check failed: ${existsErr instanceof Error ? existsErr.message : String(existsErr)}`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'form.create',
        targetKind: 'form',
        targetId: formId,
        formId,
        submissionId: null,
        authorizationResult: 'granted',
        outcome: 'error',
        httpStatus: 502,
        rejectionReason: 'Walrus existence check failed',
      });
      throw new OrchestrationError('existence-check', jobId, existsErr);
    }

    if (!blobExists) {
      transitionJob(jobId, 'failed', db, `Blob ${walrusBlobId} not found on Walrus after PUT`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'form.create',
        targetKind: 'form',
        targetId: formId,
        formId,
        submissionId: null,
        authorizationResult: 'granted',
        outcome: 'error',
        httpStatus: 404,
        rejectionReason: 'BlobNotFound',
      });
      throw new BlobNotFoundError(walrusBlobId);
    }

    // Step 7: Write metadata row (state = indexed) — Requirement 6.7
    const formRow: FormRecord = {
      id: formId,
      ownerAddress: actorAddress,
      walrusBlobId,
      privacyMode: req.privacyMode,
      policyId,
      version: req.version ?? 1,
      predecessorId: req.predecessorId ?? null,
      state: 'indexed',
      contentDigest,
      sizeBytes,
      createdAt: now,
    };

    db.insertForm(formRow);

    // Step 8: Transition job to indexed
    transitionJob(jobId, 'indexed', db);

    // Step 9: Write audit entry
    await tryWriteAudit({
      requestId,
      actorAddress,
      action: 'form.create',
      targetKind: 'form',
      targetId: formId,
      formId,
      submissionId: null,
      authorizationResult: 'granted',
      outcome: 'ok',
      httpStatus: 201,
    });

    // Structured log — no sensitive content (Requirement 7.7, 9.4)
    console.log(
      JSON.stringify({
        event: 'form_orchestrated',
        formId,
        ownerAddress: actorAddress,
        privacyMode: req.privacyMode,
        walrusBlobId,
        state: 'indexed',
        uploadJobId: jobId,
        // SECURITY: never log formDefinition, policyId, ciphertext, or credentials
        timestamp: now,
      }),
    );

    // Step 10: Return result
    return {
      formId,
      walrusBlobId,
      contentDigest,
      sizeBytes,
      state: 'indexed',
      privacyMode: req.privacyMode,
      policyId,
      createdAt: now,
      uploadJobId: jobId,
    };
  } catch (err) {
    // If the job is not already in failed state, transition it now
    // (handles unexpected errors not caught in the inner try blocks)
    try {
      transitionJob(jobId, 'failed', db, err instanceof Error ? err.message : String(err));
    } catch {
      // Ignore secondary failure — the primary error is more important
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// orchestrateSubmissionCreate
// ---------------------------------------------------------------------------

/**
 * Orchestrate the full submission creation pipeline.
 *
 * Same pattern as orchestrateFormCreate but for submissions:
 *   1. Create upload job (pending)
 *   2. Look up parent form; validate privacy mode matches
 *   3. Canonicalize submission payload JSON
 *   4. If privacyMode = 'private': transition to encrypting, call sealEncrypt
 *      using the form owner's address, transition to uploading
 *      If public: transition directly to uploading
 *   5. Upload to Walrus
 *   6. Transition to uploaded
 *   7. Verify blob exists on Walrus
 *   8. Write metadata row (state = indexed)
 *   9. Transition job to indexed
 *  10. Write audit entry
 *  11. Return CreateSubmissionResult
 *
 * SECURITY: Plaintext bytes are zeroized after encryption. No payload bytes
 * are persisted to Postgres.
 *
 * Requirements: 4.5, 6.1–6.7, 3.3, 3.4
 */
export async function orchestrateSubmissionCreate(
  req: CreateSubmissionRequest,
  actorAddress: string,
  db: Db,
): Promise<CreateSubmissionResult> {
  const requestId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Step 1: Create upload job (pending) — Requirement 6.2
  const job = createUploadJob(actorAddress, 'submission', db);
  const jobId = job.id;

  let walrusBlobId: string;
  let contentDigest: string;
  let sizeBytes: number;
  let policyId: string | null = null;

  try {
    // Step 2: Look up parent form and validate privacy mode — Requirement 4.5
    const form = db.getForm(req.formId);
    if (!form) {
      transitionJob(jobId, 'failed', db, `Form ${req.formId} not found`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'submission.create',
        targetKind: 'submission',
        targetId: submissionId,
        formId: req.formId,
        submissionId,
        authorizationResult: 'denied',
        outcome: 'denied',
        httpStatus: 404,
        rejectionReason: 'Form not found',
      });
      throw new FormNotFoundError(req.formId);
    }

    // Privacy mode mismatch check — Requirement 4.5
    if (req.privacyMode !== form.privacyMode) {
      transitionJob(jobId, 'failed', db, `Privacy mode mismatch: declared ${req.privacyMode}, form has ${form.privacyMode}`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'submission.create',
        targetKind: 'submission',
        targetId: submissionId,
        formId: req.formId,
        submissionId,
        authorizationResult: 'denied',
        outcome: 'denied',
        httpStatus: 400,
        rejectionReason: 'PrivacyModeMismatch',
      });
      throw new PrivacyModeMismatchError(req.privacyMode, form.privacyMode, req.formId);
    }

    // Step 3: Serialize submission payload to UTF-8 bytes.
    // If the payload is a string, store it as-is (UTF-8 encoded).
    // If it's an object, canonicalize it (sorted keys, no whitespace) for stable digests.
    const payloadBytes: string = typeof req.payload === 'string'
      ? req.payload
      : canonicalizeJson(req.payload);
    let plaintextBytes: Uint8Array = toUtf8Bytes(payloadBytes);

    if (req.privacyMode === 'private') {
      // Step 4a: Private — transition to encrypting, encrypt via sealEncrypt
      // using the form owner's address so the policy authorizes the form owner.
      // Requirement 6.3: transition to encrypting before Seal call
      transitionJob(jobId, 'encrypting', db);

      let encryptResult: { ciphertext: Uint8Array; policyId: string; digest: string };
      try {
        // Encrypt under the form owner's address (the policy owner)
        encryptResult = await sealEncrypt(plaintextBytes, form.ownerAddress);
        // plaintextBytes reference is released by sealEncrypt (fills with zeros)
        // Drop our local reference too
        plaintextBytes = new Uint8Array(0);
      } catch (encErr) {
        transitionJob(jobId, 'failed', db, `Seal encryption failed: ${encErr instanceof Error ? encErr.message : String(encErr)}`);
        await tryWriteAudit({
          requestId,
          actorAddress,
          action: 'submission.create',
          targetKind: 'submission',
          targetId: submissionId,
          formId: req.formId,
          submissionId,
          authorizationResult: 'granted',
          outcome: 'error',
          httpStatus: 500,
          rejectionReason: 'Seal encryption failed',
        });
        if (encErr instanceof WalletNotConfiguredError || encErr instanceof SealEncryptionError) {
          throw encErr;
        }
        throw new OrchestrationError('encrypting', jobId, encErr);
      }

      policyId = encryptResult.policyId;
      contentDigest = encryptResult.digest;

      // Transition to uploading — Requirement 6.5
      transitionJob(jobId, 'uploading', db);

      // Step 5: Upload ciphertext to Walrus
      let putResult: { blobId: string; sizeBytes: number };
      try {
        putResult = await walrusPut(encryptResult.ciphertext);
      } catch (putErr) {
        transitionJob(jobId, 'failed', db, `Walrus PUT failed: ${putErr instanceof Error ? putErr.message : String(putErr)}`);
        await tryWriteAudit({
          requestId,
          actorAddress,
          action: 'submission.create',
          targetKind: 'submission',
          targetId: submissionId,
          formId: req.formId,
          submissionId,
          authorizationResult: 'granted',
          outcome: 'error',
          httpStatus: 502,
          rejectionReason: 'Walrus PUT failed',
        });
        throw new OrchestrationError('uploading', jobId, putErr);
      }

      walrusBlobId = putResult.blobId;
      sizeBytes = putResult.sizeBytes;
    } else {
      // Step 4b: Public — transition directly to uploading
      // Requirement 6.4: pending → uploading for public forms
      transitionJob(jobId, 'uploading', db);

      contentDigest = sha256Hex(plaintextBytes);

      // Step 5: Upload plaintext bytes to Walrus
      let putResult: { blobId: string; sizeBytes: number };
      try {
        putResult = await walrusPut(plaintextBytes);
        // Release plaintext reference after upload
        plaintextBytes = new Uint8Array(0);
      } catch (putErr) {
        transitionJob(jobId, 'failed', db, `Walrus PUT failed: ${putErr instanceof Error ? putErr.message : String(putErr)}`);
        await tryWriteAudit({
          requestId,
          actorAddress,
          action: 'submission.create',
          targetKind: 'submission',
          targetId: submissionId,
          formId: req.formId,
          submissionId,
          authorizationResult: 'granted',
          outcome: 'error',
          httpStatus: 502,
          rejectionReason: 'Walrus PUT failed',
        });
        throw new OrchestrationError('uploading', jobId, putErr);
      }

      walrusBlobId = putResult.blobId;
      sizeBytes = putResult.sizeBytes;
    }

    // Step 6: Transition to uploaded — Requirement 6.6
    transitionJob(jobId, 'uploaded', db);

    // Check for idempotent reconcile — if same blob already indexed, return it
    const existing = db.findSubmissionByBlob(req.formId, walrusBlobId);
    if (existing) {
      transitionJob(jobId, 'indexed', db);
      return {
        submissionId: existing.id,
        formId: existing.formId,
        walrusBlobId: existing.walrusBlobId,
        contentDigest: existing.contentDigest,
        sizeBytes: existing.sizeBytes,
        state: 'indexed',
        privacyMode: existing.privacyMode,
        policyId: existing.policyId,
        createdAt: existing.createdAt,
        uploadJobId: jobId,
      };
    }

    // Step 7: Verify blob exists on Walrus before indexing — Requirement 7.8
    let blobExists: boolean;
    try {
      blobExists = await walrusBlobExists(walrusBlobId);
    } catch (existsErr) {
      transitionJob(jobId, 'failed', db, `Walrus existence check failed: ${existsErr instanceof Error ? existsErr.message : String(existsErr)}`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'submission.create',
        targetKind: 'submission',
        targetId: submissionId,
        formId: req.formId,
        submissionId,
        authorizationResult: 'granted',
        outcome: 'error',
        httpStatus: 502,
        rejectionReason: 'Walrus existence check failed',
      });
      throw new OrchestrationError('existence-check', jobId, existsErr);
    }

    if (!blobExists) {
      transitionJob(jobId, 'failed', db, `Blob ${walrusBlobId} not found on Walrus after PUT`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'submission.create',
        targetKind: 'submission',
        targetId: submissionId,
        formId: req.formId,
        submissionId,
        authorizationResult: 'granted',
        outcome: 'error',
        httpStatus: 404,
        rejectionReason: 'BlobNotFound',
      });
      throw new BlobNotFoundError(walrusBlobId);
    }

    // Step 8: Write metadata row (state = indexed) — Requirement 6.7
    const submissionRow: SubmissionRecord = {
      id: submissionId,
      formId: req.formId,
      formVersion: req.formVersion,
      submitterAddress: actorAddress,
      walrusBlobId,
      privacyMode: req.privacyMode,
      contentDigest,
      sizeBytes,
      state: 'indexed',
      policyId,
      createdAt: now,
    };

    db.insertSubmission(submissionRow);

    // Step 9: Transition job to indexed
    transitionJob(jobId, 'indexed', db);

    // Step 10: Write audit entry
    await tryWriteAudit({
      requestId,
      actorAddress,
      action: 'submission.create',
      targetKind: 'submission',
      targetId: submissionId,
      formId: req.formId,
      submissionId,
      authorizationResult: 'granted',
      outcome: 'ok',
      httpStatus: 201,
    });

    // Structured log — no sensitive content (Requirement 7.7, 9.4)
    console.log(
      JSON.stringify({
        event: 'submission_orchestrated',
        submissionId,
        formId: req.formId,
        submitterAddress: actorAddress,
        privacyMode: req.privacyMode,
        walrusBlobId,
        state: 'indexed',
        uploadJobId: jobId,
        // SECURITY: never log payload, policyId, ciphertext, or credentials
        timestamp: now,
      }),
    );

    // Step 11: Return result
    return {
      submissionId,
      formId: req.formId,
      walrusBlobId,
      contentDigest,
      sizeBytes,
      state: 'indexed',
      privacyMode: req.privacyMode,
      policyId,
      createdAt: now,
      uploadJobId: jobId,
    };
  } catch (err) {
    // Transition to failed for unexpected errors not caught in inner blocks
    try {
      transitionJob(jobId, 'failed', db, err instanceof Error ? err.message : String(err));
    } catch {
      // Ignore secondary failure
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// orchestrateFileCreate
// ---------------------------------------------------------------------------

/**
 * Orchestrate the full file attachment creation pipeline.
 *
 * Steps:
 *   1. Create upload job (pending)
 *   2. Validate parent submission exists
 *   3. Compute SHA-256 digest of file bytes
 *   4. Transition to uploading
 *   5. Upload file bytes to Walrus
 *   6. Transition to uploaded
 *   7. Verify blob exists on Walrus
 *   8. Write metadata row (state = indexed)
 *   9. Transition job to indexed
 *  10. Write audit entry
 *  11. Return CreateFileResult
 *
 * File attachments are always stored as raw bytes (not encrypted by the
 * orchestrator — encryption is the caller's responsibility if needed).
 *
 * SECURITY: File bytes are released after Walrus PUT. No file bytes are
 * persisted to Postgres.
 *
 * Requirements: 3.5, 6.1–6.7
 */
export async function orchestrateFileCreate(
  req: CreateFileRequest,
  actorAddress: string,
  db: Db,
): Promise<CreateFileResult> {
  const requestId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Step 1: Create upload job (pending) — Requirement 6.2
  const job = createUploadJob(actorAddress, 'file', db);
  const jobId = job.id;

  let walrusBlobId: string;
  let sizeBytes: number;

  try {
    // Step 2: Validate parent submission exists
    const submission = db.getSubmission(req.submissionId);
    if (!submission) {
      transitionJob(jobId, 'failed', db, `Submission ${req.submissionId} not found`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'file.create',
        targetKind: 'file',
        targetId: fileId,
        formId: null,
        submissionId: req.submissionId,
        authorizationResult: 'denied',
        outcome: 'denied',
        httpStatus: 404,
        rejectionReason: 'Submission not found',
      });
      throw new SubmissionNotFoundError(req.submissionId);
    }

    // Step 3: Compute SHA-256 digest of file bytes
    const contentDigest = sha256Hex(req.fileBytes);
    const fileSizeBytes = req.fileBytes.length;

    // Step 4: Transition to uploading — Requirement 6.4
    transitionJob(jobId, 'uploading', db);

    // Step 5: Upload file bytes to Walrus
    let putResult: { blobId: string; sizeBytes: number };
    try {
      putResult = await walrusPut(req.fileBytes);
    } catch (putErr) {
      transitionJob(jobId, 'failed', db, `Walrus PUT failed: ${putErr instanceof Error ? putErr.message : String(putErr)}`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'file.create',
        targetKind: 'file',
        targetId: fileId,
        formId: submission.formId,
        submissionId: req.submissionId,
        authorizationResult: 'granted',
        outcome: 'error',
        httpStatus: 502,
        rejectionReason: 'Walrus PUT failed',
      });
      throw new OrchestrationError('uploading', jobId, putErr);
    }

    walrusBlobId = putResult.blobId;
    sizeBytes = putResult.sizeBytes;

    // Step 6: Transition to uploaded — Requirement 6.6
    transitionJob(jobId, 'uploaded', db);

    // Step 7: Verify blob exists on Walrus before indexing — Requirement 7.8
    let blobExists: boolean;
    try {
      blobExists = await walrusBlobExists(walrusBlobId);
    } catch (existsErr) {
      transitionJob(jobId, 'failed', db, `Walrus existence check failed: ${existsErr instanceof Error ? existsErr.message : String(existsErr)}`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'file.create',
        targetKind: 'file',
        targetId: fileId,
        formId: submission.formId,
        submissionId: req.submissionId,
        authorizationResult: 'granted',
        outcome: 'error',
        httpStatus: 502,
        rejectionReason: 'Walrus existence check failed',
      });
      throw new OrchestrationError('existence-check', jobId, existsErr);
    }

    if (!blobExists) {
      transitionJob(jobId, 'failed', db, `Blob ${walrusBlobId} not found on Walrus after PUT`);
      await tryWriteAudit({
        requestId,
        actorAddress,
        action: 'file.create',
        targetKind: 'file',
        targetId: fileId,
        formId: submission.formId,
        submissionId: req.submissionId,
        authorizationResult: 'granted',
        outcome: 'error',
        httpStatus: 404,
        rejectionReason: 'BlobNotFound',
      });
      throw new BlobNotFoundError(walrusBlobId);
    }

    // Step 8: Write metadata row (state = indexed) — Requirement 6.7
    const fileRow: FileRecord = {
      id: fileId,
      submissionId: req.submissionId,
      walrusBlobId,
      contentType: req.contentType,
      sizeBytes: fileSizeBytes,
      contentDigest,
      state: 'indexed',
      createdAt: now,
    };

    db.insertFile(fileRow);

    // Step 9: Transition job to indexed
    transitionJob(jobId, 'indexed', db);

    // Step 10: Write audit entry
    await tryWriteAudit({
      requestId,
      actorAddress,
      action: 'file.create',
      targetKind: 'file',
      targetId: fileId,
      formId: submission.formId,
      submissionId: req.submissionId,
      authorizationResult: 'granted',
      outcome: 'ok',
      httpStatus: 201,
    });

    // Structured log — no sensitive content (Requirement 7.7, 9.4)
    console.log(
      JSON.stringify({
        event: 'file_orchestrated',
        fileId,
        submissionId: req.submissionId,
        ownerAddress: actorAddress,
        contentType: req.contentType,
        walrusBlobId,
        state: 'indexed',
        uploadJobId: jobId,
        // SECURITY: never log file bytes or credentials
        timestamp: now,
      }),
    );

    // Step 11: Return result
    return {
      fileId,
      submissionId: req.submissionId,
      walrusBlobId,
      contentDigest,
      sizeBytes: fileSizeBytes,
      contentType: req.contentType,
      state: 'indexed',
      createdAt: now,
      uploadJobId: jobId,
    };
  } catch (err) {
    // Transition to failed for unexpected errors not caught in inner blocks
    try {
      transitionJob(jobId, 'failed', db, err instanceof Error ? err.message : String(err));
    } catch {
      // Ignore secondary failure
    }
    throw err;
  }
}
