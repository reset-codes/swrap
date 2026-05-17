/**
 * Property-based tests for rate limiter middleware.
 *
 * **Validates: Requirements 9.7, 9.12**
 *
 * Property 35: Rate limiter window
 *   For all generated request rates above threshold across a sliding window,
 *   the API_Server returns 429 once the threshold is crossed and resumes 2xx
 *   after the window resets.
 *
 * Tests are organised into five groups:
 *   35a — Requests above threshold return 429 once quota is exceeded
 *   35b — Requests below threshold always return 200
 *   35c — Window reset restores quota (requests allowed again after window expires)
 *   35d — Per-IP rate limiting is enforced independently
 *   35e — Per-address rate limiting is enforced independently
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { checkBucket, resetBucket, clearAllBuckets } from './rate-limit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate `n` requests through checkBucket for a given key, returning
 * the array of results in order.
 */
function simulateRequests(
  key: string,
  n: number,
  maxRequests: number,
  windowMs: number,
): Array<{ allowed: boolean; retryAfterSeconds: number }> {
  const results: Array<{ allowed: boolean; retryAfterSeconds: number }> = [];
  for (let i = 0; i < n; i++) {
    results.push(checkBucket(key, maxRequests, windowMs));
  }
  return results;
}

/**
 * Count how many results are allowed vs denied.
 */
function countResults(results: Array<{ allowed: boolean }>): { allowed: number; denied: number } {
  let allowed = 0;
  let denied = 0;
  for (const r of results) {
    if (r.allowed) allowed++;
    else denied++;
  }
  return { allowed, denied };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a small max-requests threshold (2–20) to keep tests fast while
 * covering a meaningful range of limits.
 */
const maxRequestsArb: fc.Arbitrary<number> = fc.integer({ min: 2, max: 20 });

/**
 * Generates a window duration in milliseconds (100ms–500ms) — short enough
 * that tests can wait for window expiry without being slow.
 */
const windowMsArb: fc.Arbitrary<number> = fc.integer({ min: 100, max: 500 });

/**
 * Generates a unique bucket key to avoid cross-test interference.
 */
const bucketKeyArb: fc.Arbitrary<string> = fc
  .uuid()
  .map((id) => `test-key-${id}`);

/**
 * Generates a Sui-like address string (0x + 64 hex chars).
 */
const addressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/)
  .map((hex) => `0x${hex}`);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAllBuckets();
});

// ---------------------------------------------------------------------------
// Property 35a — Requests above threshold return 429 once quota is exceeded
// ---------------------------------------------------------------------------

describe('Property 35a: Requests above threshold return 429 once quota is exceeded', () => {
  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * For all generated thresholds and request counts above the threshold,
   * the first `maxRequests` requests are allowed and all subsequent requests
   * within the same window are denied (429).
   *
   * The transition from allowed to denied is sharp: request N (1-indexed)
   * is allowed if N ≤ maxRequests, denied if N > maxRequests.
   */
  it('Property 35a-i: first maxRequests are allowed, all subsequent are denied', () => {
    fc.assert(
      fc.property(
        maxRequestsArb,
        fc.integer({ min: 1, max: 10 }), // extra requests above threshold
        bucketKeyArb,
        (maxRequests, extraRequests, key) => {
          clearAllBuckets();
          const totalRequests = maxRequests + extraRequests;
          const results = simulateRequests(key, totalRequests, maxRequests, 60_000);

          const { allowed, denied } = countResults(results);

          // Exactly maxRequests should be allowed
          expect(allowed).toBe(maxRequests);
          // All extra requests should be denied
          expect(denied).toBe(extraRequests);

          // The first maxRequests results must all be allowed
          for (let i = 0; i < maxRequests; i++) {
            expect(results[i].allowed).toBe(true);
          }
          // All results after maxRequests must be denied
          for (let i = maxRequests; i < totalRequests; i++) {
            expect(results[i].allowed).toBe(false);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * When a request is denied, the `retryAfterSeconds` field must be a
   * positive integer (≥ 1), indicating when the window resets.
   */
  it('Property 35a-ii: denied requests carry a positive retryAfterSeconds', () => {
    fc.assert(
      fc.property(maxRequestsArb, bucketKeyArb, (maxRequests, key) => {
        clearAllBuckets();
        // Exhaust the quota
        for (let i = 0; i < maxRequests; i++) {
          checkBucket(key, maxRequests, 60_000);
        }
        // The next request must be denied with a positive retryAfterSeconds
        const result = checkBucket(key, maxRequests, 60_000);
        expect(result.allowed).toBe(false);
        expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * Allowed requests always have retryAfterSeconds === 0.
   */
  it('Property 35a-iii: allowed requests have retryAfterSeconds === 0', () => {
    fc.assert(
      fc.property(maxRequestsArb, bucketKeyArb, (maxRequests, key) => {
        clearAllBuckets();
        // All requests within quota must have retryAfterSeconds === 0
        for (let i = 0; i < maxRequests; i++) {
          const result = checkBucket(key, maxRequests, 60_000);
          expect(result.allowed).toBe(true);
          expect(result.retryAfterSeconds).toBe(0);
        }
      }),
      { numRuns: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 35b — Requests below threshold always return 200
// ---------------------------------------------------------------------------

describe('Property 35b: Requests below threshold always return 200', () => {
  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * For all generated thresholds and request counts strictly below the
   * threshold, every request is allowed.
   */
  it('Property 35b-i: any request count below maxRequests is always allowed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 20 }), // maxRequests ≥ 3 so we can pick a count below it
        bucketKeyArb,
        (maxRequests, key) => {
          clearAllBuckets();
          // Send maxRequests - 1 requests (strictly below threshold)
          const count = maxRequests - 1;
          const results = simulateRequests(key, count, maxRequests, 60_000);

          for (const result of results) {
            expect(result.allowed).toBe(true);
            expect(result.retryAfterSeconds).toBe(0);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * A single request is always allowed (never rate-limited on first request).
   */
  it('Property 35b-ii: a single request is always allowed', () => {
    fc.assert(
      fc.property(maxRequestsArb, bucketKeyArb, (maxRequests, key) => {
        clearAllBuckets();
        const result = checkBucket(key, maxRequests, 60_000);
        expect(result.allowed).toBe(true);
        expect(result.retryAfterSeconds).toBe(0);
      }),
      { numRuns: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 35c — Window reset restores quota
// ---------------------------------------------------------------------------

describe('Property 35c: Window reset restores quota (requests allowed again after window expires)', () => {
  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * For all generated thresholds and short window durations:
   * 1. Exhaust the quota (all maxRequests used).
   * 2. The next request within the window is denied.
   * 3. Wait for the window to expire.
   * 4. The first request after window expiry is allowed again.
   *
   * This verifies the sliding-window reset behaviour.
   */
  it('Property 35c-i: after window expires, requests are allowed again', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }), // small maxRequests for speed
        fc.integer({ min: 50, max: 150 }), // short window (50–150ms)
        bucketKeyArb,
        async (maxRequests, windowMs, key) => {
          clearAllBuckets();

          // Step 1: exhaust the quota
          for (let i = 0; i < maxRequests; i++) {
            const r = checkBucket(key, maxRequests, windowMs);
            expect(r.allowed).toBe(true);
          }

          // Step 2: next request within window is denied
          const deniedResult = checkBucket(key, maxRequests, windowMs);
          expect(deniedResult.allowed).toBe(false);
          expect(deniedResult.retryAfterSeconds).toBeGreaterThanOrEqual(1);

          // Step 3: wait for the window to expire (add 20ms buffer)
          await new Promise((resolve) => setTimeout(resolve, windowMs + 20));

          // Step 4: first request after window expiry is allowed
          const afterReset = checkBucket(key, maxRequests, windowMs);
          expect(afterReset.allowed).toBe(true);
          expect(afterReset.retryAfterSeconds).toBe(0);
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * After window reset, the full quota is restored: exactly maxRequests
   * requests are allowed in the new window before the next denial.
   */
  it('Property 35c-ii: after window reset, full quota is restored', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 4 }), // small maxRequests for speed
        fc.integer({ min: 50, max: 120 }), // short window
        bucketKeyArb,
        async (maxRequests, windowMs, key) => {
          clearAllBuckets();

          // Exhaust quota in first window
          for (let i = 0; i < maxRequests; i++) {
            checkBucket(key, maxRequests, windowMs);
          }
          // Confirm quota is exhausted
          expect(checkBucket(key, maxRequests, windowMs).allowed).toBe(false);

          // Wait for window to expire
          await new Promise((resolve) => setTimeout(resolve, windowMs + 20));

          // In the new window, exactly maxRequests should be allowed
          const newWindowResults = simulateRequests(
            key,
            maxRequests + 1,
            maxRequests,
            windowMs,
          );

          for (let i = 0; i < maxRequests; i++) {
            expect(newWindowResults[i].allowed).toBe(true);
          }
          // The (maxRequests + 1)th request should be denied
          expect(newWindowResults[maxRequests].allowed).toBe(false);
        },
      ),
      { numRuns: 8 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 35d — Per-IP rate limiting is enforced independently
// ---------------------------------------------------------------------------

describe('Property 35d: Per-IP rate limiting is enforced independently', () => {
  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * Two different IP keys must have independent quotas: exhausting one
   * does not affect the other.
   */
  it('Property 35d-i: exhausting quota for one IP does not affect another IP', () => {
    fc.assert(
      fc.property(
        maxRequestsArb,
        fc.tuple(bucketKeyArb, bucketKeyArb).filter(([a, b]) => a !== b),
        (maxRequests, [ip1, ip2]) => {
          clearAllBuckets();

          const key1 = `ip:${ip1}`;
          const key2 = `ip:${ip2}`;

          // Exhaust quota for ip1
          for (let i = 0; i < maxRequests; i++) {
            checkBucket(key1, maxRequests, 60_000);
          }
          // ip1 is now rate-limited
          expect(checkBucket(key1, maxRequests, 60_000).allowed).toBe(false);

          // ip2 should still be allowed (independent bucket)
          const ip2Result = checkBucket(key2, maxRequests, 60_000);
          expect(ip2Result.allowed).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * For any number of distinct IP keys, each has its own independent quota.
   * Sending maxRequests to each IP independently should all be allowed.
   */
  it('Property 35d-ii: multiple IPs each have their own independent quota', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }), // maxRequests
        fc.array(bucketKeyArb, { minLength: 2, maxLength: 5 }),
        (maxRequests, ipKeys) => {
          clearAllBuckets();

          // For each IP, send exactly maxRequests — all should be allowed
          for (const ip of ipKeys) {
            const key = `ip:${ip}`;
            const results = simulateRequests(key, maxRequests, maxRequests, 60_000);
            for (const r of results) {
              expect(r.allowed).toBe(true);
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 35e — Per-address rate limiting is enforced independently
// ---------------------------------------------------------------------------

describe('Property 35e: Per-address rate limiting is enforced independently', () => {
  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * Two different address keys must have independent quotas: exhausting one
   * does not affect the other.
   */
  it('Property 35e-i: exhausting quota for one address does not affect another address', () => {
    fc.assert(
      fc.property(
        maxRequestsArb,
        fc.tuple(addressArb, addressArb).filter(([a, b]) => a !== b),
        (maxRequests, [addr1, addr2]) => {
          clearAllBuckets();

          const key1 = `addr:${addr1}`;
          const key2 = `addr:${addr2}`;

          // Exhaust quota for addr1
          for (let i = 0; i < maxRequests; i++) {
            checkBucket(key1, maxRequests, 60_000);
          }
          // addr1 is now rate-limited
          expect(checkBucket(key1, maxRequests, 60_000).allowed).toBe(false);

          // addr2 should still be allowed (independent bucket)
          const addr2Result = checkBucket(key2, maxRequests, 60_000);
          expect(addr2Result.allowed).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * IP and address buckets for the same logical identity are independent:
   * exhausting the IP quota does not exhaust the address quota and vice versa.
   */
  it('Property 35e-ii: IP bucket and address bucket are independent for the same identity', () => {
    fc.assert(
      fc.property(maxRequestsArb, addressArb, bucketKeyArb, (maxRequests, addr, ip) => {
        clearAllBuckets();

        const ipKey = `ip:${ip}`;
        const addrKey = `addr:${addr}`;

        // Exhaust the IP quota
        for (let i = 0; i < maxRequests; i++) {
          checkBucket(ipKey, maxRequests, 60_000);
        }
        expect(checkBucket(ipKey, maxRequests, 60_000).allowed).toBe(false);

        // The address bucket is unaffected
        const addrResult = checkBucket(addrKey, maxRequests, 60_000);
        expect(addrResult.allowed).toBe(true);

        // Now exhaust the address quota too
        for (let i = 1; i < maxRequests; i++) {
          checkBucket(addrKey, maxRequests, 60_000);
        }
        expect(checkBucket(addrKey, maxRequests, 60_000).allowed).toBe(false);

        // The IP bucket remains exhausted (independent)
        expect(checkBucket(ipKey, maxRequests, 60_000).allowed).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 9.7, 9.12**
   *
   * For any number of distinct address keys, each has its own independent quota.
   * Sending maxRequests to each address independently should all be allowed.
   */
  it('Property 35e-iii: multiple addresses each have their own independent quota', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }), // maxRequests
        fc.array(addressArb, { minLength: 2, maxLength: 5 }),
        (maxRequests, addresses) => {
          clearAllBuckets();

          for (const addr of addresses) {
            const key = `addr:${addr}`;
            const results = simulateRequests(key, maxRequests, maxRequests, 60_000);
            for (const r of results) {
              expect(r.allowed).toBe(true);
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
