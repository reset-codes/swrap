/**
 * CORS middleware factory.
 *
 * Configured via API_CORS_ORIGINS env var (comma-separated list of allowed origins).
 * Wildcards ("*") are explicitly rejected — only specific origins are permitted.
 *
 * Requests from origins not in the allowlist receive no CORS headers, causing
 * the browser to block the cross-origin request.
 *
 * Requirements: 9.9
 */

import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig } from '../server-config';

const ALLOWED_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type,Authorization,X-Request-ID';
const EXPOSE_HEADERS = 'X-Request-ID';

export function corsMiddleware(config: ServerConfig) {
  // Reject wildcard origins at middleware construction time — fail fast
  const allowedOrigins = config.corsOrigins.filter((o) => o !== '*');

  if (allowedOrigins.length !== config.corsOrigins.length) {
    console.warn(
      JSON.stringify({
        event: 'cors_wildcard_rejected',
        message:
          'Wildcard "*" entries in API_CORS_ORIGINS are not permitted and have been removed. ' +
          'Specify explicit origins only.',
      }),
    );
  }

  return function cors(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin ?? '';

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    // Handle pre-flight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }

    next();
  };
}
