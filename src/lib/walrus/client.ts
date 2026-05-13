/**
 * Walrus HTTP client wrapper.
 *
 * Implements typed read/write operations against the Walrus aggregator and
 * publisher REST endpoints. All operations include retry logic with
 * exponential backoff (max 3 retries: 1 s, 2 s, 4 s delays).
 *
 * Environment variables:
 *   WALRUS_AGGREGATOR_URL — base URL for blob reads
 *   WALRUS_PUBLISHER_URL  — base URL for blob writes
 *
 * These may be absent during build time; the client handles that gracefully
 * by throwing a WalrusError at call time rather than at module load time.
 */

import {
  WalrusError,
  WalrusPublisherResponse,
  WalrusWriteResponse,
} from './types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Retry wrapper with exponential backoff.
 *
 * Attempts `fn` up to `maxRetries + 1` times total. On each failure before
 * the last attempt it waits `baseDelayMs * 2^attempt` milliseconds.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err as Error
      if (attempt < maxRetries) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)),
        )
      }
    }
  }

  // lastError is always set here because the loop runs at least once and
  // only reaches this point after a catch.
  throw lastError!
}

/**
 * Returns true for HTTP status codes that are worth retrying (network
 * infrastructure errors, not client mistakes).
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600
}

/**
 * Resolve the aggregator base URL, throwing a clear error if not configured.
 */
function getAggregatorUrl(): string {
  const url = process.env.WALRUS_AGGREGATOR_URL
  if (!url) {
    throw new WalrusError(
      'Walrus aggregator is not configured. Please set WALRUS_AGGREGATOR_URL.',
      'NETWORK_ERROR',
      false,
    )
  }
  return url.replace(/\/$/, '') // strip trailing slash
}

/**
 * Resolve the publisher base URL, throwing a clear error if not configured.
 */
function getPublisherUrl(): string {
  const url = process.env.WALRUS_PUBLISHER_URL
  if (!url) {
    throw new WalrusError(
      'Walrus publisher is not configured. Please set WALRUS_PUBLISHER_URL.',
      'NETWORK_ERROR',
      false,
    )
  }
  return url.replace(/\/$/, '') // strip trailing slash
}

/**
 * Parse the raw publisher response into a normalised WalrusWriteResponse.
 * Throws WalrusError with INVALID_RESPONSE if the shape is unrecognised.
 */
function parsePublisherResponse(raw: WalrusPublisherResponse): WalrusWriteResponse {
  if ('newlyCreated' in raw && raw.newlyCreated?.blobObject?.blobId) {
    return {
      blobId: raw.newlyCreated.blobObject.blobId,
      isNew: true,
    }
  }

  if ('alreadyCertified' in raw && raw.alreadyCertified?.blobId) {
    return {
      blobId: raw.alreadyCertified.blobId,
      isNew: false,
    }
  }

  throw new WalrusError(
    'Received an unexpected response from the Walrus publisher. Please try again.',
    'INVALID_RESPONSE',
    false,
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write a blob to Walrus.
 *
 * @param data        The content to store — a Buffer or a UTF-8 string.
 * @param contentType MIME type sent as the Content-Type header.
 *                    Defaults to 'application/octet-stream'.
 * @returns           The blob ID and whether the blob was newly created.
 * @throws            WalrusError on failure after all retries.
 */
export async function writeBlob(
  data: Buffer | string,
  contentType = 'application/octet-stream',
): Promise<WalrusWriteResponse> {
  const publisherUrl = getPublisherUrl()
  const endpoint = `${publisherUrl}/v1/blobs`

  const buffer: Buffer =
    typeof data === 'string' ? Buffer.from(data, 'utf-8') : data

  // Use Buffer directly as the body — Node.js fetch handles it natively.
  const ownedBuffer = Buffer.from(buffer)

  return withRetry(async () => {
    let response: Response

    try {
      response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        body: ownedBuffer,
      })
    } catch {
      // fetch() itself threw — DNS failure, connection refused, timeout, etc.
      throw new WalrusError(
        'Unable to reach the Walrus storage network. Please check your connection and try again.',
        'NETWORK_ERROR',
        true,
      )
    }

    if (!response.ok) {
      const retryable = isRetryableStatus(response.status)
      throw new WalrusError(
        'Failed to store data on Walrus. Please try again.',
        'WRITE_FAILED',
        retryable,
      )
    }

    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw new WalrusError(
        'Received an unreadable response from the Walrus publisher.',
        'INVALID_RESPONSE',
        false,
      )
    }

    return parsePublisherResponse(json as WalrusPublisherResponse)
  })
}

/**
 * Read a blob from Walrus by its blob ID.
 *
 * @param blobId  The Walrus blob ID to fetch.
 * @returns       The raw blob content as a Buffer.
 * @throws        WalrusError on failure after all retries.
 */
export async function readBlob(blobId: string): Promise<Buffer> {
  const aggregatorUrl = getAggregatorUrl()
  const endpoint = `${aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`

  return withRetry(async () => {
    let response: Response

    try {
      response = await fetch(endpoint, { method: 'GET' })
    } catch {
      throw new WalrusError(
        'Unable to reach the Walrus storage network. Please check your connection and try again.',
        'NETWORK_ERROR',
        true,
      )
    }

    if (!response.ok) {
      const retryable = isRetryableStatus(response.status)
      throw new WalrusError(
        'Failed to retrieve data from Walrus. Please try again.',
        'READ_FAILED',
        retryable,
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  })
}

/**
 * Read a blob from Walrus and decode it as a UTF-8 string.
 *
 * @param blobId  The Walrus blob ID to fetch.
 * @returns       The blob content as a string.
 * @throws        WalrusError on failure after all retries.
 */
export async function readBlobAsText(blobId: string): Promise<string> {
  const buffer = await readBlob(blobId)
  return buffer.toString('utf-8')
}

/**
 * Read a blob from Walrus and parse it as JSON.
 *
 * @param blobId  The Walrus blob ID to fetch.
 * @returns       The parsed JSON value typed as T.
 * @throws        WalrusError on network/read failure.
 * @throws        SyntaxError if the blob content is not valid JSON.
 */
export async function readBlobAsJson<T>(blobId: string): Promise<T> {
  const text = await readBlobAsText(blobId)
  return JSON.parse(text) as T
}
