/**
 * Express app factory for the Swrap VPS API server.
 *
 * Separating the app creation from the server startup makes the app
 * importable in tests without binding to a port.
 *
 * Middleware stack order (requirements 9.1, 9.6, 9.7, 9.9, 9.10):
 *   request-id → request-logger → cors → security-headers →
 *   rate-limit → payload-limit → auth-verify → router → error-handler
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { ServerConfig } from './server-config';
import { requestLogger } from './middleware/request-logger';
import { corsMiddleware } from './middleware/cors';
import { securityHeaders } from './middleware/security-headers';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { payloadLimitMiddleware } from './middleware/payload-limit';
import { apiAuthMiddleware } from './middleware/api-auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import { submissionsRouter } from './routes/submissions';
import { formsRouter } from './routes/forms';
import { filesRouter } from './routes/files';
import { authRouter, meRouter } from './routes/auth';
import { activityRouter } from './routes/activity';

// ---------------------------------------------------------------------------
// Request-ID middleware (first in stack)
// ---------------------------------------------------------------------------

/**
 * Assigns a unique request ID to every incoming request.
 * Sets `X-Request-ID` on both the request (for downstream middleware) and
 * the response (for client-side correlation).
 *
 * If the client sends an `X-Request-ID` header, it is preserved; otherwise
 * a new UUID is generated.
 */
function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingId = req.headers['x-request-id'];
  const requestId =
    typeof existingId === 'string' && existingId.length > 0 ? existingId : randomUUID();

  // Attach to request headers so downstream middleware (e.g. request-logger) can read it
  req.headers['x-request-id'] = requestId;
  // Echo back on the response for client-side correlation
  res.setHeader('X-Request-ID', requestId);

  next();
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export function createApp(config: ServerConfig): Express {
  const app = express();

  // Remove the default X-Powered-By header
  app.disable('x-powered-by');

  // ── 1. Request ID ─────────────────────────────────────────────────────────
  app.use(requestIdMiddleware);

  // ── 2. Request logger ─────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── 3. CORS ───────────────────────────────────────────────────────────────
  app.use(corsMiddleware(config));

  // ── 4. Security headers ───────────────────────────────────────────────────
  app.use(securityHeaders);

  // ── 5. Rate limiting ──────────────────────────────────────────────────────
  app.use(rateLimitMiddleware());

  // ── 6. Payload limit (replaces express.json({ limit: '1mb' })) ────────────
  app.use(payloadLimitMiddleware());

  // ── Public routes (no auth required) ─────────────────────────────────────
  app.use('/health', healthRouter(config));

  // ── Auth routes (no API_SECRET_KEY required — use session tokens) ─────────
  app.use('/api/auth', authRouter());
  app.use('/api/me', meRouter());

  // ── 7. Auth verify ────────────────────────────────────────────────────────
  // Admin routes require API_SECRET_KEY bearer token
  app.use('/api', apiAuthMiddleware(config));

  // ── 8. Router ─────────────────────────────────────────────────────────────
  app.use('/api/forms', formsRouter(config));
  app.use('/api/submissions', submissionsRouter(config));
  app.use('/api/files', filesRouter(config));
  app.use('/api/activity', activityRouter(config));

  // ── 9. Error handling ─────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
