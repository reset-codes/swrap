/**
 * Health route for the Express VPS API server.
 *
 * GET /health — Returns liveness/readiness status.
 *
 * Checks:
 *   1. Database connectivity — lightweight SELECT 1 query via Prisma.
 *   2. Infrastructure_Wallet availability — verifies INFRASTRUCTURE_WALLET_SECRET
 *      env var is set (never logs or returns the actual credential value).
 *
 * Response shape:
 *   {
 *     status: 'ok' | 'degraded',
 *     checks: {
 *       db: 'ok' | 'error',
 *       infraWallet: 'ok' | 'missing',
 *     },
 *     timestamp: string,   // ISO 8601
 *   }
 *
 * HTTP 200 when all checks pass, HTTP 503 when any check fails.
 *
 * SECURITY: The actual INFRASTRUCTURE_WALLET_SECRET value is NEVER logged,
 * returned, or included in any response field. Only its presence is checked.
 *
 * Requirements: health check for liveness/readiness
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import type { ServerConfig } from '../server-config';

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface HealthCheckResponse {
  status: 'ok' | 'degraded';
  checks: {
    db: 'ok' | 'error';
    infraWallet: 'ok' | 'missing';
  };
  timestamp: string;
  /** Git commit SHA baked in at Docker build time via COMMIT_SHA build-arg. */
  commit: string;
}

// ---------------------------------------------------------------------------
// Prisma client singleton for health checks
// ---------------------------------------------------------------------------

// A module-level Prisma client is acceptable here because the health endpoint
// is called frequently and we want connection reuse. The client is lazily
// initialised on first request so that import-time failures are avoided.
let _prisma: PrismaClient | null = null;

function getPrismaClient(databaseUrl: string): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
      log: [], // No query logging — avoids leaking connection string details
    });
  }
  return _prisma;
}

// ---------------------------------------------------------------------------
// DB connectivity check
// ---------------------------------------------------------------------------

async function checkDb(databaseUrl: string): Promise<'ok' | 'error'> {
  const prisma = getPrismaClient(databaseUrl);
  try {
    // Lightweight connectivity probe — does not touch application tables.
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    // Any error (connection refused, auth failure, timeout) → 'error'.
    // The error detail is intentionally not surfaced in the response to avoid
    // leaking connection string fragments or internal topology.
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Infrastructure_Wallet availability check
// ---------------------------------------------------------------------------

function checkInfraWallet(): 'ok' | 'missing' {
  // SECURITY: Only check presence of the env var — never read, log, or return
  // the actual credential value.
  const secret = process.env.INFRASTRUCTURE_WALLET_SECRET;
  return secret && secret.trim().length > 0 ? 'ok' : 'missing';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function healthRouter(config: ServerConfig): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const [dbStatus, infraWalletStatus] = await Promise.all([
      checkDb(config.databaseUrl),
      Promise.resolve(checkInfraWallet()),
    ]);

    const allOk = dbStatus === 'ok' && infraWalletStatus === 'ok';

    const body: HealthCheckResponse = {
      status: allOk ? 'ok' : 'degraded',
      checks: {
        db: dbStatus,
        infraWallet: infraWalletStatus,
      },
      timestamp: new Date().toISOString(),
      // Injected at Docker build time via COMMIT_SHA build-arg.
      // Falls back to 'unknown' if the image was built without the arg (e.g. local dev).
      commit: process.env.COMMIT_SHA ?? 'unknown',
    };

    // HTTP 200 when healthy, 503 when any check fails.
    res.status(allOk ? 200 : 503).json(body);
  });

  return router;
}
