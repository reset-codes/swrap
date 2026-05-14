/**
 * Walrus_Client property-based tests
 *
 * **Validates: Requirements R6.4, R6.5, R17.4**
 *
 * Property 4: retrieve(upload(b)) == b
 * For any byte array b, uploading it to Walrus and then retrieving it by the
 * returned blobId must produce byte-identical output.
 *
 * Two test modes:
 *  1. Default (always runs): MSW in-memory publisher/aggregator pair.
 *  2. Testnet integration (opt-in): guarded by USE_WALRUS_TESTNET=true,
 *     numRuns: 5, skipped otherwise.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import * as fc from 'fast-check';
import { createWalrusClient } from './client';

// ---------------------------------------------------------------------------
// In-memory blob store (MSW publisher/aggregator pair)
// ---------------------------------------------------------------------------

const PUBLISHER_URL = 'https://publisher.pbt.walrus.test';
const AGGREGATOR_URL = 'https://aggregator.pbt.walrus.test';

/** In-memory store: blobId → bytes */
const blobStore = new Map<string, Uint8Array>();

/** Simple deterministic blobId generator based on content hash. */
function generateBlobId(bytes: Uint8Array): string {
  // Use a simple checksum-based ID so identical content gets the same ID
  // (mirrors the alreadyCertified path in real Walrus).
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
  // PUT /v1/blobs — store bytes, return newlyCreated response
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

  // GET /v1/blobs/:blobId — retrieve bytes by blobId
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
// MSW-backed client (no real network, no delays)
// ---------------------------------------------------------------------------

function makeMswClient() {
  return createWalrusClient({
    publisherUrl: PUBLISHER_URL,
    aggregatorUrl: AGGREGATOR_URL,
    uploadTimeoutMs: 5_000,
    retrieveTimeoutMs: 5_000,
    healthTimeoutMs: 5_000,
    retryDelaysMs: [0, 0, 0],
  });
}

// ---------------------------------------------------------------------------
// Property 4: retrieve(upload(b)) == b  (MSW in-memory, always runs)
// ---------------------------------------------------------------------------

describe('WalrusClient PBT — Property 4: retrieve(upload(b)) == b (MSW)', () => {
  /**
   * **Validates: Requirements R6.4, R6.5, R17.4**
   *
   * For any non-empty byte array b (1–65536 bytes), uploading via walrus.put
   * and then retrieving via walrus.get(blobId) must return byte-identical data.
   */
  it('Property 4: walrus.get(walrus.put(bytes).blobId) deep-equals bytes for all inputs', async () => {
    const walrus = makeMswClient();

    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 65536 }),
        async (bytes) => {
          const { blobId } = await walrus.put(bytes);
          const retrieved = await walrus.get(blobId);
          expect(retrieved).toEqual(bytes);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Testnet integration (opt-in: USE_WALRUS_TESTNET=true)
// ---------------------------------------------------------------------------

const runTestnet = process.env.USE_WALRUS_TESTNET === 'true';

describe('WalrusClient PBT — Property 4: retrieve(upload(b)) == b (testnet integration)', () => {
  it.skipIf(!runTestnet)(
    'testnet round-trip: walrus.get(walrus.put(bytes).blobId) deep-equals bytes',
    async () => {
      // Use real testnet endpoints from env or fall back to defaults.
      const publisherUrl =
        process.env.WALRUS_PUBLISHER_URL ?? 'https://publisher.walrus-testnet.walrus.space';
      const aggregatorUrl =
        process.env.WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space';

      const walrus = createWalrusClient({
        publisherUrl,
        aggregatorUrl,
        uploadTimeoutMs: 60_000,
        retrieveTimeoutMs: 60_000,
        healthTimeoutMs: 15_000,
        retryDelaysMs: [1_000, 2_000, 4_000],
      });

      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 1, maxLength: 65536 }),
          async (bytes) => {
            const { blobId } = await walrus.put(bytes);
            const retrieved = await walrus.get(blobId);
            expect(retrieved).toEqual(bytes);
          },
        ),
        { numRuns: 5 },
      );
    },
  );
});
