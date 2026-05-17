/**
 * apps/api/routes/forms.ts — Production forms routes
 *
 * Endpoints:
 *   POST   /forms           — Create a form (requires auth session)
 *   GET    /forms           — List forms (filter by owner; requires auth)
 *   GET    /forms/:id       — Get form metadata (public forms open; private require auth)
 *   POST   /forms/:id/version — Create a new form version on privacy mode change (requires auth + owner)
 *
 * Form creation flow:
 *   Web_App → POST /forms { formDefinition, privacyMode, policyId? }
 *     → API validates auth session
 *     → delegates to orchestrateFormCreate() (canonical upload orchestration module)
 *     → returns ApiResponse<FormRow> with state: 'indexed'
 *
 * Upload state machine transitions are managed exclusively by
 * metadata-orchestrator.ts — this route does NOT call walrusPut or sealEncrypt
 * directly.
 *
 * All responses use the typed ApiResponse<T> envelope:
 *   { ok: true,  requestId, result: T }
 *   { ok: false, requestId, error: { code, message, details? } }
 *
 * Auth: reads the session address from the Authorization: Bearer header (or
 * req.headers['x-session-address'] as a fallback for the interim period before
 * apps/api/auth/session.ts is wired in). When apps/api/auth/session.ts exists
 * and exports `getSessionAddress`, that will be the canonical source.
 *
 * DB layer: uses an in-memory stub (Map-based) so the route structure is
 * production-ready while the real Postgres layer (task 1) is being wired in.
 * Replace `formStore` with real DB calls once the migration tooling lands.
 *
 * Requirements: 4.1, 4.4, 4.5, 4.7, 7.1, 7.5, 7.9, 3.3
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig } from '../server-config';
import {
  orchestrateFormCreate,
  BlobNotFoundError,
  OrchestrationError,
  type Db,
  type FormRecord,
  type SubmissionRecord,
  type FileRecord,
  type UploadJobRecord,
  type UploadState,
} from '../services/metadata-orchestrator';
import { WalletNotConfiguredError, SealEncryptionError } from '../services/infrastructure-wallet';
import {
  ok as apiOk,
  err as apiErr,
  type ApiResponse,
  type ApiErrorCode,
  type ApiResponseOk,
  type ApiResponseErr,
} from '../error-envelope';

// Re-export the canonical envelope types so existing consumers of this module
// continue to compile without changes.
export type { ApiResponse, ApiErrorCode, ApiResponseOk, ApiResponseErr };

// ---------------------------------------------------------------------------
// Route-local response helpers (thin wrappers that write to Express Response)
// ---------------------------------------------------------------------------

function ok<T>(result: T, res: Response, requestId: string, status = 200): void {
  res.status(status).json(apiOk(result, requestId, status));
}

function err(
  code: ApiErrorCode,
  message: string,
  res: Response,
  requestId: string,
  status: number,
  details?: Record<string, unknown>,
): void {
  res.status(status).json(apiErr(code, message, status, requestId, details));
}

// ---------------------------------------------------------------------------
// Request ID helper
// ---------------------------------------------------------------------------

function getRequestId(req: Request): string {
  return (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Session address extraction
// ---------------------------------------------------------------------------

/**
 * Extract the authenticated session address from the request.
 *
 * Priority:
 *   1. `Authorization: Bearer <address>` header (interim — will be replaced
 *      by a real session token once apps/api/auth/session.ts is wired in)
 *   2. `x-session-address` header (test/dev convenience)
 *
 * Returns null if no address is present.
 */
function getSessionAddress(req: Request): string | null {
  // Try to import session.ts dynamically if it exists (forward-compat shim)
  // For now, read from the Authorization header or x-session-address.
  const authHeader = req.headers.authorization ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      return token;
    }
  }

  const sessionHeader = req.headers['x-session-address'];
  if (typeof sessionHeader === 'string' && sessionHeader.trim().length > 0) {
    return sessionHeader.trim();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const PrivacyModeSchema = z.enum(['public', 'private']);

const CreateFormBodySchema = z.object({
  /**
   * The Form_Definition JSON body — the canonical form schema document.
   * The API_Server will serialize this to bytes, upload to Walrus, and
   * record the resulting blob ID in metadata.
   *
   * Must be a non-null object (the form definition document).
   * Requirements: 4.1, 3.3
   */
  formDefinition: z
    .record(z.unknown())
    .refine((v) => v !== null && typeof v === 'object', {
      message: 'formDefinition must be a non-null JSON object',
    }),
  /** Privacy mode for this form */
  privacyMode: PrivacyModeSchema,
  /**
   * Seal policy ID — required when privacyMode is "private".
   * For private forms, the policyId is included in the form metadata so
   * that submission flows can reference the correct Seal policy.
   * Requirements: 4.3, 4.4
   */
  policyId: z.string().optional(),
}).refine(
  (data) => data.privacyMode === 'public' || (data.policyId !== undefined && data.policyId.length > 0),
  { message: 'policyId is required when privacyMode is "private"', path: ['policyId'] },
);

const CreateVersionBodySchema = z.object({
  /** New privacy mode for the new version */
  privacyMode: PrivacyModeSchema,
  /**
   * The new Form_Definition JSON body for this version.
   * The API_Server will upload it to Walrus and record the blob ID.
   */
  formDefinition: z
    .record(z.unknown())
    .refine((v) => v !== null && typeof v === 'object', {
      message: 'formDefinition must be a non-null JSON object',
    }),
  /** Seal policy ID — required when privacyMode is "private" */
  policyId: z.string().optional(),
}).refine(
  (data) => data.privacyMode === 'public' || (data.policyId !== undefined && data.policyId.length > 0),
  { message: 'policyId is required when privacyMode is "private"', path: ['policyId'] },
);

const ListFormsQuerySchema = z.object({
  ownerAddress: z.string().optional(),
  state: z
    .enum(['pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

// FormRow is an alias for FormRecord from the orchestrator — the canonical
// type for form metadata rows. Re-exported for backward compatibility with
// existing tests and consumers.
export type { FormRecord as FormRow } from '../services/metadata-orchestrator';
export type FormState = UploadState;

// ---------------------------------------------------------------------------
// In-memory stub DB layer
// ---------------------------------------------------------------------------
// Replace these with real Postgres calls once task 1 (DB migrations) lands.
// The interface is intentionally thin so the swap is mechanical.
//
// This store implements the Db interface from metadata-orchestrator.ts so
// that orchestrateFormCreate() can be called directly from the route handler.

const formStore = new Map<string, FormRecord>();
const uploadJobStore = new Map<string, UploadJobRecord>();

/** Db adapter backed by the in-memory stores above. */
const inMemoryDb: Db = {
  getForm: (id) => formStore.get(id),
  insertForm: (row) => { formStore.set(row.id, row); return row; },
  getSubmission: (_id) => undefined,
  insertSubmission: (row) => row,
  getFile: (_id) => undefined,
  insertFile: (row) => row,
  insertUploadJob: (row) => { uploadJobStore.set(row.id, row); return row; },
  updateUploadJobState: (jobId, state, failureReason) => {
    const job = uploadJobStore.get(jobId);
    if (job) {
      job.state = state;
      job.failureReason = failureReason ?? null;
      job.updatedAt = new Date().toISOString();
    }
  },
  findFormByBlob: (ownerAddress, walrusBlobId) =>
    Array.from(formStore.values()).find(
      (f) => f.ownerAddress === ownerAddress && f.walrusBlobId === walrusBlobId,
    ),
  findSubmissionByBlob: (_formId, _walrusBlobId) => undefined,
};

function dbGetForm(id: string): FormRecord | undefined {
  return formStore.get(id);
}

function dbListForms(filter: {
  ownerAddress?: string;
  state?: UploadState;
  limit: number;
  offset: number;
}): FormRecord[] {
  let rows = Array.from(formStore.values());

  if (filter.ownerAddress !== undefined) {
    rows = rows.filter((r) => r.ownerAddress === filter.ownerAddress);
  }
  if (filter.state !== undefined) {
    rows = rows.filter((r) => r.state === filter.state);
  }

  // Sort by createdAt descending (newest first)
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return rows.slice(filter.offset, filter.offset + filter.limit);
}

// Exported for tests — allows resetting the in-memory store between test runs
export function _resetFormStore(): void {
  formStore.clear();
  uploadJobStore.clear();
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function formsRouter(_config: ServerConfig): Router {
  const router = Router();

  // ── POST /forms — create a form ──────────────────────────────────────────

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);
    try {
      // 1. Auth — session address required (Requirement 7.1)
      const sessionAddress = getSessionAddress(req);
      if (!sessionAddress) {
        err('Unauthorized', 'Authentication required to create a form.', res, requestId, 401);
        return;
      }

      // 2. Validate body
      const parseResult = CreateFormBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const details: Record<string, unknown> = {};
        for (const issue of parseResult.error.issues) {
          details[issue.path.join('.') || 'body'] = issue.message;
        }
        err('Validation', 'Request body validation failed.', res, requestId, 400, details);
        return;
      }

      const body = parseResult.data;

      // 3. Delegate to the canonical upload orchestration module.
      //    orchestrateFormCreate handles: canonicalize → (encrypt if private) →
      //    walrusPut → existence check → metadata index → audit entry.
      //    Requirements: 3.3, 6.1–6.7
      const formCountBefore = formStore.size;
      let result: import('../services/metadata-orchestrator').CreateFormResult;
      try {
        result = await orchestrateFormCreate(
          {
            formDefinition: body.formDefinition,
            privacyMode: body.privacyMode,
            policyId: body.policyId,
            version: 1,
          },
          sessionAddress,
          inMemoryDb,
        );
      } catch (orchErr) {
        if (orchErr instanceof BlobNotFoundError) {
          err('BlobNotFound', orchErr.message, res, requestId, 404);
          return;
        }
        if (orchErr instanceof WalletNotConfiguredError) {
          err('Internal', 'Encryption service is not available. Please try again later.', res, requestId, 500);
          return;
        }
        if (orchErr instanceof SealEncryptionError) {
          err('Internal', 'Form encryption failed. Please try again.', res, requestId, 500);
          return;
        }
        if (orchErr instanceof OrchestrationError) {
          const cause = orchErr.cause;
          if (cause instanceof Error && cause.name === 'WalrusPutError') {
            err('Internal', 'Failed to upload form definition to storage. Please try again.', res, requestId, 502);
            return;
          }
          err('Internal', 'Form creation failed. Please try again.', res, requestId, 500);
          return;
        }
        throw orchErr;
      }

      // 4. Map orchestrator result to FormRow response
      const formRow = dbGetForm(result.formId);
      if (!formRow) {
        // Should not happen — orchestrator inserts the row before returning
        err('Internal', 'Form was created but could not be retrieved.', res, requestId, 500);
        return;
      }

      // Determine status: 200 for idempotent reconcile, 201 for new creation
      const isIdempotent = formStore.size === formCountBefore;

      ok<FormRecord>(formRow, res, requestId, isIdempotent ? 200 : 201);
    } catch (e) {
      next(e);
    }
  });

  // ── GET /forms — list forms ──────────────────────────────────────────────

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);
    try {
      // Auth required for listing
      const sessionAddress = getSessionAddress(req);
      if (!sessionAddress) {
        err('Unauthorized', 'Authentication required to list forms.', res, requestId, 401);
        return;
      }

      // Validate query params
      const queryResult = ListFormsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        const details: Record<string, unknown> = {};
        for (const issue of queryResult.error.issues) {
          details[issue.path.join('.') || 'query'] = issue.message;
        }
        err('Validation', 'Query parameter validation failed.', res, requestId, 400, details);
        return;
      }

      const query = queryResult.data;

      // Enforce: callers can only list their own forms unless they are the owner
      // (For now, if ownerAddress is specified it must match the session address.)
      const effectiveOwner = query.ownerAddress ?? sessionAddress;
      if (query.ownerAddress !== undefined && query.ownerAddress !== sessionAddress) {
        err(
          'Forbidden',
          'You may only list forms owned by your account.',
          res,
          requestId,
          403,
        );
        return;
      }

      const rows = dbListForms({
        ownerAddress: effectiveOwner,
        state: query.state,
        limit: query.limit,
        offset: query.offset,
      });

      ok<{ forms: FormRecord[]; total: number }>(
        { forms: rows, total: rows.length },
        res,
        requestId,
      );
    } catch (e) {
      next(e);
    }
  });

  // ── GET /forms/:id — get form metadata ──────────────────────────────────

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);
    try {
      const id = req.params['id'] as string;

      if (!id || typeof id !== 'string') {
        err('BadRequest', 'Form ID is required.', res, requestId, 400);
        return;
      }

      const form = dbGetForm(id);
      if (!form) {
        err('NotFound', `Form ${id} not found.`, res, requestId, 404);
        return;
      }

      // Public forms are open; private forms require auth + owner-or-viewer
      if (form.privacyMode === 'private') {
        const sessionAddress = getSessionAddress(req);
        if (!sessionAddress) {
          err(
            'Unauthorized',
            'Authentication required to access a private form.',
            res,
            requestId,
            401,
          );
          return;
        }

        // For now: only the owner can access private form metadata.
        // When the authorization service (task 15) is wired in, this will
        // also check viewer_permissions.
        if (sessionAddress !== form.ownerAddress) {
          err(
            'Forbidden',
            'You do not have permission to access this form.',
            res,
            requestId,
            403,
          );
          return;
        }
      }

      ok<FormRecord>(form, res, requestId);
    } catch (e) {
      next(e);
    }
  });

  // ── POST /forms/:id/version — create a new form version ─────────────────

  router.post('/:id/version', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);
    try {
      const id = req.params['id'] as string;

      // Auth required
      const sessionAddress = getSessionAddress(req);
      if (!sessionAddress) {
        err(
          'Unauthorized',
          'Authentication required to create a form version.',
          res,
          requestId,
          401,
        );
        return;
      }

      // Validate body
      const parseResult = CreateVersionBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const details: Record<string, unknown> = {};
        for (const issue of parseResult.error.issues) {
          details[issue.path.join('.') || 'body'] = issue.message;
        }
        err('Validation', 'Request body validation failed.', res, requestId, 400, details);
        return;
      }

      const body = parseResult.data;

      // Look up the predecessor form
      const predecessor = dbGetForm(id);
      if (!predecessor) {
        err('NotFound', `Form ${id} not found.`, res, requestId, 404);
        return;
      }

      // Enforce owner check — only the form owner can create a new version
      if (sessionAddress !== predecessor.ownerAddress) {
        err(
          'Forbidden',
          'Only the form owner can create a new version.',
          res,
          requestId,
          403,
        );
        return;
      }

      // Delegate to the canonical upload orchestration module.
      // Privacy mode change creates a new version (Requirement 4.7).
      let result: import('../services/metadata-orchestrator').CreateFormResult;
      try {
        result = await orchestrateFormCreate(
          {
            formDefinition: body.formDefinition,
            privacyMode: body.privacyMode,
            policyId: body.policyId,
            version: predecessor.version + 1,
            predecessorId: predecessor.id,
          },
          sessionAddress,
          inMemoryDb,
        );
      } catch (orchErr) {
        if (orchErr instanceof BlobNotFoundError) {
          err('BlobNotFound', orchErr.message, res, requestId, 404);
          return;
        }
        if (orchErr instanceof WalletNotConfiguredError) {
          err('Internal', 'Encryption service is not available. Please try again later.', res, requestId, 500);
          return;
        }
        if (orchErr instanceof SealEncryptionError) {
          err('Internal', 'Form encryption failed. Please try again.', res, requestId, 500);
          return;
        }
        if (orchErr instanceof OrchestrationError) {
          const cause = orchErr.cause;
          if (cause instanceof Error && cause.name === 'WalrusPutError') {
            err('Internal', 'Failed to upload form definition to storage. Please try again.', res, requestId, 502);
            return;
          }
          err('Internal', 'Form version creation failed. Please try again.', res, requestId, 500);
          return;
        }
        throw orchErr;
      }

      const newFormRow = dbGetForm(result.formId);
      if (!newFormRow) {
        err('Internal', 'Form version was created but could not be retrieved.', res, requestId, 500);
        return;
      }

      ok<FormRecord>(newFormRow, res, requestId, 201);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
