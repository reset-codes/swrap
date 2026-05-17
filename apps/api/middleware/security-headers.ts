/**
 * Security headers middleware.
 *
 * Sets the following headers on every response:
 *   - Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy: no-referrer
 *   - Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
 *
 * Requirements: 9.10
 */

import type { Request, Response, NextFunction } from 'express';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
}
