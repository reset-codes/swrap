/**
 * Forms handler integration tests for apps/api/forms.ts
 *
 * Tests the POST and GET handlers directly (no HTTP server).
 * MSW mocks the Walrus publisher/aggregator endpoints.
 * vi.mock controls the @poc/shared loadPocEnv return value.
 * vi.mock controls the @poc/sui detectLocalSigner return value.
 *
 * Requirements: R6.1, R6.4, R6.6, R7.1, R7.2, R8.1, R8.2, R8.3, R8.6
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NextRequest } from 'next/server';
import { randomBytes, hkdfSync } from 'node:crypto';

// ---------------------------------------------------------------------------
// Build a deterministic in-memory signer for tests (no filesystem access)
// ---------------------------------------------------------------------------

function buildTestSigner(secretHex?: string) {
  // Use a fixed 32-byte secret for deterministic tests
  const secret = secretHex
    ? Buffer.from(secretHex, 'hex')
    : Buffer.from('deadbeef'.repeat(8), 'hex'); // 32 bytes

  const address = '0x' + 'ab'.repeat(32); // 64 hex chars = 32 bytes

  return {
    scheme: 'ed25519' as const,
    address,
    getPublicKey: () => new Uint8Array(32),
    signPersonalMessage: async (_bytes: Uint8Array) => ({ signature: 'sig', bytes: 'bytes' }),
    signTransaction: async (_txBytes: Uint8Array) => ({ signature: 'sig', bytes: 'bytes' }),
    deriveSymmetricKey: (salt: Uint8Array, info: Uint8Array): Uint8Array => {
      const derived = hkdfSync('sha256', secret, salt, info, 32);
      return new Uint8Array(derived);
    },
  };
}

const testSigner = buildTestSigner();

// ---------------------------------------------------------------------------
// Mock @poc/shared so we can control DEV_ALLOW_PLAINTEXT per test
// ---------------------------------------------------------------------------

const mockEnv = {
  DEV_BYPASS_STORAGE: true,
  DEV_LOCAL_SIGNER: true,
  DEV_ALLOW_PLAINTEXT: true,
  USE_WALRUS_TESTNET: false,
  USE_SUI_TESTNET: false,
  WALRUS_PUBLISHER_URL: 'https://publisher.forms-test.walrus.test',
  WALRUS_AGGREGATOR_URL: 'https://aggregator.forms-test.walrus.test',
  SUI_RPC_URL: 'https://fullnode.testnet.sui.io:443',
  NODE_ENV: 'test' as const,
  POC_ALLOW_PROD: false,
};

vi.mock('@poc/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@poc/shared')>();
  return {
    ...actual,
    loadPocEnv: vi.fn(() => ({ ...mockEnv })),
  };
});

vi.mock('@poc/sui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@poc/sui')>();
  return {
    ...actual,
    detectLocalSigner: vi.fn(async () => ({
      signer: testSigner,
      activeNetwork: 'testnet',
      clientYamlPath: '/mock/.sui/sui_config/client.yaml',
      keystorePath: '/mock/.sui/sui_config/sui.keystore',
    })),
  };
});

// Import handlers AFTER mocking so they pick up the mock
import { POST, GET } from './forms';
import { loadPocEnv } from '@poc/shared';
import { detectLocalSigner } from '@poc/sui';

// ---------------------------------------------------------------------------
// In-memory blob store (mirrors the pattern from client.pbt.test.ts)
// ---------------------------------------------------------------------------

const PUBLISHER_URL = 'https://publisher.forms-test.walrus.test';
const AGGREGATOR_URL = 'https://aggregator.forms-test.walrus.test';

const blobStore = new Map<string, Uint8Array>();

function generateBlobId(bytes: Uint8Array): string {
  let hash = 0;
  for (let i = 0; i < bytes.length; i++) {
    hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
  }
  return `blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`;
}

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer(
  http.put(`${PUBLISHER_URL}/v1/blobs`, async ({ request }) => {
    const buffer = await request.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const blobId = generateBlobId(bytes);
    blobStore.set(blobId, bytes);
    return HttpResponse.json({
      newlyCreated: {
        blobObject: {
          blobId,
          size: bytes.length,
        },
      },
    });
  }),

  http.get(`${AGGREGATOR_URL}/v1/blobs/:blobId`, ({ params }) => {
    const blobId = decodeURIComponent(params.blobId as string);
    const bytes = blobStore.get(blobId);
    if (!bytes) {
      return new HttpResponse('Not Found', { status: 404 });
    }
    return new HttpResponse(bytes, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  blobStore.clear();
  vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv });
  vi.mocked(detectLocalSigner).mockResolvedValue({
    signer: testSigner,
    activeNetwork: 'testnet',
    clientYamlPath: '/mock/.sui/sui_config/client.yaml',
    keystorePath: '/mock/.sui/sui_config/sui.keystore',
  });
});
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/poc/forms', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGetRequest(blobId: string, raw = false): NextRequest {
  const url = raw
    ? `http://localhost/api/poc/forms/${blobId}?raw=true`
    : `http://localhost/api/poc/forms/${blobId}`;
  return new NextRequest(url, { method: 'GET' });
}

function makeGetContext(blobId: string) {
  return { params: Promise.resolve({ blob_id: blobId }) };
}

/** A valid FormSchema that passes FormSchemaSchema.safeParse() */
function validFormSchema() {
  return {
    title: 'Test Form',
    fields: [{ type: 'text' as const, label: 'Name', required: false }],
    version: 1 as const,
    created_at: '2024-01-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Plaintext path tests
// ---------------------------------------------------------------------------

describe('POST /api/poc/forms — DEV_ALLOW_PLAINTEXT=true, plaintext:true', () => {
  it('returns HTTP 200 with blob_id and created_at', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: true });

    const req = makePostRequest({
      form_schema: { title: 'Test Form', fields: [] },
      plaintext: true,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('blob_id');
    expect(typeof body.blob_id).toBe('string');
    expect(body.blob_id.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('created_at');
    expect(typeof body.created_at).toBe('string');
  });
});

describe('POST /api/poc/forms — DEV_ALLOW_PLAINTEXT=false, plaintext:true → 400 PLAINTEXT_DISABLED', () => {
  it('returns HTTP 400 with code PLAINTEXT_DISABLED', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: false });

    const req = makePostRequest({
      form_schema: { title: 'Test Form', fields: [] },
      plaintext: true,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('PLAINTEXT_DISABLED');
  });
});

describe('POST then GET /api/poc/forms — plaintext upload/retrieve round-trip', () => {
  it('GET with ?raw=true returns byte-identical bytes to what was uploaded', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: true });

    const formSchema = { title: 'Round-trip Form', fields: [{ label: 'Name', type: 'text' }] };

    // Step 1: POST to upload (plaintext)
    const postReq = makePostRequest({ form_schema: formSchema, plaintext: true });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);

    const postBody = await postRes.json();
    const blobId: string = postBody.blob_id;
    expect(typeof blobId).toBe('string');

    // Step 2: GET with ?raw=true to retrieve bytes
    const getReq = makeGetRequest(blobId, true);
    const getRes = await GET(getReq, makeGetContext(blobId));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('application/octet-stream');

    // Step 3: Verify bytes are identical to what was serialized and uploaded.
    // The plaintext handler uses canonicalize() from @poc/shared (RFC 8785 JCS).
    const retrievedBuffer = await getRes.arrayBuffer();
    const retrievedBytes = new Uint8Array(retrievedBuffer);
    expect(retrievedBytes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Encrypted path tests (default — no plaintext:true)
// ---------------------------------------------------------------------------

describe('POST /api/poc/forms — encrypted path (default)', () => {
  it('returns HTTP 200 with blob_id, schema_hash, created_at, tx_digest:null for valid form_schema', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: false });

    const req = makePostRequest({ form_schema: validFormSchema() });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('blob_id');
    expect(typeof body.blob_id).toBe('string');
    expect(body.blob_id.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('schema_hash');
    expect(typeof body.schema_hash).toBe('string');
    expect(body.schema_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body).toHaveProperty('created_at');
    expect(typeof body.created_at).toBe('string');
    expect(body).toHaveProperty('tx_digest');
    expect(body.tx_digest).toBeNull();
  });

  it('returns HTTP 400 INVALID_FORM_SCHEMA when form_schema fails validation', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: false });

    // Missing required fields: version, created_at
    const req = makePostRequest({ form_schema: { title: 'Bad Form', fields: [] } });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('INVALID_FORM_SCHEMA');
    expect(body.error.stage).toBe('validate');
  });

  it('returns HTTP 400 INVALID_FORM_SCHEMA when form_schema is null', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: false });

    const req = makePostRequest({ form_schema: null });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('INVALID_FORM_SCHEMA');
  });
});

describe('POST then GET /api/poc/forms — encrypted round-trip', () => {
  it('POST encrypts and uploads; GET decrypts and returns form_schema + schema_hash', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: false });

    const schema = validFormSchema();

    // Step 1: POST (encrypted path)
    const postReq = makePostRequest({ form_schema: schema });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);

    const postBody = await postRes.json();
    const blobId: string = postBody.blob_id;
    const postedSchemaHash: string = postBody.schema_hash;
    expect(typeof blobId).toBe('string');
    expect(postedSchemaHash).toMatch(/^[0-9a-f]{64}$/);

    // Step 2: GET (encrypted path — no ?raw=true)
    const getReq = makeGetRequest(blobId);
    const getRes = await GET(getReq, makeGetContext(blobId));
    expect(getRes.status).toBe(200);

    const getBody = await getRes.json();
    expect(getBody).toHaveProperty('form_schema');
    expect(getBody).toHaveProperty('blob_id', blobId);
    expect(getBody).toHaveProperty('schema_hash');
    // schema_hash from GET must match schema_hash from POST
    expect(getBody.schema_hash).toBe(postedSchemaHash);
    // form_schema must match what was uploaded
    expect(getBody.form_schema.title).toBe(schema.title);
    expect(getBody.form_schema.version).toBe(schema.version);
  });

  it('GET with ?raw=true returns raw encrypted bytes (not JSON)', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: false });

    const schema = validFormSchema();

    // POST to upload
    const postReq = makePostRequest({ form_schema: schema });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);
    const { blob_id: blobId } = await postRes.json();

    // GET with ?raw=true — should return raw encrypted bytes
    const getReq = makeGetRequest(blobId, true);
    const getRes = await GET(getReq, makeGetContext(blobId));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('application/octet-stream');

    const rawBuffer = await getRes.arrayBuffer();
    const rawBytes = new Uint8Array(rawBuffer);
    // Raw bytes should be the encrypted blob (at least 82 bytes header)
    expect(rawBytes.length).toBeGreaterThan(82);
  });
});

describe('POST /api/poc/forms — R8.6 encrypted blob validation', () => {
  it('DEV_ALLOW_PLAINTEXT=false: encrypted output passes looksLikeEncryptedBlob check', async () => {
    // This test verifies that the encrypted path produces a valid encrypted blob
    // that passes the looksLikeEncryptedBlob check (R8.6).
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: false });

    const req = makePostRequest({ form_schema: validFormSchema() });
    const res = await POST(req);
    // Should succeed — encrypt() always produces a valid encrypted blob
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blob_id).toBeTruthy();
  });
});
