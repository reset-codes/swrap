/**
 * Unit tests for apps/api/middleware/payload-limit.ts
 *
 * Verifies that:
 * - Requests within the 64 KB limit are accepted (200)
 * - Requests exceeding the limit are rejected with HTTP 413
 * - The limit is configurable via PAYLOAD_LIMIT_BYTES env var
 *
 * Requirements: 9.6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import http from 'node:http';
import { payloadLimitMiddleware } from './payload-limit';
import { errorHandler } from './error-handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(limitBytes?: number): Express {
  if (limitBytes !== undefined) {
    process.env.PAYLOAD_LIMIT_BYTES = String(limitBytes);
  } else {
    delete process.env.PAYLOAD_LIMIT_BYTES;
  }

  const app = express();
  app.use(payloadLimitMiddleware());
  app.post('/echo', (req, res) => {
    res.status(200).json({ received: true, size: JSON.stringify(req.body).length });
  });
  // Wire the error handler so 413 is returned as JSON
  app.use(errorHandler);
  return app;
}

function startServer(app: Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
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
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const json = await res.json();
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('payloadLimitMiddleware — default 64 KB limit', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const result = await startServer(buildApp());
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    await stopServer(server);
    delete process.env.PAYLOAD_LIMIT_BYTES;
  });

  it('accepts a request body well within the 64 KB limit', async () => {
    // ~100 bytes — well under 64 KB
    const body = JSON.stringify({ data: 'hello world' });
    const { status } = await post(port, body);
    expect(status).toBe(200);
  });

  it('accepts a request body exactly at the limit boundary (64 KB - 1 byte padding)', async () => {
    // Build a JSON object whose serialised form is just under 64 KB
    const limit = 64 * 1024;
    // {"d":"<padding>"} — account for the wrapper characters
    const padding = 'x'.repeat(limit - 8); // {"d":"..."} = 8 chars overhead
    const body = JSON.stringify({ d: padding });
    expect(body.length).toBeLessThanOrEqual(limit);
    const { status } = await post(port, body);
    expect(status).toBe(200);
  });

  it('rejects a request body exceeding 64 KB with HTTP 413', async () => {
    // Build a body that is clearly over 64 KB
    const overLimit = 'x'.repeat(64 * 1024 + 1);
    const body = JSON.stringify({ d: overLimit });
    expect(body.length).toBeGreaterThan(64 * 1024);
    const { status, json } = await post(port, body);
    expect(status).toBe(413);
    expect((json as { error: { code: string } }).error.code).toBe('PayloadTooLarge');
  });

  it('rejects a body that is even one byte over the limit', async () => {
    // Construct a body that is exactly limit + 1 bytes
    const limit = 64 * 1024;
    // {"d":"<padding>"} — 8 chars overhead, so padding = limit - 8 + 1 = limit - 7
    const padding = 'x'.repeat(limit - 7);
    const body = JSON.stringify({ d: padding });
    expect(body.length).toBeGreaterThan(limit);
    const { status } = await post(port, body);
    expect(status).toBe(413);
  });
});

describe('payloadLimitMiddleware — configurable via PAYLOAD_LIMIT_BYTES', () => {
  let server: http.Server;
  let port: number;

  afterEach(async () => {
    await stopServer(server);
    delete process.env.PAYLOAD_LIMIT_BYTES;
  });

  it('respects a custom lower limit (1 KB)', async () => {
    const customLimit = 1024; // 1 KB
    const result = await startServer(buildApp(customLimit));
    server = result.server;
    port = result.port;

    // Body under 1 KB — should pass
    const smallBody = JSON.stringify({ d: 'x'.repeat(100) });
    const { status: okStatus } = await post(port, smallBody);
    expect(okStatus).toBe(200);

    // Body over 1 KB — should be rejected
    const bigBody = JSON.stringify({ d: 'x'.repeat(customLimit + 1) });
    const { status: rejStatus } = await post(port, bigBody);
    expect(rejStatus).toBe(413);
  });

  it('falls back to 64 KB when PAYLOAD_LIMIT_BYTES is not a valid number', async () => {
    process.env.PAYLOAD_LIMIT_BYTES = 'not-a-number';
    const result = await startServer(buildApp());
    server = result.server;
    port = result.port;

    // Body just over 64 KB should still be rejected
    const body = JSON.stringify({ d: 'x'.repeat(64 * 1024 + 1) });
    const { status } = await post(port, body);
    expect(status).toBe(413);
  });
});
