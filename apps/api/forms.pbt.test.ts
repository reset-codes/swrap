/**
 * Forms handler end-to-end pipeline property-based tests
 *
 * **Validates: Requirements R8.4, R17.5**
 *
 * Property 5: decrypt(retrieve(upload(encrypt(print(x))))) == print(x)
 *
 * For any valid FormSchema x, POSTing through the real apps/api/forms handler
 * (with MSW-backed Walrus) and then GETting back must return a form_schema
 * that deep-equals the original input.
 *
 * Requirements: R8.4, R17.5
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NextRequest } from 'next/server';
import { hkdfSync } from 'node:crypto';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Build a deterministic in-memory signer for tests (no filesystem access)
// ---------------------------------------------------------------------------

function buildTestSigner() {
  const secret = Buffer.from('deadbeef'.repeat(8), 'hex'); // 32 bytes
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
  DEV_ALLOW_PLAINTEXT: false,
  USE_WALRUS_TESTNET: false,
  USE_SUI_TESTNET: false,
  WALRUS_PUBLISHER_URL: 'https://publisher.forms-pbt.walrus.test',
  WALRUS_AGGREGATOR_URL: 'https://aggregator.forms-pbt.walrus.test',
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

// ---------------------------------------------------------------------------
// In-memory blob store (MSW publisher/aggregator pair)
// ---------------------------------------------------------------------------

const PUBLISHER_URL = 'https://publisher.forms-pbt.walrus.test';
const AGGREGATOR_URL = 'https://aggregator.forms-pbt.walrus.test';

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

function makeGetRequest(blobId: string): NextRequest {
  return new NextRequest(`http://localhost/api/poc/forms/${blobId}`, {
    method: 'GET',
  });
}

function makeGetContext(blobId: string) {
  return { params: Promise.resolve({ blob_id: blobId }) };
}

// ---------------------------------------------------------------------------
// FormSchema arbitrary
// ---------------------------------------------------------------------------

/**
 * Generates arbitrary valid FormSchema objects that pass FormSchemaSchema.safeParse().
 *
 * Constraints:
 * - title: printable ASCII (excluding backslash and double-quote for simplicity), 1–50 chars
 * - fields: 0–5 fields, each with a valid type and label
 * - version: always 1 (literal)
 * - created_at: valid ISO 8601 datetime string
 */
const formSchemaArb = fc.record({
  title: fc.stringMatching(/^[ !#-[\]-~]+$/, { maxLength: 50 }).filter((s) => s.length >= 1),
  fields: fc.array(
    fc.record({
      type: fc.constantFrom('text', 'textarea', 'email', 'number', 'select', 'checkbox'),
      label: fc.stringMatching(/^[ !#-[\]-~]+$/, { maxLength: 50 }).filter((s) => s.length >= 1),
    }),
    { minLength: 0, maxLength: 5 },
  ),
  version: fc.constant(1 as const),
  created_at: fc
    .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
    .filter((d) => !isNaN(d.getTime()))
    .map((d) => d.toISOString()),
});

// ---------------------------------------------------------------------------
// Property 5: decrypt(retrieve(upload(encrypt(print(x))))) == print(x)
// ---------------------------------------------------------------------------

describe('Forms handler PBT — Property 5: end-to-end pipeline round-trip', () => {
  /**
   * **Validates: Requirements R8.4, R17.5**
   *
   * For any valid FormSchema x:
   *   1. POST x through the encrypted path → get blob_id
   *   2. GET blob_id → decrypt → parse → form_schema
   *   3. Assert form_schema deep-equals x
   *
   * This exercises the full pipeline:
   *   print(x) → encrypt → walrus.put → walrus.get → decrypt → parse → form_schema
   */
  it('Property 5: POST(schema) then GET returns deep-equal form_schema for all valid FormSchema', async () => {
    await fc.assert(
      fc.asyncProperty(formSchemaArb, async (schema) => {
        // POST (encrypted path)
        const postReq = makePostRequest({ form_schema: schema });
        const postRes = await POST(postReq);
        expect(postRes.status).toBe(200);
        const { blob_id } = await postRes.json();

        // GET (decrypted path)
        const getReq = makeGetRequest(blob_id);
        const getRes = await GET(getReq, makeGetContext(blob_id));
        expect(getRes.status).toBe(200);
        const { form_schema: retrieved } = await getRes.json();

        // Deep equality: retrieved form_schema must match the original
        expect(retrieved).toEqual(schema);
      }),
      { numRuns: 20 },
    );
  });
});
