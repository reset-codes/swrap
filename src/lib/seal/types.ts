/**
 * Seal encryption client — shared types.
 *
 * Seal provides field-level and full-submission encryption with access-control
 * policies. The interface is designed to be compatible with the @mysten/seal
 * SDK when it becomes available as a stable npm package.
 *
 * Current implementation: AES-256-GCM via Node.js built-in `crypto` module.
 * This is a real encryption implementation, not a mock. The interface is
 * intentionally swappable with the real Seal SDK later.
 */

export interface SealEncryptResult {
  /** Base64-encoded encrypted blob (iv + authTag + ciphertext). */
  encryptedData: string
  /** The Seal policy ID used for this encryption. */
  policyId: string
  /** Algorithm identifier — 'AES-256-GCM' for the current implementation. */
  algorithm: string
}

export interface SealDecryptResult {
  /** Decrypted plaintext string. NEVER log or persist this value. */
  plaintext: string
}

export interface SealPolicy {
  /** Unique identifier for this access-control policy. */
  policyId: string
  /** The form this policy is associated with. */
  formId: string
  /** Roles authorized to decrypt data under this policy. */
  authorizedRoles: string[]
  /** ISO 8601 timestamp of policy creation. */
  createdAt: string
}

/**
 * Error codes for Seal operations.
 *
 * - ENCRYPT_FAILED:    Encryption could not be completed.
 * - DECRYPT_FAILED:    Decryption could not be completed (wrong key, tampered data, etc.).
 * - POLICY_NOT_FOUND:  The requested Seal policy does not exist.
 * - UNAUTHORIZED:      The caller does not have permission to perform the operation.
 * - INVALID_KEY:       The provided key material is invalid or malformed.
 * - NETWORK_ERROR:     A network-level failure occurred communicating with the Seal service.
 * - NOT_CONFIGURED:    Required environment variables for Seal are not set.
 */
export type SealErrorCode =
  | 'ENCRYPT_FAILED'
  | 'DECRYPT_FAILED'
  | 'POLICY_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID_KEY'
  | 'NETWORK_ERROR'
  | 'NOT_CONFIGURED'

export class SealError extends Error {
  constructor(
    message: string,
    public readonly code: SealErrorCode,
  ) {
    super(message)
    this.name = 'SealError'
  }
}
