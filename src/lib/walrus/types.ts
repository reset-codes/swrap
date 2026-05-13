/**
 * Walrus decentralized blob storage — shared types.
 *
 * Walrus uses an HTTP REST API:
 *   - Aggregator (reads):  GET  {WALRUS_AGGREGATOR_URL}/v1/blobs/{blobId}
 *   - Publisher  (writes): PUT  {WALRUS_PUBLISHER_URL}/v1/blobs
 */

export interface WalrusBlobInfo {
  blobId: string
  size?: number
}

export interface WalrusWriteResponse {
  /** The Walrus blob ID assigned to the stored data. */
  blobId: string
  /** true if the blob was newly stored; false if it was already certified on the network. */
  isNew: boolean
}

/**
 * Raw publisher response shapes returned by the Walrus publisher endpoint.
 * The publisher returns one of two shapes depending on whether the blob was
 * already known to the network.
 */
export interface WalrusPublisherNewlyCreated {
  newlyCreated: {
    blobObject: {
      blobId: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
}

export interface WalrusPublisherAlreadyCertified {
  alreadyCertified: {
    blobId: string
    [key: string]: unknown
  }
}

export type WalrusPublisherResponse =
  | WalrusPublisherNewlyCreated
  | WalrusPublisherAlreadyCertified

/**
 * Error codes for Walrus operations.
 *
 * - WRITE_FAILED:          The blob could not be written after all retries.
 * - READ_FAILED:           The blob could not be fetched after all retries.
 * - INSUFFICIENT_CREDITS:  The admin does not have enough storage credits.
 * - NETWORK_ERROR:         A network-level failure occurred (DNS, timeout, etc.).
 * - INVALID_RESPONSE:      The Walrus API returned an unexpected response shape.
 */
export type WalrusErrorCode =
  | 'WRITE_FAILED'
  | 'READ_FAILED'
  | 'INSUFFICIENT_CREDITS'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'

export class WalrusError extends Error {
  constructor(
    message: string,
    public readonly code: WalrusErrorCode,
    public readonly retryable: boolean = false,
  ) {
    super(message)
    this.name = 'WalrusError'
  }
}
