/**
 * API authentication middleware.
 *
 * Validates the Authorization: Bearer <token> header against API_SECRET_KEY.
 * Used on all /api/* routes to prevent unauthorized access.
 *
 * In development with no API_SECRET_KEY set, auth is skipped with a warning.
 * In production, missing or invalid tokens always return 401.
 *
 * SECURITY: Timing-safe comparison is used to prevent timing attacks.
 */

import { timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig } from '../server-config';

/**
 * Constant-time string comparison to prevent timing oracle attacks on the
 * secret key comparison.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  // Both buffers must be the same length — hash both to normalize length
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function apiAuthMiddleware(config: ServerConfig) {
  return function auth(req: Request, res: Response, next: NextFunction): void {
    // Skip auth in development when no key is configured
    if (config.skipAuth) {
      console.warn(
        JSON.stringify({
          event: 'auth_skipped',
          reason: 'No API_SECRET_KEY set in non-production environment',
          url: req.url,
        }),
      );
      next();
      return;
    }

    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authorization header required.' },
      });
      return;
    }

    const token = authHeader.slice(7); // Remove "Bearer "
    if (!timingSafeStringEqual(token, config.apiSecretKey)) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key.' },
      });
      return;
    }

    next();
  };
}
