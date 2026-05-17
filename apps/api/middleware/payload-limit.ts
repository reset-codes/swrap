/**
 * Payload limit middleware.
 *
 * Parses JSON request bodies with a strict size limit.
 * Default: 64 KB. Configurable via PAYLOAD_LIMIT_BYTES env var.
 *
 * Requests exceeding the limit are rejected with HTTP 413 PayloadTooLarge.
 *
 * Requirements: 9.6
 */

import express, { type RequestHandler } from 'express';

/**
 * Returns an express.json() middleware configured with the payload limit.
 *
 * The limit is read from PAYLOAD_LIMIT_BYTES at call time (not at module load)
 * so tests can override it via environment variables.
 */
export function payloadLimitMiddleware(): RequestHandler {
  const limitBytes = process.env.PAYLOAD_LIMIT_BYTES
    ? parseInt(process.env.PAYLOAD_LIMIT_BYTES, 10)
    : 64 * 1024; // 64 KB default

  const limit = isNaN(limitBytes) || limitBytes <= 0 ? 64 * 1024 : limitBytes;

  return express.json({
    limit,
    // Express will emit a 413 SyntaxError / PayloadTooLargeError automatically
    // when the body exceeds the limit. The error-handler catches it.
  });
}
