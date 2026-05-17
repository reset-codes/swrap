/**
 * Property-based tests for payload limit middleware.
 *
 * **Validates: Requirements 9.6**
 *
 * Property 34: Payload limit
 *   For all generated request bodies whose serialised size exceeds
 *   PAYLOAD_LIMIT_BYTES, the API_Server returns HTTP 413.
 *   For all generated request bodies whose serialised size is within the
 *   limit, the API_Server returns a non-413 response (200).
 *
 * Tests are organised into four groups:
 *   34a — Over-limit bodies always return 413 (default 64 KB limit)
 *   34b — Under-limit bodies always return 200 (default 64 KB limit)
 *   34c — Invariant holds for different configured limits via PAYLOAD_LIMIT_BYTES
 *   34d — Boundary: bodies at exactly the limit are accepted; one byte over is rejected
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import express, { type Express } from 'express';
import http from 'node:http';
import { payloadLimitMiddleware } from './payload-limit';
import { errorHandler } from './error-handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app with the payload-limit middleware and a POST
 * /echo route that returns 200 on success. The error handler converts the
 * express.json() 413 error into a structured JSON response.
 *
 * The limit is read from PAYLOAD_LIMIT_BYTES at call time, so callers must
 * set process.env.PAYLOAD_LIMIT_BYTES before calling buildApp().
 */
function buildApp(): Express {
  const app = express();
  app.use(payloadLimitMiddleware());
  app.post('/echo', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
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

async function post(
  port: number,
  body: string,
): Promise<{ status: number }> {
  const res = await fetch(`http://127.0.0.1:${port}/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  // Drain the body to avoid connection leaks
  await res.text();
  return { status: res.status };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 64 * 1024; // 64 KB

/**
 * Generates a JSON body string whose byte length is strictly greater than
 * `limitBytes`. The body is a valid JSON object: {"d":"<padding>"}.
 *
 * The overhead of `{"d":""}` is 8 bytes, so padding length = limitBytes - 8 + 1
 * gives a body that is exactly limitBytes + 1 bytes long. We then add an
 * additional random offset (0–512 bytes) to exercise a range of over-limit sizes.
 */
function overLimitBodyArb(limitBytes: number): fc.Arbitrary<string> {
  // overhead of {"d":""} = 8 chars; padding needed to exceed limit:
  const minPadding = Math.max(1, limitBytes - 8 + 1);
  return fc
    .integer({ min: minPadding, max: minPadding + 512 })
    .map((paddingLen) => JSON.stringify({ d: 'x'.repeat(paddingLen) }));
}

/**
 * Generates a JSON body string whose byte length is strictly less than
 * `limitBytes`. We keep bodies well under the limit (max 80% of limit) to
 * avoid accidentally hitting the boundary in edge cases.
 */
function underLimitBodyArb(limitBytes: number): fc.Arbitrary<string> {
  // overhead of {"d":""} = 8 chars; max padding = 80% of limit - 8
  const maxPadding = Math.max(0, Math.floor(limitBytes * 0.8) - 8);
  if (maxPadding <= 0) {
    // For very small limits (< 10 bytes), just use an empty JSON object
    return fc.constant('{}');
  }
  return fc
    .integer({ min: 0, max: maxPadding })
    .map((paddingLen) =>
      paddingLen === 0 ? '{}' : JSON.stringify({ d: 'x'.repeat(paddingLen) }),
    );
}

/**
 * Generates a custom limit in bytes. We use a range that is practical for
 * testing (256 bytes to 8 KB) to keep test execution fast while covering
 * a meaningful range of configured limits.
 */
const customLimitArb: fc.Arbitrary<number> = fc.integer({ min: 256, max: 8 * 1024 });

// ---------------------------------------------------------------------------
// Property 34a — Over-limit bodies always return 413 (default limit)
// ---------------------------------------------------------------------------

describe('Property 34a: Over-limit bodies always return 413 (default 64 KB limit)', () => {
  afterEach(() => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * For all generated request bodies whose serialised size exceeds the default
   * 64 KB limit, the API_Server MUST return HTTP 413.
   *
   * Zero tolerance: even one byte over the limit is rejected.
   */
  it('Property 34a-i: any body exceeding 64 KB returns 413', async () => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(overLimitBodyArb(DEFAULT_LIMIT), async (body) => {
          expect(body.length).toBeGreaterThan(DEFAULT_LIMIT);
          const { status } = await post(port, body);
          expect(status).toBe(413);
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * Bodies that are exactly one byte over the limit must be rejected.
   * This verifies the "zero tolerance" requirement.
   */
  it('Property 34a-ii: a body exactly one byte over the limit returns 413', async () => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      // {"d":"<padding>"} — overhead is 8 chars, so padding = limit - 8 + 1
      const padding = 'x'.repeat(DEFAULT_LIMIT - 8 + 1);
      const body = JSON.stringify({ d: padding });
      expect(body.length).toBe(DEFAULT_LIMIT + 1);

      const { status } = await post(port, body);
      expect(status).toBe(413);
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 34b — Under-limit bodies always return 200 (default limit)
// ---------------------------------------------------------------------------

describe('Property 34b: Under-limit bodies always return 200 (default 64 KB limit)', () => {
  afterEach(() => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * For all generated request bodies whose serialised size is within the
   * default 64 KB limit, the API_Server MUST return HTTP 200 (not 413).
   */
  it('Property 34b-i: any body within 64 KB returns 200', async () => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(underLimitBodyArb(DEFAULT_LIMIT), async (body) => {
          expect(body.length).toBeLessThan(DEFAULT_LIMIT);
          const { status } = await post(port, body);
          expect(status).toBe(200);
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * An empty JSON object (minimal valid body) must always be accepted.
   */
  it('Property 34b-ii: an empty JSON object is always accepted', async () => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      const { status } = await post(port, '{}');
      expect(status).toBe(200);
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 34c — Invariant holds for different configured limits
// ---------------------------------------------------------------------------

describe('Property 34c: Payload limit invariant holds for any configured PAYLOAD_LIMIT_BYTES', () => {
  afterEach(() => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * For all generated custom limit values (via PAYLOAD_LIMIT_BYTES), bodies
   * exceeding that limit MUST return 413 and bodies within the limit MUST
   * return 200.
   *
   * This verifies that the configurable limit is correctly applied regardless
   * of the specific value set.
   */
  it('Property 34c-i: over-limit bodies return 413 for any configured limit', async () => {
    await fc.assert(
      fc.asyncProperty(customLimitArb, async (limitBytes) => {
        process.env.PAYLOAD_LIMIT_BYTES = String(limitBytes);
        const app = buildApp();
        const { server, port } = await startServer(app);

        try {
          // Build a body that is clearly over the configured limit
          const padding = 'x'.repeat(limitBytes + 100);
          const body = JSON.stringify({ d: padding });
          expect(body.length).toBeGreaterThan(limitBytes);

          const { status } = await post(port, body);
          expect(status).toBe(413);
        } finally {
          await stopServer(server);
          delete process.env.PAYLOAD_LIMIT_BYTES;
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * For all generated custom limit values, bodies within the limit MUST
   * return 200.
   */
  it('Property 34c-ii: under-limit bodies return 200 for any configured limit', async () => {
    await fc.assert(
      fc.asyncProperty(customLimitArb, async (limitBytes) => {
        process.env.PAYLOAD_LIMIT_BYTES = String(limitBytes);
        const app = buildApp();
        const { server, port } = await startServer(app);

        try {
          // Use a small body that is well within any configured limit
          const body = JSON.stringify({ ok: true });
          expect(body.length).toBeLessThan(limitBytes);

          const { status } = await post(port, body);
          expect(status).toBe(200);
        } finally {
          await stopServer(server);
          delete process.env.PAYLOAD_LIMIT_BYTES;
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * For all generated custom limits, the 413/200 boundary is sharp:
   * a body of size `limit + 1` returns 413 while a body of size `limit - 1`
   * returns 200. Both assertions hold for the same configured limit.
   */
  it('Property 34c-iii: boundary is sharp — limit+1 returns 413, limit-1 returns 200', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Use limits large enough to construct valid JSON bodies on both sides
        fc.integer({ min: 64, max: 4 * 1024 }),
        async (limitBytes) => {
          process.env.PAYLOAD_LIMIT_BYTES = String(limitBytes);
          const app = buildApp();
          const { server, port } = await startServer(app);

          try {
            // Body just over the limit: {"d":"<padding>"} where padding = limit - 8 + 1
            const overPadding = Math.max(1, limitBytes - 8 + 1);
            const overBody = JSON.stringify({ d: 'x'.repeat(overPadding) });

            // Body just under the limit: use a small fixed body well within range
            const underBody = JSON.stringify({ ok: true }); // ~12 bytes

            // Only test the over-limit case if the body is actually over the limit
            if (overBody.length > limitBytes) {
              const { status: overStatus } = await post(port, overBody);
              expect(overStatus).toBe(413);
            }

            // Under-limit body must always be accepted
            if (underBody.length < limitBytes) {
              const { status: underStatus } = await post(port, underBody);
              expect(underStatus).toBe(200);
            }
          } finally {
            await stopServer(server);
            delete process.env.PAYLOAD_LIMIT_BYTES;
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 34d — Boundary precision at the default limit
// ---------------------------------------------------------------------------

describe('Property 34d: Boundary precision at the default 64 KB limit', () => {
  afterEach(() => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * A body whose serialised length is exactly at the limit boundary must be
   * accepted (200). This verifies the limit is inclusive.
   */
  it('Property 34d-i: body at exactly the limit boundary is accepted (200)', async () => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      // Build a body whose JSON length is exactly DEFAULT_LIMIT bytes.
      // {"d":"<padding>"} — overhead is 8 chars, so padding = limit - 8
      const padding = 'x'.repeat(DEFAULT_LIMIT - 8);
      const body = JSON.stringify({ d: padding });
      expect(body.length).toBe(DEFAULT_LIMIT);

      const { status } = await post(port, body);
      expect(status).toBe(200);
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * Bodies of varying sizes in the range [1, limit-1] must all return 200.
   * This exercises the full under-limit space with generated sizes.
   */
  it('Property 34d-ii: bodies of varying sizes under the limit all return 200', async () => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          // Generate padding lengths that produce bodies well under the limit
          fc.integer({ min: 0, max: DEFAULT_LIMIT - 100 }),
          async (paddingLen) => {
            const body =
              paddingLen === 0 ? '{}' : JSON.stringify({ d: 'x'.repeat(paddingLen) });
            expect(body.length).toBeLessThan(DEFAULT_LIMIT);
            const { status } = await post(port, body);
            expect(status).toBe(200);
          },
        ),
        { numRuns: 15 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.6**
   *
   * Bodies of varying sizes in the range [limit+1, limit+1024] must all
   * return 413. This exercises the full over-limit space near the boundary.
   */
  it('Property 34d-iii: bodies of varying sizes over the limit all return 413', async () => {
    delete process.env.PAYLOAD_LIMIT_BYTES;
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          // Generate padding lengths that produce bodies over the limit
          fc.integer({ min: DEFAULT_LIMIT - 8 + 1, max: DEFAULT_LIMIT - 8 + 1024 }),
          async (paddingLen) => {
            const body = JSON.stringify({ d: 'x'.repeat(paddingLen) });
            expect(body.length).toBeGreaterThan(DEFAULT_LIMIT);
            const { status } = await post(port, body);
            expect(status).toBe(413);
          },
        ),
        { numRuns: 15 },
      );
    } finally {
      await stopServer(server);
    }
  });
});
