/**
 * Walrus client — public API surface.
 *
 * Re-exports all types and client functions so consumers can import from
 * a single path:
 *
 *   import { writeBlob, readBlob, WalrusError } from '@/lib/walrus'
 */

export type {
  WalrusBlobInfo,
  WalrusWriteResponse,
  WalrusPublisherResponse,
  WalrusPublisherNewlyCreated,
  WalrusPublisherAlreadyCertified,
  WalrusErrorCode,
} from './types'

export { WalrusError } from './types'

export { writeBlob, readBlob, readBlobAsText, readBlobAsJson } from './client'
