/**
 * File attachment routes for the Swrap API server.
 *
 * POST /files
 *   - Creates a file attachment metadata record under a submission.
 *   - Validates body: submissionId, walrusBlobId, contentType, sizeBytes, contentDigest.
 *   - Verifies that the referenced submissionId exists before inserting.
 *   - Returns ApiResponse<FileRow> with the created record.
 *
 * GET /files/:id
 *   - Returns file attachment metadata by file ID.
 *   - Returns ApiResponse<FileRow> or 404 if not found.
 *
 * Both routes require authentication (enforced at the /api router level).
 * All responses use the typed ApiResponse<T> envelope.
 *
 * Requirements: 5.3, 5.7, 7.1
 */

import { Router } from 'express';
import { z } from 'zod';
import type { ServerConfig } from '../server-config';
import { ApiError } from '../middleware/error-handler';
import {
  ok as apiOk,
  err as apiErr,
  type ApiResponse,
  type ApiErrorCode,
  type ApiError as ApiErrorType,
} from '../error-envelope';

// Re-export the canonical envelope types so existing consumers of this module
// continue to compile without changes.
export type { ApiResponse, ApiErrorCode };
export type ApiResponseError = ApiErrorType;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * Upload state machine states for file attachments.
 * Mirrors the `files.state` column in the Postgres schema.
 */
export type FileState =
  | 'pending'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'indexed'
  | 'failed';

/**
 * A file attachment metadata row as returned by the API.
 * Maps to the `files` table in the Postgres schema (design.md §5).
 *
 * Postgres MUST NOT contain file bytes — only the Walrus blob identifier,
 * content type, size, digest, and state are stored here.
 */
export interface FileRow {
  id: string;
  submissionId: string;
  walrusBlobId: string;
  contentType: string;
  sizeBytes: number;
  contentDigest: string;
  state: FileState;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// In-memory stub store (replaces DB layer until Postgres integration lands)
//
// This stub is intentionally simple: it provides the correct interface so
// route logic, validation, and response shaping can be tested end-to-end
// without a live database. The DB layer will be swapped in during the
// Postgres integration phase (task 1.x).
// ---------------------------------------------------------------------------

/** Stub submission store — keyed by submission ID. */
const _submissions = new Map<string, { id: string }>();

/** Stub file store — keyed by file ID. */
const _files = new Map<string, FileRow>();

/**
 * Seed a submission into the stub store.
 * Used by tests to set up known-good submission IDs.
 */
export function _stubSeedSubmission(id: string): void {
  _submissions.set(id, { id });
}

/**
 * Clear all stub data.
 * Used by tests to reset state between cases.
 */
export function _stubClear(): void {
  _submissions.clear();
  _files.clear();
}

/** Check whether a submission exists (stub implementation). */
async function submissionExists(submissionId: string): Promise<boolean> {
  return _submissions.has(submissionId);
}

/** Persist a new file record (stub implementation). */
async function insertFile(row: FileRow): Promise<FileRow> {
  _files.set(row.id, row);
  return row;
}

/** Retrieve a file record by ID (stub implementation). */
async function findFileById(id: string): Promise<FileRow | null> {
  return _files.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Validation schemas (Zod)
// ---------------------------------------------------------------------------

/**
 * Zod schema for POST /files request body.
 *
 * All fields are required. sizeBytes must be a non-negative integer.
 * contentDigest is expected to be a hex-encoded SHA-256 (64 hex chars),
 * but we accept any non-empty string to allow future digest schemes.
 */
const CreateFileBodySchema = z.object({
  submissionId: z
    .string()
    .uuid({ message: 'submissionId must be a valid UUID' }),

  walrusBlobId: z
    .string()
    .min(1, { message: 'walrusBlobId must be a non-empty string' }),

  contentType: z
    .string()
    .min(1, { message: 'contentType must be a non-empty string' })
    .max(255, { message: 'contentType must be at most 255 characters' }),

  sizeBytes: z
    .number()
    .int({ message: 'sizeBytes must be an integer' })
    .nonnegative({ message: 'sizeBytes must be >= 0' }),

  contentDigest: z
    .string()
    .min(1, { message: 'contentDigest must be a non-empty string' }),
});

type CreateFileBody = z.infer<typeof CreateFileBodySchema>;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function requestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  return crypto.randomUUID();
}

function ok<T>(result: T, status: number, reqId: string): ApiResponse<T> {
  return apiOk(result, reqId, status);
}

function err(
  code: ApiErrorCode,
  message: string,
  status: number,
  reqId: string,
  details?: Record<string, unknown>,
): ApiResponse<never> {
  return apiErr(code, message, status, reqId, details);
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function filesRouter(_config: ServerConfig): Router {
  const router = Router();

  // ── POST /files ────────────────────────────────────────────────────────────
  /**
   * Create a file attachment metadata record.
   *
   * Body (JSON):
   *   submissionId   — UUID of the parent submission (must exist)
   *   walrusBlobId   — Walrus blob identifier for the file bytes
   *   contentType    — MIME type (e.g. "image/png")
   *   sizeBytes      — file size in bytes (non-negative integer)
   *   contentDigest  — SHA-256 hex digest of the file bytes
   *
   * Returns 201 ApiResponse<FileRow> on success.
   * Returns 400 on validation failure.
   * Returns 404 if the referenced submissionId does not exist.
   * Returns 409 if a file with the same walrusBlobId already exists (unique constraint).
   */
  router.post('/', async (req, res, next) => {
    const reqId = requestId(req as Parameters<typeof requestId>[0]);

    try {
      // 1. Parse and validate request body
      const parseResult = CreateFileBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const details = parseResult.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        }));
        res.status(400).json(
          err('Validation', 'Request body validation failed.', 400, reqId, {
            issues: details,
          }),
        );
        return;
      }

      const body: CreateFileBody = parseResult.data;

      // 2. Verify the referenced submission exists
      const exists = await submissionExists(body.submissionId);
      if (!exists) {
        res.status(404).json(
          err(
            'NotFound',
            `Submission '${body.submissionId}' not found.`,
            404,
            reqId,
          ),
        );
        return;
      }

      // 3. Check for duplicate walrusBlobId (unique constraint enforcement)
      const existingFiles = Array.from(_files.values());
      const duplicate = existingFiles.find((f) => f.walrusBlobId === body.walrusBlobId);
      if (duplicate) {
        res.status(409).json(
          err(
            'Conflict',
            `A file with walrusBlobId '${body.walrusBlobId}' already exists.`,
            409,
            reqId,
          ),
        );
        return;
      }

      // 4. Build and persist the file record
      //    Initial state is 'pending' — the upload state machine will advance it.
      const fileRow: FileRow = {
        id: crypto.randomUUID(),
        submissionId: body.submissionId,
        walrusBlobId: body.walrusBlobId,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        contentDigest: body.contentDigest,
        state: 'pending',
        createdAt: new Date().toISOString(),
      };

      const created = await insertFile(fileRow);

      res.status(201).json(ok(created, 201, reqId));
    } catch (error) {
      next(error);
    }
  });

  // ── GET /files/:id ─────────────────────────────────────────────────────────
  /**
   * Retrieve file attachment metadata by file ID.
   *
   * Path param:
   *   id — UUID of the file record
   *
   * Returns 200 ApiResponse<FileRow> on success.
   * Returns 400 if the id is not a valid UUID.
   * Returns 404 if no file with that ID exists.
   */
  router.get('/:id', async (req, res, next) => {
    const reqId = requestId(req as Parameters<typeof requestId>[0]);

    try {
      const { id } = req.params;

      // Validate that the path param is a UUID
      const uuidResult = z.string().uuid().safeParse(id);
      if (!uuidResult.success) {
        res.status(400).json(
          err('BadRequest', 'File id must be a valid UUID.', 400, reqId),
        );
        return;
      }

      const file = await findFileById(id);
      if (!file) {
        res.status(404).json(
          err('NotFound', `File '${id}' not found.`, 404, reqId),
        );
        return;
      }

      res.status(200).json(ok(file, 200, reqId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
