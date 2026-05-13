/**
 * Seal encryption client wrapper.
 *
 * Provides field-level and full-submission encryption using AES-256-GCM via
 * Node.js built-in `crypto` module. This is a real encryption implementation
 * designed to be interface-compatible with the @mysten/seal SDK when it
 * becomes available as a stable npm package.
 *
 * ⚠️  DEVELOPMENT PLACEHOLDER — AES-256-GCM implementation
 * Replace the internal `aesEncrypt` / `aesDecrypt` calls with the real
 * @mysten/seal SDK once it is available. The public interface (encrypt,
 * decrypt, createPolicy, encryptObject, decryptObject) will remain unchanged.
 *
 * Security invariants enforced by this module:
 *   - Plaintext values are NEVER logged, included in error messages, or
 *     persisted anywhere.
 *   - Decryption is always in-memory only — callers must not persist the
 *     returned plaintext.
 *   - Key material is derived via SHA-256 and never stored or logged.
 *
 * Environment variables:
 *   SEAL_API_URL — base URL for the Seal service endpoint (reserved for
 *                  future use when the real SDK is integrated).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto'
import {
  SealDecryptResult,
  SealEncryptResult,
  SealError,
  SealPolicy,
} from './types'

// ---------------------------------------------------------------------------
// Internal crypto helpers
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte AES key from arbitrary key material using SHA-256.
 * The key material is never logged or stored.
 */
function deriveKey(keyMaterial: string): Buffer {
  return createHash('sha256').update(keyMaterial).digest()
}

/**
 * Encrypt a UTF-8 plaintext string using AES-256-GCM.
 *
 * Packed output layout (base64-encoded):
 *   [iv: 12 bytes][authTag: 16 bytes][ciphertext: variable]
 *
 * The plaintext parameter is intentionally not referenced in any error
 * messages or logs.
 */
function aesEncrypt(plaintext: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial)
  const iv = randomBytes(12) // 96-bit IV recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag() // 16 bytes

  // Pack: iv (12) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted])
  return packed.toString('base64')
}

/**
 * Decrypt a base64-encoded AES-256-GCM blob.
 *
 * Throws SealError with DECRYPT_FAILED if the data is tampered, the key is
 * wrong, or the packed format is invalid. The returned plaintext is never
 * included in error messages.
 */
function aesDecrypt(encryptedBase64: string, keyMaterial: string): string {
  let packed: Buffer
  try {
    packed = Buffer.from(encryptedBase64, 'base64')
  } catch {
    throw new SealError(
      'Encrypted data is not valid base64.',
      'DECRYPT_FAILED',
    )
  }

  if (packed.length < 28) {
    // Minimum: 12 (iv) + 16 (authTag) = 28 bytes; ciphertext may be empty
    throw new SealError(
      'Encrypted data is too short to be a valid encrypted blob.',
      'DECRYPT_FAILED',
    )
  }

  const key = deriveKey(keyMaterial)
  const iv = packed.subarray(0, 12)
  const authTag = packed.subarray(12, 28)
  const ciphertext = packed.subarray(28)

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    // Intentionally not logging the result — plaintext must never be logged
    return decipher.update(ciphertext) + decipher.final('utf8')
  } catch {
    // Do NOT include any key material or plaintext hints in this error
    throw new SealError(
      'Decryption failed. The data may be tampered or the key may be incorrect.',
      'DECRYPT_FAILED',
    )
  }
}

/**
 * Generate a deterministic policy ID from a form ID and a random nonce.
 * In the real Seal SDK this would be a network-issued policy object ID.
 */
function generatePolicyId(formId: string): string {
  const nonce = randomBytes(16).toString('hex')
  return createHash('sha256')
    .update(`${formId}:${nonce}`)
    .digest('hex')
    .slice(0, 32)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a string value under a Seal policy.
 *
 * The policyId is used as key material for the AES-256-GCM cipher. In the
 * real Seal SDK, the policy would govern on-chain access control.
 *
 * SECURITY: The `value` parameter is NEVER logged or included in errors.
 *
 * @param value     The plaintext string to encrypt.
 * @param policyId  The Seal policy ID governing decryption access.
 * @returns         Encrypted result with base64-encoded blob, policyId, and algorithm.
 * @throws          SealError with ENCRYPT_FAILED on failure.
 */
export async function encrypt(
  value: string,
  policyId: string,
): Promise<SealEncryptResult> {
  if (!policyId || policyId.trim() === '') {
    throw new SealError(
      'A valid policyId is required for encryption.',
      'ENCRYPT_FAILED',
    )
  }

  try {
    // SECURITY: `value` is passed directly to aesEncrypt and never referenced
    // in any log statement or error message below.
    const encryptedData = aesEncrypt(value, policyId)
    return {
      encryptedData,
      policyId,
      algorithm: 'AES-256-GCM',
    }
  } catch (err) {
    if (err instanceof SealError) throw err
    // Do NOT include `value` or any derivative in this error message
    throw new SealError(
      'Encryption failed due to an internal error.',
      'ENCRYPT_FAILED',
    )
  }
}

/**
 * Decrypt an encrypted blob in-memory.
 *
 * SECURITY: The returned plaintext is NEVER logged or persisted. Callers
 * must treat the result as ephemeral and display-only.
 *
 * In production, `adminKey` should be derived from the
 * INFRA_WALLET_PRIVATE_KEY environment variable by the caller.
 *
 * @param encryptedData  Base64-encoded encrypted blob from `encrypt()`.
 * @param adminKey       Key material for decryption (e.g., derived from infra wallet key).
 * @returns              Decrypted plaintext wrapped in SealDecryptResult.
 * @throws               SealError with DECRYPT_FAILED on failure.
 */
export async function decrypt(
  encryptedData: string,
  adminKey: string,
): Promise<SealDecryptResult> {
  if (!adminKey || adminKey.trim() === '') {
    throw new SealError(
      'A valid adminKey is required for decryption.',
      'INVALID_KEY',
    )
  }

  if (!encryptedData || encryptedData.trim() === '') {
    throw new SealError(
      'Encrypted data must not be empty.',
      'DECRYPT_FAILED',
    )
  }

  try {
    // SECURITY: The result of aesDecrypt is never logged — it is returned
    // directly to the caller who is responsible for in-memory-only use.
    const plaintext = aesDecrypt(encryptedData, adminKey)
    return { plaintext }
  } catch (err) {
    if (err instanceof SealError) throw err
    // Do NOT include any plaintext hints in this error message
    throw new SealError(
      'Decryption failed due to an internal error.',
      'DECRYPT_FAILED',
    )
  }
}

/**
 * Create a Seal access-control policy for a form.
 *
 * In the real Seal SDK, this would register an on-chain policy object that
 * governs who may decrypt data encrypted under this policy. In the current
 * AES-256-GCM implementation, the policy is a locally-generated record.
 *
 * @param formId           The form this policy is associated with.
 * @param authorizedRoles  Roles permitted to decrypt (e.g., ['admin', 'owner']).
 * @returns                The created SealPolicy with a unique policyId.
 * @throws                 SealError with ENCRYPT_FAILED on failure.
 */
export async function createPolicy(
  formId: string,
  authorizedRoles: string[],
): Promise<SealPolicy> {
  if (!formId || formId.trim() === '') {
    throw new SealError(
      'A valid formId is required to create a Seal policy.',
      'ENCRYPT_FAILED',
    )
  }

  if (!Array.isArray(authorizedRoles) || authorizedRoles.length === 0) {
    throw new SealError(
      'At least one authorized role is required to create a Seal policy.',
      'ENCRYPT_FAILED',
    )
  }

  try {
    const policyId = generatePolicyId(formId)
    return {
      policyId,
      formId,
      authorizedRoles,
      createdAt: new Date().toISOString(),
    }
  } catch (err) {
    if (err instanceof SealError) throw err
    throw new SealError(
      'Failed to create Seal policy due to an internal error.',
      'ENCRYPT_FAILED',
    )
  }
}

/**
 * Encrypt an entire object by JSON-serializing it then encrypting the string.
 *
 * Used for full-submission encryption mode where the entire payload is
 * encrypted as a single blob before Walrus storage.
 *
 * SECURITY: The serialized JSON (which contains plaintext field values) is
 * never logged or stored — it exists only in memory during this call.
 *
 * @param obj       The object to encrypt (must be JSON-serializable).
 * @param policyId  The Seal policy ID governing decryption access.
 * @returns         Base64-encoded encrypted blob string.
 * @throws          SealError with ENCRYPT_FAILED on failure.
 */
export async function encryptObject(
  obj: Record<string, unknown>,
  policyId: string,
): Promise<string> {
  if (!policyId || policyId.trim() === '') {
    throw new SealError(
      'A valid policyId is required for object encryption.',
      'ENCRYPT_FAILED',
    )
  }

  let serialized: string
  try {
    // SECURITY: `serialized` contains plaintext — it must never be logged
    serialized = JSON.stringify(obj)
  } catch {
    throw new SealError(
      'Failed to serialize object for encryption. Ensure the object is JSON-serializable.',
      'ENCRYPT_FAILED',
    )
  }

  try {
    // SECURITY: `serialized` is passed directly and never referenced in logs
    const encryptedData = aesEncrypt(serialized, policyId)
    return encryptedData
  } catch (err) {
    if (err instanceof SealError) throw err
    throw new SealError(
      'Object encryption failed due to an internal error.',
      'ENCRYPT_FAILED',
    )
  }
}

/**
 * Decrypt a base64-encoded encrypted blob and JSON-parse it back to an object.
 *
 * Used for full-submission decryption. The decrypted JSON string exists only
 * in memory and is never logged or persisted.
 *
 * SECURITY: The decrypted plaintext is NEVER logged. Callers must treat the
 * returned object as ephemeral and display-only.
 *
 * @param encryptedData  Base64-encoded encrypted blob from `encryptObject()`.
 * @param adminKey       Key material for decryption.
 * @returns              The decrypted and parsed object typed as T.
 * @throws               SealError with DECRYPT_FAILED on failure.
 */
export async function decryptObject<T>(
  encryptedData: string,
  adminKey: string,
): Promise<T> {
  if (!adminKey || adminKey.trim() === '') {
    throw new SealError(
      'A valid adminKey is required for object decryption.',
      'INVALID_KEY',
    )
  }

  if (!encryptedData || encryptedData.trim() === '') {
    throw new SealError(
      'Encrypted data must not be empty.',
      'DECRYPT_FAILED',
    )
  }

  let plaintext: string
  try {
    // SECURITY: `plaintext` contains the decrypted JSON — never log it
    plaintext = aesDecrypt(encryptedData, adminKey)
  } catch (err) {
    if (err instanceof SealError) throw err
    throw new SealError(
      'Object decryption failed due to an internal error.',
      'DECRYPT_FAILED',
    )
  }

  try {
    // SECURITY: `plaintext` is parsed and discarded — never logged
    return JSON.parse(plaintext) as T
  } catch {
    // Do NOT include `plaintext` in this error message
    throw new SealError(
      'Decrypted data is not valid JSON. The encrypted blob may be corrupted.',
      'DECRYPT_FAILED',
    )
  }
}
