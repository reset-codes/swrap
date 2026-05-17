/**
 * Legacy configuration detector.
 *
 * Provides two layers of protection against forbidden legacy environment
 * variables that must never be present in a production build:
 *
 *   DEV_BYPASS_STORAGE       — Legacy POC storage bypass flag
 *   DEV_LOCAL_SIGNER         — Legacy POC local signer flag
 *   DEV_ALLOW_PLAINTEXT      — Legacy POC plaintext flag
 *   INFRA_WALLET_PRIVATE_KEY — Old name for Infrastructure_Wallet secret
 *                              (renamed to INFRASTRUCTURE_WALLET_SECRET)
 *
 * Layer 1 — startup: `detectLegacyConfig()` is called once before the server
 * begins accepting requests. If any forbidden key is present it throws a
 * descriptive error listing every offending key, preventing server startup.
 *
 * Layer 2 — runtime: `legacyDetectorMiddleware` is an Express middleware that
 * re-checks the same keys on every request and returns 503 if any are found.
 * This is a belt-and-suspenders guard for environments where env vars can be
 * mutated after process start (e.g. some container runtimes).
 *
 * Requirements: 9.3, 9.8, 13.1
 */

import type { Request, Response, NextFunction } from 'express';
import { FORBIDDEN_ENV_KEYS, type ForbiddenEnvKey } from '../server-config';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the subset of `FORBIDDEN_ENV_KEYS` that are present in `source`.
 */
function findForbiddenKeys(
  source: Record<string, string | undefined>,
): ForbiddenEnvKey[] {
  return FORBIDDEN_ENV_KEYS.filter((key) => source[key] !== undefined);
}

/**
 * Build a human-readable description for a single forbidden key.
 */
function describeKey(key: ForbiddenEnvKey): string {
  switch (key) {
    case 'INFRA_WALLET_PRIVATE_KEY':
      return `${key} — renamed to INFRASTRUCTURE_WALLET_SECRET; update your environment and remove this key`;
    case 'DEV_BYPASS_STORAGE':
    case 'DEV_LOCAL_SIGNER':
    case 'DEV_ALLOW_PLAINTEXT':
      return `${key} — legacy POC flag; remove from environment before starting the server`;
    default: {
      // Exhaustiveness guard — TypeScript will catch unhandled members at
      // compile time; this branch is unreachable at runtime.
      const _exhaustive: never = key;
      return `${_exhaustive} — forbidden legacy key; remove from environment`;
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 1 — startup detection
// ---------------------------------------------------------------------------

/**
 * Detect the presence of forbidden legacy environment variables at startup.
 *
 * Call this function once, before `server.listen()`, to prevent the server
 * from starting with a misconfigured environment. If any forbidden key is
 * found the function throws an `Error` whose message lists every offending
 * key with a remediation hint.
 *
 * @param source - env-like object to inspect (defaults to `process.env`)
 * @throws {Error} if one or more forbidden keys are present
 */
export function detectLegacyConfig(
  source: Record<string, string | undefined> = process.env,
): void {
  const found = findForbiddenKeys(source);

  if (found.length === 0) {
    return;
  }

  const descriptions = found.map((key) => `  • ${describeKey(key)}`).join('\n');

  throw new Error(
    `Server startup aborted — forbidden legacy environment variable(s) detected:\n` +
      descriptions +
      `\n\nRemove the listed variable(s) from your environment and restart the server.`,
  );
}

// ---------------------------------------------------------------------------
// Layer 2 — runtime middleware (belt-and-suspenders)
// ---------------------------------------------------------------------------

/**
 * Express middleware that returns 503 if any forbidden legacy environment
 * variable is detected at request time.
 *
 * This is a belt-and-suspenders guard. Under normal operation `detectLegacyConfig`
 * will have already prevented the server from starting. This middleware exists
 * for environments where env vars can be injected or mutated after process
 * start (e.g. some container runtimes or hot-reload scenarios).
 *
 * Mount this middleware early in the stack, before route handlers.
 */
export function legacyDetectorMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const found = findForbiddenKeys(process.env);

  if (found.length === 0) {
    next();
    return;
  }

  // Log a critical error — do NOT include the values of the forbidden keys,
  // only their names (the values may contain credentials).
  console.error(
    JSON.stringify({
      level: 'critical',
      event: 'legacy_config_detected_at_runtime',
      forbiddenKeys: found,
      message:
        'Forbidden legacy environment variable(s) detected at request time. ' +
        'The server should have been prevented from starting. ' +
        'Returning 503 to all requests until the environment is corrected.',
    }),
  );

  res.status(503).json({
    error: {
      code: 'ServiceUnavailable',
      message:
        'The server is misconfigured and cannot handle requests. ' +
        'Contact the operator to resolve the configuration issue.',
    },
  });
}
