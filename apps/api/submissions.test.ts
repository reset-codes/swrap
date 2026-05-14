/**
 * Submissions handler integration tests for apps/api/submissions.ts
 *
 * Tests the POST and GET handlers directly (no HTTP server).
 * MSW mocks the Walrus publisher/aggregator endpoints.
 * vi.mock controls the @poc/shared loadPocEnv return value.
 * vi.mock controls the @poc/sui detectLocalSigner return value.
 *
 * Requirements: R12.2, R12.6
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NextRequest } from 'next/server';
import { hkdfSync } from 'node:crypto';

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
// Mock @poc/shared so we can control env flags
// ---------------------------------------------------------------------------

const mockEnv = {
  DEV_BYPASS_STORAGE: true,
  DEV_LOCAL_SIGNER: true,
  DEV_ALLOW_PLAINTEXT: true,
  USE_WALRUS_TESTNET: false,
  USE_SUI_TESTNET: false,
  WALRUS_PUBLISHER_URL: 'https://publisher.submissions-test.walrus.test',
  WALRUS_AGGREGATOR_URL: 'https://aggregator.submissions-test.walrus.test',
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
import { POST, GET } from './submissions';
import { loadPocEnv } from '@poc/shared';
import { detectLocalSigner } from '@poc/sui';
import { encrypt } from '@poc/seal';
import { canonicalize } from '@poc/shared';
import type { FormSchema } from '@poc/shared';

// ---------------------------------------------------------------------------
// In-memory blob store (mirrors the pattern from forms.test.ts)
// ---------------------------------------------------------------------------

const PUBLISHER_URL = 'https://publisher.submissions-test.walrus.test';
const AGGREGATOR_URL = 'https://aggregator.submissions-test.walrus.test';

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
  return new NextRequest('http://localhost/api/poc/submissions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGetRequest(blobId: string): NextRequest {
  return new NextRequest(`http://localhost/api/poc/submissions/${blobId}`, {
    method: 'GET',
  });
}

function makeGetContext(blobId: string) {
  return { params: Promise.resolve({ blob_id: blobId }) };
}

/** A valid FormSchema that passes FormSchemaSchema.safeParse() */
function validFormSchema(): FormSchema {
  return {
    title: 'Test Submission Form',
    fields: [
      { type: 'text' as const, label: 'Name', required: true },
      { type: 'email' as const, label: 'Email', required: false },
    ],
    version: 1 as const,
    created_at: '2024-01-01T00:00:00.000Z',
  };
}

/**
 * Pre-encrypt a FormSchema and store it in the MSW blob store.
 * Returns the blob_id that can be used as form_blob_id in submissions.
 */
async function uploadEncryptedFormBlob(schema: FormSchema): Promise<string> {
  const plainBytes = canonicalize(schema);
  const encryptedBytes = await encrypt(plainBytes, testSigner, 'form');
  const blobId = generateBlobId(encryptedBytes);
  blobStore.set(blobId, encryptedBytes);
  return blobId;
}

// ---------------------------------------------------------------------------
// Test 1: POST with valid form_blob_id and valid answers → 200 with expected fields
// ---------------------------------------------------------------------------

describe('POST /api/poc/submissions — valid submission', () => {
  it('returns HTTP 200 with { blob_id, form_blob_id, schema_hash, submitted_at } for valid answers', async () => {
    const schema = validFormSchema();
    const formBlobId = await uploadEncryptedFormBlob(schema);

    const req = makePostRequest({
      form_blob_id: formBlobId,
      answers: { Name: 'Alice', Email: 'alice@example.com' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('blob_id');
    expect(typeof body.blob_id).toBe('string');
    expect(body.blob_id.length).toBeGreaterThan(0);

    expect(body).toHaveProperty('form_blob_id', formBlobId);

    expect(body).toHaveProperty('schema_hash');
    expect(typeof body.schema_hash).toBe('string');
    expect(body.schema_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(body).toHaveProperty('submitted_at');
    expect(typeof body.submitted_at).toBe('string');
    // submitted_at should be a valid ISO 8601 datetime
    expect(() => new Date(body.submitted_at)).not.toThrow();
    expect(new Date(body.submitted_at).toISOString()).toBe(body.submitted_at);
  });
});

// ---------------------------------------------------------------------------
// Test 2: POST with missing required field → 400 INVALID_SUBMISSION
// ---------------------------------------------------------------------------

describe('POST /api/poc/submissions — missing required field', () => {
  it('returns HTTP 400 with code INVALID_SUBMISSION when required field is missing', async () => {
    const schema = validFormSchema(); // has required field "Name"
    const formBlobId = await uploadEncryptedFormBlob(schema);

    // Omit the required "Name" field
    const req = makePostRequest({
      form_blob_id: formBlobId,
      answers: { Email: 'alice@example.com' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('INVALID_SUBMISSION');
    expect(body.error.stage).toBe('validate');
    expect(body.error).toHaveProperty('details');
    expect(body.error.details).toHaveProperty('issues');
    expect(Array.isArray(body.error.details.issues)).toBe(true);
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3: POST with missing form_blob_id → 400 MISSING_FORM_BLOB_ID
// ---------------------------------------------------------------------------

describe('POST /api/poc/submissions — missing form_blob_id', () => {
  it('returns HTTP 400 with code MISSING_FORM_BLOB_ID when form_blob_id is absent', async () => {
    const req = makePostRequest({
      answers: { Name: 'Alice' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('MISSING_FORM_BLOB_ID');
    expect(body.error.stage).toBe('validate');
  });

  it('returns HTTP 400 with code MISSING_FORM_BLOB_ID when form_blob_id is empty string', async () => {
    const req = makePostRequest({
      form_blob_id: '',
      answers: { Name: 'Alice' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('MISSING_FORM_BLOB_ID');
  });
});

// ---------------------------------------------------------------------------
// Test 4: GET with valid blob_id → 200 with parsed submission
// ---------------------------------------------------------------------------

describe('GET /api/poc/submissions/[blob_id] — valid blob_id', () => {
  it('returns HTTP 200 with parsed Submission for a valid submission blob', async () => {
    // Step 1: Upload a form blob
    const schema = validFormSchema();
    const formBlobId = await uploadEncryptedFormBlob(schema);

    // Step 2: POST a valid submission
    const postReq = makePostRequest({
      form_blob_id: formBlobId,
      answers: { Name: 'Bob', Email: 'bob@example.com' },
    });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);

    const postBody = await postRes.json();
    const submissionBlobId: string = postBody.blob_id;
    expect(typeof submissionBlobId).toBe('string');

    // Step 3: GET the submission blob
    const getReq = makeGetRequest(submissionBlobId);
    const getRes = await GET(getReq, makeGetContext(submissionBlobId));
    expect(getRes.status).toBe(200);

    const getBody = await getRes.json();
    // Should return a parsed Submission object
    expect(getBody).toHaveProperty('form_blob_id', formBlobId);
    expect(getBody).toHaveProperty('form_schema_hash');
    expect(getBody.form_schema_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(getBody).toHaveProperty('answers');
    expect(getBody.answers).toMatchObject({ Name: 'Bob', Email: 'bob@example.com' });
    expect(getBody).toHaveProperty('submitted_at');
    expect(typeof getBody.submitted_at).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Test 5: GET with non-existent blob_id → returns error
// ---------------------------------------------------------------------------

describe('GET /api/poc/submissions/[blob_id] — non-existent blob_id', () => {
  it('returns an error response when blob_id does not exist in the store', async () => {
    const nonExistentBlobId = 'blob-00000000-nonexistent';

    const getReq = makeGetRequest(nonExistentBlobId);
    const getRes = await GET(getReq, makeGetContext(nonExistentBlobId));

    // Should return a non-200 error response
    expect(getRes.status).not.toBe(200);

    const body = await getRes.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
  });
});
