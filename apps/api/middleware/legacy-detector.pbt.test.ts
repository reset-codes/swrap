/**
 * Property-based tests for the legacy configuration detector.
 *
 * **Validates: Requirements 9.1, 9.2, 9.13**
 *
 * Property 40: Legacy detector
 *   For all generated env objects containing any forbidden key
 *   (`INFRA_WALLET_PRIVATE_KEY`, `DEV_BYPASS_STORAGE`, `DEV_LOCAL_SIGNER`,
 *   `DEV_ALLOW_PLAINTEXT`), the legacy detector reports detection and throws;
 *   for all generated env objects without forbidden keys, the detector passes.
 *
 * Tests are organised into four groups:
 *   40a — Presence of any forbidden key causes detectLegacyConfig to throw
 *   40b — Absence of all forbidden keys allows detectLegacyConfig to pass
 *   40c — The middleware returns 503 when forbidden keys are in process.env
 *   40d — Route scanning for legacy route patterns (optional coverage)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import express, { type Express } from 'express';
import http from 'node:http';
import { detectLegacyConfig, legacyDetectorMiddleware } from './legacy-detector';
import { FORBIDDEN_ENV_KEYS } from '../server-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a safe env key that is NOT one of the forbidden keys. */
const safeKeyArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Z][A-Z0-9_]{2,30}$/)
  .filter((key) => !(FORBIDDEN_ENV_KEYS as readonly string[]).includes(key));

/** Generate a non-empty env value. */
const envValueArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 100 });

/**
 * Generate an env object that contains NO forbidden keys.
 * Keys are random uppercase identifiers that don't collide with FORBIDDEN_ENV_KEYS.
 */
const cleanEnvArb: fc.Arbitrary<Record<string, string>> = fc
  .array(fc.tuple(safeKeyArb, envValueArb), { minLength: 0, maxLength: 10 })
  .map((pairs) => Object.fromEntries(pairs));

/**
 * Generate an env object that contains at least one forbidden key.
 * We pick 1–4 forbidden keys and assign them random values, then mix in
 * some safe keys for realism.
 */
const dirtyEnvArb: fc.Arbitrary<Record<string, string>> = fc
  .tuple(
    // At least one forbidden key with a value
    fc.subarray([...FORBIDDEN_ENV_KEYS], { minLength: 1 }).chain((forbiddenKeys) =>
      fc.tuple(
        fc.constant(forbiddenKeys),
        fc.array(envValueArb, {
          minLength: forbiddenKeys.length,
          maxLength: forbiddenKeys.length,
        }),
      ),
    ),
    // Optional safe keys mixed in
    fc.array(fc.tuple(safeKeyArb, envValueArb), { minLength: 0, maxLength: 5 }),
  )
  .map(([[forbiddenKeys, forbiddenValues], safePairs]) => {
    const env: Record<string, string> = {};
    forbiddenKeys.forEach((key, i) => {
      env[key] = forbiddenValues[i];
    });
    for (const [k, v] of safePairs) {
      env[k] = v;
    }
    return env;
  });

/** Pick exactly one forbidden key at random. */
const singleForbiddenKeyArb: fc.Arbitrary<string> = fc.constantFrom(...FORBIDDEN_ENV_KEYS);

function buildApp(): Express {
  const app = express();
  app.use(legacyDetectorMiddleware);
  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

function startServer(app: Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function request(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Property 40a — Presence of any forbidden key causes throw
// ---------------------------------------------------------------------------

describe('Property 40a: Presence of any forbidden key causes detectLegacyConfig to throw', () => {
  /**
   * **Validates: Requirements 9.1, 9.2, 9.13**
   *
   * For all generated env objects containing at least one forbidden key,
   * detectLegacyConfig throws an Error listing the offending key(s).
   */
  it('Property 40a-i: any env with forbidden keys causes detectLegacyConfig to throw', () => {
    fc.assert(
      fc.property(dirtyEnvArb, (env) => {
        expect(() => detectLegacyConfig(env)).toThrow(Error);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.1, 9.2, 9.13**
   *
   * For each individual forbidden key in isolation, detectLegacyConfig throws.
   */
  it('Property 40a-ii: each individual forbidden key in isolation causes throw', () => {
    fc.assert(
      fc.property(singleForbiddenKeyArb, envValueArb, (key, value) => {
        const env: Record<string, string> = { [key]: value };
        expect(() => detectLegacyConfig(env)).toThrow(Error);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 9.13**
   *
   * The thrown error message mentions every forbidden key that is present.
   */
  it('Property 40a-iii: error message lists all present forbidden keys', () => {
    fc.assert(
      fc.property(dirtyEnvArb, (env) => {
        try {
          detectLegacyConfig(env);
          // Should not reach here
          expect.fail('Expected detectLegacyConfig to throw');
        } catch (err: unknown) {
          const message = (err as Error).message;
          // Every forbidden key present in env should appear in the error message
          for (const key of FORBIDDEN_ENV_KEYS) {
            if (env[key] !== undefined) {
              expect(message).toContain(key);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.13**
   *
   * The error message contains the word "forbidden" (case-insensitive) to
   * clearly communicate the nature of the failure.
   */
  it('Property 40a-iv: error message contains "forbidden" keyword', () => {
    fc.assert(
      fc.property(singleForbiddenKeyArb, envValueArb, (key, value) => {
        const env: Record<string, string> = { [key]: value };
        try {
          detectLegacyConfig(env);
          expect.fail('Expected detectLegacyConfig to throw');
        } catch (err: unknown) {
          const message = (err as Error).message.toLowerCase();
          expect(message).toContain('forbidden');
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 40b — Absence of all forbidden keys allows pass
// ---------------------------------------------------------------------------

describe('Property 40b: Absence of all forbidden keys allows detectLegacyConfig to pass', () => {
  /**
   * **Validates: Requirements 9.1, 9.2, 9.13**
   *
   * For all generated env objects that do NOT contain any forbidden key,
   * detectLegacyConfig returns without throwing.
   */
  it('Property 40b-i: clean env objects pass without throwing', () => {
    fc.assert(
      fc.property(cleanEnvArb, (env) => {
        expect(() => detectLegacyConfig(env)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.1, 9.2, 9.13**
   *
   * An empty env object passes (no keys at all means no forbidden keys).
   */
  it('Property 40b-ii: empty env object passes', () => {
    expect(() => detectLegacyConfig({})).not.toThrow();
  });

  /**
   * **Validates: Requirements 9.1, 9.2, 9.13**
   *
   * Env objects with keys that are substrings or superstrings of forbidden
   * keys (but not exact matches) should pass. Only exact key matches trigger
   * detection.
   */
  it('Property 40b-iii: near-miss keys (substrings/superstrings of forbidden keys) pass', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FORBIDDEN_ENV_KEYS),
        fc.constantFrom('_EXTRA', 'PREFIX_', '_V2', '2'),
        (forbiddenKey, suffix) => {
          // Superstring of a forbidden key — should NOT trigger
          const env: Record<string, string> = { [`${forbiddenKey}${suffix}`]: 'value' };
          expect(() => detectLegacyConfig(env)).not.toThrow();
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 40c — Middleware returns 503 when forbidden keys in process.env
// ---------------------------------------------------------------------------

describe('Property 40c: legacyDetectorMiddleware returns 503 when forbidden keys are present', () => {
  afterEach(() => {
    // Clean up any forbidden keys we injected into process.env
    for (const key of FORBIDDEN_ENV_KEYS) {
      delete process.env[key];
    }
  });

  /**
   * **Validates: Requirements 9.1, 9.2, 9.13**
   *
   * For all generated forbidden keys injected into process.env, the middleware
   * returns 503 ServiceUnavailable.
   */
  it('Property 40c-i: middleware returns 503 when any forbidden key is in process.env', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(singleForbiddenKeyArb, envValueArb, async (key, value) => {
          // Inject the forbidden key
          process.env[key] = value;

          const { status, body } = await request(port, 'GET', '/health');
          expect(status).toBe(503);
          expect(body).toHaveProperty('error');
          expect((body as any).error.code).toBe('ServiceUnavailable');

          // Clean up for next iteration
          delete process.env[key];
        }),
        { numRuns: 20 },
      );
    } finally {
      // Final cleanup
      for (const key of FORBIDDEN_ENV_KEYS) {
        delete process.env[key];
      }
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.1, 9.2, 9.13**
   *
   * When no forbidden keys are in process.env, the middleware passes through
   * and the route handler responds normally.
   */
  it('Property 40c-ii: middleware passes through when no forbidden keys are present', async () => {
    // Ensure no forbidden keys are set
    for (const key of FORBIDDEN_ENV_KEYS) {
      delete process.env[key];
    }

    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      const { status, body } = await request(port, 'GET', '/health');
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true });
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.13**
   *
   * When multiple forbidden keys are present simultaneously, the middleware
   * still returns 503 (not a partial failure or different error).
   */
  it('Property 40c-iii: middleware returns 503 when multiple forbidden keys are present', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.subarray([...FORBIDDEN_ENV_KEYS], { minLength: 2 }),
          async (keys) => {
            // Inject multiple forbidden keys
            for (const key of keys) {
              process.env[key] = 'some-value';
            }

            const { status } = await request(port, 'GET', '/health');
            expect(status).toBe(503);

            // Clean up
            for (const key of keys) {
              delete process.env[key];
            }
          },
        ),
        { numRuns: 10 },
      );
    } finally {
      for (const key of FORBIDDEN_ENV_KEYS) {
        delete process.env[key];
      }
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 40d — Legacy route pattern detection (optional coverage)
// ---------------------------------------------------------------------------

describe('Property 40d: detectLegacyConfig only inspects env keys, not route patterns', () => {
  /**
   * **Validates: Requirements 9.1, 9.2**
   *
   * The detectLegacyConfig function is purely env-based. Env objects that
   * happen to contain values resembling legacy route paths (/decrypt,
   * /poc-decrypt, /bypass) but do NOT have forbidden KEYS should pass.
   * This confirms the detector checks keys, not values.
   */
  it('Property 40d-i: env values containing legacy route patterns do not trigger detection', () => {
    const legacyRoutePatterns = ['/decrypt', '/poc-decrypt', '/bypass', '/legacy'];

    fc.assert(
      fc.property(
        safeKeyArb,
        fc.constantFrom(...legacyRoutePatterns),
        (key, routeValue) => {
          const env: Record<string, string> = { [key]: routeValue };
          // Should NOT throw — the detector checks keys, not values
          expect(() => detectLegacyConfig(env)).not.toThrow();
        },
      ),
      { numRuns: 40 },
    );
  });

  /**
   * **Validates: Requirements 9.1, 9.2**
   *
   * Forbidden keys with values that look like route paths still trigger
   * detection (the value content is irrelevant; only key presence matters).
   */
  it('Property 40d-ii: forbidden keys trigger detection regardless of their value content', () => {
    fc.assert(
      fc.property(
        singleForbiddenKeyArb,
        fc.constantFrom('', 'true', 'false', '0', '1', '/decrypt', 'anything'),
        (key, value) => {
          const env: Record<string, string> = { [key]: value };
          expect(() => detectLegacyConfig(env)).toThrow(Error);
        },
      ),
      { numRuns: 40 },
    );
  });
});
