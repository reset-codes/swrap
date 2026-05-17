/**
 * apps/api/error-envelope.ts — Canonical typed ApiResponse<T> contract.
 *
 * This is the single source of truth for the API response envelope used by
 * every route handler in the Swrap API server.
 *
 * Shape (from design.md §7):
 *
 *   type ApiResponse<T> =
 *     | { ok: true;  status: number; result: T;  requestId: string }
 *     | { ok: false; status: number; error: ApiError; requestId: string };
 *
 *   type ApiError = {
 *     code: ApiErrorCode;   // closed enum
 *     message: string;      // human-readable, no payload contents
 *     details?: Record<string, unknown>;  // structured, redacted
 *   };
 *
 * Helper functions:
 *   ok<T>(result, status?, requestId)  → ApiResponse<T>  (success branch)
 *   err(code, message, status, requestId, details?) → ApiResponse<never>  (error branch)
 *
 * Legacy helper (retained for backward compatibility with existing tests):
 *   toErrorResponse(err) → NextResponse<ErrorEnvelope>
 *     Maps known POC error classes to structured NextResponse JSON responses.
 *     This will be removed once the POC routes are fully migrated.
 *
 * Requirements: 7.6
 */

import { NextResponse } from 'next/server';
import { EnvLoadError } from '@poc/shared';
import { SignerDetectorError, SuiClientError } from '@poc/sui';
import { WalrusError } from '@poc/walrus';

// ---------------------------------------------------------------------------
// Closed error code enum
// ---------------------------------------------------------------------------

/**
 * Closed set of error codes for the ApiResponse error branch.
 * Every route handler MUST use one of these codes — no ad-hoc strings.
 *
 * Requirements: 7.6
 */
export type ApiErrorCode =
  | 'BadRequest'
  | 'Unauthorized'
  | 'Forbidden'
  | 'NotFound'
  | 'Conflict'
  | 'PayloadTooLarge'
  | 'TooManyRequests'
  | 'Validation'
  | 'Internal'
  | 'PrivacyModeMismatch'
  | 'BlobNotFound'
  | 'IntegrityMismatch'
  | 'AuthExpired';

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

export interface ApiError {
  /** Closed error code — one of ApiErrorCode. */
  code: ApiErrorCode;
  /** Human-readable message. MUST NOT contain payload bodies, keys, or credentials. */
  message: string;
  /** Optional structured details (redacted — no sensitive data). */
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ApiResponse<T>
// ---------------------------------------------------------------------------

export interface ApiResponseOk<T> {
  ok: true;
  status: number;
  requestId: string;
  result: T;
}

export interface ApiResponseErr {
  ok: false;
  status: number;
  requestId: string;
  error: ApiError;
}

/**
 * Typed response envelope for all API responses.
 *
 * Exactly one of `result` (success) or `error` (failure) is present.
 * `status` mirrors the HTTP status code.
 * `requestId` is the trace identifier for the request.
 *
 * Requirements: 7.6
 */
export type ApiResponse<T> = ApiResponseOk<T> | ApiResponseErr;

// ---------------------------------------------------------------------------
// Helper: ok<T>
// ---------------------------------------------------------------------------

/**
 * Build a successful ApiResponse<T>.
 *
 * @param result    The typed result payload.
 * @param requestId The request trace identifier.
 * @param status    HTTP status code (default 200).
 * @returns         ApiResponse<T> with ok: true.
 *
 * Requirements: 7.6
 */
export function ok<T>(result: T, requestId: string, status = 200): ApiResponse<T> {
  return { ok: true, status, requestId, result };
}

// ---------------------------------------------------------------------------
// Helper: err
// ---------------------------------------------------------------------------

/**
 * Build an error ApiResponse<never>.
 *
 * @param code      Closed error code from ApiErrorCode.
 * @param message   Human-readable message (no payload contents).
 * @param status    HTTP status code.
 * @param requestId The request trace identifier.
 * @param details   Optional structured details (redacted).
 * @returns         ApiResponse<never> with ok: false.
 *
 * Requirements: 7.6
 */
export function err(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId: string,
  details?: Record<string, unknown>,
): ApiResponse<never> {
  return {
    ok: false,
    status,
    requestId,
    error: { code, message, ...(details ? { details } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Legacy POC error envelope (retained for backward compatibility)
// ---------------------------------------------------------------------------
// The tests in error-envelope.test.ts cover this legacy helper.
// It will be removed once the POC Next.js routes are fully migrated.

export interface ErrorEnvelope {
  error: {
    code: string;
    stage: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** WalrusError codes that map to 404 instead of 502. */
const WALRUS_NOT_FOUND_CODES = new Set<string>(['AGGREGATOR_NOT_FOUND']);

/**
 * Convert any thrown value into a `NextResponse<ErrorEnvelope>` with the
 * correct HTTP status code and structured error body.
 *
 * @deprecated Use the typed `ok()` / `err()` helpers with Express routes instead.
 *   This helper is retained for the legacy POC Next.js routes only.
 */
export function toErrorResponse(thrownErr: unknown): NextResponse<ErrorEnvelope> {
  // --- EnvLoadError → 500 ---
  if (thrownErr instanceof EnvLoadError) {
    return NextResponse.json(
      {
        error: {
          code: 'ENV_INVALID',
          stage: 'env',
          message: thrownErr.message,
          details: { field: thrownErr.field },
        },
      },
      { status: 500 },
    );
  }

  // --- SignerDetectorError → 500 ---
  if (thrownErr instanceof SignerDetectorError) {
    const details: Record<string, unknown> = { path: thrownErr.path };
    if (thrownErr.field !== undefined) details.field = thrownErr.field;

    return NextResponse.json(
      {
        error: {
          code: `SIGNER_${thrownErr.code.toUpperCase()}`,
          stage: 'signer',
          message: thrownErr.message,
          details,
        },
      },
      { status: 500 },
    );
  }

  // --- SuiClientError → 502 ---
  if (thrownErr instanceof SuiClientError) {
    return NextResponse.json(
      {
        error: {
          code: `SUI_${thrownErr.code}`,
          stage: 'sui',
          message: thrownErr.message,
          details: { endpoint: thrownErr.endpoint },
        },
      },
      { status: 502 },
    );
  }

  // --- WalrusError → 404 (NOT_FOUND) or 502 (everything else) ---
  if (thrownErr instanceof WalrusError) {
    const status = WALRUS_NOT_FOUND_CODES.has(thrownErr.code) ? 404 : 502;
    return NextResponse.json(
      {
        error: {
          code: `WALRUS_${thrownErr.code}`,
          stage: 'walrus',
          message: thrownErr.message,
          details: { endpoint: thrownErr.endpoint },
        },
      },
      { status },
    );
  }

  // --- Unknown error → 500 ---
  const message =
    thrownErr instanceof Error
      ? thrownErr.message
      : typeof thrownErr === 'string'
        ? thrownErr
        : 'An unexpected error occurred';

  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        stage: 'unknown',
        message,
      },
    },
    { status: 500 },
  );
}
