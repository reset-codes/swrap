/**
 * Plaintext upload integration tests for apps/api/forms.ts
 *
 * Tests the POST and GET handlers directly (no HTTP server).
 * MSW mocks the Walrus publisher/aggregator endpoints.
 * vi.mock controls the @poc/shared loadPocEnv return value.
 *
 * Requirements: R6.1, R6.4, R6.6
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NextRequest } from 'next/server';

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

// Import handlers AFTER mocking so they pick up the mock
import { POST, GET } from './forms';
import { loadPocEnv } from '@poc/shared';

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

// ---------------------------------------------------------------------------
// Test 1: POST with DEV_ALLOW_PLAINTEXT=true and plaintext:true → 200 + blob_id
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

// ---------------------------------------------------------------------------
// Test 2: POST with DEV_ALLOW_PLAINTEXT=false → 400 + PLAINTEXT_DISABLED
// ---------------------------------------------------------------------------

describe('POST /api/poc/forms — DEV_ALLOW_PLAINTEXT=false', () => {
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

// ---------------------------------------------------------------------------
// Test 3: POST with DEV_ALLOW_PLAINTEXT=true but plaintext omitted → 400 + PLAINTEXT_DISABLED
// ---------------------------------------------------------------------------

describe('POST /api/poc/forms — DEV_ALLOW_PLAINTEXT=true, plaintext omitted', () => {
  it('returns HTTP 400 with code PLAINTEXT_DISABLED when plaintext field is absent', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: true });

    const req = makePostRequest({
      form_schema: { title: 'Test Form', fields: [] },
      // plaintext intentionally omitted
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('PLAINTEXT_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// Test 4: Upload → GET round-trip returns byte-identical bytes
// ---------------------------------------------------------------------------

describe('POST then GET /api/poc/forms — upload/retrieve round-trip', () => {
  it('GET with ?raw=true returns byte-identical bytes to what was uploaded', async () => {
    vi.mocked(loadPocEnv).mockReturnValue({ ...mockEnv, DEV_ALLOW_PLAINTEXT: true });

    const formSchema = { title: 'Round-trip Form', fields: [{ label: 'Name', type: 'text' }] };

    // Step 1: POST to upload
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

    // Step 3: Verify bytes are identical to what was serialized and uploaded
    const retrievedBuffer = await getRes.arrayBuffer();
    const retrievedBytes = new Uint8Array(retrievedBuffer);

    // The handler canonicalizes the form_schema before uploading.
    // Reproduce the same canonicalization to compare.
    const expectedJson = JSON.stringify(formSchema, (_, v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        );
      }
      return v;
    });
    const expectedBytes = new TextEncoder().encode(expectedJson);

    expect(retrievedBytes).toEqual(expectedBytes);
  });
});
