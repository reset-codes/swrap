/**
 * apps/api/routes/activity.ts — audit log query endpoint.
 *
 * GET /activity
 *   - Returns audit log entries matching the supplied filter parameters.
 *   - Query parameters: actorAddress, formId, submissionId, fromTime, toTime
 *   - Authorization: Only form owners may query activity for their forms.
 *     If formId is provided, the actor must be the owner of that form.
 *     If formId is not provided, returns all activity (admin-level access
 *     or filtered by the actor's forms only).
 *   - Returns ApiResponse<AuditLogRow[]>
 *
 * Requirements: 7.4, 14.5, 14.6
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig } from '../server-config';
import {
  queryAuditLog,
  type AuditLogRow,
  type AuditLogFilter,
} from '../services/audit-log';
import {
  ok as apiOk,
  err as apiErr,
  type ApiResponse,
  type ApiErrorCode,
} from '../error-envelope';
import { assertOwner, ForbiddenError, AuditLogWriteError } from '../services/authorization';
import { _formStore } from './submissions';

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
// Zod validation schemas
// ---------------------------------------------------------------------------

/**
 * Query parameters for the activity endpoint.
 *
 * All parameters are optional:
 *   - actorAddress: Filter by requester Authorization_Identity address.
 *   - formId: Filter by form identifier. If provided, actor must be the form owner.
 *   - submissionId: Filter by submission identifier.
 *   - fromTime: Inclusive lower bound on createdAt (ISO 8601 timestamp).
 *   - toTime: Inclusive upper bound on createdAt (ISO 8601 timestamp).
 *
 * Requirements: 14.5
 */
const ListActivityQuerySchema = z.object({
  actorAddress: z.string().optional(),
  formId: z.string().uuid('formId must be a valid UUID').optional(),
  submissionId: z.string().uuid('submissionId must be a valid UUID').optional(),
  fromTime: z.string().datetime({ message: 'fromTime must be a valid ISO 8601 timestamp' }).optional(),
  toTime: z.string().datetime({ message: 'toTime must be a valid ISO 8601 timestamp' }).optional(),
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
 * Parse an ISO 8601 timestamp string into a Date object.
 * Returns undefined if the input is undefined or invalid.
 */
function parseOptionalTimestamp(timestamp?: string): Date | undefined {
  if (!timestamp) return undefined;
  const parsed = new Date(timestamp);
  if (isNaN(parsed.getTime())) return undefined;
  return parsed;
}

// ---------------------------------------------------------------------------
// Minimal Db adapter for authorization
// ---------------------------------------------------------------------------

/**
 * Minimal database interface for the authorization check.
 * Uses the in-memory stores from routes/submissions.ts.
 */
const activityAuthDb = {
  getForm: (formId: string) => _formStore.get(formId),
  getViewerPermission: () => undefined, // Activity query is owner-only
  getSubmission: () => undefined,
};

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create the activity router.
 *
 * The activity endpoint allows querying the audit log with filter parameters.
 * Authorization is enforced:
 *   - If formId is provided, the actor must be the owner of that form.
 *   - If formId is not provided, all activity entries are returned.
 *
 * Requirements: 7.4, 14.5, 14.6
 */
export function activityRouter(_config: ServerConfig): Router {
  const router = Router();

  // ── GET /activity ─────────────────────────────────────────────────────────
  /**
   * Query audit log entries.
   *
   * Returns audit entries matching the supplied filter parameters.
   * All filter fields are optional and are ANDed together.
   *
   * Query parameters:
   *   - actorAddress: Filter by requester address.
   *   - formId: Filter by form ID. Actor must be the form owner.
   *   - submissionId: Filter by submission ID.
   *   - fromTime: Inclusive lower bound on createdAt (ISO 8601).
   *   - toTime: Inclusive upper bound on createdAt (ISO 8601).
   *   - limit: Maximum number of results (default 50, max 100).
   *   - offset: Number of results to skip (default 0).
   *
   * Authorization:
   *   - If formId is provided, the actor (from x-actor-address header) must
   *     be the owner of that form.
   *   - If formId is not provided, all activity is returned (future: may
   *     restrict to admin users or filter by the actor's forms only).
   *
   * Returns: ApiResponse<AuditLogRow[]>
   *
   * Requirements: 7.4, 14.5, 14.6
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      // 1. Validate query parameters
      const parseResult = ListActivityQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        const response = err(
          'Validation',
          `Query parameter validation failed: ${issues.join('; ')}`,
          400,
          requestId,
        );
        res.status(400).json(response);
        return;
      }

      const query = parseResult.data;

      // 2. Extract actor address from request header for authorization
      //    In the current implementation the full ZK Login session middleware
      //    is wired in a later task; we read from `x-actor-address` as the
      //    session identity carrier.
      const actorAddress = (req.headers['x-actor-address'] as string | undefined)?.trim();

      // 3. Authorization check: if formId is provided, actor must be the owner
      if (query.formId) {
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

        // Use the authorization service to check ownership
        try {
          await assertOwner(actorAddress, query.formId, activityAuthDb, requestId);
        } catch (authErr) {
          if (authErr instanceof ForbiddenError) {
            const response = err(
              'Forbidden',
              'You are not authorized to view activity for this form.',
              403,
              requestId,
            );
            res.status(403).json(response);
            return;
          }
          if (authErr instanceof AuditLogWriteError) {
            // Audit write failed — treat as server error
            console.error(
              JSON.stringify({
                event: 'activity_audit_write_failed',
                action: 'authorization.assertOwner',
                requestId,
                timestamp: new Date().toISOString(),
              }),
            );
            const response = err(
              'Internal',
              'Authorization check failed. Please try again.',
              500,
              requestId,
            );
            res.status(500).json(response);
            return;
          }
          throw authErr;
        }
      }

      // 4. Build the filter object
      const filter: AuditLogFilter = {
        actorAddress: query.actorAddress,
        formId: query.formId,
        submissionId: query.submissionId,
        fromTime: parseOptionalTimestamp(query.fromTime),
        toTime: parseOptionalTimestamp(query.toTime),
      };

      // 5. Query the audit log
      const rows = await queryAuditLog(filter);

      // 6. Apply pagination (in-memory for now; Postgres will handle this natively)
      const paginatedRows = rows.slice(query.offset, query.offset + query.limit);

      // 7. Return the response
      const response = ok(paginatedRows, 200, requestId);
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
