/**
 * apps/api/services/walrus-service.ts
 *
 * Server-side Walrus client for the API_Server.
 *
 * This module is the single place in `apps/api` that performs HTTP I/O
 * against the Walrus publisher and aggregator. It exposes three operations:
 *
 *   - `walrusPut(bytes)`      — upload bytes to the Walrus publisher
 *   - `walrusGet(blobId)`     — fetch bytes from the Walrus aggregator
 *   - `walrusBlobExists(blobId)` — HEAD check on the Walrus aggregator
 *
 * All three operations use bounded exponential backoff with jitter:
 *   delay(n) = min(2^n * 100ms + rand(0..100ms), 10_000ms)
 * Default maximum attempts: 5.
 *
 * Endpoint URLs are read from `WALRUS_PUBLISHER_URL` and
 * `WALRUS_AGGREGATOR_URL` environment variables (validated at startup by
 * `server-config.ts`). The module reads them lazily so that tests can set
 * them before the first call.
 *
 * Requirements: 3.3, 3.4, 3.5, 3.8, 3.9, 3.10, 7.8
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of attempts for any Walrus operation. */
const DEFAULT_MAX_ATTEMPTS = 5;

/** Base delay in ms for the first retry (n=0 → 2^0 * 100 = 100ms). */
const BASE_DELAY_MS = 100;

/** Maximum delay cap in ms (10 seconds). */
const MAX_DELAY_MS = 10_000;

/** Jitter range in ms (0..100ms). */
const JITTER_RANGE_MS = 100;

/** Default request timeout in ms (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when a `walrusPut` operation fails after all retry attempts.
 *
 * `cause` carries the underlying error from the last attempt.
 */
export class WalrusPutError extends Error {
  readonly code = 'WALRUS_PUT_FAILED' as const;

  constructor(
    public readonly blobId: string | undefined,
    public readonly attempts: number,
    cause: unknown,
  ) {
    super(
      `Walrus PUT failed after ${attempts} attempt(s): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'WalrusPutError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a `walrusGet` operation fails after all retry attempts.
 *
 * `cause` carries the underlying error from the last attempt.
 */
export class WalrusGetError extends Error {
  readonly code = 'WALRUS_GET_FAILED' as const;

  constructor(
    public readonly blobId: string,
    public readonly attempts: number,
    cause: unknown,
  ) {
    super(
      `Walrus GET for blob "${blobId}" failed after ${attempts} attempt(s): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'WalrusGetError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when the bytes fetched from Walrus do not match the expected digest.
 *
 * The caller MUST NOT return the fetched bytes as authentic when this error
 * is thrown (Requirement 3.9).
 */
export class WalrusIntegrityError extends Error {
  readonly code = 'WALRUS_INTEGRITY_MISMATCH' as const;

  constructor(
    public readonly blobId: string,
    public readonly expectedDigest: string,
    public readonly actualDigest: string,
  ) {
    super(
      `Integrity check failed for blob "${blobId}": ` +
        `expected SHA-256 ${expectedDigest}, got ${actualDigest}`,
    );
    this.name = 'WalrusIntegrityError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute a hex-encoded SHA-256 digest over `bytes`.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Compute the bounded exponential backoff delay for attempt `n` (0-indexed).
 *
 * delay(n) = min(2^n * BASE_DELAY_MS + rand(0..JITTER_RANGE_MS), MAX_DELAY_MS)
 */
export function backoffDelayMs(n: number): number {
  const exponential = Math.pow(2, n) * BASE_DELAY_MS;
  const jitter = Math.random() * JITTER_RANGE_MS;
  return Math.min(exponential + jitter, MAX_DELAY_MS);
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns `true` if the HTTP status code or error type is retryable.
 *
 * Retryable: network errors, 5xx, 429.
 * Non-retryable: 404, 4xx (other than 429), integrity mismatch.
 */
function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/**
 * Perform a fetch with an AbortSignal timeout.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Read the Walrus publisher URL from the environment.
 * Strips trailing slashes.
 */
function publisherUrl(): string {
  const url = process.env.WALRUS_PUBLISHER_URL;
  if (!url) {
    throw new WalrusPutError(undefined, 0, new Error('WALRUS_PUBLISHER_URL is not configured'));
  }
  return url.replace(/\/+$/, '');
}

/**
 * Read the Walrus aggregator URL from the environment.
 * Strips trailing slashes.
 */
function aggregatorUrl(): string {
  const url = process.env.WALRUS_AGGREGATOR_URL;
  if (!url) {
    throw new WalrusGetError('(unknown)', 0, new Error('WALRUS_AGGREGATOR_URL is not configured'));
  }
  return url.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Publisher response shapes
// ---------------------------------------------------------------------------

interface NewlyCreatedResponse {
  newlyCreated: {
    blobObject: {
      blobId: string;
      size?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

interface AlreadyCertifiedResponse {
  alreadyCertified: {
    blobId: string;
    size?: number;
    [key: string]: unknown;
  };
}

function isNewlyCreated(r: unknown): r is NewlyCreatedResponse {
  return (
    typeof r === 'object' &&
    r !== null &&
    'newlyCreated' in r &&
    typeof (r as NewlyCreatedResponse).newlyCreated?.blobObject?.blobId === 'string'
  );
}

function isAlreadyCertified(r: unknown): r is AlreadyCertifiedResponse {
  return (
    typeof r === 'object' &&
    r !== null &&
    'alreadyCertified' in r &&
    typeof (r as AlreadyCertifiedResponse).alreadyCertified?.blobId === 'string'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload `bytes` to the Walrus publisher.
 *
 * Retries on 5xx, 429, and network errors with bounded exponential backoff.
 * Does NOT retry on 4xx (other than 429).
 *
 * @param bytes       Raw bytes to upload.
 * @param maxAttempts Maximum number of attempts (default: 5).
 * @returns `{ blobId, sizeBytes }` on success.
 * @throws `WalrusPutError` after all attempts are exhausted.
 *
 * Requirements: 3.3, 3.4, 3.5
 */
export async function walrusPut(
  bytes: Uint8Array,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<{ blobId: string; sizeBytes: number }> {
  const base = publisherUrl();
  const url = `${base}/v1/blobs?epochs=1`;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          url,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: Buffer.from(bytes),
          },
          DEFAULT_TIMEOUT_MS,
        );
      } catch (networkErr) {
        // Network-level error — always retryable
        lastError = networkErr;
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      // Non-retryable 4xx (not 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const body = await response.text().catch(() => '');
        throw new WalrusPutError(
          undefined,
          attempt + 1,
          new Error(`HTTP ${response.status}: ${body}`),
        );
      }

      // Retryable: 5xx or 429
      if (isRetryableStatus(response.status)) {
        const body = await response.text().catch(() => '');
        lastError = new Error(`HTTP ${response.status}: ${body}`);
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      // Success — parse response
      let json: unknown;
      try {
        json = await response.json();
      } catch (parseErr) {
        throw new WalrusPutError(
          undefined,
          attempt + 1,
          new Error(`Failed to parse publisher response: ${(parseErr as Error).message}`),
        );
      }

      if (isNewlyCreated(json)) {
        const blobId = json.newlyCreated.blobObject.blobId;
        const sizeBytes = json.newlyCreated.blobObject.size ?? bytes.length;
        return { blobId, sizeBytes };
      }

      if (isAlreadyCertified(json)) {
        const blobId = json.alreadyCertified.blobId;
        const sizeBytes = json.alreadyCertified.size ?? bytes.length;
        return { blobId, sizeBytes };
      }

      throw new WalrusPutError(
        undefined,
        attempt + 1,
        new Error(
          `Unexpected publisher response shape: ${JSON.stringify(json).slice(0, 200)}`,
        ),
      );
    } catch (err) {
      // Re-throw non-retryable errors immediately (WalrusPutError thrown above)
      if (err instanceof WalrusPutError) throw err;
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelayMs(attempt));
      }
    }
  }

  throw new WalrusPutError(undefined, maxAttempts, lastError);
}

/**
 * Fetch bytes for `blobId` from the Walrus aggregator.
 *
 * Retries on 5xx, 429, and network errors with bounded exponential backoff.
 * Does NOT retry on 404 (blob not found) or integrity mismatch.
 *
 * If `expectedDigest` is provided, the fetched bytes are verified against it.
 * A mismatch throws `WalrusIntegrityError` immediately (no retry).
 *
 * @param blobId         Walrus blob identifier.
 * @param expectedDigest Optional hex-encoded SHA-256 digest to verify against.
 * @param maxAttempts    Maximum number of attempts (default: 5).
 * @returns Raw bytes from Walrus.
 * @throws `WalrusGetError` after all attempts are exhausted.
 * @throws `WalrusIntegrityError` on digest mismatch (no retry).
 *
 * Requirements: 3.8, 3.9, 3.10
 */
export async function walrusGet(
  blobId: string,
  expectedDigest?: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<Uint8Array> {
  const base = aggregatorUrl();
  const url = `${base}/v1/blobs/${encodeURIComponent(blobId)}`;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let response: Response;
      try {
        response = await fetchWithTimeout(url, { method: 'GET' }, DEFAULT_TIMEOUT_MS);
      } catch (networkErr) {
        // Network-level error — always retryable
        lastError = networkErr;
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      // 404 — blob not found, never retry
      if (response.status === 404) {
        const body = await response.text().catch(() => '');
        throw new WalrusGetError(
          blobId,
          attempt + 1,
          new Error(`Blob not found (404): ${body}`),
        );
      }

      // Non-retryable 4xx (not 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const body = await response.text().catch(() => '');
        throw new WalrusGetError(
          blobId,
          attempt + 1,
          new Error(`HTTP ${response.status}: ${body}`),
        );
      }

      // Retryable: 5xx or 429
      if (isRetryableStatus(response.status)) {
        const body = await response.text().catch(() => '');
        lastError = new Error(`HTTP ${response.status}: ${body}`);
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      // Success — read body
      let buffer: ArrayBuffer;
      try {
        buffer = await response.arrayBuffer();
      } catch (readErr) {
        lastError = new Error(
          `Failed to read response body: ${(readErr as Error).message}`,
        );
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      const bytes = new Uint8Array(buffer);

      // Integrity check — non-retryable on mismatch (Requirement 3.9)
      if (expectedDigest !== undefined) {
        const actualDigest = sha256Hex(bytes);
        if (actualDigest !== expectedDigest) {
          throw new WalrusIntegrityError(blobId, expectedDigest, actualDigest);
        }
      }

      return bytes;
    } catch (err) {
      // Re-throw non-retryable errors immediately
      if (err instanceof WalrusGetError || err instanceof WalrusIntegrityError) throw err;
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelayMs(attempt));
      }
    }
  }

  throw new WalrusGetError(blobId, maxAttempts, lastError);
}

/**
 * Check whether a blob exists on the Walrus aggregator via a HEAD request.
 *
 * Retries on 5xx, 429, and network errors with bounded exponential backoff.
 * Returns `false` on 404 (never retried).
 *
 * Used by the API_Server to verify blob existence before transitioning a
 * metadata record to `indexed` (Requirement 7.8).
 *
 * @param blobId      Walrus blob identifier.
 * @param maxAttempts Maximum number of attempts (default: 5).
 * @returns `true` if the blob exists, `false` if the aggregator returns 404.
 * @throws `WalrusGetError` after all attempts are exhausted on non-404 errors.
 *
 * Requirements: 3.8, 7.8
 */
export async function walrusBlobExists(
  blobId: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<boolean> {
  const base = aggregatorUrl();
  const url = `${base}/v1/blobs/${encodeURIComponent(blobId)}`;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let response: Response;
      try {
        response = await fetchWithTimeout(url, { method: 'HEAD' }, DEFAULT_TIMEOUT_MS);
      } catch (networkErr) {
        // Network-level error — always retryable
        lastError = networkErr;
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      // 404 — blob does not exist; return false immediately (no retry)
      if (response.status === 404) {
        return false;
      }

      // Non-retryable 4xx (not 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new WalrusGetError(
          blobId,
          attempt + 1,
          new Error(`HEAD request failed with HTTP ${response.status}`),
        );
      }

      // Retryable: 5xx or 429
      if (isRetryableStatus(response.status)) {
        lastError = new Error(`HEAD request failed with HTTP ${response.status}`);
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      // 2xx — blob exists
      return true;
    } catch (err) {
      // Re-throw non-retryable errors immediately
      if (err instanceof WalrusGetError) throw err;
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelayMs(attempt));
      }
    }
  }

  throw new WalrusGetError(blobId, maxAttempts, lastError);
}

/**
 * Upload `bytes` to Walrus with an automatic CLI fallback.
 *
 * Attempts the standard HTTP `walrusPut` first. If it fails after all retries,
 * falls back to the `walrus` CLI binary (requires WALRUS_CLI_PATH or `walrus`
 * in PATH on the VPS).
 *
 * NEVER silently swallows failures — if both paths fail, the error from the
 * HTTP path is re-thrown (CLI error is logged as a warning).
 *
 * @param bytes       Raw bytes to upload.
 * @param maxAttempts Maximum attempts for the HTTP path (default: 5).
 * @returns `{ blobId, sizeBytes }` on success from either path.
 * @throws `WalrusPutError` if both the HTTP and CLI paths fail.
 */
export async function walrusPutWithCliFallback(
  bytes: Uint8Array,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<{ blobId: string; sizeBytes: number }> {
  // ── Primary: HTTP publisher ──────────────────────────────────────────────
  try {
    return await walrusPut(bytes, maxAttempts);
  } catch (httpErr) {
    console.warn(
      '[WalrusService] HTTP publisher failed — attempting CLI fallback:',
      httpErr instanceof Error ? httpErr.message : String(httpErr),
    );
  }

  // ── Fallback: CLI publisher ──────────────────────────────────────────────
  try {
    const { publishViaWalrusCli } = await import('./walrus-cli-publisher');
    const result = await publishViaWalrusCli(Buffer.from(bytes));
    console.info('[WalrusService] CLI fallback succeeded, blobId:', result.blobId);
    return { blobId: result.blobId, sizeBytes: bytes.length };
  } catch (cliErr) {
    console.warn(
      '[WalrusService] CLI fallback also failed:',
      cliErr instanceof Error ? cliErr.message : String(cliErr),
    );
  }

  // Both paths failed — throw the HTTP error
  throw new WalrusPutError(undefined, maxAttempts, new Error('HTTP and CLI publish both failed'));
}
