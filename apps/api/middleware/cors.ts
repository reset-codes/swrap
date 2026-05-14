/**
 * CORS middleware factory.
 *
 * Configured via API_CORS_ORIGINS env var:
 *   - "*"                     → allow all origins (development only)
 *   - "https://swrap.xyz,..." → whitelist specific origins (production)
 *
 * Always allows credentials and the standard headers needed by the SUI wallet
 * and Walrus SDK.
 */

import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig } from '../server-config';

const ALLOWED_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type,Authorization,X-Request-ID';

export function corsMiddleware(config: ServerConfig) {
  return function cors(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin ?? '';
    const allowAll = config.corsOrigins.includes('*');

    if (allowAll || config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      if (!allowAll) {
        res.setHeader('Vary', 'Origin');
      }
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
