/**
 * Global error handler and 404 handler for the Express VPS server.
 *
 * Catches all errors thrown from route handlers, maps them to structured
 * JSON responses with appropriate HTTP status codes, and logs the originals
 * for debugging without exposing internals to clients.
 */

import type { Request, Response, NextFunction } from 'express';
import { EnvLoadError } from '@poc/shared';
import { WalrusError } from '@poc/walrus';

// ─── Typed API error for route handlers to throw ────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Not found handler ───────────────────────────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found.`,
    },
  });
}

// ─── Global error handler ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Structured internal log — never surfaces raw error to clients
  console.error(
    JSON.stringify({
      event: 'unhandled_error',
      method: req.method,
      url: req.url,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined,
      timestamp: new Date().toISOString(),
    }),
  );

  // Handle payload-too-large errors emitted by express.json() body parser
  if (
    err instanceof Error &&
    (err as Error & { type?: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({
      error: {
        code: 'PayloadTooLarge',
        message: 'Request body exceeds the maximum allowed size.',
      },
    });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (err instanceof EnvLoadError) {
    res.status(500).json({
      error: {
        code: 'ENV_INVALID',
        message: 'Server misconfiguration. Please contact support.',
      },
    });
    return;
  }

  if (err instanceof WalrusError) {
    const status = err.code === 'AGGREGATOR_NOT_FOUND' ? 404 : 502;
    res.status(status).json({
      error: {
        code: `WALRUS_${err.code}`,
        message: 'Storage operation failed. Please try again.',
      },
    });
    return;
  }

  // Unknown error — return a safe generic message
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
}
