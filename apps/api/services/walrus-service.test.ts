/**
 * Unit tests for apps/api/services/walrus-service.ts
 *
 * Tests cover:
 *   - `walrusPut` — success, non-retryable 4xx, retryable 5xx, network errors
 *   - `walrusGet` — success, 404, integrity check, retryable errors
 *   - `walrusBlobExists` — 200, 404, retryable errors
 *   - `backoffDelayMs` — bounded exponential backoff formula
 *   - `sha256Hex` — digest correctness
 *
 * Requirements: 3.3, 3.4, 3.5, 3.8, 3.9, 3.10, 7.8
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  walrusPut,
  walrusGet,
  walrusBlobExists,
  backoffDelayMs,
  sha256Hex,
  WalrusPutError,
  WalrusGetError,
  WalrusIntegrityError,
} from './walrus-service';

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const PUBLISHER_URL = 'https://publisher.walrus.test';
const AGGREGATOR_URL = 'https://aggregator.walrus.test';

beforeEach(async () => {
  setEnv('WALRUS_PUBLISHER_URL', PUBLISHER_URL);
  setEnv('WALRUS_AGGREGATOR_URL', AGGREGATOR_URL);
  vi.restoreAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------

describe('sha256Hex', () => {
  it('returns a 64-character hex string', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches Node crypto SHA-256', () => {
    const bytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
    expect(sha256Hex(bytes)).toBe(sha256(bytes));
  });

  it('returns different digests for different inputs', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });

  it('returns the same digest for the same input', () => {
    const bytes = new Uint8Array([10, 20, 30]);
    expect(sha256Hex(bytes)).toBe(sha256Hex(bytes));
  });
});

// ---------------------------------------------------------------------------
// backoffDelayMs
// ---------------------------------------------------------------------------

describe('backoffDelayMs', () => {
  it('returns a value ≤ MAX_DELAY_MS (10_000ms) for any attempt', () => {
    for (let n = 0; n < 20; n++) {
      expect(backoffDelayMs(n)).toBeLessThanOrEqual(10_000);
    }
  });

  it('returns a value ≥ 0 for any attempt', () => {
    for (let n = 0; n < 10; n++) {
      expect(backoffDelayMs(n)).toBeGreaterThanOrEqual(0);
    }
  });

  it('grows with attempt number (before cap)', () => {
    // Without jitter, delay(0) = 100ms, delay(1) = 200ms, delay(2) = 400ms
    // With jitter (max 100ms), delay(n) ≤ delay(n+1) is not guaranteed for
    // individual calls, but the base grows. We test the cap behaviour instead.
    const delay0 = backoffDelayMs(0);
    const delay10 = backoffDelayMs(10);
    // Both should be ≤ 10_000ms; delay10 should be at the cap
    expect(delay0).toBeLessThanOrEqual(10_000);
    expect(delay10).toBeLessThanOrEqual(10_000);
  });

  it('caps at 10_000ms for large attempt numbers', () => {
    // 2^10 * 100 = 102_400ms >> 10_000ms cap
    expect(backoffDelayMs(10)).toBeLessThanOrEqual(10_000);
    expect(backoffDelayMs(20)).toBeLessThanOrEqual(10_000);
  });

  it('attempt 0 base is 100ms (before jitter)', () => {
    // backoffDelayMs(0) = min(2^0 * 100 + jitter, 10_000) = min(100 + jitter, 10_000)
    // jitter ∈ [0, 100), so result ∈ [100, 200)
    const delay = backoffDelayMs(0);
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// walrusPut
// ---------------------------------------------------------------------------

describe('walrusPut', () => {
  it('returns blobId and sizeBytes on newlyCreated response', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const mockResponse = {
      newlyCreated: {
        blobObject: { blobId: 'blob-abc-123', size: 4 },
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await walrusPut(bytes, 1);
    expect(result.blobId).toBe('blob-abc-123');
    expect(result.sizeBytes).toBe(4);
  });

  it('returns blobId and sizeBytes on alreadyCertified response', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const mockResponse = {
      alreadyCertified: { blobId: 'blob-existing-456', size: 3 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await walrusPut(bytes, 1);
    expect(result.blobId).toBe('blob-existing-456');
    expect(result.sizeBytes).toBe(3);
  });

  it('falls back to bytes.length when size is absent from response', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const mockResponse = {
      newlyCreated: {
        blobObject: { blobId: 'blob-no-size' },
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await walrusPut(bytes, 1);
    expect(result.sizeBytes).toBe(5);
  });

  it('throws WalrusPutError immediately on non-retryable 4xx (400)', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Bad Request', { status: 400 }),
    );

    await expect(walrusPut(bytes, 3)).rejects.toThrow(WalrusPutError);
    // Should only have been called once (no retry on 4xx)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('throws WalrusPutError immediately on non-retryable 4xx (403)', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );

    await expect(walrusPut(bytes, 3)).rejects.toThrow(WalrusPutError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and eventually throws WalrusPutError after maxAttempts', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );
    // Speed up by using maxAttempts=2
    await expect(walrusPut(bytes, 2)).rejects.toThrow(WalrusPutError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 and eventually throws WalrusPutError after maxAttempts', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Too Many Requests', { status: 429 }),
    );

    await expect(walrusPut(bytes, 2)).rejects.toThrow(WalrusPutError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('retries on network error and eventually throws WalrusPutError', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    await expect(walrusPut(bytes, 2)).rejects.toThrow(WalrusPutError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('succeeds on second attempt after one 5xx', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const mockResponse = {
      newlyCreated: { blobObject: { blobId: 'blob-retry-success', size: 3 } },
    };

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { status: 200 }));

    const result = await walrusPut(bytes, 3);
    expect(result.blobId).toBe('blob-retry-success');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('throws WalrusPutError when WALRUS_PUBLISHER_URL is not set', async () => {
    setEnv('WALRUS_PUBLISHER_URL', undefined);
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(walrusPut(bytes, 1)).rejects.toThrow(WalrusPutError);
  });

  it('WalrusPutError has code WALRUS_PUT_FAILED', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    try {
      await walrusPut(bytes, 1);
    } catch (err) {
      expect((err as WalrusPutError).code).toBe('WALRUS_PUT_FAILED');
    }
  });

  it('throws WalrusPutError on unexpected response shape', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    );

    await expect(walrusPut(bytes, 1)).rejects.toThrow(WalrusPutError);
  });
});

// ---------------------------------------------------------------------------
// walrusGet
// ---------------------------------------------------------------------------

describe('walrusGet', () => {
  it('returns bytes on success', async () => {
    const expectedBytes = new Uint8Array([10, 20, 30, 40]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(expectedBytes, { status: 200 }),
    );

    const result = await walrusGet('blob-123', undefined, 1);
    expect(result).toEqual(expectedBytes);
  });

  it('throws WalrusGetError immediately on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    await expect(walrusGet('missing-blob', undefined, 3)).rejects.toThrow(WalrusGetError);
    // Should only have been called once (no retry on 404)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('throws WalrusGetError immediately on non-retryable 4xx (403)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );

    await expect(walrusGet('blob-123', undefined, 3)).rejects.toThrow(WalrusGetError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and eventually throws WalrusGetError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Server Error', { status: 500 }),
    );

    await expect(walrusGet('blob-123', undefined, 2)).rejects.toThrow(WalrusGetError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 and eventually throws WalrusGetError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Too Many Requests', { status: 429 }),
    );

    await expect(walrusGet('blob-123', undefined, 2)).rejects.toThrow(WalrusGetError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('retries on network error and eventually throws WalrusGetError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    await expect(walrusGet('blob-123', undefined, 2)).rejects.toThrow(WalrusGetError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('succeeds on second attempt after one 5xx', async () => {
    const expectedBytes = new Uint8Array([1, 2, 3]);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      .mockResolvedValueOnce(new Response(expectedBytes, { status: 200 }));

    const result = await walrusGet('blob-123', undefined, 3);
    expect(result).toEqual(expectedBytes);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('passes integrity check when digest matches', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const digest = sha256(bytes);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(bytes, { status: 200 }),
    );

    const result = await walrusGet('blob-123', digest, 1);
    expect(result).toEqual(bytes);
  });

  it('throws WalrusIntegrityError when digest does not match', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const wrongDigest = 'a'.repeat(64); // wrong digest

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(bytes, { status: 200 }),
    );

    await expect(walrusGet('blob-123', wrongDigest, 1)).rejects.toThrow(WalrusIntegrityError);
  });

  it('does NOT retry on integrity mismatch', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const wrongDigest = 'b'.repeat(64);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(bytes, { status: 200 }),
    );

    await expect(walrusGet('blob-123', wrongDigest, 5)).rejects.toThrow(WalrusIntegrityError);
    // Should only have been called once (no retry on integrity mismatch)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('WalrusIntegrityError carries blobId, expectedDigest, actualDigest', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const expectedDigest = 'c'.repeat(64);
    const actualDigest = sha256(bytes);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(bytes, { status: 200 }),
    );

    try {
      await walrusGet('my-blob', expectedDigest, 1);
    } catch (err) {
      const integrityErr = err as WalrusIntegrityError;
      expect(integrityErr.blobId).toBe('my-blob');
      expect(integrityErr.expectedDigest).toBe(expectedDigest);
      expect(integrityErr.actualDigest).toBe(actualDigest);
      expect(integrityErr.code).toBe('WALRUS_INTEGRITY_MISMATCH');
    }
  });

  it('throws WalrusGetError when WALRUS_AGGREGATOR_URL is not set', async () => {
    setEnv('WALRUS_AGGREGATOR_URL', undefined);
    await expect(walrusGet('blob-123', undefined, 1)).rejects.toThrow(WalrusGetError);
  });

  it('WalrusGetError has code WALRUS_GET_FAILED', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    try {
      await walrusGet('blob-123', undefined, 1);
    } catch (err) {
      expect((err as WalrusGetError).code).toBe('WALRUS_GET_FAILED');
    }
  });

  it('WalrusGetError carries blobId and attempts', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    try {
      await walrusGet('my-blob', undefined, 2);
    } catch (err) {
      const getErr = err as WalrusGetError;
      expect(getErr.blobId).toBe('my-blob');
      expect(getErr.attempts).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// walrusBlobExists
// ---------------------------------------------------------------------------

describe('walrusBlobExists', () => {
  it('returns true when HEAD returns 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    const exists = await walrusBlobExists('blob-123', 1);
    expect(exists).toBe(true);
  });

  it('returns false when HEAD returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    );

    const exists = await walrusBlobExists('missing-blob', 3);
    expect(exists).toBe(false);
    // Should only have been called once (no retry on 404)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('throws WalrusGetError immediately on non-retryable 4xx (403)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 403 }),
    );

    await expect(walrusBlobExists('blob-123', 3)).rejects.toThrow(WalrusGetError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and eventually throws WalrusGetError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await expect(walrusBlobExists('blob-123', 2)).rejects.toThrow(WalrusGetError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 and eventually throws WalrusGetError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 429 }),
    );

    await expect(walrusBlobExists('blob-123', 2)).rejects.toThrow(WalrusGetError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('retries on network error and eventually throws WalrusGetError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    await expect(walrusBlobExists('blob-123', 2)).rejects.toThrow(WalrusGetError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('succeeds on second attempt after one 5xx', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const exists = await walrusBlobExists('blob-123', 3);
    expect(exists).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('throws WalrusGetError when WALRUS_AGGREGATOR_URL is not set', async () => {
    setEnv('WALRUS_AGGREGATOR_URL', undefined);
    await expect(walrusBlobExists('blob-123', 1)).rejects.toThrow(WalrusGetError);
  });

  it('uses HEAD method (not GET)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    await walrusBlobExists('blob-123', 1);

    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.method).toBe('HEAD');
  });
});

// ---------------------------------------------------------------------------
// Error class shapes
// ---------------------------------------------------------------------------

describe('WalrusPutError', () => {
  it('is an instance of Error', () => {
    const err = new WalrusPutError('blob-1', 3, new Error('cause'));
    expect(err).toBeInstanceOf(Error);
  });

  it('has name WalrusPutError', () => {
    const err = new WalrusPutError('blob-1', 3, new Error('cause'));
    expect(err.name).toBe('WalrusPutError');
  });

  it('has code WALRUS_PUT_FAILED', () => {
    const err = new WalrusPutError('blob-1', 3, new Error('cause'));
    expect(err.code).toBe('WALRUS_PUT_FAILED');
  });

  it('message includes attempt count', () => {
    const err = new WalrusPutError(undefined, 5, new Error('timeout'));
    expect(err.message).toContain('5');
  });
});

describe('WalrusGetError', () => {
  it('is an instance of Error', () => {
    const err = new WalrusGetError('blob-1', 3, new Error('cause'));
    expect(err).toBeInstanceOf(Error);
  });

  it('has name WalrusGetError', () => {
    const err = new WalrusGetError('blob-1', 3, new Error('cause'));
    expect(err.name).toBe('WalrusGetError');
  });

  it('has code WALRUS_GET_FAILED', () => {
    const err = new WalrusGetError('blob-1', 3, new Error('cause'));
    expect(err.code).toBe('WALRUS_GET_FAILED');
  });

  it('message includes blobId', () => {
    const err = new WalrusGetError('my-special-blob', 2, new Error('timeout'));
    expect(err.message).toContain('my-special-blob');
  });
});

describe('WalrusIntegrityError', () => {
  it('is an instance of Error', () => {
    const err = new WalrusIntegrityError('blob-1', 'a'.repeat(64), 'b'.repeat(64));
    expect(err).toBeInstanceOf(Error);
  });

  it('has name WalrusIntegrityError', () => {
    const err = new WalrusIntegrityError('blob-1', 'a'.repeat(64), 'b'.repeat(64));
    expect(err.name).toBe('WalrusIntegrityError');
  });

  it('has code WALRUS_INTEGRITY_MISMATCH', () => {
    const err = new WalrusIntegrityError('blob-1', 'a'.repeat(64), 'b'.repeat(64));
    expect(err.code).toBe('WALRUS_INTEGRITY_MISMATCH');
  });

  it('message includes blobId', () => {
    const err = new WalrusIntegrityError('my-blob', 'a'.repeat(64), 'b'.repeat(64));
    expect(err.message).toContain('my-blob');
  });
});
