/**
 * Infrastructure Wallet Manager — shared types.
 *
 * The Infrastructure_Wallet is a Swrap-managed keypair that executes all
 * Walrus and Seal operations on behalf of Admins and Submitters. Submitters
 * never interact with wallets directly.
 *
 * SECURITY INVARIANTS:
 *   - WalletConfig.privateKey MUST NEVER be logged, included in error
 *     messages, returned in API responses, or serialized anywhere.
 *   - SealResult.plaintext MUST NEVER be logged or persisted.
 */

export interface WalletConfig {
  /** The infrastructure wallet private key. NEVER expose this value. */
  privateKey: string
}

export type SealOperationType = 'encrypt' | 'decrypt' | 'createPolicy'

/**
 * Describes a Seal operation to be executed by the infrastructure wallet.
 *
 * NOTE: Plaintext values are intentionally NOT included here — they are
 * passed as separate parameters to the individual execute functions to
 * avoid accidental logging of sensitive data.
 */
export interface SealOperation {
  type: SealOperationType
  policyId?: string
  encryptedData?: string
  formId?: string
  authorizedRoles?: string[]
}

export interface SealResult {
  encryptedData?: string
  /** Decrypted plaintext. NEVER log this value. */
  plaintext?: string
  policyId?: string
  algorithm?: string
}

/**
 * Error thrown by the wallet manager for configuration and operation failures.
 *
 * Error messages are intentionally safe — they never include key material,
 * plaintext values, or internal implementation details.
 */
export class WalletError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_CONFIGURED' | 'OPERATION_FAILED' | 'INVALID_KEY',
  ) {
    super(message)
    this.name = 'WalletError'
  }
}
