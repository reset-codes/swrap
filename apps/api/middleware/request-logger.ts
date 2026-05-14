/**
 * Request logger middleware.
 *
 * Emits a single structured JSON log line per request on completion.
 * Follows the principle of structured logging for production observability.
 * Never logs request bodies (may contain PII or sensitive submission data).
 */

import type { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, url, ip } = req;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const { statusCode } = res;

    // Use structured JSON for log aggregation compatibility (Datadog, Loki, etc.)
    console.log(
      JSON.stringify({
        event: 'http_request',
        method,
        url,
        status: statusCode,
        durationMs,
        // IP is logged only as a hash-like prefix for rate-limit tracing — not full IP
        ipPrefix: ip ? ip.split('.').slice(0, 2).join('.') : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    );
  });

  next();
}
