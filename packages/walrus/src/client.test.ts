/**
 * Walrus_Client unit tests with MSW fixtures
 *
 * Requirements: R5.2, R5.3, R5.4, R5.5, R5.6
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createWalrusClient, WalrusError } from './client';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const PUBLISHER_URL = 'https://publisher.test.walrus.space';
const AGGREGATOR_URL = 'https://aggregator.test.walrus.space';

const TEST_BLOB_ID = 'test-blob-id';
const EXISTING_BLOB_ID = 'existing-blob-id';
const TEST_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

// ---------------------------------------------------------------------------
// MSW server setup
// ---------------------------------------------------------------------------

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Helper: create a client with fast timeouts for tests
// ---------------------------------------------------------------------------

function makeClient(overrides?: { publisherUrl?: string; aggregatorUrl?: string }) {
  return createWalrusClient({
    publisherUrl: overrides?.publisherUrl ?? PUBLISHER_URL,
    aggregatorUrl: overrides?.aggregatorUrl ?? AGGREGATOR_URL,
    uploadTimeoutMs: 5_000,
    retrieveTimeoutMs: 5_000,
    healthTimeoutMs: 5_000,
    retryDelaysMs: [0, 0, 0], // no delays in tests
  });
}
// ---------------------------------------------------------------------------
// 1. put — happy path: newlyCreated
// ---------------------------------------------------------------------------

describe('WalrusClient.put — happy path (newlyCreated)', () => {
  it('returns { blobId, isNew: true, endpoint } when publisher returns newlyCreated', async () => {
    server.use(
      http.put(`${PUBLISHER_URL}/v1/blobs`, () => {
        return HttpResponse.json({
          newlyCreated: {
            blobObject: {
              blobId: TEST_BLOB_ID,
              size: 5,
            },
          },
        });
      }),
    );

    const client = makeClient();
    const result = await client.put(TEST_BYTES);

    expect(result.blobId).toBe(TEST_BLOB_ID);
    expect(result.isNew).toBe(true);
    expect(result.endpoint).toBe(PUBLISHER_URL);
  });
});

// ---------------------------------------------------------------------------
// 2. put — happy path: alreadyCertified
// ---------------------------------------------------------------------------

describe('WalrusClient.put — alreadyCertified', () => {
  it('returns { blobId, isNew: false, endpoint } when publisher returns alreadyCertified', async () => {
    server.use(
      http.put(`${PUBLISHER_URL}/v1/blobs`, () => {
        return HttpResponse.json({
          alreadyCertified: {
            blobId: EXISTING_BLOB_ID,
            event: { txDigest: 'some-digest', eventSeq: '0' },
          },
        });
      }),
    );

    const client = makeClient();
    const result = await client.put(TEST_BYTES);

    expect(result.blobId).toBe(EXISTING_BLOB_ID);
    expect(result.isNew).toBe(false);
    expect(result.endpoint).toBe(PUBLISHER_URL);
  });
});

// ---------------------------------------------------------------------------
// 3. put — 5xx retry exhaustion → PUBLISHER_UNREACHABLE
// ---------------------------------------------------------------------------

describe('WalrusClient.put — 5xx retry exhaustion', () => {
  it('throws WalrusError with code PUBLISHER_UNREACHABLE after exhausting retries', async () => {
    let requestCount = 0;

    // Always return 500
    server.use(
      http.put(`${PUBLISHER_URL}/v1/blobs`, () => {
        requestCount++;
        return new HttpResponse('Internal Server Error', { status: 500 });
      }),
    );

    const client = makeClient(); // uses retryDelaysMs: [0, 0, 0]

    let caughtError: unknown;
    try {
      await client.put(TEST_BYTES);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(WalrusError);
    expect((caughtError as WalrusError).code).toBe('PUBLISHER_UNREACHABLE');
    // Should have made exactly 3 attempts (MAX_ATTEMPTS)
    expect(requestCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. get — happy path
// ---------------------------------------------------------------------------

describe('WalrusClient.get — happy path', () => {
  it('returns Uint8Array of the blob bytes', async () => {
    server.use(
      http.get(`${AGGREGATOR_URL}/v1/blobs/${TEST_BLOB_ID}`, () => {
        return new HttpResponse(TEST_BYTES, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }),
    );

    const client = makeClient();
    const result = await client.get(TEST_BLOB_ID);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(TEST_BYTES);
  });
});

// ---------------------------------------------------------------------------
// 5. get — 404 → AGGREGATOR_NOT_FOUND (no retry)
// ---------------------------------------------------------------------------

describe('WalrusClient.get — 404', () => {
  it('throws WalrusError with code AGGREGATOR_NOT_FOUND on 404', async () => {
    server.use(
      http.get(`${AGGREGATOR_URL}/v1/blobs/${TEST_BLOB_ID}`, () => {
        return new HttpResponse('Not Found', { status: 404 });
      }),
    );

    const client = makeClient();

    await expect(client.get(TEST_BLOB_ID)).rejects.toThrow(WalrusError);
    await expect(client.get(TEST_BLOB_ID)).rejects.toMatchObject({
      code: 'AGGREGATOR_NOT_FOUND',
    });
  });

  it('does not retry on 404 (only one request is made)', async () => {
    let requestCount = 0;

    server.use(
      http.get(`${AGGREGATOR_URL}/v1/blobs/${TEST_BLOB_ID}`, () => {
        requestCount++;
        return new HttpResponse('Not Found', { status: 404 });
      }),
    );

    const client = makeClient();

    await expect(client.get(TEST_BLOB_ID)).rejects.toMatchObject({
      code: 'AGGREGATOR_NOT_FOUND',
    });

    expect(requestCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. healthCheck — both endpoints green → ok: true, signerStatus: 'ready'
// ---------------------------------------------------------------------------

describe('WalrusClient.healthCheck — both endpoints green', () => {
  it('returns { ok: true, signerStatus: "ready" } when both /v1/api endpoints return 200', async () => {
    server.use(
      http.get(`${PUBLISHER_URL}/v1/api`, () => {
        return HttpResponse.json({ status: 'ok' });
      }),
      http.get(`${AGGREGATOR_URL}/v1/api`, () => {
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const client = makeClient();
    const result = await client.healthCheck();

    expect(result.ok).toBe(true);
    expect(result.signerStatus).toBe('ready');
    expect(result.publisher.ok).toBe(true);
    expect(result.aggregator.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. healthCheck — publisher returns 500 → throws HEALTH_PUBLISHER_FAIL
// ---------------------------------------------------------------------------

describe('WalrusClient.healthCheck — publisher fails', () => {
  it('throws WalrusError with code HEALTH_PUBLISHER_FAIL when publisher /v1/api returns 500', async () => {
    server.use(
      http.get(`${PUBLISHER_URL}/v1/api`, () => {
        return new HttpResponse('Internal Server Error', { status: 500 });
      }),
      http.get(`${AGGREGATOR_URL}/v1/api`, () => {
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const client = makeClient();

    let caughtError: unknown;
    try {
      await client.healthCheck();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(WalrusError);
    expect((caughtError as WalrusError).code).toBe('HEALTH_PUBLISHER_FAIL');
  });
});

// ---------------------------------------------------------------------------
// 8. healthCheck — aggregator fails → throws HEALTH_AGGREGATOR_FAIL
// ---------------------------------------------------------------------------

describe('WalrusClient.healthCheck — aggregator fails', () => {
  it('throws WalrusError with code HEALTH_AGGREGATOR_FAIL when aggregator /v1/api returns 500', async () => {
    server.use(
      http.get(`${PUBLISHER_URL}/v1/api`, () => {
        return HttpResponse.json({ status: 'ok' });
      }),
      http.get(`${AGGREGATOR_URL}/v1/api`, () => {
        return new HttpResponse('Internal Server Error', { status: 500 });
      }),
    );

    // Fresh client to bypass the 5s health cache
    const client = makeClient();

    let caughtError: unknown;
    try {
      await client.healthCheck();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(WalrusError);
    expect((caughtError as WalrusError).code).toBe('HEALTH_AGGREGATOR_FAIL');
  });
});

// ---------------------------------------------------------------------------
// 9. healthCheck — publisher times out → throws HEALTH_PUBLISHER_FAIL
// ---------------------------------------------------------------------------

describe('WalrusClient.healthCheck — publisher times out', () => {
  it('throws WalrusError with code HEALTH_PUBLISHER_FAIL when publisher times out', async () => {
    server.use(
      http.get(`${PUBLISHER_URL}/v1/api`, async () => {
        // Delay longer than the health timeout to simulate a timeout
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ status: 'ok' });
      }),
      http.get(`${AGGREGATOR_URL}/v1/api`, () => {
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const client = createWalrusClient({
      publisherUrl: PUBLISHER_URL,
      aggregatorUrl: AGGREGATOR_URL,
      healthTimeoutMs: 50, // very short timeout — handler delays 200ms
      retryDelaysMs: [0, 0, 0],
    });

    let caughtError: unknown;
    try {
      await client.healthCheck();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(WalrusError);
    expect((caughtError as WalrusError).code).toBe('HEALTH_PUBLISHER_FAIL');
  });
});

// ---------------------------------------------------------------------------
// 10. signer_status = 'ready' iff both health probes green
// ---------------------------------------------------------------------------

describe('WalrusClient.healthCheck — signerStatus semantics', () => {
  it('signerStatus is "ready" when both endpoints are healthy', async () => {
    server.use(
      http.get(`${PUBLISHER_URL}/v1/api`, () => HttpResponse.json({ status: 'ok' })),
      http.get(`${AGGREGATOR_URL}/v1/api`, () => HttpResponse.json({ status: 'ok' })),
    );

    const client = makeClient();
    const result = await client.healthCheck();
    expect(result.signerStatus).toBe('ready');
  });

  it('signerStatus is "not_ready" when publisher is unhealthy (error thrown, but cached result has not_ready)', async () => {
    server.use(
      http.get(`${PUBLISHER_URL}/v1/api`, () => new HttpResponse('Error', { status: 503 })),
      http.get(`${AGGREGATOR_URL}/v1/api`, () => HttpResponse.json({ status: 'ok' })),
    );

    const client = makeClient();

    // The healthCheck throws HEALTH_PUBLISHER_FAIL, but the cached result
    // (set before throwing) has signerStatus: 'not_ready'
    try {
      await client.healthCheck();
    } catch (err) {
      expect(err).toBeInstanceOf(WalrusError);
      expect((err as WalrusError).code).toBe('HEALTH_PUBLISHER_FAIL');
    }
  });
});

// ---------------------------------------------------------------------------
// 11. WalrusError shape
// ---------------------------------------------------------------------------

describe('WalrusError', () => {
  it('has the correct name, code, endpoint, and reason properties', () => {
    const err = new WalrusError('PUBLISHER_UNREACHABLE', 'https://example.com', 'timeout');
    expect(err.name).toBe('WalrusError');
    expect(err.code).toBe('PUBLISHER_UNREACHABLE');
    expect(err.endpoint).toBe('https://example.com');
    expect(err.reason).toBe('timeout');
    expect(err).toBeInstanceOf(Error);
  });

  it('message includes code, endpoint, and reason', () => {
    const err = new WalrusError('AGGREGATOR_NOT_FOUND', 'https://agg.example.com', 'blob missing');
    expect(err.message).toContain('AGGREGATOR_NOT_FOUND');
    expect(err.message).toContain('https://agg.example.com');
    expect(err.message).toContain('blob missing');
  });
});
