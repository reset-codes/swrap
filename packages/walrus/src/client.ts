/**
 * Walrus_Client — pure HTTP client for uploading and retrieving blobs on
 * Walrus testnet.
 *
 * Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WalrusClientConfig {
  publisherUrl: string;
  aggregatorUrl: string;
  /** Upload timeout in ms. Default: 30_000 (R10.3) */
  uploadTimeoutMs?: number;
  /** Retrieve timeout in ms. Default: 30_000 (R10.6) */
  retrieveTimeoutMs?: number;
  /** Health-check timeout per endpoint in ms. Default: 10_000 (R5.2) */
  healthTimeoutMs?: number;
  /** Default number of epochs to store blobs. Default: 1 */
  defaultEpochs?: number;
  /** Retry backoff delays in ms. Default: [1000, 2000, 4000]. Override in tests to speed up. */
  retryDelaysMs?: [number, number, number];
}

export type WalrusBlobId = string;

export interface WalrusPutResult {
  blobId: WalrusBlobId;
  isNew: boolean;
  /** The publisher URL used for this upload. */
  endpoint: string;
}

export interface WalrusHealthResult {
  ok: boolean;
  publisher: { ok: boolean; url: string; latencyMs: number; reason?: string };
  aggregator: { ok: boolean; url: string; latencyMs: number; reason?: string };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * All nine error codes from design.md.
 */
export type WalrusErrorCode =
  | 'PUBLISHER_UNREACHABLE'
  | 'AGGREGATOR_UNREACHABLE'
  | 'AGGREGATOR_NOT_FOUND'
  | 'UPLOAD_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'HEALTH_PUBLISHER_FAIL'
  | 'HEALTH_AGGREGATOR_FAIL'
  | 'SIGNER_NOT_READY'
  | 'PLAINTEXT_DISABLED';

export class WalrusError extends Error {
  constructor(
    public readonly code: WalrusErrorCode,
    public readonly endpoint: string,
    public readonly reason: string,
  ) {
    super(`${code} @ ${endpoint}: ${reason}`);
    this.name = 'WalrusError';
  }
}

// ---------------------------------------------------------------------------
// WalrusClient interface
// ---------------------------------------------------------------------------

export interface WalrusClient {
  put(
    bytes: Uint8Array,
    opts?: { epochs?: number; signal?: AbortSignal },
  ): Promise<WalrusPutResult>;
  get(blobId: WalrusBlobId, signal?: AbortSignal): Promise<Uint8Array>;
  healthCheck(): Promise<{
    ok: boolean;
    publisher: { ok: boolean; url: string };
    aggregator: { ok: boolean; url: string };
    signerStatus: 'ready' | 'not_ready';
  }>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIEVE_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;
const DEFAULT_EPOCHS = 1;

/** Retry backoff delays in ms: 1s, 2s, 4s */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const MAX_ATTEMPTS = 3;

/** Health-check cache TTL in ms (5 seconds). */
const HEALTH_CACHE_TTL_MS = 5_000;

// ---------------------------------------------------------------------------
// Response shapes from the Walrus publisher
// ---------------------------------------------------------------------------

interface NewlyCreatedResponse {
  newlyCreated: {
    blobObject: {
      blobId: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

interface AlreadyCertifiedResponse {
  alreadyCertified: {
    blobId: string;
    [key: string]: unknown;
  };
}

type PublisherResponse = NewlyCreatedResponse | AlreadyCertifiedResponse;

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
// Retry helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the error is retryable (5xx or network-level error).
 * 4xx errors (including 404) are never retried.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof WalrusError) {
    // AGGREGATOR_NOT_FOUND (404) is never retried
    if (err.code === 'AGGREGATOR_NOT_FOUND') return false;
    // 4xx errors are never retried
    if (err.code === 'UPLOAD_FAILED' || err.code === 'DOWNLOAD_FAILED') return false;
    // Network-level errors and 5xx are retried
    return (
      err.code === 'PUBLISHER_UNREACHABLE' ||
      err.code === 'AGGREGATOR_UNREACHABLE'
    );
  }
  // Raw network errors (fetch failures) are retried
  return true;
}

/**
 * Sleep for `ms` milliseconds, respecting an optional AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Execute `fn` with up to `MAX_ATTEMPTS` attempts, using exponential backoff
 * on retryable errors. Non-retryable errors are thrown immediately.
 */
async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  signal?: AbortSignal,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(delays[attempt], signal);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Perform a fetch with an AbortSignal timeout.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If an external signal is provided, abort our controller when it fires.
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `WalrusClient` configured with the given endpoints and timeouts.
 *
 * Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6
 */
export function createWalrusClient(config: WalrusClientConfig): WalrusClient {
  const {
    publisherUrl,
    aggregatorUrl,
    uploadTimeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
    retrieveTimeoutMs = DEFAULT_RETRIEVE_TIMEOUT_MS,
    healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    defaultEpochs = DEFAULT_EPOCHS,
    retryDelaysMs = RETRY_DELAYS_MS,
  } = config;

  // Normalise URLs: strip trailing slashes.
  const publisher = publisherUrl.replace(/\/+$/, '');
  const aggregator = aggregatorUrl.replace(/\/+$/, '');

  // Health-check cache state.
  let healthCache: {
    result: Awaited<ReturnType<WalrusClient['healthCheck']>>;
    cachedAt: number;
  } | null = null;

  // ---------------------------------------------------------------------------
  // put
  // ---------------------------------------------------------------------------

  async function put(
    bytes: Uint8Array,
    opts?: { epochs?: number; signal?: AbortSignal },
  ): Promise<WalrusPutResult> {
    const epochs = opts?.epochs ?? defaultEpochs;
    const signal = opts?.signal;
    const url = `${publisher}/v1/blobs?epochs=${epochs}`;

    return withRetry(async () => {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          url,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            // Convert to Buffer so TypeScript's BodyInit type is satisfied.
            body: Buffer.from(bytes),
          },
          uploadTimeoutMs,
          signal,
        );
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        throw new WalrusError('PUBLISHER_UNREACHABLE', publisher, `Network error: ${message}`);
      }
      // 4xx errors are never retried — throw UPLOAD_FAILED immediately.
      if (response.status >= 400 && response.status < 500) {
        const body = await response.text().catch(() => '');
        throw new WalrusError(
          'UPLOAD_FAILED',
          publisher,
          `HTTP ${response.status}: ${body}`,
        );
      }

      // 5xx errors are retried — throw PUBLISHER_UNREACHABLE.
      if (response.status >= 500) {
        const body = await response.text().catch(() => '');
        throw new WalrusError(
          'PUBLISHER_UNREACHABLE',
          publisher,
          `HTTP ${response.status}: ${body}`,
        );
      }

      // Parse the response body.
      let json: unknown;
      try {
        json = await response.json();
      } catch (err) {
        throw new WalrusError(
          'UPLOAD_FAILED',
          publisher,
          `Failed to parse publisher response: ${(err as Error).message}`,
        );
      }

      if (isNewlyCreated(json)) {
        return {
          blobId: json.newlyCreated.blobObject.blobId,
          isNew: true,
          endpoint: publisher,
        };
      }

      if (isAlreadyCertified(json)) {
        return {
          blobId: json.alreadyCertified.blobId,
          isNew: false,
          endpoint: publisher,
        };
      }

      throw new WalrusError(
        'UPLOAD_FAILED',
        publisher,
        `Unexpected publisher response shape: ${JSON.stringify(json).slice(0, 200)}`,
      );
    }, signal, retryDelaysMs);
  }

  // ---------------------------------------------------------------------------
  // get
  // ---------------------------------------------------------------------------

  async function get(blobId: WalrusBlobId, signal?: AbortSignal): Promise<Uint8Array> {
    const url = `${aggregator}/v1/blobs/${encodeURIComponent(blobId)}`;

    return withRetry(async () => {
      let response: Response;
      try {
        response = await fetchWithTimeout(url, { method: 'GET' }, retrieveTimeoutMs, signal);
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        throw new WalrusError('AGGREGATOR_UNREACHABLE', aggregator, `Network error: ${message}`);
      }

      // 404 — blob not found, never retry.
      if (response.status === 404) {
        throw new WalrusError(
          'AGGREGATOR_NOT_FOUND',
          aggregator,
          `Blob not found: ${blobId}`,
        );
      }

      // Other 4xx — download failed, never retry.
      if (response.status >= 400 && response.status < 500) {
        const body = await response.text().catch(() => '');
        throw new WalrusError(
          'DOWNLOAD_FAILED',
          aggregator,
          `HTTP ${response.status}: ${body}`,
        );
      }

      // 5xx — retryable.
      if (response.status >= 500) {
        const body = await response.text().catch(() => '');
        throw new WalrusError(
          'AGGREGATOR_UNREACHABLE',
          aggregator,
          `HTTP ${response.status}: ${body}`,
        );
      }

      try {
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      } catch (err) {
        throw new WalrusError(
          'DOWNLOAD_FAILED',
          aggregator,
          `Failed to read response body: ${(err as Error).message}`,
        );
      }
    }, signal, retryDelaysMs);
  }

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------

  async function healthCheck(): Promise<{
    ok: boolean;
    publisher: { ok: boolean; url: string };
    aggregator: { ok: boolean; url: string };
    signerStatus: 'ready' | 'not_ready';
  }> {
    const now = Date.now();

    // Return cached result if still fresh (5s TTL).
    if (healthCache && now - healthCache.cachedAt < HEALTH_CACHE_TTL_MS) {
      return healthCache.result;
    }

    // Probe publisher and aggregator in parallel, each with its own AbortController.
    const [publisherResult, aggregatorResult] = await Promise.all([
      probeEndpoint(publisher, healthTimeoutMs),
      probeEndpoint(aggregator, healthTimeoutMs),
    ]);

    const publisherOk = publisherResult.ok;
    const aggregatorOk = aggregatorResult.ok;
    const allOk = publisherOk && aggregatorOk;

    const result = {
      ok: allOk,
      publisher: { ok: publisherOk, url: publisher },
      aggregator: { ok: aggregatorOk, url: aggregator },
      // signerStatus is 'ready' only when both endpoints are healthy.
      // The Walrus HTTP publisher does not require client-side signing, so
      // signer readiness is defined as: both health probes green.
      // (R5.3, R5.5, R5.6)
      signerStatus: allOk ? ('ready' as const) : ('not_ready' as const),
    };

    // Cache the result.
    healthCache = { result, cachedAt: now };

    // Throw descriptive errors if either endpoint failed (R5.4).
    if (!publisherOk) {
      throw new WalrusError(
        'HEALTH_PUBLISHER_FAIL',
        publisher,
        publisherResult.reason ?? 'Publisher health check failed',
      );
    }
    if (!aggregatorOk) {
      throw new WalrusError(
        'HEALTH_AGGREGATOR_FAIL',
        aggregator,
        aggregatorResult.reason ?? 'Aggregator health check failed',
      );
    }

    return result;
  }

  return { put, get, healthCheck };
}

// ---------------------------------------------------------------------------
// Internal: probe a single endpoint
// ---------------------------------------------------------------------------

interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  reason?: string;
}

/**
 * Probe `${baseUrl}/v1/api` with a dedicated AbortController set to
 * `timeoutMs`. Returns `{ ok, latencyMs, reason? }`.
 */
async function probeEndpoint(baseUrl: string, timeoutMs: number): Promise<ProbeResult> {
  const url = `${baseUrl}/v1/api`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    const latencyMs = Date.now() - start;
    clearTimeout(timeoutId);

    if (response.ok) {
      return { ok: true, latencyMs };
    }

    return {
      ok: false,
      latencyMs,
      reason: `HTTP ${response.status} from ${url}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    const message = (err as Error)?.message ?? String(err);
    const isTimeout =
      message.toLowerCase().includes('abort') ||
      message.toLowerCase().includes('timeout') ||
      (err instanceof Error && err.name === 'AbortError');

    return {
      ok: false,
      latencyMs,
      reason: isTimeout ? `Timeout after ${timeoutMs}ms` : `Network error: ${message}`,
    };
  }
}
