/**
 * Unit tests for apps/api/routes/submissions.ts — production submissions routes.
 *
 * Tests the Express router handlers via a lightweight in-process HTTP server.
 * Uses in-memory DB stubs (_formStore, _submissionStore) seeded per test.
 * Mocks sealEncrypt/sealDecrypt from infrastructure-wallet.ts and
 * walrusGet/walrusPut from walrus-service.ts to avoid real network calls.
 *
 * Requirements: 4.2, 4.3, 4.5, 4.6, 7.2, 7.3, 7.9, 7.10, 12.3, 12.5, 13.3, 13.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import {
  submissionsRouter,
  _seedForm,
  _seedViewerPermission,
  _clearStores,
  type FormRecord,
  type ViewerPermission,
} from './submissions';
import type { ServerConfig } from '../server-config';
import { db, prisma } from '../services/db';

// ---------------------------------------------------------------------------
// Mock infrastructure-wallet sealEncrypt + sealDecrypt
// ---------------------------------------------------------------------------

vi.mock('../services/infrastructure-wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/infrastructure-wallet')>();
  return {
    ...actual,
    sealEncrypt: vi.fn(async (plaintext: Uint8Array, _policyOwnerAddress: string) => {
      const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...plaintext.slice(0, 8)]);
      const digest = 'a'.repeat(64);
      return { ciphertext, policyId: 'test-policy-id', digest };
    }),
    sealDecrypt: vi.fn(async (ciphertext: Uint8Array, _policyId: string) => {
      // Strip the 4-byte mock header [0xde, 0xad, 0xbe, 0xef] added by sealEncrypt mock
      // and return the original plaintext bytes
      return ciphertext.slice(4);
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock walrus-service walrusPut + walrusGet (avoid real Walrus network calls)
// ---------------------------------------------------------------------------

vi.mock('../services/walrus-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/walrus-service')>();
  const mockWalrusPut = vi.fn(async (bytes: Uint8Array) => {
    // Return a deterministic blob ID based on full content to avoid collisions
    let hash = 0;
    for (let i = 0; i < bytes.length; i++) {
      hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
    }
    return { blobId: `mock-blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`, sizeBytes: bytes.length };
  });
  return {
    ...actual,
    walrusPut: mockWalrusPut,
    walrusPutWithCliFallback: vi.fn(async (bytes: Uint8Array) => {
      return mockWalrusPut(bytes);
    }),
    walrusBlobExists: vi.fn(async (_blobId: string) => true),
    walrusGet: vi.fn(async (blobId: string, _expectedDigest?: string) => {
      // Return mock ciphertext bytes keyed by blobId for testability.
      // Tests that need specific content should override this mock.
      const encoder = new TextEncoder();
      return encoder.encode(`mock-content-for-${blobId}`);
    }),
  };
});

import { sealEncrypt, sealDecrypt } from '../services/infrastructure-wallet';
import { walrusPut, walrusGet } from '../services/walrus-service';

// ---------------------------------------------------------------------------
// Test app + HTTP helper
// ---------------------------------------------------------------------------

const mockConfig: ServerConfig = {
  port: 4000,
  nodeEnv: 'test',
  apiSecretKey: '',
  skipAuth: true,
  infrastructureWalletSecret: 'test-secret',
  databaseUrl: 'postgresql://localhost/test',
  walrusPublisherUrl: 'https://publisher.test',
  walrusAggregatorUrl: 'https://aggregator.test',
  suiRpcUrl: 'https://rpc.test',
  sessionSecret: 'test-session-secret-32-chars-long',
  corsOrigins: ['http://localhost:3000'],
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/submissions', submissionsRouter(mockConfig));
  return app;
}

/**
 * Minimal fetch-like helper that sends a request to an in-process Express app
 * without binding to a real port.
 */
async function appFetch(
  app: express.Express,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}${path}`;

      const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : undefined;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: bodyStr,
      })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PUBLIC_FORM: FormRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  privacyMode: 'public',
  ownerAddress: '0xaabbccdd',
  walrusBlobId: 'form-blob-public',
  policyId: null,
  version: 1,
  predecessorId: null,
  state: 'indexed',
  contentDigest: 'a'.repeat(64),
  sizeBytes: 100,
  createdAt: new Date().toISOString(),
};

const PRIVATE_FORM: FormRecord = {
  id: '00000000-0000-0000-0000-000000000002',
  privacyMode: 'private',
  ownerAddress: '0xdeadbeef',
  walrusBlobId: 'form-blob-private',
  policyId: 'test-policy-id',
  version: 1,
  predecessorId: null,
  state: 'indexed',
  contentDigest: 'b'.repeat(64),
  sizeBytes: 120,
  createdAt: new Date().toISOString(),
};

const VALID_SUBMITTER = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await _clearStores();
  await _seedForm(PUBLIC_FORM);
  await _seedForm(PRIVATE_FORM);
  vi.mocked(sealEncrypt).mockClear();
  vi.mocked(sealDecrypt).mockClear();
  vi.mocked(walrusPut).mockClear();
  vi.mocked(walrusGet).mockClear();
});

afterEach(async () => {
  await _clearStores();
});

// ---------------------------------------------------------------------------
// POST /submissions — input validation
// ---------------------------------------------------------------------------

describe('POST /submissions — input validation', () => {
  it('returns 400 Validation when body is missing required fields', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {},
    });

    expect(status).toBe(400);
    expect((body as any).error.code).toBe('Validation');
    expect((body as any).status).toBe(400);
    expect((body as any).requestId).toBeDefined();
  });

  it('returns 400 Validation when formId is not a UUID', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: 'not-a-uuid',
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"answer":"hello"}',
      },
    });

    expect(status).toBe(400);
    expect((body as any).error.code).toBe('Validation');
  });

  it('returns 400 Validation when privacyMode is invalid', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'protected',
        payload: '{"answer":"hello"}',
      },
    });

    expect(status).toBe(400);
    expect((body as any).error.code).toBe('Validation');
  });

  it('returns 400 Validation when payload is empty', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '',
      },
    });

    expect(status).toBe(400);
    expect((body as any).error.code).toBe('Validation');
  });
});

// ---------------------------------------------------------------------------
// POST /submissions — form not found
// ---------------------------------------------------------------------------

describe('POST /submissions — form not found', () => {
  it('returns 404 NotFound when formId does not exist', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: '99999999-9999-9999-9999-999999999999',
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"answer":"hello"}',
      },
    });

    expect(status).toBe(404);
    expect((body as any).error.code).toBe('NotFound');
    expect((body as any).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /submissions — privacy mode mismatch (Requirement 4.5)
// ---------------------------------------------------------------------------

describe('POST /submissions — privacy mode mismatch', () => {
  it('returns 400 PrivacyModeMismatch when declaring public for a private form', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PRIVATE_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public', // mismatch — form is private
        payload: '{"answer":"hello"}',
      },
    });

    expect(status).toBe(400);
    expect((body as any).error.code).toBe('PrivacyModeMismatch');
    expect((body as any).status).toBe(400);
    expect((body as any).error.message).toContain('privacy_mode');
    expect((body as any).requestId).toBeDefined();
  });

  it('returns 400 PrivacyModeMismatch when declaring private for a public form', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'private', // mismatch — form is public
        payload: '{"answer":"hello"}',
      },
    });

    expect(status).toBe(400);
    expect((body as any).error.code).toBe('PrivacyModeMismatch');
  });
});

// ---------------------------------------------------------------------------
// POST /submissions — public form success (Requirement 4.2)
// ---------------------------------------------------------------------------

describe('POST /submissions — public form', () => {
  it('creates a submission for a public form without calling sealEncrypt', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"name":"Alice","email":"alice@example.com"}',
      },
    });

    expect(status).toBe(201);
    expect(sealEncrypt).not.toHaveBeenCalled();

    const b = body as any;
    expect(b.status).toBe(201);
    expect(b.requestId).toBeDefined();
    expect(b.result).toBeDefined();
    expect(b.error).toBeUndefined();

    const row = b.result;
    expect(row.id).toBeDefined();
    expect(row.formId).toBe(PUBLIC_FORM.id);
    expect(row.formVersion).toBe(1);
    expect(row.submitterAddress).toBe(VALID_SUBMITTER);
    expect(row.privacyMode).toBe('public');
    expect(row.walrusBlobId).toBeDefined();
    expect(row.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(row.sizeBytes).toBeGreaterThan(0);
    expect(row.state).toBe('indexed');
    expect(row.createdAt).toBeDefined();
    expect(row.policyId).toBeUndefined();
  });

  it('returns ApiResponse envelope with result and no error field', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"answer":"test"}',
      },
    });

    expect(status).toBe(201);
    const b = body as any;
    expect(b).toHaveProperty('requestId');
    expect(b).toHaveProperty('status', 201);
    expect(b).toHaveProperty('result');
    expect(b.error).toBeUndefined();
  });

  it('calls walrusPut with plaintext bytes for public form submission (Requirement 2.1, 4.2)', async () => {
    const app = buildApp();
    const payload = '{"name":"Alice","email":"alice@example.com"}';
    // The orchestrator canonicalizes JSON (sorts keys) before uploading
    const canonicalPayload = '{"email":"alice@example.com","name":"Alice"}';
    const { status } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload,
      },
    });

    expect(status).toBe(201);
    // walrusPut must be called with the UTF-8 encoded canonicalized bytes
    expect(walrusPut).toHaveBeenCalledOnce();
    const callArg = vi.mocked(walrusPut).mock.calls[0][0] as Uint8Array;
    const decoded = new TextDecoder().decode(callArg);
    expect(decoded).toBe(canonicalPayload);
  });

  it('returns 500 Internal when walrusPut fails for a public form', async () => {
    const { WalrusPutError } = await import('../services/walrus-service');
    vi.mocked(walrusPut).mockRejectedValueOnce(
      new WalrusPutError(undefined, 5, new Error('Walrus unavailable')),
    );

    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"answer":"test"}',
      },
    });

    expect(status).toBe(500);
    expect((body as any).error.code).toBe('Internal');
    expect((body as any).status).toBe(500);
    expect((body as any).requestId).toBeDefined();
  });

  it('server always handles Walrus upload (walrusBlobId in body is ignored)', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"answer":"test"}',
        // walrusBlobId is no longer accepted — server always orchestrates upload
      },
    });

    expect(status).toBe(201);
    // walrusPut IS called — the server always handles the upload
    expect(walrusPut).toHaveBeenCalledOnce();
    // The blob ID is server-assigned
    expect((body as any).result.walrusBlobId).toMatch(/^mock-blob-/);
  });
});

// ---------------------------------------------------------------------------
// POST /submissions — private form success (Requirement 4.3)
// ---------------------------------------------------------------------------

describe('POST /submissions — private form', () => {
  it('creates a submission for a private form by calling sealEncrypt', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PRIVATE_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'private',
        payload: '{"secret":"sensitive data"}',
      },
    });

    expect(status).toBe(201);
    expect(sealEncrypt).toHaveBeenCalledOnce();
    expect(sealEncrypt).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      PRIVATE_FORM.ownerAddress,
    );

    const row = (body as any).result;
    expect(row.privacyMode).toBe('private');
    expect(row.policyId).toBe('test-policy-id');
    expect(row.contentDigest).toBe('a'.repeat(64));
    expect(row.state).toBe('indexed');
  });

  it('returns 500 Internal when sealEncrypt throws WalletNotConfiguredError', async () => {
    const { WalletNotConfiguredError } = await import('../services/infrastructure-wallet');
    vi.mocked(sealEncrypt).mockRejectedValueOnce(new WalletNotConfiguredError('missing'));

    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PRIVATE_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'private',
        payload: '{"secret":"data"}',
      },
    });

    expect(status).toBe(500);
    expect((body as any).error.code).toBe('Internal');
    expect((body as any).status).toBe(500);
  });

  it('returns 500 Internal when sealEncrypt throws SealEncryptionError', async () => {
    const { SealEncryptionError } = await import('../services/infrastructure-wallet');
    vi.mocked(sealEncrypt).mockRejectedValueOnce(new SealEncryptionError(new Error('seal down')));

    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PRIVATE_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'private',
        payload: '{"secret":"data"}',
      },
    });

    expect(status).toBe(500);
    expect((body as any).error.code).toBe('Internal');
  });
});

// ---------------------------------------------------------------------------
// POST /submissions — idempotency on (formId, walrusBlobId)
// ---------------------------------------------------------------------------

describe('POST /submissions — idempotency', () => {
  it('returns the existing row when same payload is submitted twice (idempotent on formId+walrusBlobId)', async () => {
    const app = buildApp();
    const requestBody = {
      formId: PUBLIC_FORM.id,
      formVersion: 1,
      submitterAddress: VALID_SUBMITTER,
      privacyMode: 'public',
      payload: '{"answer":"idempotent"}',
    };

    const { status: s1, body: b1 } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: requestBody,
    });
    const { status: s2, body: b2 } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: requestBody,
    });

    expect(s1).toBe(201);
    expect(s2).toBe(200); // idempotent — returns existing
    expect((b1 as any).result.id).toBe((b2 as any).result.id);
    // Both should have the same server-assigned blob ID
    expect((b2 as any).result.walrusBlobId).toBe((b1 as any).result.walrusBlobId);
  });
});

// ---------------------------------------------------------------------------
// GET /submissions/:id
// ---------------------------------------------------------------------------

describe('GET /submissions/:id', () => {
  it('returns 404 NotFound for a non-existent submission ID', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(
      app,
      '/submissions/99999999-9999-9999-9999-999999999999',
    );

    expect(status).toBe(404);
    expect((body as any).error.code).toBe('NotFound');
    expect((body as any).status).toBe(404);
    expect((body as any).requestId).toBeDefined();
  });

  it('returns 200 with submission metadata for an existing submission', async () => {
    const app = buildApp();

    const { body: createBody } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"answer":"get-test"}',
      },
    });

    const submissionId = (createBody as any).result.id;

    const { status, body } = await appFetch(app, `/submissions/${submissionId}`);

    expect(status).toBe(200);
    const b = body as any;
    expect(b.status).toBe(200);
    expect(b.result.id).toBe(submissionId);
    expect(b.result.formId).toBe(PUBLIC_FORM.id);
    expect(b.result.privacyMode).toBe('public');
    expect(b.result.state).toBe('indexed');
    expect(b.result.walrusBlobId).toBeDefined();
    expect(b.result.contentDigest).toBeDefined();
  });

  it('returns ApiResponse envelope with result and no error field on success', async () => {
    const app = buildApp();

    const { body: createBody } = await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"answer":"envelope-test"}',
      },
    });

    const submissionId = (createBody as any).result.id;
    const { status, body } = await appFetch(app, `/submissions/${submissionId}`);

    expect(status).toBe(200);
    const b = body as any;
    expect(b).toHaveProperty('requestId');
    expect(b).toHaveProperty('status', 200);
    expect(b).toHaveProperty('result');
    expect(b.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /submissions — list with filters
// ---------------------------------------------------------------------------

describe('GET /submissions — list', () => {
  it('returns empty list when no submissions exist', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions');

    expect(status).toBe(200);
    const b = body as any;
    expect(b.status).toBe(200);
    expect(b.result.submissions).toEqual([]);
    expect(b.result.total).toBe(0);
  });

  it('returns all submissions when no filters are applied', async () => {
    const app = buildApp();

    await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"a":1}',
      },
    });

    await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"b":2}',
      },
    });

    const { status, body } = await appFetch(app, '/submissions');
    expect(status).toBe(200);
    expect((body as any).result.total).toBe(2);
    expect((body as any).result.submissions).toHaveLength(2);
  });

  it('filters by formId', async () => {
    const app = buildApp();

    await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"form":"public"}',
      },
    });

    await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PRIVATE_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'private',
        payload: '{"form":"private"}',
      },
    });

    const { status, body } = await appFetch(
      app,
      `/submissions?formId=${PUBLIC_FORM.id}`,
    );

    expect(status).toBe(200);
    expect((body as any).result.total).toBe(1);
    expect((body as any).result.submissions[0].formId).toBe(PUBLIC_FORM.id);
  });

  it('filters by state', async () => {
    const app = buildApp();

    await appFetch(app, '/submissions', {
      method: 'POST',
      body: {
        formId: PUBLIC_FORM.id,
        formVersion: 1,
        submitterAddress: VALID_SUBMITTER,
        privacyMode: 'public',
        payload: '{"state":"indexed"}',
      },
    });

    const { status: s1, body: b1 } = await appFetch(app, '/submissions?state=indexed');
    expect(s1).toBe(200);
    expect((b1 as any).result.total).toBe(1);

    const { status: s2, body: b2 } = await appFetch(app, '/submissions?state=failed');
    expect(s2).toBe(200);
    expect((b2 as any).result.total).toBe(0);
  });

  it('returns 400 Validation for invalid state filter', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/submissions?state=invalid-state');

    expect(status).toBe(400);
    expect((body as any).error.code).toBe('Validation');
  });

  it('respects limit and offset pagination', async () => {
    const app = buildApp();

    for (let i = 0; i < 3; i++) {
      await appFetch(app, '/submissions', {
        method: 'POST',
        body: {
          formId: PUBLIC_FORM.id,
          formVersion: 1,
          submitterAddress: VALID_SUBMITTER,
          privacyMode: 'public',
          payload: `{"index":${i}}`,
        },
      });
    }

    const { status, body } = await appFetch(app, '/submissions?limit=2&offset=0');

    expect(status).toBe(200);
    const b = body as any;
    expect(b.result.submissions).toHaveLength(2);
    expect(b.result.total).toBe(3);
    expect(b.result.limit).toBe(2);
    expect(b.result.offset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /submissions/:id/decrypt — decryption retrieval flow (Task 15.4)
// Requirements: 4.6, 7.3, 7.9, 12.3, 12.5, 13.3, 13.6
// ---------------------------------------------------------------------------

/**
 * Helper: create a private submission and return its ID.
 */
async function createPrivateSubmission(
  app: express.Express,
): Promise<string> {
  const { body } = await appFetch(app, '/submissions', {
    method: 'POST',
    body: {
      formId: PRIVATE_FORM.id,
      formVersion: 1,
      submitterAddress: VALID_SUBMITTER,
      privacyMode: 'private',
      payload: '{"secret":"sensitive data"}',
    },
  });
  return (body as any).result.id;
}

/**
 * Helper: create a public submission and return its ID.
 */
async function createPublicSubmission(
  app: express.Express,
): Promise<string> {
  const { body } = await appFetch(app, '/submissions', {
    method: 'POST',
    body: {
      formId: PUBLIC_FORM.id,
      formVersion: 1,
      submitterAddress: VALID_SUBMITTER,
      privacyMode: 'public',
      payload: '{"answer":"hello world"}',
    },
  });
  return (body as any).result.id;
}

describe('GET /submissions/:id/decrypt — auth session check', () => {
  it('returns 401 Unauthorized when x-actor-address header is missing', async () => {
    const app = buildApp();
    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`);

    expect(status).toBe(401);
    expect((body as any).error.code).toBe('Unauthorized');
    expect((body as any).status).toBe(401);
    expect((body as any).requestId).toBeDefined();
    // sealDecrypt must NOT be called when unauthenticated (Req 12.3)
    expect(sealDecrypt).not.toHaveBeenCalled();
  });

  it('returns 401 Unauthorized when x-actor-address header is empty', async () => {
    const app = buildApp();
    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': '   ' },
    });

    expect(status).toBe(401);
    expect((body as any).error.code).toBe('Unauthorized');
    expect(sealDecrypt).not.toHaveBeenCalled();
  });

  it('returns 404 NotFound for a non-existent submission ID', async () => {
    const app = buildApp();

    const { status, body } = await appFetch(
      app,
      '/submissions/99999999-9999-9999-9999-999999999999/decrypt',
      { headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress } },
    );

    expect(status).toBe(404);
    expect((body as any).error.code).toBe('NotFound');
    expect(sealDecrypt).not.toHaveBeenCalled();
  });
});

describe('GET /submissions/:id/decrypt — authorization gating (Req 4.6, 7.3, 12.3, 12.5)', () => {
  it('returns 403 Forbidden when actor is not the form owner and has no viewer permission', async () => {
    const app = buildApp();
    const submissionId = await createPrivateSubmission(app);
    const unauthorizedActor = '0xdeadbeef00000000000000000000000000000000000000000000000000000001';

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': unauthorizedActor },
    });

    expect(status).toBe(403);
    expect((body as any).error.code).toBe('Forbidden');
    expect((body as any).status).toBe(403);
    expect((body as any).requestId).toBeDefined();
    // CRITICAL: sealDecrypt MUST NOT be called on authorization failure (Req 12.3, 13.6)
    expect(sealDecrypt).not.toHaveBeenCalled();
  });

  it('does NOT call sealDecrypt when authorization fails — security invariant', async () => {
    const app = buildApp();
    const submissionId = await createPrivateSubmission(app);
    const randomActor = '0x0000000000000000000000000000000000000000000000000000000000000099';

    await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': randomActor },
    });

    // The security invariant: sealDecrypt is never called when auth fails
    expect(sealDecrypt).not.toHaveBeenCalled();
  });

  it('returns 403 when authorization check errors (form not found) — treat as rejection (Req 7.3)', async () => {
    const app = buildApp();
    // Create a submission
    const submissionId = await createPrivateSubmission(app);
    
    // Mock db.getForm to return undefined to simulate a missing form record
    vi.spyOn(db, 'getForm').mockResolvedValueOnce(undefined);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(status).toBe(403);
    expect((body as any).error.code).toBe('Forbidden');
    // sealDecrypt must NOT be called when authorization check itself errors
    expect(sealDecrypt).not.toHaveBeenCalled();
  });
});

describe('GET /submissions/:id/decrypt — authorized owner decryption (Req 4.6, 13.3)', () => {
  it('returns 200 with plaintext when form owner requests decryption', async () => {
    const app = buildApp();
    const plaintext = '{"secret":"sensitive data"}';
    const plaintextBytes = new TextEncoder().encode(plaintext);

    // Mock walrusGet to return mock ciphertext (4-byte header + plaintext bytes)
    const mockCiphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...plaintextBytes.slice(0, 8)]);
    vi.mocked(walrusGet).mockResolvedValueOnce(mockCiphertext);
    // Mock sealDecrypt to return the original plaintext bytes
    vi.mocked(sealDecrypt).mockResolvedValueOnce(plaintextBytes);

    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(status).toBe(200);
    const b = body as any;
    expect(b.status).toBe(200);
    expect(b.requestId).toBeDefined();
    expect(b.result).toBeDefined();
    expect(b.error).toBeUndefined();
    expect(b.result.plaintext).toBe(plaintext);
  });

  it('calls walrusGet with the submission blobId and contentDigest', async () => {
    const app = buildApp();
    const plaintextBytes = new TextEncoder().encode('{"data":"test"}');

    vi.mocked(walrusGet).mockResolvedValueOnce(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    vi.mocked(sealDecrypt).mockResolvedValueOnce(plaintextBytes);

    const submissionId = await createPrivateSubmission(app);

    // Get the actual blob ID assigned by the orchestrator
    const { body: subBody } = await appFetch(app, `/submissions/${submissionId}`);
    const actualBlobId = (subBody as any).result.walrusBlobId;

    await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(walrusGet).toHaveBeenCalledOnce();
    const [calledBlobId, calledDigest] = vi.mocked(walrusGet).mock.calls[0];
    expect(calledBlobId).toBe(actualBlobId);
    // contentDigest should be passed for integrity verification (Req 3.9)
    expect(calledDigest).toBeDefined();
  });

  it('calls sealDecrypt with ciphertext and policyId after authorization passes', async () => {
    const app = buildApp();
    const plaintextBytes = new TextEncoder().encode('{"secret":"value"}');
    const mockCiphertext = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

    vi.mocked(walrusGet).mockResolvedValueOnce(mockCiphertext);
    vi.mocked(sealDecrypt).mockResolvedValueOnce(plaintextBytes);

    const submissionId = await createPrivateSubmission(app);

    await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(sealDecrypt).toHaveBeenCalledOnce();
    const [calledCiphertext, calledPolicyId] = vi.mocked(sealDecrypt).mock.calls[0];
    expect(calledCiphertext).toEqual(mockCiphertext);
    expect(calledPolicyId).toBe('test-policy-id'); // policyId set by sealEncrypt mock
  });

  it('returns ApiResponse<{ plaintext }> envelope shape', async () => {
    const app = buildApp();
    const plaintextBytes = new TextEncoder().encode('{"answer":"42"}');

    vi.mocked(walrusGet).mockResolvedValueOnce(new Uint8Array([0x01, 0x02]));
    vi.mocked(sealDecrypt).mockResolvedValueOnce(plaintextBytes);

    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(status).toBe(200);
    const b = body as any;
    // Typed ApiResponse<T> envelope (Req 7.6)
    expect(b).toHaveProperty('requestId');
    expect(b).toHaveProperty('status', 200);
    expect(b).toHaveProperty('result');
    expect(b.result).toHaveProperty('plaintext');
    expect(b.error).toBeUndefined();
  });
});

describe('GET /submissions/:id/decrypt — viewer permission (Req 12.5, 13.3)', () => {
  it('returns 200 when actor has viewer permission with capability=view', async () => {
    const app = buildApp();
    const viewerAddress = '0xaaaa000000000000000000000000000000000000000000000000000000000001';
    const plaintextBytes = new TextEncoder().encode('{"secret":"viewer can see"}');

    await _seedViewerPermission({
      formId: PRIVATE_FORM.id,
      granteeAddress: viewerAddress,
      capability: 'view',
    });

    vi.mocked(walrusGet).mockResolvedValueOnce(new Uint8Array([0x01]));
    vi.mocked(sealDecrypt).mockResolvedValueOnce(plaintextBytes);

    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': viewerAddress },
    });

    expect(status).toBe(200);
    expect((body as any).result.plaintext).toBe('{"secret":"viewer can see"}');
    expect(sealDecrypt).toHaveBeenCalledOnce();
  });

  it('returns 403 when actor has viewer permission with capability=submit (not view)', async () => {
    const app = buildApp();
    const submitterAddress = '0xbbbb000000000000000000000000000000000000000000000000000000000002';

    await _seedViewerPermission({
      formId: PRIVATE_FORM.id,
      granteeAddress: submitterAddress,
      capability: 'submit', // submit capability does not grant decryption
    });

    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': submitterAddress },
    });

    expect(status).toBe(403);
    expect((body as any).error.code).toBe('Forbidden');
    // sealDecrypt must NOT be called (Req 12.3)
    expect(sealDecrypt).not.toHaveBeenCalled();
  });
});

describe('GET /submissions/:id/decrypt — public submission retrieval (Req 3.8, 3.9)', () => {
  it('returns 200 with plaintext for a public submission without calling sealDecrypt', async () => {
    const app = buildApp();
    const publicPayload = '{"answer":"hello world"}';
    const publicBytes = new TextEncoder().encode(publicPayload);

    vi.mocked(walrusGet).mockResolvedValueOnce(publicBytes);

    const submissionId = await createPublicSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': '0xanyone' },
    });

    expect(status).toBe(200);
    expect((body as any).result.plaintext).toBe(publicPayload);
    // sealDecrypt must NOT be called for public submissions
    expect(sealDecrypt).not.toHaveBeenCalled();
  });

  it('returns 422 IntegrityMismatch when Walrus returns bytes with wrong digest', async () => {
    const app = buildApp();
    const { WalrusIntegrityError } = await import('../services/walrus-service');

    vi.mocked(walrusGet).mockRejectedValueOnce(
      new WalrusIntegrityError('public-blob-001', 'expected-digest', 'actual-digest'),
    );

    const submissionId = await createPublicSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': '0xanyone' },
    });

    expect(status).toBe(422);
    expect((body as any).error.code).toBe('IntegrityMismatch');
    expect(sealDecrypt).not.toHaveBeenCalled();
  });
});

describe('GET /submissions/:id/decrypt — error handling', () => {
  it('returns 502 BlobNotFound when walrusGet fails for a private submission', async () => {
    const app = buildApp();
    const { WalrusGetError } = await import('../services/walrus-service');

    vi.mocked(walrusGet).mockRejectedValueOnce(
      new WalrusGetError('private-blob-001', 5, new Error('Walrus unavailable')),
    );

    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(status).toBe(502);
    expect((body as any).error.code).toBe('BlobNotFound');
    expect(sealDecrypt).not.toHaveBeenCalled();
  });

  it('returns 500 Internal when sealDecrypt throws WalletNotConfiguredError', async () => {
    const app = buildApp();
    const { WalletNotConfiguredError } = await import('../services/infrastructure-wallet');

    vi.mocked(walrusGet).mockResolvedValueOnce(new Uint8Array([0x01, 0x02]));
    vi.mocked(sealDecrypt).mockRejectedValueOnce(new WalletNotConfiguredError('missing'));

    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(status).toBe(500);
    expect((body as any).error.code).toBe('Internal');
  });

  it('returns 500 Internal when sealDecrypt throws SealDecryptionError', async () => {
    const app = buildApp();
    const { SealDecryptionError } = await import('../services/infrastructure-wallet');

    vi.mocked(walrusGet).mockResolvedValueOnce(new Uint8Array([0x01, 0x02]));
    vi.mocked(sealDecrypt).mockRejectedValueOnce(
      new SealDecryptionError(new Error('seal network down')),
    );

    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(status).toBe(500);
    expect((body as any).error.code).toBe('Internal');
    expect((body as any).status).toBe(500);
    expect((body as any).requestId).toBeDefined();
  });

  it('returns 422 IntegrityMismatch when Walrus returns bytes with wrong digest for private submission', async () => {
    const app = buildApp();
    const { WalrusIntegrityError } = await import('../services/walrus-service');

    vi.mocked(walrusGet).mockRejectedValueOnce(
      new WalrusIntegrityError('private-blob-001', 'expected', 'actual'),
    );

    const submissionId = await createPrivateSubmission(app);

    const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
      headers: { 'x-actor-address': PRIVATE_FORM.ownerAddress },
    });

    expect(status).toBe(422);
    expect((body as any).error.code).toBe('IntegrityMismatch');
    // sealDecrypt must NOT be called on integrity failure
    expect(sealDecrypt).not.toHaveBeenCalled();
  });
});
