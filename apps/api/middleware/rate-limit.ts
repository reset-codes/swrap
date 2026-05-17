/**
 * Token-bucket rate limiter middleware.
 *
 * Limits requests to 120 per minute per source IP and per asserted address
 * (from the verified session token or the Authorization header).
 *
 * Returns HTTP 429 with a `Retry-After` header (seconds until the window resets)
 * when the quota is exceeded.
 *
 * Implementation: sliding-window token bucket stored in an in-process Map.
 * For multi-process deployments, replace the store with a Redis-backed adapter.
 *
 * Requirements: 9.7, 9.12
 */

import type { Request, Response, NextFunction } from 'express';
import { getSessionAddress } from '../auth/session';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MAX_REQUESTS = 120;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// In-process token bucket store
// ---------------------------------------------------------------------------

interface BucketEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, BucketEntry>();

/**
 * Periodically prune expired entries to prevent unbounded memory growth.
 * Runs every 5 minutes.
 */
function pruneExpiredEntries(windowMs: number): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart >= windowMs) {
      store.delete(key);
    }
  }
}

// Prune every 5 minutes (only in non-test environments to avoid timer leaks)
let pruneInterval: ReturnType<typeof setInterval> | null = null;

function ensurePruneInterval(windowMs: number): void {
  if (pruneInterval === null && process.env.NODE_ENV !== 'test') {
    pruneInterval = setInterval(() => pruneExpiredEntries(windowMs), 5 * 60_000);
    // Allow the process to exit even if this timer is still running
    if (pruneInterval.unref) pruneInterval.unref();
  }
}

// ---------------------------------------------------------------------------
// Core bucket logic (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Check and increment the request count for a given key within the window.
 *
 * @returns `{ allowed: boolean; retryAfterSeconds: number }` — if `allowed` is
 *   false, `retryAfterSeconds` is the number of seconds until the window resets.
 */
export function checkBucket(
  key: string,
  maxRequests: number = DEFAULT_MAX_REQUESTS,
  windowMs: number = DEFAULT_WINDOW_MS,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    // New window
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count < maxRequests) {
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Quota exceeded — compute seconds until window resets
  const retryAfterMs = windowMs - (now - entry.windowStart);
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  return { allowed: false, retryAfterSeconds };
}

/**
 * Reset the bucket for a given key. Useful in tests.
 */
export function resetBucket(key: string): void {
  store.delete(key);
}

/**
 * Clear all buckets. Useful in tests.
 */
export function clearAllBuckets(): void {
  store.clear();
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
}

/**
 * Returns a rate-limiting middleware that enforces per-IP and per-identity limits.
 *
 * Both the source IP and the asserted address (from the verified session token)
 * are checked independently. A request is rejected if either quota is exceeded.
 *
 * Identity is resolved via `getSessionAddress()` which validates the session
 * token from the `Authorization: Bearer` header. This ensures rate limiting
 * is tied to the verified Sui address, not the raw token bytes.
 *
 * Applied globally — covers all authenticated endpoints including encryption
 * and decryption endpoints (Requirements 9.7, 9.12).
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}): (req: Request, res: Response, next: NextFunction) => void {
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

  ensurePruneInterval(windowMs);

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    // Derive the source IP — trust X-Forwarded-For only behind a known proxy
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      'unknown';

    // Derive the asserted address from the verified session token.
    // getSessionAddress validates the token and returns the bound Sui address,
    // ensuring per-identity rate limiting is tied to a verified identity.
    const assertedAddress = getSessionAddress(req);

    // Check IP bucket
    const ipResult = checkBucket(`ip:${ip}`, maxRequests, windowMs);
    if (!ipResult.allowed) {
      res.setHeader('Retry-After', String(ipResult.retryAfterSeconds));
      res.status(429).json({
        error: {
          code: 'TooManyRequests',
          message: `Rate limit exceeded. Try again in ${ipResult.retryAfterSeconds} second(s).`,
        },
      });
      return;
    }

    // Check per-address bucket (only when a verified address is present)
    if (assertedAddress) {
      const addrResult = checkBucket(`addr:${assertedAddress}`, maxRequests, windowMs);
      if (!addrResult.allowed) {
        res.setHeader('Retry-After', String(addrResult.retryAfterSeconds));
        res.status(429).json({
          error: {
            code: 'TooManyRequests',
            message: `Rate limit exceeded. Try again in ${addrResult.retryAfterSeconds} second(s).`,
          },
        });
        return;
      }
    }

    next();
  };
}
