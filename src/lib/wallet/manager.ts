/**
 * Infrastructure Wallet Manager.
 *
 * Manages the SEALBASE infrastructure keypair and wraps all Walrus and Seal
 * operations with wallet-level context. This is the single point of contact
 * for all blockchain-adjacent operations — Submitters and Admins never
 * interact with wallets directly.
 *
 * SECURITY INVARIANTS (enforced throughout this module):
 *   - INFRA_WALLET_PRIVATE_KEY is NEVER logged, included in error messages,
 *     returned in API responses, or serialized anywhere.
 *   - Decrypted plaintext values are NEVER logged or persisted.
 *   - All error messages are safe for external consumption.
 *
 * Environment variables:
 *   INFRA_WALLET_PRIVATE_KEY — the infrastructure wallet private key.
 *                              Required at runtime; absence throws WalletError.
 *
 * Requirement: R15 — Infrastructure Wallet and Blockchain Abstraction
 */

import { readBlob, writeBlob } from '@/lib/walrus/client'
import { createPolicy, decrypt, encrypt } from '@/lib/seal/client'
import { WalletError } from './types'

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * Read the infrastructure wallet private key from the environment.
 *
 * SECURITY: The returned value is key material. Callers MUST NOT log it,
 * include it in error messages, or return it in API responses.
 *
 * @throws WalletError with 'NOT_CONFIGURED' if the env var is absent or empty.
 */
export function getInfraWalletKey(): string {
  const key = process.env.INFRA_WALLET_PRIVATE_KEY
  if (!key || key.trim() === '') {
    // Safe message — does not hint at the key value
    throw new WalletError(
      'Infrastructure wallet is not configured. Please set INFRA_WALLET_PRIVATE_KEY.',
      'NOT_CONFIGURED',
    )
  }
  // SECURITY: key is returned directly — never log it here or in callers
  return key
}

/**
 * Returns the infrastructure wallet key for use as adminKey in Seal
 * decryption operations.
 *
 * SECURITY: The returned value is key material. NEVER log this.
 *
 * @throws WalletError with 'NOT_CONFIGURED' if the env var is absent or empty.
 */
export function getAdminDecryptKey(): string {
  // Delegates to getInfraWalletKey — single source of truth for key retrieval
  return getInfraWalletKey()
}

// ---------------------------------------------------------------------------
// Walrus operations
// ---------------------------------------------------------------------------

/**
 * Write a blob to Walrus using the infrastructure wallet.
 *
 * In MVP, the infrastructure wallet "authorizes" the write via the HTTP call.
 * In production, this would sign the transaction with the wallet keypair.
 *
 * @param data         The content to store.
 * @param contentType  MIME type. Defaults to 'application/octet-stream'.
 * @returns            The Walrus blob ID for the stored data.
 * @throws             WalletError with 'OPERATION_FAILED' on failure.
 */
export async function executeWalrusWrite(
  data: Buffer,
  contentType = 'application/octet-stream',
): Promise<{ blobId: string }> {
  // Validate the wallet is configured before attempting the write
  getInfraWalletKey()

  try {
    const result = await writeBlob(data, contentType)
    return { blobId: result.blobId }
  } catch {
    // Re-throw as WalletError with a safe message — never expose internals
    throw new WalletError(
      'Walrus write operation failed. Please try again.',
      'OPERATION_FAILED',
    )
  }
}

/**
 * Read a blob from Walrus using the infrastructure wallet.
 *
 * @param blobId  The Walrus blob ID to fetch.
 * @returns       The raw blob content as a Buffer.
 * @throws        WalletError with 'OPERATION_FAILED' on failure.
 */
export async function executeWalrusRead(blobId: string): Promise<Buffer> {
  // Validate the wallet is configured before attempting the read
  getInfraWalletKey()

  try {
    return await readBlob(blobId)
  } catch {
    throw new WalletError(
      'Walrus read operation failed. Please try again.',
      'OPERATION_FAILED',
    )
  }
}

// ---------------------------------------------------------------------------
// Seal operations
// ---------------------------------------------------------------------------

/**
 * Encrypt a string value under a Seal policy using the infrastructure wallet.
 *
 * SECURITY: The `value` parameter is NEVER logged or included in errors.
 *
 * @param value     The plaintext string to encrypt.
 * @param policyId  The Seal policy ID governing decryption access.
 * @returns         The base64-encoded encrypted blob and algorithm identifier.
 * @throws          WalletError with 'OPERATION_FAILED' on failure.
 */
export async function executeSealEncrypt(
  value: string,
  policyId: string,
): Promise<{ encryptedData: string; algorithm: string }> {
  getInfraWalletKey()

  try {
    // SECURITY: `value` is passed directly — never referenced in logs below
    const result = await encrypt(value, policyId)
    return {
      encryptedData: result.encryptedData,
      algorithm: result.algorithm,
    }
  } catch {
    // Do NOT include `value` or any derivative in this error message
    throw new WalletError(
      'Seal encryption operation failed.',
      'OPERATION_FAILED',
    )
  }
}

/**
 * Decrypt an encrypted blob in-memory using the infrastructure wallet key.
 *
 * SECURITY: The returned plaintext is NEVER logged or persisted. Callers
 * must treat the result as ephemeral and display-only.
 *
 * @param encryptedData  Base64-encoded encrypted blob from executeSealEncrypt.
 * @returns              The decrypted plaintext wrapped in an object.
 * @throws               WalletError with 'OPERATION_FAILED' on failure,
 *                       or 'NOT_CONFIGURED' if the wallet key is absent.
 */
export async function executeSealDecrypt(
  encryptedData: string,
): Promise<{ plaintext: string }> {
  // SECURITY: adminKey is key material — never log it
  const adminKey = getInfraWalletKey()

  try {
    // SECURITY: The result of decrypt contains plaintext — never log it
    const result = await decrypt(encryptedData, adminKey)
    return { plaintext: result.plaintext }
  } catch (err) {
    if (err instanceof WalletError) throw err
    // Do NOT include any plaintext hints in this error message
    throw new WalletError(
      'Seal decryption operation failed.',
      'OPERATION_FAILED',
    )
  }
}

/**
 * Create a Seal access-control policy for a form using the infrastructure wallet.
 *
 * @param formId           The form this policy is associated with.
 * @param authorizedRoles  Roles permitted to decrypt (e.g., ['admin', 'owner']).
 * @returns                The created policy ID.
 * @throws                 WalletError with 'OPERATION_FAILED' on failure.
 */
export async function executeSealCreatePolicy(
  formId: string,
  authorizedRoles: string[],
): Promise<{ policyId: string }> {
  getInfraWalletKey()

  try {
    const policy = await createPolicy(formId, authorizedRoles)
    return { policyId: policy.policyId }
  } catch {
    throw new WalletError(
      'Seal policy creation failed.',
      'OPERATION_FAILED',
    )
  }
}
