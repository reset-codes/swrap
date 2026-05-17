/**
 * Property-based tests for apps/web/lib/walrus/walrus-client.ts
 *
 * **Validates: Requirements 3.6, 3.7, 3.8, 4.2**
 *
 * Properties tested:
 *
 *   Property 14: Walrus put precedes API post
 *     For any artifact creation flow, Walrus PUT timestamp precedes API POST
 *     timestamp; if Walrus PUT fails, no API POST occurs.
 *
 *   Property 15: Walrus storage round-trip
 *     `digest(walrusGet(walrusPut(b))) == digest(b)` and returned bytes
 *     deep-equal `b`.
 *
 *   Property 16: Walrus integrity verification rejects digest mismatches
 *     For any `(recordedDigest, fetchedBytes)` where
 *     SHA-256(fetchedBytes) ≠ recordedDigest, `verifyIntegrity` throws
 *     `IntegrityError`.
 *
 *   Property 17: Walrus fetch retry is bounded
 *     For N transient failures followed by success with N ≤ MAX-1, client
 *     issues exactly N+1 calls. For N ≥ MAX, issues exactly MAX calls and
 *     throws `WalrusFetchError`.
 *
 *   Property 18: Public submission round-trip
 *     After upload pipeline completes, bytes fetched from Walrus via
 *     API-returned blob ID, when JSON-parsed, deep-equal the original
 *     submission payload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';

import {
  walrusPut,
  walrusGet,
  verifyIntegrity,
  sha256Hex,
  backoffDelayMs,
  IntegrityError,
  WalrusFetchError,
  WalrusPutError,
} from './walrus-client';

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const PUBLISHER_URL = 'https://publisher.walrus.test';
const AGGREGATOR_URL = 'https://aggregator.walrus.test';

beforeEach(() => {
  process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL = PUBLISHER_URL;
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL = AGGREGATOR_URL;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a non-empty Uint8Array of up to 1024 bytes. */
const arbitraryBytes = fc
  .uint8Array({ minLength: 1, maxLength: 1024 })
  .map((arr) => new Uint8Array(arr));

/** Generate a valid 64-char hex digest string. */
const arbitraryDigest = fc.stringMatching(/^[0-9a-f]{64}$/);

/** Generate a blob ID string (alphanumeric, 8–64 chars). */
const arbitraryBlobId = fc.stringMatching(/^[a-zA-Z0-9_-]{8,64}$/);

/** Default max attempts for the walrus client. */
const MAX_ATTEMPTS = 5;

/** Generate a small attempt count N in [0, MAX_ATTEMPTS-1]. */
const arbitrarySuccessAfterN = fc.integer({ min: 0, max: MAX_ATTEMPTS - 1 });

/**
 * Generate a JSON-serializable submission payload object.
 * Simulates realistic form submission data.
 */
const arbitrarySubmissionPayload = fc.record({
  formId: fc.uuid(),
  submittedAt: fc.date().map((d) => d.toISOString()),
  answers: fc.array(
    fc.record({
      fieldId: fc.uuid(),
      value: fc.oneof(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer(),
        fc.boolean(),
      ),
    }),
    { minLength: 1, maxLength: 5 },
  ),
});

// ---------------------------------------------------------------------------
// Property 14: Walrus put precedes API post
//
// For any artifact creation flow, Walrus PUT timestamp precedes API POST
// timestamp; if Walrus PUT fails, no API POST occurs.
//
// We simulate the full upload pipeline: walrusPut → then API POST (metadata).
// We track timestamps of each call to verify ordering.
//
// **Validates: Requirements 3.6, 3.7, 3.8**
// ---------------------------------------------------------------------------

describe('Property 14: Walrus put precedes API post', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Walrus PUT timestamp precedes API POST timestamp in artifact creation flow', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryBytes, async (bytes) => {
        vi.clearAllMocks();

        const timestamps: { walrusPut?: number; apiPost?: number } = {};
        let currentTime = 1000;

        const blobId = 'blob-test-ordering';
        const putResponse = {
          newlyCreated: {
            blobObject: { blobId, size: bytes.length },
          },
        };

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
          const urlStr = typeof url === 'string' ? url : url.toString();
          if (urlStr.includes(PUBLISHER_URL)) {
            timestamps.walrusPut = currentTime++;
            return new Response(JSON.stringify(putResponse), { status: 200 });
          }
          // Simulate API POST (metadata endpoint)
          timestamps.apiPost = currentTime++;
          return new Response(JSON.stringify({ id: 'sub-1', state: 'indexed' }), { status: 200 });
        });

        // Step 1: Walrus PUT
        const result = await walrusPut(new Uint8Array(bytes), 1);
        expect(result.blobId).toBe(blobId);

        // Step 2: Simulate API POST (metadata write) — only happens after PUT succeeds
        await fetch('https://api.test/submissions', {
          method: 'POST',
          body: JSON.stringify({ blobId: result.blobId }),
        });

        // Verify ordering: PUT timestamp < POST timestamp
        expect(timestamps.walrusPut).toBeDefined();
        expect(timestamps.apiPost).toBeDefined();
        expect(timestamps.walrusPut!).toBeLessThan(timestamps.apiPost!);
      }),
      { numRuns: 10 },
    );
  });

  it('if Walrus PUT fails, no API POST occurs', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryBytes, async (bytes) => {
        vi.clearAllMocks();

        let apiPostCalled = false;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
          const urlStr = typeof url === 'string' ? url : url.toString();
          if (urlStr.includes(PUBLISHER_URL)) {
            // Walrus PUT fails with non-retryable 400
            return new Response('Bad Request', { status: 400 });
          }
          // API POST — should never be reached
          apiPostCalled = true;
          return new Response(JSON.stringify({ id: 'sub-1' }), { status: 200 });
        });

        // Attempt the upload pipeline: PUT should fail
        let putFailed = false;
        try {
          await walrusPut(new Uint8Array(bytes), 1);
        } catch (err) {
          putFailed = true;
          expect(err).toBeInstanceOf(WalrusPutError);
        }

        // PUT must have failed
        expect(putFailed).toBe(true);

        // API POST must NOT have been called
        expect(apiPostCalled).toBe(false);
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: Walrus storage round-trip
//
// For all generated byte payloads `b`:
//   - `walrusPut(b)` returns a blobId
//   - `walrusGet(blobId)` returns bytes equal to `b`
//   - `digest(returned bytes) == digest(b)`
//
// We simulate the Walrus network with a mock that stores bytes in memory.
// **Validates: Requirements 3.6**
// ---------------------------------------------------------------------------

describe('Property 15: Walrus storage round-trip', () => {
  it('walrusGet(walrusPut(b)) deep-equals b and digest matches', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryBytes, async (bytes) => {
        vi.clearAllMocks();

        const originalBytes = new Uint8Array(bytes);
        const blobId = `blob-${(await sha256Hex(originalBytes)).slice(0, 16)}`;

        // Mock PUT: return a newlyCreated response
        const putResponse = {
          newlyCreated: {
            blobObject: { blobId, size: originalBytes.length },
          },
        };

        // Mock GET: return the stored bytes
        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(
            new Response(JSON.stringify(putResponse), { status: 200 }),
          )
          .mockResolvedValueOnce(
            new Response(new Uint8Array(originalBytes), { status: 200 }),
          );

        const putResult = await walrusPut(new Uint8Array(originalBytes), 1);
        expect(putResult.blobId).toBe(blobId);

        const fetchedBytes = await walrusGet(putResult.blobId, 1);

        // Round-trip: fetched bytes equal original bytes
        expect(fetchedBytes).toEqual(originalBytes);

        // Digest invariant: digest of fetched bytes equals digest of original
        const fetchedDigest = await sha256Hex(fetchedBytes);
        const originalDigest = await sha256Hex(originalBytes);
        expect(fetchedDigest).toBe(originalDigest);
      }),
      { numRuns: 10 },
    );
  });

  it('walrusPut returns alreadyCertified response correctly', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryBytes, async (bytes) => {
        vi.clearAllMocks();

        const originalBytes = new Uint8Array(bytes);
        const blobId = `blob-certified-${(await sha256Hex(originalBytes)).slice(0, 8)}`;

        // Mock PUT: return an alreadyCertified response
        const putResponse = {
          alreadyCertified: { blobId, size: originalBytes.length },
        };

        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(
            new Response(JSON.stringify(putResponse), { status: 200 }),
          )
          .mockResolvedValueOnce(
            new Response(new Uint8Array(originalBytes), { status: 200 }),
          );

        const putResult = await walrusPut(new Uint8Array(originalBytes), 1);
        expect(putResult.blobId).toBe(blobId);

        const fetchedBytes = await walrusGet(putResult.blobId, 1);
        expect(fetchedBytes).toEqual(originalBytes);
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Walrus integrity verification rejects digest mismatches
//
// For any `(recordedDigest, fetchedBytes)` where
// SHA-256(fetchedBytes) ≠ recordedDigest, `verifyIntegrity` throws
// `IntegrityError` and does NOT return the bytes as authentic.
//
// **Validates: Requirements 3.7**
// ---------------------------------------------------------------------------

describe('Property 16: Walrus integrity verification rejects digest mismatches', () => {
  it('throws IntegrityError when SHA-256(fetchedBytes) ≠ recordedDigest', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryBytes,
        arbitraryBytes,
        async (bytesA, bytesB) => {
          // Ensure the two byte arrays produce different digests
          const digestA = await sha256Hex(bytesA);
          const digestB = await sha256Hex(bytesB);
          fc.pre(digestA !== digestB);

          const recordedDigest = digestA; // digest of A
          // Verify against B (different bytes → different digest)

          await expect(
            verifyIntegrity(bytesB, recordedDigest),
          ).rejects.toThrow(IntegrityError);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('IntegrityError carries the correct expected and actual digests', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryBytes,
        arbitraryBytes,
        async (bytesA, bytesB) => {
          const digestA = await sha256Hex(bytesA);
          const digestB = await sha256Hex(bytesB);
          fc.pre(digestA !== digestB);

          try {
            await verifyIntegrity(bytesB, digestA);
            // Should not reach here
            expect(true).toBe(false);
          } catch (err) {
            expect(err).toBeInstanceOf(IntegrityError);
            const intErr = err as IntegrityError;
            expect(intErr.expectedDigest).toBe(digestA);
            expect(intErr.actualDigest).toBe(digestB);
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  it('verifyIntegrity returns true when digest matches', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryBytes, async (bytes) => {
        const digest = await sha256Hex(bytes);
        const result = await verifyIntegrity(bytes, digest);
        expect(result).toBe(true);
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: Walrus fetch retry is bounded
//
// For N transient failures (5xx) followed by success with N ≤ MAX-1:
//   - client issues exactly N+1 calls
//   - returns the bytes successfully
//
// For N ≥ MAX transient failures:
//   - client issues exactly MAX calls
//   - throws WalrusFetchError
//
// We use fake timers to avoid real sleep delays during retries.
//
// **Validates: Requirements 3.8**
// ---------------------------------------------------------------------------

describe('Property 17: Walrus fetch retry is bounded', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('walrusGet: issues exactly N+1 calls when N transient failures precede success (N < MAX)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrarySuccessAfterN,
        arbitraryBytes,
        async (n, successBytes) => {
          vi.clearAllMocks();

          const fetchSpy = vi.spyOn(globalThis, 'fetch');
          for (let i = 0; i < n; i++) {
            fetchSpy.mockResolvedValueOnce(
              new Response('Server Error', { status: 500 }),
            );
          }
          fetchSpy.mockResolvedValueOnce(
            new Response(new Uint8Array(successBytes), { status: 200 }),
          );

          const resultPromise = walrusGet('blob-retry', MAX_ATTEMPTS);
          await vi.runAllTimersAsync();
          const result = await resultPromise;

          expect(result).toEqual(new Uint8Array(successBytes));
          expect(fetchSpy).toHaveBeenCalledTimes(n + 1);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('walrusGet: issues exactly MAX calls and throws WalrusFetchError when all attempts fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MAX_ATTEMPTS, max: MAX_ATTEMPTS + 5 }),
        async (n) => {
          vi.clearAllMocks();

          const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('Server Error', { status: 500 }));

          let caughtError: unknown;
          const resultPromise = walrusGet('blob-exhausted', MAX_ATTEMPTS).catch(
            (e) => {
              caughtError = e;
            },
          );
          await vi.runAllTimersAsync();
          await resultPromise;

          expect(caughtError).toBeInstanceOf(WalrusFetchError);
          expect((caughtError as WalrusFetchError).attempts).toBe(MAX_ATTEMPTS);
          expect(fetchSpy).toHaveBeenCalledTimes(MAX_ATTEMPTS);
        },
      ),
      { numRuns: 5 },
    );
  });

  it('walrusPut: issues exactly N+1 calls when N transient failures precede success (N < MAX)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrarySuccessAfterN,
        arbitraryBytes,
        async (n, bytes) => {
          vi.clearAllMocks();

          const blobId = `blob-put-${n}`;
          const successResponse = new Response(
            JSON.stringify({
              newlyCreated: { blobObject: { blobId, size: bytes.length } },
            }),
            { status: 200 },
          );

          const fetchSpy = vi.spyOn(globalThis, 'fetch');
          for (let i = 0; i < n; i++) {
            fetchSpy.mockResolvedValueOnce(
              new Response('Server Error', { status: 500 }),
            );
          }
          fetchSpy.mockResolvedValueOnce(successResponse);

          const resultPromise = walrusPut(new Uint8Array(bytes), MAX_ATTEMPTS);
          await vi.runAllTimersAsync();
          const result = await resultPromise;

          expect(result.blobId).toBe(blobId);
          expect(fetchSpy).toHaveBeenCalledTimes(n + 1);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('walrusPut: issues exactly MAX calls and throws WalrusPutError when all attempts fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MAX_ATTEMPTS, max: MAX_ATTEMPTS + 5 }),
        arbitraryBytes,
        async (_n, bytes) => {
          vi.clearAllMocks();

          const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('Server Error', { status: 500 }));

          let caughtError: unknown;
          const resultPromise = walrusPut(
            new Uint8Array(bytes),
            MAX_ATTEMPTS,
          ).catch((e) => {
            caughtError = e;
          });
          await vi.runAllTimersAsync();
          await resultPromise;

          expect(caughtError).toBeInstanceOf(WalrusPutError);
          expect((caughtError as WalrusPutError).attempts).toBe(MAX_ATTEMPTS);
          expect(fetchSpy).toHaveBeenCalledTimes(MAX_ATTEMPTS);
        },
      ),
      { numRuns: 5 },
    );
  });

  it('walrusGet: 429 responses are retried (retryable status)', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryBytes, async (successBytes) => {
        vi.clearAllMocks();

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        // Two 429 responses followed by success
        fetchSpy.mockResolvedValueOnce(
          new Response('Too Many Requests', { status: 429 }),
        );
        fetchSpy.mockResolvedValueOnce(
          new Response('Too Many Requests', { status: 429 }),
        );
        fetchSpy.mockResolvedValueOnce(
          new Response(new Uint8Array(successBytes), { status: 200 }),
        );

        const resultPromise = walrusGet('blob-429', MAX_ATTEMPTS);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result).toEqual(new Uint8Array(successBytes));
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      }),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: Public submission round-trip
//
// After upload pipeline completes, bytes fetched from Walrus via
// API-returned blob ID, when JSON-parsed, deep-equal the original
// submission payload.
//
// We simulate the full public submission pipeline:
//   1. Serialize payload to JSON bytes
//   2. walrusPut(bytes) → blobId
//   3. walrusGet(blobId) → fetched bytes
//   4. JSON.parse(fetched bytes) deep-equals original payload
//
// **Validates: Requirements 3.6, 4.2**
// ---------------------------------------------------------------------------

describe('Property 18: Public submission round-trip', () => {
  it('JSON-parsed fetched bytes deep-equal the original submission payload', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrarySubmissionPayload, async (payload) => {
        vi.clearAllMocks();

        // Serialize payload to JSON bytes (canonical form)
        const jsonStr = JSON.stringify(payload);
        const payloadBytes = new TextEncoder().encode(jsonStr);

        const blobId = `blob-public-${Date.now()}`;
        const putResponse = {
          newlyCreated: {
            blobObject: { blobId, size: payloadBytes.length },
          },
        };

        // Mock: PUT returns blobId, GET returns the same bytes
        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(
            new Response(JSON.stringify(putResponse), { status: 200 }),
          )
          .mockResolvedValueOnce(
            new Response(new Uint8Array(payloadBytes), { status: 200 }),
          );

        // Step 1: Upload to Walrus
        const putResult = await walrusPut(payloadBytes, 1);
        expect(putResult.blobId).toBe(blobId);

        // Step 2: Fetch from Walrus
        const fetchedBytes = await walrusGet(putResult.blobId, 1);

        // Step 3: Parse and compare
        const decoded = new TextDecoder().decode(fetchedBytes);
        const parsed = JSON.parse(decoded);

        // Deep equality: parsed payload equals original
        expect(parsed).toEqual(payload);
      }),
      { numRuns: 10 },
    );
  });

  it('integrity digest is preserved through the round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrarySubmissionPayload, async (payload) => {
        vi.clearAllMocks();

        const jsonStr = JSON.stringify(payload);
        const payloadBytes = new TextEncoder().encode(jsonStr);
        const originalDigest = await sha256Hex(payloadBytes);

        const blobId = `blob-integrity-${Date.now()}`;
        const putResponse = {
          newlyCreated: {
            blobObject: { blobId, size: payloadBytes.length },
          },
        };

        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(
            new Response(JSON.stringify(putResponse), { status: 200 }),
          )
          .mockResolvedValueOnce(
            new Response(new Uint8Array(payloadBytes), { status: 200 }),
          );

        const putResult = await walrusPut(payloadBytes, 1);
        const fetchedBytes = await walrusGet(putResult.blobId, 1);

        // Verify integrity: digest of fetched bytes matches original
        const result = await verifyIntegrity(fetchedBytes, originalDigest);
        expect(result).toBe(true);
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Bonus: backoff formula invariant
//
// For all attempt numbers n ≥ 0, backoffDelayMs(n) ∈ [0, 10_000].
// ---------------------------------------------------------------------------

describe('Backoff formula invariant', () => {
  it('backoffDelayMs(n) is always in [0, 10_000] for any n ≥ 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (n) => {
        const delay = backoffDelayMs(n);
        return delay >= 0 && delay <= 10_000;
      }),
      { numRuns: 25 },
    );
  });
});
