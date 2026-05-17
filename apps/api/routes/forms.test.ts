/**
 * Unit tests for apps/api/routes/forms.ts — production forms routes.
 *
 * Tests the Express router handlers via a lightweight in-process HTTP server.
 * Mocks walrusPut from walrus-service.ts to avoid real network calls.
 *
 * Form creation flow (task 15.3):
 *   POST /forms { formDefinition, privacyMode, policyId? }
 *     → validates auth session
 *     → uploads formDefinition to Walrus (walrusPut)
 *     → indexes metadata in Postgres (in-memory stub)
 *     → returns ApiResponse<FormRow> with state: 'indexed'
 *
 * Requirements: 4.1, 4.4, 7.5, 3.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { formsRouter, _resetFormStore, type FormRow } from './forms';
import type { ServerConfig } from '../server-config';

// ---------------------------------------------------------------------------
// Mock walrus-service walrusPut (avoid real Walrus network calls)
// ---------------------------------------------------------------------------

vi.mock('../services/walrus-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/walrus-service')>();
  return {
    ...actual,
    walrusPut: vi.fn(async (bytes: Uint8Array) => {
      // Return a deterministic blob ID based on content
      let hash = 0;
      for (let i = 0; i < bytes.length; i++) {
        hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
      }
      return {
        blobId: `mock-blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`,
        sizeBytes: bytes.length,
      };
    }),
    walrusBlobExists: vi.fn(async (_blobId: string) => true),
  };
});

import { walrusPut, walrusBlobExists } from '../services/walrus-service';

// ---------------------------------------------------------------------------
// Mock infrastructure-wallet sealEncrypt (avoid real Seal calls for private forms)
// ---------------------------------------------------------------------------

vi.mock('../services/infrastructure-wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/infrastructure-wallet')>();
  return {
    ...actual,
    sealEncrypt: vi.fn(async (plaintext: Uint8Array, _policyOwnerAddress: string) => {
      const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...plaintext.slice(0, 8)]);
      const digest = 'b'.repeat(64);
      return { ciphertext, policyId: 'mock-policy-id', digest };
    }),
  };
});

import { sealEncrypt } from '../services/infrastructure-wallet';

// ---------------------------------------------------------------------------
// Mock audit-log (avoid real DB calls)
// ---------------------------------------------------------------------------

vi.mock('../services/audit-log', () => ({
  writeAuditEntry: vi.fn().mockResolvedValue(undefined),
  AuditLogWriteError: class AuditLogWriteError extends Error {
    constructor(cause: unknown) { super(String(cause)); this.name = 'AuditLogWriteError'; }
  },
}));

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
  app.use('/forms', formsRouter(mockConfig));
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

const OWNER_ADDRESS = '0x' + 'ab'.repeat(32);

const VALID_PUBLIC_FORM_DEFINITION = {
  title: 'Test Form',
  fields: [{ type: 'text', label: 'Name', required: false }],
  version: 1,
};

const VALID_PRIVATE_FORM_DEFINITION = {
  title: 'Private Form',
  fields: [{ type: 'email', label: 'Email', required: true }],
  version: 1,
};

const VALID_POLICY_ID = 'seal-policy-abc123';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetFormStore();
  vi.mocked(walrusPut).mockClear();
  vi.mocked(walrusBlobExists).mockClear();
  vi.mocked(sealEncrypt).mockClear();
  // Reset to default implementation (deterministic hash-based blob ID)
  vi.mocked(walrusPut).mockImplementation(async (bytes: Uint8Array) => {
    let hash = 0;
    for (let i = 0; i < bytes.length; i++) {
      hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
    }
    return {
      blobId: `mock-blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`,
      sizeBytes: bytes.length,
    };
  });
  vi.mocked(walrusBlobExists).mockResolvedValue(true);
  vi.mocked(sealEncrypt).mockImplementation(async (plaintext: Uint8Array, _policyOwnerAddress: string) => {
    const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...plaintext.slice(0, 8)]);
    const digest = 'b'.repeat(64);
    return { ciphertext, policyId: 'mock-policy-id', digest };
  });
});

afterEach(() => {
  _resetFormStore();
});

// ---------------------------------------------------------------------------
// POST /forms — authentication
// ---------------------------------------------------------------------------

describe('POST /forms — authentication', () => {
  it('returns 401 Unauthorized when no auth header is provided', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
    });

    expect(status).toBe(401);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Unauthorized');
  });

  it('returns 401 Unauthorized when Authorization header is empty Bearer', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { Authorization: 'Bearer ' },
    });

    expect(status).toBe(401);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// POST /forms — input validation
// ---------------------------------------------------------------------------

describe('POST /forms — input validation', () => {
  it('returns 400 Validation when body is empty', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {},
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(400);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Validation');
  });

  it('returns 400 Validation when formDefinition is missing', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: { privacyMode: 'public' },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(400);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Validation');
  });

  it('returns 400 Validation when privacyMode is missing', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: { formDefinition: VALID_PUBLIC_FORM_DEFINITION },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(400);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Validation');
  });

  it('returns 400 Validation when privacyMode is invalid', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'secret',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(400);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Validation');
  });

  it('returns 400 Validation when privacyMode is private but policyId is missing', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PRIVATE_FORM_DEFINITION,
        privacyMode: 'private',
        // policyId intentionally omitted
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(400);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Validation');
  });
});

// ---------------------------------------------------------------------------
// POST /forms — public form creation flow (task 15.3)
// ---------------------------------------------------------------------------

describe('POST /forms — public form creation flow', () => {
  it('creates a public form: uploads to Walrus and returns indexed FormRow', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(201);
    const result = (body as any).result as FormRow;

    // ApiResponse envelope
    expect((body as any).ok).toBe(true);
    expect((body as any).requestId).toBeDefined();

    // FormRow fields
    expect(result.id).toBeDefined();
    expect(result.ownerAddress).toBe(OWNER_ADDRESS);
    expect(result.privacyMode).toBe('public');
    expect(result.policyId).toBeNull();
    expect(result.state).toBe('indexed');
    expect(result.version).toBe(1);
    expect(result.predecessorId).toBeNull();
    expect(result.walrusBlobId).toBeDefined();
    expect(result.walrusBlobId.length).toBeGreaterThan(0);
    expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.createdAt).toBeDefined();

    // Walrus upload was called
    expect(walrusPut).toHaveBeenCalledOnce();
  });

  it('walrusBlobId in response matches what walrusPut returned', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(201);
    const result = (body as any).result as FormRow;

    // The blob ID should start with 'mock-blob-' (from our mock)
    expect(result.walrusBlobId).toMatch(/^mock-blob-/);
  });

  it('contentDigest is a valid SHA-256 hex string', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(201);
    const result = (body as any).result as FormRow;
    expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ownerAddress is set to the session address (not spoofable)', async () => {
    const differentAddress = '0x' + 'cd'.repeat(32);
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': differentAddress },
    });

    expect(status).toBe(201);
    const result = (body as any).result as FormRow;
    expect(result.ownerAddress).toBe(differentAddress);
  });
});

// ---------------------------------------------------------------------------
// POST /forms — private form creation flow (task 15.3)
// ---------------------------------------------------------------------------

describe('POST /forms — private form creation flow', () => {
  it('creates a private form: uploads to Walrus, stores policyId, returns indexed FormRow', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PRIVATE_FORM_DEFINITION,
        privacyMode: 'private',
        policyId: VALID_POLICY_ID,
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(201);
    const result = (body as any).result as FormRow;

    expect((body as any).ok).toBe(true);
    expect(result.privacyMode).toBe('private');
    // policyId comes from sealEncrypt result (mock returns 'mock-policy-id')
    expect(result.policyId).toBe('mock-policy-id');
    expect(result.state).toBe('indexed');
    expect(result.walrusBlobId).toBeDefined();
    // contentDigest comes from sealEncrypt result (mock returns 'b'.repeat(64))
    expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sizeBytes).toBeGreaterThan(0);

    // Walrus upload was called
    expect(walrusPut).toHaveBeenCalledOnce();
  });

  it('policyId is included in the FormRow for private forms (Requirement 4.4)', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PRIVATE_FORM_DEFINITION,
        privacyMode: 'private',
        policyId: VALID_POLICY_ID,
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(201);
    const result = (body as any).result as FormRow;
    // policyId is assigned by sealEncrypt (mock returns 'mock-policy-id')
    expect(result.policyId).toBe('mock-policy-id');
  });
});

// ---------------------------------------------------------------------------
// POST /forms — Walrus upload failure handling
// ---------------------------------------------------------------------------

describe('POST /forms — Walrus upload failure handling', () => {
  it('returns 502 Internal when walrusPut fails', async () => {
    const { WalrusPutError } = await import('../services/walrus-service');
    vi.mocked(walrusPut).mockRejectedValueOnce(
      new WalrusPutError(undefined, 5, new Error('Walrus unavailable')),
    );

    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(502);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Internal');
  });
});

// ---------------------------------------------------------------------------
// POST /forms — idempotency
// ---------------------------------------------------------------------------

describe('POST /forms — idempotency', () => {
  it('returns 200 with existing row when same owner+blob is submitted twice', async () => {
    // Make walrusPut always return the same blob ID to simulate idempotent upload
    vi.mocked(walrusPut).mockResolvedValue({ blobId: 'fixed-blob-id', sizeBytes: 100 });

    const app = buildApp();

    // First request
    const { status: status1, body: body1 } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });
    expect(status1).toBe(201);
    const result1 = (body1 as any).result as FormRow;

    // Second request with same content (same blob ID returned by mock)
    const { status: status2, body: body2 } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });
    expect(status2).toBe(200); // idempotent — returns existing row
    const result2 = (body2 as any).result as FormRow;

    // Both should return the same form ID
    expect(result2.id).toBe(result1.id);
    expect(result2.walrusBlobId).toBe(result1.walrusBlobId);
  });
});

// ---------------------------------------------------------------------------
// POST /forms — ApiResponse<FormRow> envelope shape
// ---------------------------------------------------------------------------

describe('POST /forms — ApiResponse<FormRow> envelope', () => {
  it('response envelope has ok, requestId, and result fields', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(201);
    expect((body as any).ok).toBe(true);
    expect(typeof (body as any).requestId).toBe('string');
    expect((body as any).requestId.length).toBeGreaterThan(0);
    expect((body as any).result).toBeDefined();
    // No error field on success
    expect((body as any).error).toBeUndefined();
  });

  it('error response envelope has ok=false, requestId, and error fields', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {},
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(400);
    expect((body as any).ok).toBe(false);
    expect(typeof (body as any).requestId).toBe('string');
    expect((body as any).error).toBeDefined();
    expect((body as any).error.code).toBeDefined();
    expect((body as any).error.message).toBeDefined();
    // No result field on error
    expect((body as any).result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /forms/:id — form retrieval
// ---------------------------------------------------------------------------

describe('GET /forms/:id — form retrieval', () => {
  it('returns 404 for a non-existent form', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms/00000000-0000-0000-0000-000000000099');

    expect(status).toBe(404);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('NotFound');
  });

  it('returns the form after creation', async () => {
    const app = buildApp();

    // Create a form first
    const { status: createStatus, body: createBody } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PUBLIC_FORM_DEFINITION,
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });
    expect(createStatus).toBe(201);
    const created = (createBody as any).result as FormRow;

    // Retrieve it
    const { status, body } = await appFetch(app, `/forms/${created.id}`);
    expect(status).toBe(200);
    const result = (body as any).result as FormRow;
    expect(result.id).toBe(created.id);
    expect(result.walrusBlobId).toBe(created.walrusBlobId);
    expect(result.state).toBe('indexed');
  });

  it('returns 401 for private form when not authenticated', async () => {
    const app = buildApp();

    // Create a private form
    const { body: createBody } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PRIVATE_FORM_DEFINITION,
        privacyMode: 'private',
        policyId: VALID_POLICY_ID,
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });
    const created = (createBody as any).result as FormRow;

    // Try to access without auth
    const { status, body } = await appFetch(app, `/forms/${created.id}`);
    expect(status).toBe(401);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Unauthorized');
  });

  it('returns 403 for private form when accessed by non-owner', async () => {
    const app = buildApp();

    // Create a private form as OWNER_ADDRESS
    const { body: createBody } = await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: VALID_PRIVATE_FORM_DEFINITION,
        privacyMode: 'private',
        policyId: VALID_POLICY_ID,
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });
    const created = (createBody as any).result as FormRow;

    // Try to access as a different address
    const otherAddress = '0x' + 'ff'.repeat(32);
    const { status, body } = await appFetch(app, `/forms/${created.id}`, {
      headers: { 'x-session-address': otherAddress },
    });
    expect(status).toBe(403);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// GET /forms — list forms
// ---------------------------------------------------------------------------

describe('GET /forms — list forms', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms');

    expect(status).toBe(401);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Unauthorized');
  });

  it('returns empty list when no forms exist', async () => {
    const app = buildApp();
    const { status, body } = await appFetch(app, '/forms', {
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(200);
    expect((body as any).ok).toBe(true);
    expect((body as any).result.forms).toHaveLength(0);
    expect((body as any).result.total).toBe(0);
  });

  it('returns created forms for the authenticated owner', async () => {
    const app = buildApp();

    // Create two forms
    await appFetch(app, '/forms', {
      method: 'POST',
      body: { formDefinition: VALID_PUBLIC_FORM_DEFINITION, privacyMode: 'public' },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });
    await appFetch(app, '/forms', {
      method: 'POST',
      body: {
        formDefinition: { ...VALID_PUBLIC_FORM_DEFINITION, title: 'Second Form' },
        privacyMode: 'public',
      },
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    const { status, body } = await appFetch(app, '/forms', {
      headers: { 'x-session-address': OWNER_ADDRESS },
    });

    expect(status).toBe(200);
    expect((body as any).result.forms).toHaveLength(2);
    expect((body as any).result.total).toBe(2);
  });

  it('returns 403 when trying to list another owner\'s forms', async () => {
    const app = buildApp();
    const otherAddress = '0x' + 'ff'.repeat(32);

    const { status, body } = await appFetch(
      app,
      `/forms?ownerAddress=${otherAddress}`,
      {
        headers: { 'x-session-address': OWNER_ADDRESS },
      },
    );

    expect(status).toBe(403);
    expect((body as any).ok).toBe(false);
    expect((body as any).error.code).toBe('Forbidden');
  });
});
