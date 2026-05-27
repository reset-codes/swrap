/**
 * Infrastructure Wallet Manager.
 *
 * Manages the Swrap infrastructure keypair and wraps all Walrus and Seal
 * operations with wallet-level context. This is the single point of contact
 * for all blockchain-adjacent operations — Submitters and Admins never
 * interact with wallets directly.
 *
 * SECURITY INVARIANTS (enforced throughout this module):
 *   - INFRA_WALLET_PRIVATE_KEY is NEVER logged, included in error messages,
 *     returned in API responses, or serialized anywhere.
 *   - Decrypted plaintext values are NEVER logged or persisted.
 *   - All error messages surfaced to callers are safe for external consumption.
 *
 * Environment variables:
 *   INFRA_WALLET_PRIVATE_KEY — the infrastructure wallet private key.
 *                              Required at runtime; absence throws WalletError.
 *
 * Requirement: R15 — Infrastructure Wallet and Blockchain Abstraction
 */

import { WalletError } from './types'

// ---------------------------------------------------------------------------
// Inline Walrus helpers (src/lib/walrus was removed as a duplicate module;
// these minimal helpers replace the deleted client for legacy src/ routes)
// ---------------------------------------------------------------------------

async function writeBlob(
  data: Buffer,
  contentType = 'application/octet-stream',
): Promise<{ blobId: string }> {
  const publisherUrl = process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space'
  const url = `${publisherUrl.replace(/\/+$/, '')}/v1/blobs?epochs=1`
  // Convert Buffer to ArrayBuffer for fetch body compatibility
  const bodyBytes: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bodyBytes,
  })
  if (!response.ok) {
    throw new WalletError(`Walrus PUT failed with HTTP ${response.status}`, 'OPERATION_FAILED')
  }
  const json = await response.json() as Record<string, unknown>
  const newlyCreated = json['newlyCreated'] as { blobObject?: { blobId?: string } } | undefined
  const alreadyCertified = json['alreadyCertified'] as { blobId?: string } | undefined
  const blobId = newlyCreated?.blobObject?.blobId ?? alreadyCertified?.blobId
  if (!blobId) {
    throw new WalletError('Unexpected Walrus publisher response shape', 'OPERATION_FAILED')
  }
  return { blobId }
}

async function readBlob(blobId: string): Promise<Buffer> {
  const aggregatorUrl = process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space'
  const url = `${aggregatorUrl.replace(/\/+$/, '')}/v1/blobs/${encodeURIComponent(blobId)}`
  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) {
    throw new WalletError(`Walrus GET failed with HTTP ${response.status}`, 'OPERATION_FAILED')
  }
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer)
}

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
  const key = process.env.INFRASTRUCTURE_WALLET_SECRET || process.env.INFRA_WALLET_PRIVATE_KEY
  if (!key || key.trim() === '') {
    throw new WalletError(
      'Infrastructure wallet is not configured. Please set INFRASTRUCTURE_WALLET_SECRET.',
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
  return getInfraWalletKey()
}

// ---------------------------------------------------------------------------
// Walrus operations
// ---------------------------------------------------------------------------

/**
 * Write a blob to Walrus using the infrastructure wallet.
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
  getInfraWalletKey()

  try {
    const result = await writeBlob(data, contentType)
    return { blobId: result.blobId }
  } catch (err) {
    // Log the original error before swallowing — safe: no key material in walrus errors
    console.error('[WalletManager] executeWalrusWrite failed:', err instanceof Error ? err.message : String(err))
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
  getInfraWalletKey()

  try {
    return await readBlob(blobId)
  } catch (err) {
    // Log the original error before swallowing
    console.error('[WalletManager] executeWalrusRead failed:', err instanceof Error ? err.message : String(err))
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
 * NOTE: This legacy src/ path has been superseded by the canonical
 * `apps/api/services/infrastructure-wallet.ts` module. Seal operations in
 * new code MUST use `sealEncrypt` from that module, which loads the wallet
 * from `INFRASTRUCTURE_WALLET_SECRET` (not the forbidden `INFRA_WALLET_PRIVATE_KEY`).
 *
 * @throws WalletError with 'NOT_CONFIGURED' — Seal operations must be migrated
 *         to apps/api/services/infrastructure-wallet.ts.
 */
export async function executeSealEncrypt(
  _value: string,
  _policyId: string,
): Promise<{ encryptedData: string; algorithm: string }> {
  throw new WalletError(
    'Seal encryption is not available in this path. Use apps/api/services/infrastructure-wallet.ts sealEncrypt instead.',
    'NOT_CONFIGURED',
  )
}

/**
 * Decrypt an encrypted blob in-memory using the infrastructure wallet key.
 *
 * NOTE: This legacy src/ path has been superseded by the canonical
 * `apps/api/services/infrastructure-wallet.ts` module.
 *
 * @throws WalletError with 'NOT_CONFIGURED' — Seal operations must be migrated
 *         to apps/api/services/infrastructure-wallet.ts.
 */
export async function executeSealDecrypt(
  _encryptedData: string,
): Promise<{ plaintext: string }> {
  throw new WalletError(
    'Seal decryption is not available in this path. Use apps/api/services/infrastructure-wallet.ts sealDecrypt instead.',
    'NOT_CONFIGURED',
  )
}

/**
 * Create a Seal access-control policy for a form using the infrastructure wallet.
 *
 * NOTE: This legacy src/ path has been superseded by the canonical
 * `apps/api/services/infrastructure-wallet.ts` module.
 *
 * @throws WalletError with 'NOT_CONFIGURED' — Seal operations must be migrated
 *         to apps/api/services/infrastructure-wallet.ts.
 */
export async function executeSealCreatePolicy(
  _formId: string,
  _authorizedRoles: string[],
): Promise<{ policyId: string }> {
  throw new WalletError(
    'Seal policy creation is not available in this path. Use apps/api/services/infrastructure-wallet.ts instead.',
    'NOT_CONFIGURED',
  )
}
