/**
 * Property-based tests for CORS allowlist middleware.
 *
 * **Validates: Requirements 9.9**
 *
 * Property 37: CORS allow-list
 *   For all generated origins not in `API_CORS_ORIGINS`, the API returns a
 *   CORS rejection (no `Access-Control-Allow-Origin` header).
 *   For all origins in the allowlist, the request proceeds and the response
 *   includes the correct CORS headers.
 *
 * Tests are organised into four groups:
 *   37a — Allowed origins receive CORS headers
 *   37b — Origins not in the allowlist receive no CORS headers
 *   37c — Wildcard origins are rejected (never granted CORS access)
 *   37d — `Vary: Origin` header is set for allowed origins
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import express, { type Express } from 'express';
import http from 'node:http';
import { corsMiddleware } from './cors';
import type { ServerConfig } from '../server-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ServerConfig with the given allowed origins.
 * Only `corsOrigins` is relevant for the CORS middleware.
 */
function buildConfig(corsOrigins: string[]): ServerConfig {
  return {
    port: 4000,
    nodeEnv: 'test',
    apiSecretKey: 'test-secret',
    skipAuth: true,
    infrastructureWalletSecret: 'suiprivkey1test',
    databaseUrl: 'postgresql://localhost/test',
    walrusPublisherUrl: 'https://publisher.walrus.test',
    walrusAggregatorUrl: 'https://aggregator.walrus.test',
    suiRpcUrl: 'https://rpc.sui.test',
    sessionSecret: 'test-session-secret-32-chars-long',
    corsOrigins,
  };
}

/**
 * Build a minimal Express app with the CORS middleware and a GET /ping route
 * that returns 200. This mirrors the real app structure.
 */
function buildApp(corsOrigins: string[]): Express {
  const app = express();
  app.use(corsMiddleware(buildConfig(corsOrigins)));
  app.get('/ping', (_req, res) => {
    res.status(200).json({ ok: true });
  });
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

/**
 * Send a GET /ping request with the given Origin header and return the
 * response headers. Drains the body to avoid connection leaks.
 */
async function getWithOrigin(
  port: number,
  origin: string,
): Promise<{ status: number; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}/ping`, {
    method: 'GET',
    headers: { Origin: origin },
  });
  await res.text();
  return { status: res.status, headers: res.headers };
}

/**
 * Send an OPTIONS preflight request with the given Origin header.
 */
async function preflightWithOrigin(
  port: number,
  origin: string,
): Promise<{ status: number; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}/ping`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  });
  await res.text();
  return { status: res.status, headers: res.headers };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a realistic HTTP/HTTPS origin string, e.g. "https://example.com"
 * or "http://app.example.org:3000".
 *
 * Origins are scheme + host (+ optional port). We avoid generating wildcards
 * or empty strings here — those are tested separately.
 */
const originArb: fc.Arbitrary<string> = fc
  .record({
    scheme: fc.constantFrom('https', 'http'),
    subdomain: fc.option(
      fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/).filter((s) => s.length > 0),
      { nil: undefined },
    ),
    domain: fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/),
    tld: fc.constantFrom('com', 'org', 'net', 'io', 'dev'),
    port: fc.option(fc.integer({ min: 1024, max: 9999 }), { nil: undefined }),
  })
  .map(({ scheme, subdomain, domain, tld, port }) => {
    const host = subdomain ? `${subdomain}.${domain}.${tld}` : `${domain}.${tld}`;
    return port !== undefined ? `${scheme}://${host}:${port}` : `${scheme}://${host}`;
  });

/**
 * Generates a non-empty list of distinct allowed origins (1–5 entries).
 */
const allowedOriginsArb: fc.Arbitrary<string[]> = fc
  .array(originArb, { minLength: 1, maxLength: 5 })
  .map((origins) => [...new Set(origins)])
  .filter((origins) => origins.length >= 1);

/**
 * Generates a pair of (allowedOrigins, requestOrigin) where requestOrigin IS
 * in the allowedOrigins list.
 */
const allowedPairArb: fc.Arbitrary<{ allowedOrigins: string[]; requestOrigin: string }> =
  allowedOriginsArb.chain((allowedOrigins) =>
    fc.constantFrom(...allowedOrigins).map((requestOrigin) => ({
      allowedOrigins,
      requestOrigin,
    })),
  );

/**
 * Generates a pair of (allowedOrigins, requestOrigin) where requestOrigin is
 * NOT in the allowedOrigins list.
 */
const rejectedPairArb: fc.Arbitrary<{ allowedOrigins: string[]; requestOrigin: string }> =
  fc
    .tuple(allowedOriginsArb, originArb)
    .filter(([allowedOrigins, requestOrigin]) => !allowedOrigins.includes(requestOrigin))
    .map(([allowedOrigins, requestOrigin]) => ({ allowedOrigins, requestOrigin }));

/**
 * Generates the literal wildcard string "*" — the only value the middleware
 * explicitly strips from the allowlist at construction time.
 *
 * The middleware contract (cors.ts) is: `filter((o) => o !== '*')`.
 * Only the exact string "*" is treated as a wildcard and removed.
 */
const wildcardOriginArb: fc.Arbitrary<string> = fc.constant('*');

// ---------------------------------------------------------------------------
// Property 37a — Allowed origins receive CORS headers
// ---------------------------------------------------------------------------

describe('Property 37a: Allowed origins receive CORS headers', () => {
  /**
   * **Validates: Requirements 9.9**
   *
   * For all generated origins that are present in the `API_CORS_ORIGINS`
   * allowlist, the API_Server MUST respond with:
   *   - `Access-Control-Allow-Origin` set to the exact request origin
   *   - `Access-Control-Allow-Methods` set to the allowed methods
   *   - `Access-Control-Allow-Headers` set to the allowed headers
   */
  it('Property 37a-i: requests from allowed origins receive Access-Control-Allow-Origin', async () => {
    await fc.assert(
      fc.asyncProperty(allowedPairArb, async ({ allowedOrigins, requestOrigin }) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { headers } = await getWithOrigin(port, requestOrigin);

          expect(headers.get('access-control-allow-origin')).toBe(requestOrigin);
          expect(headers.get('access-control-allow-methods')).toBeTruthy();
          expect(headers.get('access-control-allow-headers')).toBeTruthy();
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * The `Access-Control-Allow-Origin` header must echo back the exact origin
   * string from the request — not a wildcard, not a different origin.
   */
  it('Property 37a-ii: Access-Control-Allow-Origin echoes the exact request origin', async () => {
    await fc.assert(
      fc.asyncProperty(allowedPairArb, async ({ allowedOrigins, requestOrigin }) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { headers } = await getWithOrigin(port, requestOrigin);

          const acao = headers.get('access-control-allow-origin');
          // Must be the exact origin, not a wildcard
          expect(acao).toBe(requestOrigin);
          expect(acao).not.toBe('*');
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * Preflight (OPTIONS) requests from allowed origins must return 204 with
   * the correct CORS headers, enabling the browser to proceed with the
   * actual request.
   */
  it('Property 37a-iii: preflight from allowed origin returns 204 with CORS headers', async () => {
    await fc.assert(
      fc.asyncProperty(allowedPairArb, async ({ allowedOrigins, requestOrigin }) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { status, headers } = await preflightWithOrigin(port, requestOrigin);

          expect(status).toBe(204);
          expect(headers.get('access-control-allow-origin')).toBe(requestOrigin);
          expect(headers.get('access-control-allow-methods')).toBeTruthy();
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 37b — Origins not in the allowlist receive no CORS headers
// ---------------------------------------------------------------------------

describe('Property 37b: Origins not in the allowlist receive no CORS headers', () => {
  /**
   * **Validates: Requirements 9.9**
   *
   * For all generated origins that are NOT present in the `API_CORS_ORIGINS`
   * allowlist, the API_Server MUST NOT set `Access-Control-Allow-Origin`.
   * The absence of this header causes the browser to block the cross-origin
   * request (CORS rejection).
   */
  it('Property 37b-i: requests from non-allowlisted origins receive no Access-Control-Allow-Origin', async () => {
    await fc.assert(
      fc.asyncProperty(rejectedPairArb, async ({ allowedOrigins, requestOrigin }) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { headers } = await getWithOrigin(port, requestOrigin);

          expect(headers.get('access-control-allow-origin')).toBeNull();
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * A non-allowlisted origin must not receive ANY CORS response headers —
   * not just `Access-Control-Allow-Origin` but also `Access-Control-Allow-Methods`
   * and `Access-Control-Allow-Headers`.
   */
  it('Property 37b-ii: non-allowlisted origins receive no CORS response headers at all', async () => {
    await fc.assert(
      fc.asyncProperty(rejectedPairArb, async ({ allowedOrigins, requestOrigin }) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { headers } = await getWithOrigin(port, requestOrigin);

          expect(headers.get('access-control-allow-origin')).toBeNull();
          expect(headers.get('access-control-allow-methods')).toBeNull();
          expect(headers.get('access-control-allow-headers')).toBeNull();
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * A request with no Origin header (e.g. a same-origin or server-to-server
   * request) must not receive CORS headers. CORS headers are only relevant
   * for cross-origin browser requests.
   */
  it('Property 37b-iii: requests with no Origin header receive no CORS headers', async () => {
    await fc.assert(
      fc.asyncProperty(allowedOriginsArb, async (allowedOrigins) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const res = await fetch(`http://127.0.0.1:${port}/ping`, { method: 'GET' });
          await res.text();

          expect(res.headers.get('access-control-allow-origin')).toBeNull();
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * The allowlist check is exact-match only. A request origin that is a
   * prefix, suffix, or substring of an allowed origin must be rejected.
   * For example, if "https://app.example.com" is allowed, then
   * "https://evil.app.example.com" must NOT be allowed.
   */
  it('Property 37b-iv: substring/prefix of an allowed origin is not granted CORS access', async () => {
    // Fixed test: "https://app.example.com" is allowed; variants must be rejected
    const allowedOrigins = ['https://app.example.com'];
    const rejectedVariants = [
      'https://evil.app.example.com',
      'https://app.example.com.evil.org',
      'http://app.example.com', // different scheme
      'https://app.example.com:8080', // different port
      'https://APP.EXAMPLE.COM', // different case
    ];

    const app = buildApp(allowedOrigins);
    const { server, port } = await startServer(app);

    try {
      for (const origin of rejectedVariants) {
        const { headers } = await getWithOrigin(port, origin);
        expect(headers.get('access-control-allow-origin')).toBeNull();
      }
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 37c — Wildcard origins are rejected
// ---------------------------------------------------------------------------

describe('Property 37c: Wildcard origins are rejected (never granted CORS access)', () => {
  /**
   * **Validates: Requirements 9.9**
   *
   * The literal wildcard string "*" in `API_CORS_ORIGINS` must be silently
   * removed at middleware construction time (the middleware filters it out
   * with `filter((o) => o !== '*')`). An allowlist containing only "*" becomes
   * empty, so no origin is ever granted CORS access.
   *
   * This verifies that the middleware's wildcard-rejection logic at
   * construction time prevents wildcard grants.
   */
  it('Property 37c-i: literal "*" in the allowlist is stripped and never grants access', async () => {
    // Build an app whose allowlist contains only "*" — it must be stripped,
    // leaving an empty allowlist, so no origin is ever allowed.
    const app = buildApp(['*']);
    const { server, port } = await startServer(app);

    try {
      // A request with Origin: * must not receive CORS headers
      const { headers: wildcardHeaders } = await getWithOrigin(port, '*');
      expect(wildcardHeaders.get('access-control-allow-origin')).toBeNull();

      // A request with a real origin must also not receive CORS headers
      // (because the allowlist is now empty after stripping "*")
      const { headers: realHeaders } = await getWithOrigin(port, 'https://example.com');
      expect(realHeaders.get('access-control-allow-origin')).toBeNull();
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * When the allowlist contains a mix of valid origins and the literal "*",
   * the "*" is stripped but the valid origins remain effective.
   * Valid origins still receive CORS headers; a request with Origin: * does not.
   */
  it('Property 37c-ii: literal "*" is stripped but valid origins in the same list remain effective', async () => {
    await fc.assert(
      fc.asyncProperty(allowedOriginsArb, async (validOrigins) => {
        // Mix valid origins with the literal wildcard
        const mixedAllowlist = [...validOrigins, '*'];
        const app = buildApp(mixedAllowlist);
        const { server, port } = await startServer(app);

        try {
          // A valid origin from the list must still be allowed
          const validOrigin = validOrigins[0];
          const { headers: allowedHeaders } = await getWithOrigin(port, validOrigin);
          expect(allowedHeaders.get('access-control-allow-origin')).toBe(validOrigin);

          // A request with Origin: * must not be granted access
          const { headers: wildcardHeaders } = await getWithOrigin(port, '*');
          expect(wildcardHeaders.get('access-control-allow-origin')).toBeNull();
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * A request with `Origin: *` must never receive CORS headers, regardless
   * of what the allowlist contains. The literal string "*" is not a valid
   * origin and must always be rejected.
   */
  it('Property 37c-iii: a request with Origin: * is always rejected', async () => {
    await fc.assert(
      fc.asyncProperty(allowedOriginsArb, async (allowedOrigins) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { headers } = await getWithOrigin(port, '*');
          expect(headers.get('access-control-allow-origin')).toBeNull();
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 37d — Vary: Origin header is set for allowed origins
// ---------------------------------------------------------------------------

describe('Property 37d: Vary: Origin header is set for allowed origins', () => {
  /**
   * **Validates: Requirements 9.9**
   *
   * For all requests from origins in the allowlist, the response MUST include
   * `Vary: Origin`. This is required to prevent caches from serving a
   * CORS-enabled response to a different origin.
   */
  it('Property 37d-i: allowed origins receive Vary: Origin header', async () => {
    await fc.assert(
      fc.asyncProperty(allowedPairArb, async ({ allowedOrigins, requestOrigin }) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { headers } = await getWithOrigin(port, requestOrigin);

          // The Vary header must include "Origin"
          const vary = headers.get('vary') ?? '';
          expect(vary.toLowerCase()).toContain('origin');
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * For preflight requests from allowed origins, the response MUST also
   * include `Vary: Origin`.
   */
  it('Property 37d-ii: preflight from allowed origin also receives Vary: Origin', async () => {
    await fc.assert(
      fc.asyncProperty(allowedPairArb, async ({ allowedOrigins, requestOrigin }) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { headers } = await preflightWithOrigin(port, requestOrigin);

          const vary = headers.get('vary') ?? '';
          expect(vary.toLowerCase()).toContain('origin');
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 9.9**
   *
   * Non-allowlisted origins must NOT receive `Vary: Origin` — the header is
   * only meaningful when CORS headers are present.
   */
  it('Property 37d-iii: non-allowlisted origins do not receive Vary: Origin', async () => {
    await fc.assert(
      fc.asyncProperty(rejectedPairArb, async ({ allowedOrigins, requestOrigin }) => {
        const app = buildApp(allowedOrigins);
        const { server, port } = await startServer(app);

        try {
          const { headers } = await getWithOrigin(port, requestOrigin);

          // No Vary: Origin for rejected origins
          const vary = headers.get('vary') ?? '';
          expect(vary.toLowerCase()).not.toContain('origin');
        } finally {
          await stopServer(server);
        }
      }),
      { numRuns: 20 },
    );
  });
});
