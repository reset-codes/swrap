/**
 * apps/web/lib/walrus/walrus-client.ts
 *
 * Canonical Walrus client for the Web_App.
 *
 * This is the ONLY module in `apps/web` that makes direct Walrus calls.
 * All components that need to PUT or GET blobs from Walrus MUST import
 * from this module.
 *
 * Exports:
 *   - `walrusPut(bytes)`         — upload bytes to the Walrus publisher
 *   - `walrusGet(blobId)`        — fetch bytes from the Walrus aggregator
 *   - `verifyIntegrity(bytes, recordedDigest)` — SHA-256 comparison
 *   - `IntegrityError`           — thrown on digest mismatch
 *   - `WalrusFetchError`         — thrown after retry exhaustion
 *
 * Retry/backoff strategy (same as server-side):
 *   - Attempts: configurable, default 5
 *   - Backoff: exponential with jitter — min(2^n * 100ms + rand(0..100ms), 10s)
 *   - Retryable: network errors, 5xx, 429
 *   - Non-retryable: 404, integrity-digest mismatch
 *   - After exhaustion: WalrusFetchError with attempt log
 *
 * Configuration via environment variables:
 *   - NEXT_PUBLIC_WALRUS_PUBLISHER_URL
 *   - NEXT_PUBLIC_WALRUS_AGGREGATOR_URL
 *
 * Requirements: 3.8, 3.9
 */

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
 * Thrown when fetched bytes do not match the expected SHA-256 digest.
 *
 * The caller MUST NOT render or return the fetched bytes as authentic
 * when this error is thrown (Requirement 3.9).
 */
export class IntegrityError extends Error {
  readonly code = 'INTEGRITY_MISMATCH' as const;

  constructor(
    public readonly expectedDigest: string,
    public readonly actualDigest: string,
  ) {
    super(
      `Integrity check failed: expected SHA-256 ${expectedDigest}, got ${actualDigest}`,
    );
    this.name = 'IntegrityError';
  }
}

/**
 * Thrown when a Walrus GET operation fails after all retry attempts.
 *
 * Contains the attempt log for debugging and user-facing retry affordances.
 */
export class WalrusFetchError extends Error {
  readonly code = 'WALRUS_FETCH_FAILED' as const;

  constructor(
    public readonly blobId: string,
    public readonly attempts: number,
    public readonly attemptLog: string[],
    cause?: unknown,
  ) {
    super(
      `Walrus GET for blob "${blobId}" failed after ${attempts} attempt(s)`,
    );
    this.name = 'WalrusFetchError';
    if (cause instanceof Error) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Thrown when a Walrus PUT operation fails after all retry attempts.
 */
export class WalrusPutError extends Error {
  readonly code = 'WALRUS_PUT_FAILED' as const;

  constructor(
    public readonly attempts: number,
    public readonly attemptLog: string[],
    cause?: unknown,
  ) {
    super(`Walrus PUT failed after ${attempts} attempt(s)`);
    this.name = 'WalrusPutError';
    if (cause instanceof Error) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute a hex-encoded SHA-256 digest over `bytes` using the Web Crypto API.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const data = new Uint8Array(bytes);
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  );
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
 * Returns `true` if the HTTP status code is retryable.
 *
 * Retryable: 5xx, 429.
 * Non-retryable: 404, other 4xx.
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
  const url = process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL;
  if (!url) {
    throw new WalrusPutError(0, [], new Error('NEXT_PUBLIC_WALRUS_PUBLISHER_URL is not configured'));
  }
  return url.replace(/\/+$/, '');
}

/**
 * Read the Walrus aggregator URL from the environment.
 * Strips trailing slashes.
 */
function aggregatorUrl(): string {
  const url = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL;
  if (!url) {
    throw new WalrusFetchError(
      '(unknown)',
      0,
      ['NEXT_PUBLIC_WALRUS_AGGREGATOR_URL is not configured'],
    );
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

  const attemptLog: string[] = [];
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
            body: bytes as unknown as BodyInit,
          },
          DEFAULT_TIMEOUT_MS,
        );
      } catch (networkErr) {
        // Network-level error — always retryable
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        attemptLog.push(`Attempt ${attempt + 1}: network error — ${msg}`);
        lastError = networkErr;
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      // Non-retryable 4xx (not 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const body = await response.text().catch(() => '');
        attemptLog.push(`Attempt ${attempt + 1}: HTTP ${response.status} (non-retryable) — ${body}`);
        throw new WalrusPutError(
          attempt + 1,
          attemptLog,
          new Error(`HTTP ${response.status}: ${body}`),
        );
      }

      // Retryable: 5xx or 429
      if (isRetryableStatus(response.status)) {
        const body = await response.text().catch(() => '');
        attemptLog.push(`Attempt ${attempt + 1}: HTTP ${response.status} (retryable) — ${body}`);
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
        attemptLog.push(`Attempt ${attempt + 1}: failed to parse response`);
        throw new WalrusPutError(
          attempt + 1,
          attemptLog,
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

      attemptLog.push(`Attempt ${attempt + 1}: unexpected response shape`);
      throw new WalrusPutError(
        attempt + 1,
        attemptLog,
        new Error(
          `Unexpected publisher response shape: ${JSON.stringify(json).slice(0, 200)}`,
        ),
      );
    } catch (err) {
      // Re-throw non-retryable errors immediately
      if (err instanceof WalrusPutError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      attemptLog.push(`Attempt ${attempt + 1}: unexpected error — ${msg}`);
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelayMs(attempt));
      }
    }
  }

  throw new WalrusPutError(maxAttempts, attemptLog, lastError);
}

/**
 * Fetch bytes for `blobId` from the Walrus aggregator.
 *
 * Retries on 5xx, 429, and network errors with bounded exponential backoff.
 * Does NOT retry on 404 (blob not found) or integrity mismatch.
 *
 * @param blobId      Walrus blob identifier.
 * @param maxAttempts Maximum number of attempts (default: 5).
 * @returns Raw bytes from Walrus.
 * @throws `WalrusFetchError` after all attempts are exhausted.
 *
 * Requirements: 3.8, 3.9
 */
export async function walrusGet(
  blobId: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<Uint8Array> {
  const base = aggregatorUrl();
  const url = `${base}/v1/blobs/${encodeURIComponent(blobId)}`;

  const attemptLog: string[] = [];
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let response: Response;
      try {
        response = await fetchWithTimeout(url, { method: 'GET' }, DEFAULT_TIMEOUT_MS);
      } catch (networkErr) {
        // Network-level error — always retryable
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        attemptLog.push(`Attempt ${attempt + 1}: network error — ${msg}`);
        lastError = networkErr;
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      // 404 — blob not found, never retry
      if (response.status === 404) {
        const body = await response.text().catch(() => '');
        attemptLog.push(`Attempt ${attempt + 1}: 404 not found (non-retryable)`);
        throw new WalrusFetchError(
          blobId,
          attempt + 1,
          attemptLog,
          new Error(`Blob not found (404): ${body}`),
        );
      }

      // Non-retryable 4xx (not 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const body = await response.text().catch(() => '');
        attemptLog.push(`Attempt ${attempt + 1}: HTTP ${response.status} (non-retryable)`);
        throw new WalrusFetchError(
          blobId,
          attempt + 1,
          attemptLog,
          new Error(`HTTP ${response.status}: ${body}`),
        );
      }

      // Retryable: 5xx or 429
      if (isRetryableStatus(response.status)) {
        const body = await response.text().catch(() => '');
        attemptLog.push(`Attempt ${attempt + 1}: HTTP ${response.status} (retryable) — ${body}`);
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
        const msg = readErr instanceof Error ? readErr.message : String(readErr);
        attemptLog.push(`Attempt ${attempt + 1}: failed to read body — ${msg}`);
        lastError = new Error(`Failed to read response body: ${msg}`);
        if (attempt < maxAttempts - 1) {
          await sleep(backoffDelayMs(attempt));
        }
        continue;
      }

      return new Uint8Array(buffer);
    } catch (err) {
      // Re-throw non-retryable errors immediately
      if (err instanceof WalrusFetchError || err instanceof IntegrityError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      attemptLog.push(`Attempt ${attempt + 1}: unexpected error — ${msg}`);
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelayMs(attempt));
      }
    }
  }

  throw new WalrusFetchError(blobId, maxAttempts, attemptLog, lastError);
}

/**
 * Verify the integrity of fetched bytes against a recorded SHA-256 digest.
 *
 * Throws `IntegrityError` on mismatch. The caller MUST NOT render or return
 * the bytes as authentic when this error is thrown (Requirement 3.9).
 *
 * @param bytes          The fetched bytes to verify.
 * @param recordedDigest The expected hex-encoded SHA-256 digest.
 * @returns `true` if the digest matches.
 * @throws `IntegrityError` if the digest does not match.
 *
 * Requirements: 3.9
 */
export async function verifyIntegrity(
  bytes: Uint8Array,
  recordedDigest: string,
): Promise<boolean> {
  const actualDigest = await sha256Hex(bytes);
  if (actualDigest !== recordedDigest) {
    throw new IntegrityError(recordedDigest, actualDigest);
  }
  return true;
}
