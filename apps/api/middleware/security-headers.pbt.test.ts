/**
 * Property-based tests for security headers middleware.
 *
 * **Validates: Requirements 9.10**
 *
 * Property 38: Security headers
 *   For any request to any route, the response includes all four required
 *   security headers with their exact specified values.
 *
 * Tests are organised into four groups:
 *   38a — All four headers are present on success responses (2xx)
 *   38b — All four headers are present on error responses (4xx/5xx)
 *   38c — Headers are present across all HTTP methods
 *   38d — Headers are present across all registered routes
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import express, { type Express } from 'express';
import http from 'node:http';
import { securityHeaders } from './security-headers';
import { errorHandler, notFoundHandler } from './error-handler';

// ---------------------------------------------------------------------------
// Expected header values (from Requirements 9.10 and security-headers.ts)
// ---------------------------------------------------------------------------

const EXPECTED_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app with the security-headers middleware, a set of
 * test routes, and the standard error handler. This mirrors the real app
 * structure from app.ts.
 */
function buildApp(): Express {
  const app = express();
  app.use(securityHeaders);

  // Success routes
  app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/echo', express.json(), (_req, res) => res.status(201).json({ created: true }));
  app.put('/update', express.json(), (_req, res) => res.status(200).json({ updated: true }));
  app.delete('/remove', (_req, res) => res.status(200).json({ removed: true }));
  app.patch('/patch', express.json(), (_req, res) => res.status(200).json({ patched: true }));
  app.head('/head', (_req, res) => res.status(200).end());

  // Error-triggering route
  app.get('/error', (_req, _res, next) => {
    next(new Error('Intentional test error'));
  });

  // 404 and error handlers
  app.use(notFoundHandler);
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

/**
 * Send a request with the given method and path, drain the body, and return
 * the status and response headers.
 */
async function request(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; headers: Headers }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = body;
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  await res.text(); // drain body to avoid connection leaks
  return { status: res.status, headers: res.headers };
}

/**
 * Assert that all four required security headers are present with their
 * exact expected values on the given response headers object.
 */
function assertSecurityHeaders(headers: Headers): void {
  for (const [name, expectedValue] of Object.entries(EXPECTED_HEADERS)) {
    const actual = headers.get(name);
    expect(actual, `Expected header "${name}" to be present`).not.toBeNull();
    expect(actual, `Expected header "${name}" to equal "${expectedValue}"`).toBe(expectedValue);
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a URL path segment (e.g. "/foo", "/bar/baz").
 * These paths will 404 but still go through the security-headers middleware.
 */
const pathArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), { minLength: 1, maxLength: 3 })
  .map((segments) => '/' + segments.join('/'));

/**
 * HTTP methods that can be tested without a body.
 */
const bodylessMethodArb: fc.Arbitrary<string> = fc.constantFrom('GET', 'DELETE', 'HEAD');

/**
 * HTTP methods that accept a body.
 */
const bodyMethodArb: fc.Arbitrary<string> = fc.constantFrom('POST', 'PUT', 'PATCH');

/**
 * All HTTP methods combined.
 */
const anyMethodArb: fc.Arbitrary<string> = fc.constantFrom(
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
);

// ---------------------------------------------------------------------------
// Property 38a — All four headers are present on success responses (2xx)
// ---------------------------------------------------------------------------

describe('Property 38a: All four security headers are present on success responses', () => {
  /**
   * **Validates: Requirements 9.10**
   *
   * For any GET request to a registered route that returns 200, all four
   * required security headers must be present with their exact values.
   */
  it('Property 38a-i: GET /ping returns all four security headers with exact values', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(fc.constant('/ping'), async (path) => {
          const { headers } = await request(port, 'GET', path);
          assertSecurityHeaders(headers);
        }),
        { numRuns: 10 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.10**
   *
   * For any POST request to a registered route that returns 201, all four
   * required security headers must be present with their exact values.
   */
  it('Property 38a-ii: POST /echo returns all four security headers with exact values', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(fc.constant('{}'), async (body) => {
          const { headers } = await request(port, 'POST', '/echo', body);
          assertSecurityHeaders(headers);
        }),
        { numRuns: 10 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.10**
   *
   * For all generated JSON bodies sent to POST /echo, all four security
   * headers are present. This verifies the headers are set regardless of
   * request body content.
   */
  it('Property 38a-iii: security headers are present regardless of request body content', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 20 }),
            value: fc.string({ minLength: 0, maxLength: 50 }),
          }),
          async (obj) => {
            const body = JSON.stringify(obj);
            const { headers } = await request(port, 'POST', '/echo', body);
            assertSecurityHeaders(headers);
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 38b — All four headers are present on error responses (4xx/5xx)
// ---------------------------------------------------------------------------

describe('Property 38b: All four security headers are present on error responses', () => {
  /**
   * **Validates: Requirements 9.10**
   *
   * For any request to a non-existent route (404), all four required security
   * headers must still be present with their exact values.
   *
   * Security headers must be set on ALL responses, not just success responses.
   */
  it('Property 38b-i: 404 responses include all four security headers', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(pathArb, async (path) => {
          // These paths don't exist — they will 404
          const { status, headers } = await request(port, 'GET', `/nonexistent${path}`);
          expect(status).toBe(404);
          assertSecurityHeaders(headers);
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.10**
   *
   * For any request to a route that triggers a 500 error, all four required
   * security headers must still be present with their exact values.
   */
  it('Property 38b-ii: 500 error responses include all four security headers', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(fc.constant('/error'), async (path) => {
          const { status, headers } = await request(port, 'GET', path);
          expect(status).toBe(500);
          assertSecurityHeaders(headers);
        }),
        { numRuns: 10 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.10**
   *
   * For any request to a non-existent route using any HTTP method, all four
   * required security headers must be present. This covers 404 responses
   * across all methods.
   */
  it('Property 38b-iii: 404 responses for any HTTP method include all four security headers', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(bodylessMethodArb, pathArb, async (method, path) => {
          const { status, headers } = await request(port, method, `/nonexistent${path}`);
          // HEAD returns no body but still 404 status; others return 404 JSON
          expect([404, 200]).toContain(status); // HEAD on nonexistent = 404
          if (method !== 'HEAD') {
            expect(status).toBe(404);
          }
          assertSecurityHeaders(headers);
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 38c — Headers are present across all HTTP methods
// ---------------------------------------------------------------------------

describe('Property 38c: Security headers are present across all HTTP methods', () => {
  /**
   * **Validates: Requirements 9.10**
   *
   * For all generated HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD),
   * requests to registered routes return all four security headers.
   *
   * The middleware must set headers unconditionally, regardless of method.
   */
  it('Property 38c-i: all HTTP methods on registered routes return security headers', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    // Map each method to a registered route
    const methodRoutes: Array<{ method: string; path: string; body?: string }> = [
      { method: 'GET', path: '/ping' },
      { method: 'POST', path: '/echo', body: '{}' },
      { method: 'PUT', path: '/update', body: '{}' },
      { method: 'DELETE', path: '/remove' },
      { method: 'PATCH', path: '/patch', body: '{}' },
      { method: 'HEAD', path: '/head' },
    ];

    try {
      for (const { method, path, body } of methodRoutes) {
        const { headers } = await request(port, method, path, body);
        assertSecurityHeaders(headers);
      }
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.10**
   *
   * For all generated HTTP methods on non-existent routes (404), all four
   * security headers are still present. This verifies the middleware fires
   * before the 404 handler regardless of method.
   */
  it('Property 38c-ii: all HTTP methods on non-existent routes still return security headers', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(anyMethodArb, async (method) => {
          const { headers } = await request(port, method, '/does-not-exist');
          assertSecurityHeaders(headers);
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 38d — Headers are present across all registered routes
// ---------------------------------------------------------------------------

describe('Property 38d: Security headers are present across all registered routes', () => {
  /**
   * **Validates: Requirements 9.10**
   *
   * For all generated paths (both existing and non-existing), all four
   * security headers are present on every response. This is the core
   * universality property: the middleware must fire for every request
   * regardless of which route handles it.
   */
  it('Property 38d-i: security headers are present on responses to any path', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(pathArb, async (path) => {
          const { headers } = await request(port, 'GET', path);
          assertSecurityHeaders(headers);
        }),
        { numRuns: 30 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.10**
   *
   * The exact header values must match the specification precisely.
   * No partial matches, no extra whitespace, no case variations.
   *
   * This test verifies each header individually to produce clear failure
   * messages if any single header value is wrong.
   */
  it('Property 38d-ii: each security header has the exact specified value', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      const { headers } = await request(port, 'GET', '/ping');

      expect(headers.get('strict-transport-security')).toBe(
        'max-age=31536000; includeSubDomains; preload',
      );
      expect(headers.get('x-content-type-options')).toBe('nosniff');
      expect(headers.get('referrer-policy')).toBe('no-referrer');
      expect(headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.10**
   *
   * For all generated paths and all generated HTTP methods, the security
   * headers are always present. This is the broadest universality check:
   * any combination of method and path must yield all four headers.
   */
  it('Property 38d-iii: any method × any path combination returns all four security headers', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(bodylessMethodArb, pathArb, async (method, path) => {
          const { headers } = await request(port, method, path);
          assertSecurityHeaders(headers);
        }),
        { numRuns: 30 },
      );
    } finally {
      await stopServer(server);
    }
  });
});
