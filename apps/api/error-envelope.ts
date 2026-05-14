/**
 * Error-envelope helper for POC API routes.
 *
 * `toErrorResponse(err)` maps known error classes to structured JSON responses
 * with the correct HTTP status code and the standard error envelope shape:
 *
 *   { error: { code, stage, message, details? } }
 *
 * Error → HTTP status mapping (from design.md):
 *   EnvLoadError        → 500, code: ENV_INVALID,          stage: env
 *   SignerDetectorError → 500, code: SIGNER_${error.code}, stage: signer
 *   SuiClientError      → 502, code: SUI_${error.code},    stage: sui
 *   WalrusError         → 502 (network) / 404 (NOT_FOUND), code: WALRUS_${error.code}, stage: walrus
 *   unknown             → 500, code: INTERNAL_ERROR,        stage: unknown
 *
 * Requirements: R2.9, R3.5, R3.6, R4.5, R5.4
 */

import { NextResponse } from 'next/server';
import { EnvLoadError } from '@poc/shared';
import { SignerDetectorError } from '@poc/sui';
import { SuiClientError } from '@poc/sui';
import { WalrusError } from '@poc/walrus';

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface ErrorEnvelope {
  error: {
    code: string;
    stage: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// WalrusError codes that map to 404 instead of 502
// ---------------------------------------------------------------------------

const WALRUS_NOT_FOUND_CODES = new Set<string>(['AGGREGATOR_NOT_FOUND']);

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

/**
 * Convert any thrown value into a `NextResponse<ErrorEnvelope>` with the
 * correct HTTP status code and structured error body.
 */
export function toErrorResponse(err: unknown): NextResponse<ErrorEnvelope> {
  // --- EnvLoadError → 500 ---
  if (err instanceof EnvLoadError) {
    return NextResponse.json(
      {
        error: {
          code: 'ENV_INVALID',
          stage: 'env',
          message: err.message,
          details: { field: err.field },
        },
      },
      { status: 500 },
    );
  }

  // --- SignerDetectorError → 500 ---
  if (err instanceof SignerDetectorError) {
    const details: Record<string, unknown> = { path: err.path };
    if (err.field !== undefined) details.field = err.field;

    return NextResponse.json(
      {
        error: {
          code: `SIGNER_${err.code.toUpperCase()}`,
          stage: 'signer',
          message: err.message,
          details,
        },
      },
      { status: 500 },
    );
  }

  // --- SuiClientError → 502 ---
  if (err instanceof SuiClientError) {
    return NextResponse.json(
      {
        error: {
          code: `SUI_${err.code}`,
          stage: 'sui',
          message: err.message,
          details: { endpoint: err.endpoint },
        },
      },
      { status: 502 },
    );
  }

  // --- WalrusError → 404 (NOT_FOUND) or 502 (everything else) ---
  if (err instanceof WalrusError) {
    const status = WALRUS_NOT_FOUND_CODES.has(err.code) ? 404 : 502;
    return NextResponse.json(
      {
        error: {
          code: `WALRUS_${err.code}`,
          stage: 'walrus',
          message: err.message,
          details: { endpoint: err.endpoint },
        },
      },
      { status },
    );
  }

  // --- Unknown error → 500 ---
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'An unexpected error occurred';

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
