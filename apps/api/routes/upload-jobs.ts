/**
 * Upload-job reconciliation routes for the Swrap API server.
 *
 * POST /upload-jobs/reconcile
 *   Idempotent reconcile of an orphaned upload job that reached `uploaded`
 *   (Walrus has the blob) but never reached `indexed` (no metadata row).
 *   Validates that the blob exists on Walrus, then upserts the metadata row
 *   and transitions the job to `indexed`.
 *
 * GET /upload-jobs
 *   List upload jobs owned by the authenticated user, with optional filtering
 *   by state and artifact kind.
 *
 * Both routes require authentication (enforced at the /api router level).
 * All responses use the typed ApiResponse<T> envelope.
 *
 * Requirements: 6.10, 6.13, 7.1
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../middleware/error-handler';
import type { ServerConfig } from '../server-config';
import {
  ok as apiOk,
  err as apiErr,
  type ApiResponse,
  type ApiErrorCode,
  type ApiError as ApiErrorBody,
} from '../error-envelope';

// Re-export the canonical envelope types so existing consumers of this module
// continue to compile without changes.
export type { ApiResponse, ApiErrorCode, ApiErrorBody };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid states for an Upload_Job, matching the design state machine. */
export type UploadState =
  | 'pending'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'indexed'
  | 'failed';

/** Valid artifact kinds for an Upload_Job. */
export type ArtifactKind = 'form' | 'submission' | 'file';

/** A single upload job record as returned by the API. */
export interface UploadJobRow {
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
// Zod validation schemas
// ---------------------------------------------------------------------------

/**
 * Body schema for POST /upload-jobs/reconcile.
 *
 * The client provides the job context needed to upsert the metadata row.
 * `walrusBlobId` is the blob that was successfully uploaded to Walrus.
 * `formId` is required for submissions and files; optional for standalone forms.
 */
const ReconcileBodySchema = z.object({
  /** The upload job ID tracked client-side (UUID). */
  jobId: z.string().uuid({ message: 'jobId must be a valid UUID' }),

  /** Artifact kind determines which metadata table is upserted. */
  artifactKind: z.enum(['form', 'submission', 'file'], {
    errorMap: () => ({ message: "artifactKind must be 'form', 'submission', or 'file'" }),
  }),

  /** Walrus blob ID confirmed by the client after a successful PUT. */
  walrusBlobId: z
    .string()
    .min(1, 'walrusBlobId must be a non-empty string')
    .max(256, 'walrusBlobId exceeds maximum length'),

  /**
   * Form ID that owns this artifact.
   * Required for submissions and files; optional for forms.
   */
  formId: z.string().uuid({ message: 'formId must be a valid UUID' }).optional(),

  /** SHA-256 hex digest of the blob bytes, recorded for integrity checks. */
  contentDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'contentDigest must be a 64-character hex SHA-256 digest'),

  /** Size of the blob in bytes. */
  sizeBytes: z
    .number()
    .int('sizeBytes must be an integer')
    .nonnegative('sizeBytes must be >= 0'),

  /** Privacy mode of the artifact. */
  privacyMode: z.enum(['public', 'private'], {
    errorMap: () => ({ message: "privacyMode must be 'public' or 'private'" }),
  }),
});

export type ReconcileBody = z.infer<typeof ReconcileBodySchema>;

/**
 * Query schema for GET /upload-jobs.
 *
 * All filters are optional. Without filters, all jobs owned by the
 * authenticated user are returned (up to the page limit).
 */
const ListQuerySchema = z.object({
  /** Filter by Upload_State_Machine state. */
  state: z
    .enum(['pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed'])
    .optional(),

  /** Filter by artifact kind. */
  artifactKind: z.enum(['form', 'submission', 'file']).optional(),

  /** Pagination: maximum number of results to return (1–100, default 50). */
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(100)),

  /** Pagination: offset into the result set (default 0). */
  offset: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 0))
    .pipe(z.number().int().min(0)),
});

export type ListQuery = z.infer<typeof ListQuerySchema>;

// ---------------------------------------------------------------------------
// In-memory stub DB layer
//
// This is a stub implementation that satisfies the route contract without a
// live Postgres connection. It is replaced by a real DB layer when the
// database migration and connection pool are wired in (tasks 1.x, 18.x).
// ---------------------------------------------------------------------------

/** In-memory store keyed by job ID. */
const jobStore = new Map<string, UploadJobRow>();

/**
 * Upsert a job row by (ownerAddress, walrusBlobId).
 *
 * Idempotency key: if a row already exists for this owner + blob, return it
 * unchanged (the reconcile is a no-op). Otherwise insert a new row in
 * `indexed` state.
 */
function upsertJob(
  ownerAddress: string,
  body: ReconcileBody,
): { row: UploadJobRow; created: boolean } {
  // Check for existing row by (ownerAddress, walrusBlobId) — idempotency key
  for (const row of jobStore.values()) {
    if (row.ownerAddress === ownerAddress && row.walrusBlobId === body.walrusBlobId) {
      // Already reconciled — return existing row without mutation
      return { row, created: false };
    }
  }

  const now = new Date().toISOString();
  const row: UploadJobRow = {
    id: body.jobId,
    ownerAddress,
    artifactKind: body.artifactKind,
    artifactId: null, // populated when the artifact row is created
    walrusBlobId: body.walrusBlobId,
    state: 'indexed',
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };

  jobStore.set(row.id, row);
  return { row, created: true };
}

/**
 * List jobs for an owner, with optional state and kind filters.
 */
function listJobs(
  ownerAddress: string,
  filters: { state?: UploadState; artifactKind?: ArtifactKind; limit: number; offset: number },
): { rows: UploadJobRow[]; total: number } {
  const all = Array.from(jobStore.values()).filter((row) => {
    if (row.ownerAddress !== ownerAddress) return false;
    if (filters.state !== undefined && row.state !== filters.state) return false;
    if (filters.artifactKind !== undefined && row.artifactKind !== filters.artifactKind)
      return false;
    return true;
  });

  // Sort by createdAt descending (most recent first)
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = all.length;
  const rows = all.slice(filters.offset, filters.offset + filters.limit);
  return { rows, total };
}

// ---------------------------------------------------------------------------
// Walrus existence check stub
//
// In production this issues a HEAD request to the Walrus aggregator URL.
// The stub always returns true so the route logic can be exercised without
// a live Walrus connection. The real implementation is wired in task 18.x
// (walrus-existence-check service).
// ---------------------------------------------------------------------------

/**
 * Verify that a blob ID exists on Walrus_Store.
 *
 * @param walrusBlobId - The blob identifier to check.
 * @param aggregatorUrl - The Walrus aggregator base URL.
 * @returns `true` if the blob exists, `false` if it does not.
 */
async function walrusBlobExists(
  walrusBlobId: string,
  aggregatorUrl: string,
): Promise<boolean> {
  try {
    // HEAD request to the aggregator's blob endpoint.
    // The Walrus aggregator exposes GET /v1/blobs/:blobId; a HEAD on the same
    // path returns 200 if the blob is available, 404 if not.
    const url = `${aggregatorUrl.replace(/\/$/, '')}/v1/blobs/${encodeURIComponent(walrusBlobId)}`;
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    // Network error — treat as "not found" so the client can retry later.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/** Extract a request ID from the request (set by request-logger middleware). */
function getRequestId(req: Request): string {
  return (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
}

/** Send a typed success envelope. */
function sendOk<T>(res: Response, result: T, requestId: string, status = 200): void {
  res.status(status).json(apiOk(result, requestId, status));
}

/** Send a typed error envelope. */
function sendErr(
  res: Response,
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId: string,
  details?: Record<string, unknown>,
): void {
  res.status(status).json(apiErr(code, message, status, requestId, details));
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /upload-jobs/reconcile
 *
 * Idempotent reconcile of an orphaned upload job.
 *
 * An orphan is a job that reached `uploaded` (Walrus has the blob) but never
 * reached `indexed` (no metadata row). This endpoint:
 *   1. Validates the request body.
 *   2. Verifies the blob exists on Walrus_Store (HEAD check).
 *   3. Upserts the metadata row by (ownerAddress, walrusBlobId) — idempotent.
 *   4. Returns the resulting job row in `indexed` state.
 *
 * Calling this endpoint twice with the same (ownerAddress, walrusBlobId) is
 * safe — the second call returns the existing row without mutation.
 *
 * Requirements: 6.10, 6.13, 7.1
 */
async function reconcileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requestId = getRequestId(req);

  try {
    // 1. Parse and validate request body
    const parseResult = ReconcileBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const details = parseResult.error.issues.reduce<Record<string, string>>(
        (acc, issue) => {
          acc[issue.path.join('.') || 'body'] = issue.message;
          return acc;
        },
        {},
      );
      sendErr(res, 'Validation', 'Request body validation failed.', 400, requestId, details);
      return;
    }

    const body = parseResult.data;

    // 2. Validate artifact-kind-specific constraints
    if ((body.artifactKind === 'submission' || body.artifactKind === 'file') && !body.formId) {
      sendErr(
        res,
        'Validation',
        `formId is required when artifactKind is '${body.artifactKind}'.`,
        400,
        requestId,
      );
      return;
    }

    // 3. Resolve the authenticated owner address.
    //    The api-auth middleware has already verified the bearer token.
    //    In the full session model (task 3.3), req.actor.address is set by
    //    the session middleware. For now we read from the Authorization header
    //    or fall back to a placeholder that is replaced when session auth lands.
    const ownerAddress = resolveOwnerAddress(req);
    if (!ownerAddress) {
      sendErr(res, 'Unauthorized', 'Authentication required.', 401, requestId);
      return;
    }

    // 4. Verify the blob exists on Walrus_Store before transitioning to indexed.
    //    Per design §7: "verify that the blob identifier exists on Walrus_Store
    //    before transitioning the record to `indexed`."
    const config = req.app.locals.config as ServerConfig | undefined;
    const aggregatorUrl = config?.walrusAggregatorUrl ?? process.env.WALRUS_AGGREGATOR_URL ?? '';

    if (!aggregatorUrl) {
      // Misconfiguration — fail safe rather than silently skip the check
      throw new ApiError(500, 'Internal', 'Walrus aggregator URL is not configured.');
    }

    const blobExists = await walrusBlobExists(body.walrusBlobId, aggregatorUrl);
    if (!blobExists) {
      sendErr(
        res,
        'BlobNotFound',
        `Blob '${body.walrusBlobId}' was not found on Walrus. ` +
          'The publisher may still be propagating — retry after a short delay.',
        404,
        requestId,
        { walrusBlobId: body.walrusBlobId },
      );
      return;
    }

    // 5. Upsert the metadata row — idempotent on (ownerAddress, walrusBlobId).
    const { row, created } = upsertJob(ownerAddress, body);

    // 6. Return the job row in the typed envelope.
    const status = created ? 201 : 200;
    sendOk(res, row, requestId, status);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /upload-jobs
 *
 * List upload jobs owned by the authenticated user.
 *
 * Query parameters:
 *   state        — filter by Upload_State_Machine state (optional)
 *   artifactKind — filter by artifact kind: form | submission | file (optional)
 *   limit        — max results per page, 1–100 (default 50)
 *   offset       — pagination offset (default 0)
 *
 * Requirements: 6.13, 7.1
 */
async function listHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requestId = getRequestId(req);

  try {
    // 1. Parse and validate query parameters
    const parseResult = ListQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const details = parseResult.error.issues.reduce<Record<string, string>>(
        (acc, issue) => {
          acc[issue.path.join('.') || 'query'] = issue.message;
          return acc;
        },
        {},
      );
      sendErr(res, 'Validation', 'Query parameter validation failed.', 400, requestId, details);
      return;
    }

    const query = parseResult.data;

    // 2. Resolve the authenticated owner address
    const ownerAddress = resolveOwnerAddress(req);
    if (!ownerAddress) {
      sendErr(res, 'Unauthorized', 'Authentication required.', 401, requestId);
      return;
    }

    // 3. Fetch jobs from the store
    const { rows, total } = listJobs(ownerAddress, {
      state: query.state,
      artifactKind: query.artifactKind,
      limit: query.limit,
      offset: query.offset,
    });

    // 4. Return paginated result in the typed envelope
    sendOk(
      res,
      {
        jobs: rows,
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + rows.length < total,
        },
      },
      requestId,
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Owner address resolution
//
// In the full session model (task 3.3), the session middleware attaches the
// verified address to `req.actor`. Until that middleware is wired in, we
// extract the address from the `X-Actor-Address` header (set by the client
// for development) or return null to trigger a 401.
//
// This shim is intentionally minimal — it is replaced wholesale when the
// session middleware lands. The route logic above is unchanged.
// ---------------------------------------------------------------------------

/**
 * Resolve the authenticated owner address from the request.
 *
 * Returns `null` if no address can be determined (caller should return 401).
 */
function resolveOwnerAddress(req: Request): string | null {
  // Full session model: req.actor is set by session middleware (task 3.3)
  const actor = (req as Request & { actor?: { address: string } }).actor;
  if (actor?.address) {
    return actor.address;
  }

  // Development shim: accept X-Actor-Address header when auth is skipped
  const headerAddress = req.headers['x-actor-address'];
  if (typeof headerAddress === 'string' && headerAddress.startsWith('0x')) {
    return headerAddress;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create and return the upload-jobs Express router.
 *
 * Mount at `/upload-jobs` (or `/api/upload-jobs` depending on the app
 * prefix). Authentication is enforced at the parent `/api` router level
 * via `apiAuthMiddleware`.
 */
export function uploadJobsRouter(_config: ServerConfig): Router {
  const router = Router();

  /**
   * POST /upload-jobs/reconcile
   *
   * Idempotent reconcile of an orphaned upload job.
   * Validates blob existence on Walrus before transitioning to `indexed`.
   */
  router.post('/reconcile', reconcileHandler);

  /**
   * GET /upload-jobs
   *
   * List upload jobs for the authenticated user, with optional state filter.
   */
  router.get('/', listHandler);

  return router;
}
