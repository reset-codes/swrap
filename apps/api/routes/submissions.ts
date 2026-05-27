/**
 * Production submissions routes for the Swrap VPS API server.
 *
 * POST /submissions
 *   - Validates request body via Zod
 *   - Delegates to orchestrateSubmissionCreate() — the canonical upload
 *     orchestration module — which handles privacy mode validation, Seal
 *     encryption (for private forms), Walrus upload, and metadata indexing.
 *   - Returns ApiResponse<SubmissionRow>
 *
 * GET /submissions/:id
 *   - Returns submission metadata (blobId, digest, privacyMode, state)
 *   - Returns ApiResponse<SubmissionRow>
 *
 * GET /submissions/:id/decrypt
 *   - Authorization-gated decryption endpoint for private submissions.
 *   - Checks auth session → checks authorization (owner or viewer) → fetches
 *     ciphertext from Walrus → decrypts via Seal using Infrastructure_Wallet →
 *     returns plaintext to the authorized requester.
 *   - Authorization MUST pass before any sealDecrypt call is issued.
 *   - If authorization fails: returns HTTP 403, sealDecrypt is NOT called.
 *   - Returns ApiResponse<{ plaintext: string }>
 *
 * GET /submissions
 *   - Lists submissions filtered by formId, submitterAddress, state
 *   - Returns ApiResponse<SubmissionRow[]>
 *
 * Requirements: 4.2, 4.3, 4.5, 4.6, 7.2, 7.3, 7.9, 7.10, 12.3, 12.5, 13.3, 13.6
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig } from '../server-config';
import {
  orchestrateSubmissionCreate,
  FormNotFoundError,
  PrivacyModeMismatchError,
  BlobNotFoundError,
  OrchestrationError,
  type Db,
  type FormRecord,
  type SubmissionRecord,
  type FileRecord,
  type UploadJobRecord,
} from '../services/metadata-orchestrator';
export type { FormRecord } from '../services/metadata-orchestrator';
import {
  sealDecrypt,
  WalletNotConfiguredError,
  SealEncryptionError,
  SealDecryptionError,
} from '../services/infrastructure-wallet';
import {
  walrusGet,
  WalrusGetError,
  WalrusIntegrityError,
} from '../services/walrus-service';
import { writeAuditEntry } from '../services/audit-log';
import {
  ok as apiOk,
  err as apiErr,
  type ApiResponse,
  type ApiErrorCode,
} from '../error-envelope';
import { db, prisma } from '../services/db';

// Re-export the canonical envelope types so existing consumers of this module
// continue to compile without changes.
export type { ApiResponse, ApiErrorCode };

// ---------------------------------------------------------------------------
// Route-local response helpers (thin wrappers that return ApiResponse values)
// ---------------------------------------------------------------------------

function ok<T>(result: T, status: number, requestId: string): ApiResponse<T> {
  return apiOk(result, requestId, status);
}

function err(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId: string,
): ApiResponse<never> {
  return apiErr(code, message, status, requestId);
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type PrivacyMode = 'public' | 'private';
export type SubmissionState =
  | 'pending'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'indexed'
  | 'failed';

export interface SubmissionRow {
  id: string;
  formId: string;
  formVersion: number;
  submitterAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  state: SubmissionState;
  policyId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// In-memory DB stub (replaced by real Postgres in a later task)
// ---------------------------------------------------------------------------

/**
 * Viewer permission grant — authorizes an address to view a specific form's
 * submissions. Used by the authorization check in the decrypt endpoint.
 *
 * Requirements: 4.6, 7.3, 12.3, 12.5
 */
export interface ViewerPermission {
  formId: string;
  granteeAddress: string;
  capability: 'view' | 'submit' | 'manage';
}

// ─── Durable Database Seeding & Mock Helpers ─────────────────────────────────

export const _formStore = new Map<string, FormRecord>();
export const _submissionStore = new Map<string, SubmissionRow>();
export const _viewerPermissionsStore = new Map<string, ViewerPermission>();

export async function _seedForm(form: Pick<FormRecord, 'id' | 'privacyMode' | 'ownerAddress' | 'walrusBlobId'> & Partial<FormRecord>): Promise<void> {
  const full: FormRecord = {
    version: 1,
    predecessorId: null,
    state: 'indexed',
    contentDigest: 'a'.repeat(64),
    sizeBytes: 0,
    createdAt: new Date().toISOString(),
    policyId: form.privacyMode === 'private' ? 'mock-policy-id' : null,
    ...form,
  };
  await db.insertForm(full);
  _formStore.set(full.id, full);
}

async function ensureUserExists(address: string): Promise<void> {
  await prisma.dbUser.upsert({
    where: { address },
    update: { lastSeenAt: new Date() },
    create: {
      address,
      signerKind: 'zk-login',
    },
  });
}

/** Seed a viewer permission in the database for testing. */
export async function _seedViewerPermission(permission: ViewerPermission): Promise<void> {
  const dummyGrantor = '0x' + 'ab'.repeat(32);
  await ensureUserExists(permission.granteeAddress);
  await ensureUserExists(dummyGrantor);

  await prisma.dbPermission.upsert({
    where: {
      formId_granteeAddress_capability: {
        formId: permission.formId,
        granteeAddress: permission.granteeAddress,
        capability: permission.capability,
      },
    },
    update: {},
    create: {
      id: crypto.randomUUID(),
      formId: permission.formId,
      granteeAddress: permission.granteeAddress,
      capability: permission.capability,
      grantedByAddress: dummyGrantor,
    },
  });
}

/** Clear all database state (used in tests). */
export async function _clearStores(): Promise<void> {
  _formStore.clear();
  _submissionStore.clear();
  _viewerPermissionsStore.clear();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE forms, upload_jobs, submissions, files, users, activity, permissions CASCADE;');
}

function toRow(s: SubmissionRecord): SubmissionRow {
  return {
    ...s,
    policyId: s.policyId ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const CreateSubmissionBodySchema = z.object({
  formId: z.string().uuid('formId must be a valid UUID'),
  formVersion: z.number().int().positive('formVersion must be a positive integer'),
  submitterAddress: z
    .string()
    .min(1, 'submitterAddress is required')
    .regex(/^0x[0-9a-fA-F]{1,64}$/, 'submitterAddress must be a valid Sui address'),
  privacyMode: z.enum(['public', 'private'], {
    errorMap: () => ({ message: "privacyMode must be 'public' or 'private'" }),
  }),
  /**
   * The submission payload as a JSON string.
   * The server handles encryption (for private forms) and Walrus storage.
   */
  payload: z.string().min(1, 'payload is required'),
  policyId: z.string().optional(),
});

const ListSubmissionsQuerySchema = z.object({
  formId: z.string().uuid().optional(),
  submitterAddress: z.string().optional(),
  state: z
    .enum(['pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed'])
    .optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequestId(req: Request): string {
  return (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
}

/**
 * Write an audit entry, swallowing AuditLogWriteError to avoid masking the
 * primary error. Every decryption endpoint invocation MUST call this function
 * (Requirement 7.4).
 */
async function tryWriteAuditEntry(entry: Parameters<typeof writeAuditEntry>[0]): Promise<void> {
  try {
    await writeAuditEntry(entry);
  } catch (auditErr) {
    // Log the audit failure without sensitive content.
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
// Authorization helpers
// ---------------------------------------------------------------------------

/**
 * ForbiddenError — thrown when an authorization check fails.
 *
 * Carries structured context for logging (no payload contents).
 * Requirements: 4.6, 7.3, 12.3, 12.5, 13.3, 13.6
 */
export class ForbiddenError extends Error {
  readonly code = 'Forbidden' as const;

  constructor(
    public readonly actorAddress: string,
    public readonly formId: string,
    public readonly submissionId: string,
    public readonly reason: string,
  ) {
    super(`Forbidden: ${reason}`);
    this.name = 'ForbiddenError';
  }
}

/**
 * Assert that `actorAddress` is authorized to decrypt the given submission.
 *
 * Authorization passes if:
 *   - `actorAddress` is the form owner (ownership check), OR
 *   - `actorAddress` has a viewer permission with `capability = 'view'` for
 *     the form (viewer permission check).
 *
 * SECURITY INVARIANT: This function MUST be called before any `sealDecrypt`
 * invocation. If this function throws, the caller MUST NOT call `sealDecrypt`.
 *
 * If the authorization check itself errors (e.g. form not found), the error
 * is treated as a rejection — the caller receives HTTP 403.
 *
 * Requirements: 4.6, 7.3, 12.3, 12.5, 13.3, 13.6
 *
 * @throws ForbiddenError if the actor is not authorized.
 */
async function assertDecryptionAuthorized(
  actorAddress: string,
  submission: SubmissionRow,
): Promise<void> {
  const form = await db.getForm(submission.formId);

  // If the form record is missing, treat as rejection (Requirement 7.3)
  if (!form) {
    throw new ForbiddenError(
      actorAddress,
      submission.formId,
      submission.id,
      'Form record not found — treating as authorization rejection',
    );
  }

  // Ownership check
  if (form.ownerAddress === actorAddress) {
    return; // authorized
  }

  // Viewer permission check (capability = 'view')
  const perm = await prisma.dbPermission.findUnique({
    where: {
      formId_granteeAddress_capability: {
        formId: submission.formId,
        granteeAddress: actorAddress,
        capability: 'view',
      },
    },
  });
  if (perm) {
    return; // authorized
  }

  const managePerm = await prisma.dbPermission.findUnique({
    where: {
      formId_granteeAddress_capability: {
        formId: submission.formId,
        granteeAddress: actorAddress,
        capability: 'manage',
      },
    },
  });
  if (managePerm) {
    return; // authorized
  }

  throw new ForbiddenError(
    actorAddress,
    submission.formId,
    submission.id,
    `Actor ${actorAddress} is not the form owner and has no viewer permission`,
  );
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function submissionsRouter(_config: ServerConfig): Router {
  const router = Router();

  // ── POST /submissions ─────────────────────────────────────────────────────
  /**
   * Create a new submission.
   *
   * Delegates to orchestrateSubmissionCreate() — the canonical upload
   * orchestration module — which handles:
   *   1. Privacy mode validation against the parent form.
   *   2. Upload job state machine (pending → encrypting? → uploading → uploaded → indexed).
   *   3. Seal encryption for private forms via Infrastructure_Wallet.
   *   4. Walrus PUT for both public and private forms.
   *   5. Blob existence check before indexing.
   *   6. Metadata row insertion.
   *   7. Audit entry.
   *
   * Requirements: 4.2, 4.3, 4.5, 7.2, 7.3
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      // 1. Validate body
      const parseResult = CreateSubmissionBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        const response = err(
          'Validation',
          `Request body validation failed: ${issues.join('; ')}`,
          400,
          requestId,
        );
        res.status(400).json(response);
        return;
      }

      const body = parseResult.data;

      // 2. Delegate to the canonical upload orchestration module.
      //    The orchestrator validates privacy mode, handles encryption, Walrus
      //    upload, existence check, and metadata indexing.
      //    Requirements: 3.4, 4.2, 4.3, 4.5, 6.1–6.7
      const submissionCountBefore = await prisma.dbSubmission.count();
      let result: import('../services/metadata-orchestrator').CreateSubmissionResult;
      try {
        // Parse the payload string as JSON if possible, otherwise pass as raw string.
        // The orchestrator handles both: JSON objects are canonicalized, raw strings are stored as-is.
        let payloadValue: Record<string, unknown> | string;
        try {
          const parsed = JSON.parse(body.payload);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            payloadValue = parsed as Record<string, unknown>;
          } else {
            payloadValue = body.payload;
          }
        } catch {
          payloadValue = body.payload;
        }

        result = await orchestrateSubmissionCreate(
          {
            formId: body.formId,
            formVersion: body.formVersion,
            payload: payloadValue,
            privacyMode: body.privacyMode,
          },
          body.submitterAddress,
          db,
        );
      } catch (orchErr) {
        if (orchErr instanceof FormNotFoundError) {
          const response = err('NotFound', `Form ${body.formId} not found.`, 404, requestId);
          res.status(404).json(response);
          return;
        }
        if (orchErr instanceof PrivacyModeMismatchError) {
          const response = err(
            'PrivacyModeMismatch',
            `Declared privacy_mode '${orchErr.declared}' does not match form's recorded privacy_mode '${orchErr.recorded}'. ` +
              `Submissions must use the same privacy mode as their parent form.`,
            400,
            requestId,
          );
          res.status(400).json(response);
          return;
        }
        if (orchErr instanceof BlobNotFoundError) {
          const response = err('BlobNotFound', orchErr.message, 404, requestId);
          res.status(404).json(response);
          return;
        }
        if (orchErr instanceof WalletNotConfiguredError) {
          const response = err(
            'Internal',
            'Encryption service is not available. Please try again later.',
            500,
            requestId,
          );
          res.status(500).json(response);
          return;
        }
        if (orchErr instanceof SealEncryptionError) {
          const response = err(
            'Internal',
            'Submission encryption failed. Please try again.',
            500,
            requestId,
          );
          res.status(500).json(response);
          return;
        }
        if (orchErr instanceof OrchestrationError) {
          const cause = orchErr.cause;
          if (cause instanceof Error && cause.name === 'WalrusPutError') {
            const response = err(
              'Internal',
              'Failed to upload submission to storage. Please try again.',
              500,
              requestId,
            );
            res.status(500).json(response);
            return;
          }
          const response = err('Internal', 'Submission creation failed. Please try again.', 500, requestId);
          res.status(500).json(response);
          return;
        }
        throw orchErr;
      }

      // 3. Retrieve the inserted submission row from the store
      const submissionRecord = await db.getSubmission(result.submissionId);
      if (!submissionRecord) {
        // Should not happen — orchestrator inserts the row before returning
        const response = err('Internal', 'Submission was created but could not be retrieved.', 500, requestId);
        res.status(500).json(response);
        return;
      }
      const submissionRow = toRow(submissionRecord);
      _submissionStore.set(submissionRow.id, submissionRow);

      // Determine status: 200 for idempotent reconcile, 201 for new creation
      const submissionCountAfter = await prisma.dbSubmission.count();
      const isIdempotent = submissionCountBefore === submissionCountAfter;

      const response = ok(submissionRow, isIdempotent ? 200 : 201, requestId);
      res.status(isIdempotent ? 200 : 201).json(response);
    } catch (error) {
      next(error);
    }
  });

  // ── GET /submissions/:id ──────────────────────────────────────────────────
  /**
   * Get submission metadata by ID.
   *
   * Returns: blobId, digest, privacyMode, state (non-sensitive metadata only).
   * Does NOT return plaintext payload or ciphertext bytes.
   *
   * Requirements: 7.2, 2.6
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        const response = err('BadRequest', 'Submission ID is required.', 400, requestId);
        res.status(400).json(response);
        return;
      }

      const submissionRecord = await db.getSubmission(id);
      if (!submissionRecord) {
        const response = err('NotFound', `Submission ${id} not found.`, 404, requestId);
        res.status(404).json(response);
        return;
      }

      const response = ok(toRow(submissionRecord), 200, requestId);
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  // ── GET /submissions/:id/decrypt ──────────────────────────────────────────
  /**
   * Authorization-gated decryption endpoint for private submissions.
   *
   * Flow:
   *   1. Validate auth session — extract actorAddress from request header
   *      `x-actor-address` (placeholder until full ZK Login session middleware
   *      is wired in a later task; the header is required and validated).
   *   2. Look up the submission record.
   *   3. For public submissions: fetch bytes from Walrus, verify integrity
   *      digest, return plaintext directly (no Seal decryption needed).
   *   4. For private submissions:
   *      a. AUTHORIZATION CHECK — call assertDecryptionAuthorized(actor, sub).
   *         If this throws ForbiddenError: return HTTP 403 immediately.
   *         sealDecrypt is NOT called on authorization failure.
   *      b. Fetch ciphertext bytes from Walrus (with integrity check).
   *      c. Call sealDecrypt(ciphertext, policyId).
   *      d. Return plaintext as UTF-8 string in ApiResponse<{ plaintext: string }>.
   *
   * SECURITY INVARIANTS (Requirements 4.6, 7.3, 12.3, 12.5, 13.3, 13.6):
   *   - Authorization check ALWAYS precedes sealDecrypt.
   *   - If authorization check errors: treat as rejection (HTTP 403).
   *   - Plaintext bytes are held ephemerally; references released after response.
   *   - Decryption keys, plaintext, and Infrastructure_Wallet credentials are
   *     NEVER logged at any log level.
   *
   * Requirements: 4.6, 7.3, 7.9, 12.3, 12.5, 13.3, 13.6
   */
  router.get('/:id/decrypt', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        const response = err('BadRequest', 'Submission ID is required.', 400, requestId);
        res.status(400).json(response);
        return;
      }

      // ── Step 1: Auth session check ─────────────────────────────────────
      // Extract the ZK Login session identity address.
      const actorAddress = (req.headers['x-actor-address'] as string | undefined)?.trim();
      if (!actorAddress) {
        const response = err(
          'Unauthorized',
          'Authentication required. Provide a valid session via x-actor-address header.',
          401,
          requestId,
        );
        res.status(401).json(response);
        return;
      }

      // ── Step 2: Look up submission ─────────────────────────────────────
      const submissionRecord = await db.getSubmission(id);
      if (!submissionRecord) {
        const response = err('NotFound', `Submission ${id} not found.`, 404, requestId);
        res.status(404).json(response);
        return;
      }
      const submission = toRow(submissionRecord);

      // ── Step 3: Public submission — fetch + verify + return plaintext ──
      if (submission.privacyMode === 'public') {
        let bytes: Uint8Array;
        try {
          bytes = await walrusGet(submission.walrusBlobId, submission.contentDigest);
        } catch (walrusErr) {
          if (walrusErr instanceof WalrusIntegrityError) {
            // SECURITY: do not return bytes on integrity mismatch (Req 3.9)
            console.error(
              JSON.stringify({
                event: 'submission_integrity_mismatch',
                submissionId: id,
                blobId: submission.walrusBlobId,
                // SECURITY: never log expected/actual digest values that could
                // reveal ciphertext structure
                timestamp: new Date().toISOString(),
              }),
            );
            // Audit: decryption endpoint invocation with error outcome (Req 7.4)
            await tryWriteAuditEntry({
              requestId,
              actorAddress,
              action: 'submission.decrypt',
              targetKind: 'submission',
              targetId: id,
              formId: submission.formId,
              submissionId: id,
              authorizationResult: 'granted',
              outcome: 'error',
              httpStatus: 422,
              rejectionReason: 'IntegrityMismatch',
            });
            const response = err(
              'IntegrityMismatch',
              'Submission content integrity check failed. The stored blob does not match the recorded digest.',
              422,
              requestId,
            );
            res.status(422).json(response);
            return;
          }
          if (walrusErr instanceof WalrusGetError) {
            console.error(
              JSON.stringify({
                event: 'submission_walrus_fetch_error',
                submissionId: id,
                blobId: submission.walrusBlobId,
                error: walrusErr.message,
                timestamp: new Date().toISOString(),
              }),
            );
            // Audit: decryption endpoint invocation with error outcome (Req 7.4)
            await tryWriteAuditEntry({
              requestId,
              actorAddress,
              action: 'submission.decrypt',
              targetKind: 'submission',
              targetId: id,
              formId: submission.formId,
              submissionId: id,
              authorizationResult: 'granted',
              outcome: 'error',
              httpStatus: 502,
              rejectionReason: 'BlobNotFound',
            });
            const response = err(
              'BlobNotFound',
              'Submission content could not be retrieved from storage.',
              502,
              requestId,
            );
            res.status(502).json(response);
            return;
          }
          throw walrusErr;
        }

        const plaintext = new TextDecoder().decode(bytes);

        // Audit: successful public decryption endpoint invocation (Req 7.4)
        await tryWriteAuditEntry({
          requestId,
          actorAddress,
          action: 'submission.decrypt',
          targetKind: 'submission',
          targetId: id,
          formId: submission.formId,
          submissionId: id,
          authorizationResult: 'granted',
          outcome: 'ok',
          httpStatus: 200,
        });

        // Structured log — no plaintext content logged (Req 7.7, 9.4)
        console.log(
          JSON.stringify({
            event: 'submission_public_retrieved',
            submissionId: id,
            actorAddress,
            timestamp: new Date().toISOString(),
          }),
        );

        const response = ok({ plaintext }, 200, requestId);
        res.status(200).json(response);
        return;
      }

      // ── Step 4: Private submission — authorize → fetch → decrypt ───────

      // 4a. AUTHORIZATION CHECK — MUST precede sealDecrypt (Req 4.6, 12.3)
      // If authorization check itself errors, treat as rejection (Req 7.3).
      try {
        await assertDecryptionAuthorized(actorAddress, submission);
      } catch (authErr) {
        // Log the rejection without any payload content (Req 9.4, 9.11)
        console.warn(
          JSON.stringify({
            event: 'submission_decrypt_forbidden',
            submissionId: id,
            formId: submission.formId,
            actorAddress,
            reason:
              authErr instanceof ForbiddenError
                ? authErr.reason
                : 'authorization check error',
            timestamp: new Date().toISOString(),
          }),
        );
        // Audit: failed authorization attempt -- MUST be recorded (Req 7.4, 7.10)
        await tryWriteAuditEntry({
          requestId,
          actorAddress,
          action: 'submission.decrypt',
          targetKind: 'submission',
          targetId: id,
          formId: submission.formId,
          submissionId: id,
          authorizationResult: 'denied',
          outcome: 'denied',
          httpStatus: 403,
          rejectionReason:
            authErr instanceof ForbiddenError
              ? authErr.reason
              : 'authorization check error',
        });
        const response = err(
          'Forbidden',
          'You are not authorized to decrypt this submission.',
          403,
          requestId,
        );
        res.status(403).json(response);
        return;
        // sealDecrypt is NOT called — authorization failed
      }

      // 4b. Fetch ciphertext from Walrus (with integrity check)
      let ciphertext: Uint8Array;
      try {
        ciphertext = await walrusGet(submission.walrusBlobId, submission.contentDigest);
      } catch (walrusErr) {
        if (walrusErr instanceof WalrusIntegrityError) {
          // SECURITY: do not return bytes on integrity mismatch (Req 3.9)
          console.error(
            JSON.stringify({
              event: 'submission_integrity_mismatch',
              submissionId: id,
              blobId: submission.walrusBlobId,
              timestamp: new Date().toISOString(),
            }),
          );
          // Audit: decryption endpoint invocation with error outcome (Req 7.4)
          await tryWriteAuditEntry({
            requestId,
            actorAddress,
            action: 'submission.decrypt',
            targetKind: 'submission',
            targetId: id,
            formId: submission.formId,
            submissionId: id,
            authorizationResult: 'granted',
            outcome: 'error',
            httpStatus: 422,
            rejectionReason: 'IntegrityMismatch',
          });
          const response = err(
            'IntegrityMismatch',
            'Submission content integrity check failed. The stored blob does not match the recorded digest.',
            422,
            requestId,
          );
          res.status(422).json(response);
          return;
        }
        if (walrusErr instanceof WalrusGetError) {
          console.error(
            JSON.stringify({
              event: 'submission_walrus_fetch_error',
              submissionId: id,
              blobId: submission.walrusBlobId,
              error: walrusErr.message,
              timestamp: new Date().toISOString(),
            }),
          );
          // Audit: decryption endpoint invocation with error outcome (Req 7.4)
          await tryWriteAuditEntry({
            requestId,
            actorAddress,
            action: 'submission.decrypt',
            targetKind: 'submission',
            targetId: id,
            formId: submission.formId,
            submissionId: id,
            authorizationResult: 'granted',
            outcome: 'error',
            httpStatus: 502,
            rejectionReason: 'BlobNotFound',
          });
          const response = err(
            'BlobNotFound',
            'Submission content could not be retrieved from storage.',
            502,
            requestId,
          );
          res.status(502).json(response);
          return;
        }
        throw walrusErr;
      }

      // 4c. Decrypt via Seal using Infrastructure_Wallet
      // policyId is required for private submissions
      if (!submission.policyId) {
        console.error(
          JSON.stringify({
            event: 'submission_missing_policy_id',
            submissionId: id,
            timestamp: new Date().toISOString(),
          }),
        );
        // Audit: decryption endpoint invocation with error outcome (Req 7.4)
        await tryWriteAuditEntry({
          requestId,
          actorAddress,
          action: 'submission.decrypt',
          targetKind: 'submission',
          targetId: id,
          formId: submission.formId,
          submissionId: id,
          authorizationResult: 'granted',
          outcome: 'error',
          httpStatus: 500,
          rejectionReason: 'Missing policyId on private submission',
        });
        const response = err(
          'Internal',
          'Submission is missing encryption policy metadata.',
          500,
          requestId,
        );
        res.status(500).json(response);
        return;
      }

      let plaintextBytes: Uint8Array;
      try {
        plaintextBytes = await sealDecrypt(ciphertext, submission.policyId);
      } catch (decryptErr) {
        if (decryptErr instanceof WalletNotConfiguredError) {
          // SECURITY: never log wallet credentials (Req 13.5)
          console.error(
            JSON.stringify({
              event: 'submission_decrypt_wallet_error',
              submissionId: id,
              // SECURITY: no key material logged
              timestamp: new Date().toISOString(),
            }),
          );
          // Audit: decryption endpoint invocation with error outcome (Req 7.4)
          await tryWriteAuditEntry({
            requestId,
            actorAddress,
            action: 'submission.decrypt',
            targetKind: 'submission',
            targetId: id,
            formId: submission.formId,
            submissionId: id,
            authorizationResult: 'granted',
            outcome: 'error',
            httpStatus: 500,
            rejectionReason: 'Decryption service unavailable',
          });
          const response = err(
            'Internal',
            'Decryption service is not available. Please try again later.',
            500,
            requestId,
          );
          res.status(500).json(response);
          return;
        }
        if (decryptErr instanceof SealDecryptionError) {
          // SECURITY: never log decryption keys or plaintext (Req 9.4, 13.5)
          console.error(
            JSON.stringify({
              event: 'submission_seal_decrypt_error',
              submissionId: id,
              // SECURITY: no ciphertext, keys, or plaintext logged
              timestamp: new Date().toISOString(),
            }),
          );
          // Audit: decryption endpoint invocation with error outcome (Req 7.4)
          await tryWriteAuditEntry({
            requestId,
            actorAddress,
            action: 'submission.decrypt',
            targetKind: 'submission',
            targetId: id,
            formId: submission.formId,
            submissionId: id,
            authorizationResult: 'granted',
            outcome: 'error',
            httpStatus: 500,
            rejectionReason: 'Seal decryption failed',
          });
          const response = err(
            'Internal',
            'Submission decryption failed. Please try again.',
            500,
            requestId,
          );
          res.status(500).json(response);
          return;
        }
        throw decryptErr;
      }

      // 4d. Decode plaintext bytes to string
      const plaintext = new TextDecoder().decode(plaintextBytes);

      // Release plaintext bytes reference (ephemerally held — Req 2.7)
      plaintextBytes.fill(0);

      // Audit: successful decryption -- MUST be recorded (Req 7.4)
      await tryWriteAuditEntry({
        requestId,
        actorAddress,
        action: 'submission.decrypt',
        targetKind: 'submission',
        targetId: id,
        formId: submission.formId,
        submissionId: id,
        authorizationResult: 'granted',
        outcome: 'ok',
        httpStatus: 200,
      });

      // Structured log — no plaintext content, no keys (Req 7.7, 9.4, 13.5)
      console.log(
        JSON.stringify({
          event: 'submission_decrypted',
          submissionId: id,
          formId: submission.formId,
          actorAddress,
          // SECURITY: plaintext, ciphertext, policyId, and key material are
          // NEVER logged
          timestamp: new Date().toISOString(),
        }),
      );

      // 4e. Return plaintext to the authorized requester
      const response = ok({ plaintext }, 200, requestId);
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  // ── GET /submissions ──────────────────────────────────────────────────────
  /**
   * List submissions with optional filters.
   *
   * Query params:
   *   - formId: UUID — filter by form
   *   - submitterAddress: string — filter by submitter
   *   - state: SubmissionState — filter by upload state
   *   - limit: number (default 50, max 100)
   *   - offset: number (default 0)
   *
   * Requirements: 5.9, 7.2
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      const queryResult = ListSubmissionsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        const issues = queryResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        const response = err(
          'Validation',
          `Invalid query parameters: ${issues.join('; ')}`,
          400,
          requestId,
        );
        res.status(400).json(response);
        return;
      }

      const { formId, submitterAddress, state, limit, offset } = queryResult.data;

      const where: any = {};
      if (formId !== undefined) {
        where.formId = formId;
      }
      if (submitterAddress !== undefined) {
        where.submitterAddress = submitterAddress;
      }
      if (state !== undefined) {
        where.state = state;
      }

      const total = await prisma.dbSubmission.count({ where });
      const rows = await prisma.dbSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });

      const page = rows.map((r) => toRow({
        id: r.id,
        formId: r.formId,
        formVersion: r.formVersion,
        submitterAddress: r.submitterAddress,
        walrusBlobId: r.walrusBlobId,
        privacyMode: r.privacyMode as any,
        contentDigest: r.contentDigest,
        sizeBytes: Number(r.sizeBytes),
        state: r.state as any,
        policyId: null,
        createdAt: r.createdAt.toISOString(),
      }));

      const response = ok(
        { submissions: page, total, limit, offset },
        200,
        requestId,
      );
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
