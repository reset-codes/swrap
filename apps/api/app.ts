/**
 * Express app factory for the Swrap VPS API server.
 *
 * Separating the app creation from the server startup makes the app
 * importable in tests without binding to a port.
 */

import express, { type Express } from 'express';
import type { ServerConfig } from './server-config';
import { requestLogger } from './middleware/request-logger';
import { corsMiddleware } from './middleware/cors';
import { apiAuthMiddleware } from './middleware/api-auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import { submissionsRouter } from './routes/submissions';
import { formsRouter } from './routes/forms';

export function createApp(config: ServerConfig): Express {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────
  app.disable('x-powered-by');

  // ── Core middleware ──────────────────────────────────────────────────────
  app.use(corsMiddleware(config));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // ── Public routes ────────────────────────────────────────────────────────
  app.use('/health', healthRouter(config));

  // ── Authenticated routes ─────────────────────────────────────────────────
  // Admin routes require API_SECRET_KEY bearer token
  app.use('/api', apiAuthMiddleware(config));
  app.use('/api/forms', formsRouter(config));
  app.use('/api/forms', submissionsRouter(config));

  // ── Error handling ───────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
