/**
 * Request logger middleware.
 *
 * Emits a single structured JSON log line per request on completion.
 * Uses an explicit allow-list of fields — anything not on the list is never
 * logged, preventing accidental leakage of sensitive data.
 *
 * Allow-listed fields:
 *   ts, level, event, requestId, method, path, actor, status, durationMs, outcome
 *
 * Explicitly excluded (never logged):
 *   - Request body / response body
 *   - JWTs (Authorization header values)
 *   - ZK proofs, signatures, ciphertext, plaintext
 *   - Infrastructure_Wallet credentials
 *   - Any header value (only header names are safe to log)
 *
 * Requirements: 7.7, 9.4, 9.11
 */

import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Allow-listed log record shape
// ---------------------------------------------------------------------------

interface RequestLogRecord {
  ts: string;
  level: 'info' | 'warn' | 'error';
  event: 'http_request';
  requestId: string;
  method: string;
  path: string;
  /** Asserted actor address — derived from X-Actor-Address header if present; never the raw JWT */
  actor: string | null;
  status: number;
  durationMs: number;
  outcome: 'ok' | 'client_error' | 'server_error';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveOutcome(status: number): RequestLogRecord['outcome'] {
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'ok';
}

/**
 * Extract the request ID from the `X-Request-ID` header.
 * Never falls back to generating one here — that is the request-id middleware's job.
 */
function extractRequestId(req: Request): string {
  const id = req.headers['x-request-id'];
  if (typeof id === 'string' && id.length > 0) return id;
  return 'unknown';
}

/**
 * Extract the actor address from the `X-Actor-Address` header.
 * This header is set by the auth middleware after verifying the session.
 * We NEVER log the raw Authorization header value (which may contain a JWT or token).
 */
function extractActor(req: Request): string | null {
  const actor = req.headers['x-actor-address'];
  if (typeof actor === 'string' && actor.length > 0) return actor;
  return null;
}

/**
 * Sanitize the URL path — strip query string parameters that might contain
 * sensitive values (tokens, keys, etc.). Only the path component is logged.
 */
function sanitizePath(url: string): string {
  try {
    // Parse relative URL by prepending a dummy base
    const parsed = new URL(url, 'http://localhost');
    return parsed.pathname;
  } catch {
    // Fallback: strip everything after '?'
    return url.split('?')[0] ?? url;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = extractRequestId(req);
  const method = req.method;
  const path = sanitizePath(req.url ?? '');

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const status = res.statusCode;
    const actor = extractActor(req);
    const outcome = deriveOutcome(status);

    const record: RequestLogRecord = {
      ts: new Date().toISOString(),
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      event: 'http_request',
      requestId,
      method,
      path,
      actor,
      status,
      durationMs,
      outcome,
    };

    // Use structured JSON for log aggregation compatibility (Datadog, Loki, etc.)
    console.log(JSON.stringify(record));
  });

  next();
}
