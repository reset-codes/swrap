/**
 * Seal encryption client — public API surface.
 *
 * Re-exports all types and client functions so consumers can import from
 * a single path:
 *
 *   import { encrypt, decrypt, createPolicy, SealError } from '@/lib/seal'
 */

export type {
  SealEncryptResult,
  SealDecryptResult,
  SealPolicy,
  SealErrorCode,
} from './types'

export { SealError } from './types'

export {
  encrypt,
  decrypt,
  createPolicy,
  encryptObject,
  decryptObject,
} from './client'
