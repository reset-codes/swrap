/**
 * Property-based tests for structured logging redaction in request-logger middleware.
 *
 * **Validates: Requirements 9.4, 9.11**
 *
 * Property 39: Structured logging redaction
 *   For all generated log records emitted by the API_Server, no record
 *   contains substrings of Infrastructure_Wallet credentials, decryption
 *   keys, or Seal session secrets.
 *
 *   Additionally, every log record MUST contain the expected non-sensitive
 *   fields: requestId, method, path, status, durationMs.
 *
 * Tests are organised into five groups:
 *   39a — Log output never contains Infrastructure_Wallet credential substrings
 *   39b — Log output never contains JWT / Authorization header values
 *   39c — Log output never contains ZK proof, signature, or ciphertext values
 *   39d — Log output always contains the expected non-sensitive structural fields
 *   39e — Query-string parameters (which may carry tokens) are stripped from logged path
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import express, { type Express } from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { requestLogger } from './request-logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app with the request-logger middleware and a small
 * set of test routes. The app mirrors the real middleware stack position from
 * app.ts: request-id → request-logger → router.
 */
function buildApp(): Express {
  const app = express();

  // Minimal request-id middleware (mirrors app.ts)
  app.use((req, res, next) => {
    const id = (req.headers['x-request-id'] as string) ?? randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('X-Request-ID', id);
    next();
  });

  app.use(requestLogger);

  app.use(express.json({ limit: '1mb' }));

  app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/echo', (req, res) => res.status(200).json({ received: req.body }));
  app.get('/error', (_req, _res, next) => next(new Error('test error')));

  // Simple error handler
  app.use(
    (
      _err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: 'internal' });
    },
  );

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
 * Capture all console.log calls made during the execution of `fn`.
 * Returns the array of captured log lines (as raw strings).
 */
async function captureConsoleLogs(fn: () => Promise<void>): Promise<string[]> {
  const captured: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return captured;
}

/**
 * Send a GET request to the given path with optional extra headers.
 * Drains the body to avoid connection leaks.
 */
async function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'GET',
    headers,
  });
  await res.text();
  return { status: res.status };
}

/**
 * Send a POST request with a JSON body and optional extra headers.
 * Drains the body to avoid connection leaks.
 */
async function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  await res.text();
  return { status: res.status };
}

/**
 * Assert that none of the captured log lines contain the given sensitive value.
 * The check is case-sensitive and looks for the exact substring.
 */
function assertNotInLogs(logs: string[], sensitiveValue: string, label: string): void {
  for (const line of logs) {
    expect(
      line.includes(sensitiveValue),
      `Log line contains sensitive ${label}: "${sensitiveValue.slice(0, 20)}…"\nLog: ${line.slice(0, 200)}`,
    ).toBe(false);
  }
}

/**
 * Parse a log line as JSON and return the parsed object, or null if it is not
 * a valid JSON log record emitted by the request-logger.
 */
function parseLogRecord(line: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    // Only consider lines that look like request-logger records
    if (obj.event === 'http_request') return obj;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a realistic bech32-like Infrastructure_Wallet secret key string.
 * Format: suiprivkey1<base58-like chars>
 */
const walletSecretArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9]{32,64}$/)
  .map((s) => `suiprivkey1${s}`);

/**
 * Generates a realistic JWT-like token string (three base64url segments).
 */
const jwtArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z0-9_-]{20,40}$/),
    fc.stringMatching(/^[A-Za-z0-9_-]{40,80}$/),
    fc.stringMatching(/^[A-Za-z0-9_-]{20,40}$/),
  )
  .map(([h, p, s]) => `${h}.${p}.${s}`);

/**
 * Generates a hex-encoded decryption key / ciphertext value (32–64 bytes).
 */
const hexSecretArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64,128}$/)
  .map((s) => s);

/**
 * Generates a base64-encoded ZK proof / signature value.
 */
const base64SecretArb: fc.Arbitrary<string> = fc
  .uint8Array({ minLength: 32, maxLength: 64 })
  .map((bytes) => Buffer.from(bytes).toString('base64'));

/**
 * Generates a Sui-like actor address (0x + 64 hex chars).
 */
const actorAddressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/)
  .map((hex) => `0x${hex}`);

/**
 * Generates a simple path segment (no query string).
 */
const pathArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), { minLength: 1, maxLength: 3 })
  .map((segs) => '/' + segs.join('/'));

// ---------------------------------------------------------------------------
// Property 39a — Log output never contains Infrastructure_Wallet credential substrings
// ---------------------------------------------------------------------------

describe('Property 39a: Log output never contains Infrastructure_Wallet credential substrings', () => {
  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated wallet secret values passed in the Authorization header
   * (simulating a client that mistakenly sends the raw wallet secret as a
   * bearer token), the request-logger MUST NOT emit the secret value in any
   * log line. The logger never reads Authorization header values — only
   * X-Actor-Address is read, and only for the actor address field.
   */
  it('Property 39a-i: wallet secret in Authorization header is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(walletSecretArb, async (walletSecret) => {
          const logs = await captureConsoleLogs(async () => {
            await get(port, '/ping', { Authorization: `Bearer ${walletSecret}` });
          });

          // The wallet secret must not appear in any log line
          assertNotInLogs(logs, walletSecret, 'wallet secret');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated wallet secret values passed in the request body, the
   * request-logger MUST NOT log the request body at all (the body is not on
   * the allow-list of logged fields).
   */
  it('Property 39a-ii: wallet secret in request body is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(walletSecretArb, async (walletSecret) => {
          const logs = await captureConsoleLogs(async () => {
            await post(port, '/echo', {
              infrastructureWalletSecret: walletSecret,
              action: 'test',
            });
          });

          assertNotInLogs(logs, walletSecret, 'wallet secret in body');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated wallet secret values passed as a query parameter, the
   * request-logger MUST NOT log the query string (only the path component is
   * logged, per the sanitizePath implementation).
   */
  it('Property 39a-iii: wallet secret in query string is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(walletSecretArb, async (walletSecret) => {
          const logs = await captureConsoleLogs(async () => {
            await get(port, `/ping?key=${encodeURIComponent(walletSecret)}`);
          });

          assertNotInLogs(logs, walletSecret, 'wallet secret in query string');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 39b — Log output never contains JWT / Authorization header values
// ---------------------------------------------------------------------------

describe('Property 39b: Log output never contains JWT or Authorization header values', () => {
  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated JWT tokens passed in the Authorization header, the
   * request-logger MUST NOT emit the token value in any log line.
   *
   * The logger explicitly excludes Authorization header values from the
   * allow-list (only X-Actor-Address is read, never Authorization).
   */
  it('Property 39b-i: JWT in Authorization header is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(jwtArb, async (jwt) => {
          const logs = await captureConsoleLogs(async () => {
            await get(port, '/ping', { Authorization: `Bearer ${jwt}` });
          });

          assertNotInLogs(logs, jwt, 'JWT token');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated JWT tokens passed in the request body (e.g. as a
   * session token field), the request-logger MUST NOT log the body.
   */
  it('Property 39b-ii: JWT in request body is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(jwtArb, async (jwt) => {
          const logs = await captureConsoleLogs(async () => {
            await post(port, '/echo', { sessionToken: jwt });
          });

          assertNotInLogs(logs, jwt, 'JWT in body');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated JWT tokens passed as a query parameter, the
   * request-logger MUST NOT log the query string.
   */
  it('Property 39b-iii: JWT in query string is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(jwtArb, async (jwt) => {
          const logs = await captureConsoleLogs(async () => {
            await get(port, `/ping?token=${encodeURIComponent(jwt)}`);
          });

          assertNotInLogs(logs, jwt, 'JWT in query string');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 39c — Log output never contains ZK proof, signature, or ciphertext
// ---------------------------------------------------------------------------

describe('Property 39c: Log output never contains ZK proof, signature, or ciphertext values', () => {
  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated hex-encoded decryption key / ciphertext values passed
   * in the request body, the request-logger MUST NOT log the body.
   */
  it('Property 39c-i: hex-encoded ciphertext in request body is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(hexSecretArb, async (ciphertext) => {
          const logs = await captureConsoleLogs(async () => {
            await post(port, '/echo', { ciphertext, action: 'decrypt' });
          });

          assertNotInLogs(logs, ciphertext, 'ciphertext');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated base64-encoded ZK proof / signature values passed in
   * the request body, the request-logger MUST NOT log the body.
   */
  it('Property 39c-ii: base64-encoded ZK proof in request body is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(base64SecretArb, async (zkProof) => {
          const logs = await captureConsoleLogs(async () => {
            await post(port, '/echo', { zkProof, nonce: 'test-nonce' });
          });

          assertNotInLogs(logs, zkProof, 'ZK proof');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated base64-encoded signature values passed in the
   * X-Signature header, the request-logger MUST NOT log header values.
   */
  it('Property 39c-iii: signature in custom header is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(base64SecretArb, async (signature) => {
          const logs = await captureConsoleLogs(async () => {
            await get(port, '/ping', { 'X-Signature': signature });
          });

          assertNotInLogs(logs, signature, 'signature in header');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated hex-encoded decryption key values passed in a custom
   * header, the request-logger MUST NOT log header values.
   */
  it('Property 39c-iv: decryption key in custom header is not logged', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(hexSecretArb, async (decryptionKey) => {
          const logs = await captureConsoleLogs(async () => {
            await get(port, '/ping', { 'X-Decryption-Key': decryptionKey });
          });

          assertNotInLogs(logs, decryptionKey, 'decryption key in header');
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 39d — Log output always contains the expected non-sensitive fields
// ---------------------------------------------------------------------------

describe('Property 39d: Log output always contains the expected non-sensitive structural fields', () => {
  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all requests to any registered route, the emitted log record MUST be
   * valid JSON and MUST contain the allow-listed fields:
   *   requestId, method, path, status, durationMs
   *
   * These fields are safe to log and are required for observability.
   */
  it('Property 39d-i: every log record is valid JSON with all required non-sensitive fields', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('/ping', '/echo', '/nonexistent'),
          fc.constantFrom('GET', 'POST'),
          async (path, method) => {
            const logs = await captureConsoleLogs(async () => {
              if (method === 'POST') {
                await post(port, path, { test: true });
              } else {
                await get(port, path);
              }
            });

            // At least one log line must be a valid request-logger record
            const records = logs.map(parseLogRecord).filter(Boolean);
            expect(records.length).toBeGreaterThanOrEqual(1);

            for (const record of records) {
              if (!record) continue;
              // Required non-sensitive fields
              expect(record).toHaveProperty('requestId');
              expect(typeof record.requestId).toBe('string');
              expect((record.requestId as string).length).toBeGreaterThan(0);

              expect(record).toHaveProperty('method');
              expect(typeof record.method).toBe('string');

              expect(record).toHaveProperty('path');
              expect(typeof record.path).toBe('string');

              expect(record).toHaveProperty('status');
              expect(typeof record.status).toBe('number');

              expect(record).toHaveProperty('durationMs');
              expect(typeof record.durationMs).toBe('number');
              expect(record.durationMs as number).toBeGreaterThanOrEqual(0);
            }
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all requests, the log record MUST also contain the structural fields:
   *   ts, level, event, outcome
   *
   * These are part of the allow-listed shape defined in request-logger.ts.
   */
  it('Property 39d-ii: every log record contains ts, level, event, and outcome fields', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('/ping', '/nonexistent'),
          async (path) => {
            const logs = await captureConsoleLogs(async () => {
              await get(port, path);
            });

            const records = logs.map(parseLogRecord).filter(Boolean);
            expect(records.length).toBeGreaterThanOrEqual(1);

            for (const record of records) {
              if (!record) continue;
              expect(record).toHaveProperty('ts');
              expect(record).toHaveProperty('level');
              expect(['info', 'warn', 'error']).toContain(record.level);
              expect(record).toHaveProperty('event');
              expect(record.event).toBe('http_request');
              expect(record).toHaveProperty('outcome');
              expect(['ok', 'client_error', 'server_error']).toContain(record.outcome);
            }
          },
        ),
        { numRuns: 15 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all requests with a known actor address, the log record MUST contain
   * the actor field set to that address (not null, not a different value).
   *
   * The actor field is safe to log — it is the asserted Sui address, not a
   * credential or secret.
   */
  it('Property 39d-iii: actor address is logged when X-Actor-Address header is present', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(actorAddressArb, async (actorAddress) => {
          const logs = await captureConsoleLogs(async () => {
            await get(port, '/ping', { 'X-Actor-Address': actorAddress });
          });

          const records = logs.map(parseLogRecord).filter(Boolean);
          expect(records.length).toBeGreaterThanOrEqual(1);

          for (const record of records) {
            if (!record) continue;
            expect(record.actor).toBe(actorAddress);
          }
        }),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * The log record MUST NOT contain any field outside the allow-list.
   * Specifically, it must not contain: body, payload, headers, authorization,
   * password, secret, key, token, proof, cipher, plaintext.
   */
  it('Property 39d-iv: log record does not contain forbidden field names', async () => {
    const FORBIDDEN_FIELD_NAMES = [
      'body',
      'payload',
      'headers',
      'authorization',
      'password',
      'secret',
      'key',
      'token',
      'proof',
      'cipher',
      'plaintext',
      'privateKey',
      'private_key',
    ];

    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('/ping', '/echo', '/nonexistent'),
          async (path) => {
            const logs = await captureConsoleLogs(async () => {
              await get(port, path);
            });

            const records = logs.map(parseLogRecord).filter(Boolean);
            for (const record of records) {
              if (!record) continue;
              for (const forbidden of FORBIDDEN_FIELD_NAMES) {
                expect(
                  Object.prototype.hasOwnProperty.call(record, forbidden),
                  `Log record must not contain field "${forbidden}"`,
                ).toBe(false);
              }
            }
          },
        ),
        { numRuns: 15 },
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 39e — Query-string parameters are stripped from the logged path
// ---------------------------------------------------------------------------

describe('Property 39e: Query-string parameters are stripped from the logged path', () => {
  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated paths with query strings, the logged `path` field MUST
   * contain only the pathname component (no `?` or query parameters).
   *
   * Query strings may carry sensitive values (tokens, keys, etc.) and must
   * never appear in log output.
   */
  it('Property 39e-i: logged path contains no query string', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          pathArb,
          fc.record({
            key: fc.stringMatching(/^[a-z]{3,10}$/),
            value: fc.stringMatching(/^[a-zA-Z0-9]{8,32}$/),
          }),
          async (basePath, param) => {
            const fullPath = `${basePath}?${param.key}=${param.value}`;

            const logs = await captureConsoleLogs(async () => {
              await get(port, fullPath);
            });

            const records = logs.map(parseLogRecord).filter(Boolean);
            for (const record of records) {
              if (!record) continue;
              const loggedPath = record.path as string;
              // The logged path must not contain a query string
              expect(loggedPath).not.toContain('?');
              expect(loggedPath).not.toContain(param.value);
              // The logged path must be the base path only
              expect(loggedPath).toBe(basePath);
            }
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated sensitive values passed as query parameters, the
   * logged path MUST NOT contain those values.
   *
   * This is the combined redaction + path-sanitization invariant.
   */
  it('Property 39e-ii: sensitive values in query string are not present in logged path', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(walletSecretArb, jwtArb, hexSecretArb),
          async (sensitiveValue) => {
            const logs = await captureConsoleLogs(async () => {
              await get(
                port,
                `/ping?secret=${encodeURIComponent(sensitiveValue)}`,
              );
            });

            // The sensitive value must not appear anywhere in any log line
            assertNotInLogs(logs, sensitiveValue, 'sensitive value in query string');

            // The logged path must be just "/ping"
            const records = logs.map(parseLogRecord).filter(Boolean);
            for (const record of records) {
              if (!record) continue;
              expect(record.path).toBe('/ping');
            }
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });

  /**
   * **Validates: Requirements 9.4, 9.11**
   *
   * For all generated paths with multiple query parameters, none of the
   * parameter values appear in the logged path.
   */
  it('Property 39e-iii: multiple query parameters are all stripped from logged path', async () => {
    const app = buildApp();
    const { server, port } = await startServer(app);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(
            fc.stringMatching(/^[a-zA-Z0-9]{8,20}$/),
            fc.stringMatching(/^[a-zA-Z0-9]{8,20}$/),
            fc.stringMatching(/^[a-zA-Z0-9]{8,20}$/),
          ),
          async ([v1, v2, v3]) => {
            const fullPath = `/ping?a=${v1}&b=${v2}&c=${v3}`;

            const logs = await captureConsoleLogs(async () => {
              await get(port, fullPath);
            });

            const records = logs.map(parseLogRecord).filter(Boolean);
            for (const record of records) {
              if (!record) continue;
              const loggedPath = record.path as string;
              expect(loggedPath).not.toContain(v1);
              expect(loggedPath).not.toContain(v2);
              expect(loggedPath).not.toContain(v3);
              expect(loggedPath).not.toContain('?');
            }
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      await stopServer(server);
    }
  });
});
