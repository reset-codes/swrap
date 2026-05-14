/**
 * EncryptionService — Field-level and full-submission encryption via Seal.
 *
 * Enforces the core encryption invariants for Swrap:
 *   1. Encrypted fields are encrypted via Seal BEFORE the payload is sent to Walrus (Engineering Rule 6)
 *   2. Plaintext values are NEVER logged, included in error messages, or persisted anywhere
 *   3. Decryption is always in-memory only — decrypted values are never persisted
 *   4. Seal operation failures abort the operation and throw immediately
 *   5. Decryption is restricted to users with `admin` or `owner` roles (R9.6, R2.2)
 *
 * SECURITY INVARIANTS (enforced throughout this module):
 *   - Field values, serialized payloads, and decrypted results are NEVER logged
 *   - Plaintext is NEVER persisted — all decryption is in-memory per request
 *   - Any Seal operation failure throws ServiceError with code 'SEAL_ERROR' immediately
 *   - Role check failures throw ServiceError with code 'FORBIDDEN'
 *
 * Requirements: R9
 */

import {
  executeSealCreatePolicy,
  executeSealDecrypt,
  executeSealEncrypt,
} from '@/lib/wallet/manager'
import { WalletError } from '@/lib/wallet/types'
import type { EncryptionMode } from '@/types/form'
import type { FieldValue, SubmissionPayload } from '@/types/submission'
import { ServiceError } from './FormService'

// ─── Role constants ───────────────────────────────────────────────────────────

/** Roles authorized to perform Seal decryption (R2.2, R9.6) */
const DECRYPTION_AUTHORIZED_ROLES = ['admin', 'owner'] as const
type DecryptionRole = (typeof DECRYPTION_AUTHORIZED_ROLES)[number]

/** Roles authorized to create Seal policies */
const POLICY_CREATION_AUTHORIZED_ROLES: string[] = ['admin', 'owner']

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Assert that the caller has a role authorized for decryption.
 *
 * @param role  The caller's role string.
 * @throws ServiceError with code 'FORBIDDEN' if the role is not authorized.
 */
function assertDecryptionAuthorized(role: string): asserts role is DecryptionRole {
  if (!(DECRYPTION_AUTHORIZED_ROLES as readonly string[]).includes(role)) {
    throw new ServiceError(
      'You do not have permission to decrypt submission data. Only admin and owner roles may decrypt.',
      'FORBIDDEN',
      403,
    )
  }
}

/**
 * Wrap a WalletError (from a Seal operation) into a ServiceError with code 'SEAL_ERROR'.
 *
 * SECURITY: The original error message is logged internally but a safe message
 * is surfaced to the caller. The plaintext value is never included.
 *
 * @param err  The caught error from a Seal operation.
 * @param context  A safe description of the operation that failed (no plaintext).
 * @throws ServiceError with code 'SEAL_ERROR'.
 */
function throwSealError(err: unknown, context: string): never {
  // Log the internal error for debugging — safe message only, no plaintext
  if (err instanceof WalletError) {
    console.error(`[EncryptionService] Seal operation failed (${context}): ${err.message}`)
  } else {
    console.error(`[EncryptionService] Unexpected error during ${context}`)
  }

  throw new ServiceError(
    `Seal ${context} failed. Please try again.`,
    'SEAL_ERROR',
    500,
  )
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt a single field value using Seal.
 *
 * SECURITY: The `value` parameter is NEVER logged or included in error messages.
 *
 * @param value     The plaintext field value to encrypt.
 * @param policyId  The Seal policy ID governing decryption access.
 * @returns         Base64-encoded encrypted blob string.
 * @throws ServiceError with code 'SEAL_ERROR' on Seal operation failure.
 */
export async function encryptField(value: string, policyId: string): Promise<string> {
  try {
    // SECURITY: `value` is passed directly — never referenced in logs below
    const result = await executeSealEncrypt(value, policyId)
    return result.encryptedData
  } catch (err) {
    // Do NOT include `value` or any derivative in the error context string
    throwSealError(err, 'field encryption')
  }
}

/**
 * Encrypt an entire submission payload (JSON.stringify then encrypt).
 *
 * SECURITY: The serialized JSON (which contains plaintext field values) is
 * NEVER logged or stored — it exists only in memory during this call.
 *
 * @param payload   The submission payload object to encrypt.
 * @param policyId  The Seal policy ID governing decryption access.
 * @returns         Base64-encoded encrypted blob string.
 * @throws ServiceError with code 'SEAL_ERROR' on Seal operation failure.
 */
export async function encryptPayload(payload: object, policyId: string): Promise<string> {
  // SECURITY: `serialized` contains plaintext — it must never be logged
  let serialized: string
  try {
    serialized = JSON.stringify(payload)
  } catch {
    throw new ServiceError(
      'Failed to serialize submission payload for encryption.',
      'SEAL_ERROR',
      500,
    )
  }

  try {
    // SECURITY: `serialized` is passed directly — never referenced in logs below
    const result = await executeSealEncrypt(serialized, policyId)
    return result.encryptedData
  } catch (err) {
    // Do NOT include `serialized` or any derivative in the error context string
    throwSealError(err, 'payload encryption')
  }
}

/**
 * Decrypt an encrypted field value in-memory.
 *
 * SECURITY: The returned plaintext is NEVER logged or persisted. Callers
 * must treat the result as ephemeral and display-only.
 *
 * @param encryptedData  Base64-encoded encrypted blob from `encryptField`.
 * @param adminRole      The caller's role — must be 'admin' or 'owner'.
 * @returns              The decrypted plaintext string.
 * @throws ServiceError with code 'FORBIDDEN' if the caller lacks the required role.
 * @throws ServiceError with code 'SEAL_ERROR' on Seal operation failure.
 */
export async function decryptField(
  encryptedData: string,
  adminRole: string,
): Promise<string> {
  // Role check — must happen before any Seal operation (R9.6, R2.2)
  assertDecryptionAuthorized(adminRole)

  try {
    // SECURITY: The result contains plaintext — never log it
    const result = await executeSealDecrypt(encryptedData)
    // SECURITY: result.plaintext is returned directly — callers must not persist it
    return result.plaintext
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throwSealError(err, 'field decryption')
  }
}

/**
 * Decrypt an encrypted payload blob and JSON.parse it back to an object.
 *
 * SECURITY: The decrypted JSON string and the resulting object are NEVER
 * logged or persisted. Callers must treat the result as ephemeral.
 *
 * @param encryptedData  Base64-encoded encrypted blob from `encryptPayload`.
 * @param adminRole      The caller's role — must be 'admin' or 'owner'.
 * @returns              The decrypted and parsed submission payload object.
 * @throws ServiceError with code 'FORBIDDEN' if the caller lacks the required role.
 * @throws ServiceError with code 'SEAL_ERROR' on Seal operation failure.
 */
export async function decryptPayload(
  encryptedData: string,
  adminRole: string,
): Promise<object> {
  // Role check — must happen before any Seal operation (R9.6, R2.2)
  assertDecryptionAuthorized(adminRole)

  let plaintext: string
  try {
    // SECURITY: The result contains plaintext — never log it
    const result = await executeSealDecrypt(encryptedData)
    plaintext = result.plaintext
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throwSealError(err, 'payload decryption')
  }

  try {
    // SECURITY: `plaintext` contains the decrypted JSON — never log it
    return JSON.parse(plaintext) as object
  } catch {
    // Do NOT include `plaintext` in this error message
    throw new ServiceError(
      'Decrypted data is not valid JSON. The encrypted blob may be corrupted.',
      'SEAL_ERROR',
      500,
    )
  }
}

/**
 * Create a Seal access-control policy for a form.
 *
 * Authorized roles for decryption are set to ['admin', 'owner'] per R2.2 and R9.6.
 *
 * @param formId  The form ID to associate the policy with.
 * @returns       The created Seal policy ID.
 * @throws ServiceError with code 'SEAL_ERROR' on Seal operation failure.
 */
export async function createFormPolicy(formId: string): Promise<string> {
  try {
    const result = await executeSealCreatePolicy(formId, POLICY_CREATION_AUTHORIZED_ROLES)
    return result.policyId
  } catch (err) {
    throwSealError(err, 'policy creation')
  }
}

/**
 * Encrypt individual fields in a submission that have `encrypted: true`.
 *
 * For each field where `encrypted === true`, the field value is encrypted via
 * Seal and the result is stored in `encryptedData`. The original `value` is
 * set to `null` to ensure no plaintext is retained in the payload.
 *
 * SECURITY: Field values are NEVER logged during this operation.
 *
 * @param fields    Array of FieldValue objects from the submission payload.
 * @param policyId  The Seal policy ID governing decryption access.
 * @returns         New array with encrypted fields having `encryptedData` set and `value` set to null.
 * @throws ServiceError with code 'SEAL_ERROR' if any Seal encryption fails.
 */
export async function encryptSubmissionFields(
  fields: FieldValue[],
  policyId: string,
): Promise<FieldValue[]> {
  const result: FieldValue[] = []

  for (const field of fields) {
    if (!field.encrypted) {
      // Non-encrypted field — pass through unchanged
      result.push(field)
      continue
    }

    if (field.value === null || field.value === undefined) {
      // Encrypted field with no value — pass through with null value
      result.push({ ...field, value: null })
      continue
    }

    // Serialize the field value to a string for encryption
    // SECURITY: `serializedValue` contains plaintext — never log it
    let serializedValue: string
    if (typeof field.value === 'string') {
      serializedValue = field.value
    } else {
      try {
        serializedValue = JSON.stringify(field.value)
      } catch {
        throw new ServiceError(
          `Failed to serialize field value for encryption (fieldId: ${field.fieldId}).`,
          'SEAL_ERROR',
          500,
        )
      }
    }

    // Encrypt the field value — SECURITY: serializedValue is never logged
    const encryptedData = await encryptField(serializedValue, policyId)

    result.push({
      ...field,
      value: null,          // Clear plaintext value — never retain it
      encryptedData,        // Store the encrypted blob
    })
  }

  return result
}

/**
 * Process submission encryption based on the form's configured encryption mode.
 *
 * - `none`:             Return the payload as-is with no encryption.
 * - `field_level`:      Encrypt individual fields marked `encrypted: true`.
 *                       Return the modified payload with encrypted field values.
 * - `full_submission`:  Encrypt the entire payload as a single blob.
 *                       Return minimal metadata payload + the encrypted blob.
 *
 * SECURITY: Plaintext field values and serialized payloads are NEVER logged.
 *
 * @param payload         The assembled submission payload.
 * @param encryptionMode  The form's configured encryption mode.
 * @param policyId        The Seal policy ID (required for field_level and full_submission modes).
 * @returns               Object containing the (possibly modified) payload and optional encrypted blob.
 * @throws ServiceError with code 'SEAL_ERROR' if encryption fails.
 * @throws ServiceError with code 'MISSING_POLICY' if policyId is required but not provided.
 */
export async function processSubmissionEncryption(
  payload: SubmissionPayload,
  encryptionMode: EncryptionMode,
  policyId?: string,
): Promise<{ payload: SubmissionPayload; encryptedPayload?: string }> {
  if (encryptionMode === 'none') {
    // No encryption — return payload unchanged
    return { payload }
  }

  // policyId is required for any encryption mode
  if (!policyId || policyId.trim() === '') {
    throw new ServiceError(
      'A Seal policy ID is required for encrypted forms. Please ensure the form has a policy configured.',
      'MISSING_POLICY',
      400,
    )
  }

  if (encryptionMode === 'field_level') {
    // Encrypt individual fields marked encrypted=true
    const encryptedFields = await encryptSubmissionFields(payload.fields, policyId)
    return {
      payload: {
        ...payload,
        fields: encryptedFields,
      },
    }
  }

  if (encryptionMode === 'full_submission') {
    // Encrypt the entire payload as a single blob
    // SECURITY: `payload` contains plaintext — encryptPayload never logs it
    const encryptedPayload = await encryptPayload(payload, policyId)

    // Return a minimal metadata-only payload (no field values) alongside the encrypted blob
    // This ensures no plaintext field values are stored unencrypted in PostgreSQL or Walrus
    const minimalPayload: SubmissionPayload = {
      id: payload.id,
      formId: payload.formId,
      formSlug: payload.formSlug,
      formVersion: payload.formVersion,
      fields: [], // Field values are in the encrypted blob — not stored here
      submittedAt: payload.submittedAt,
      metadata: payload.metadata,
    }

    return {
      payload: minimalPayload,
      encryptedPayload,
    }
  }

  // Exhaustive check — TypeScript should catch unhandled modes at compile time
  const _exhaustive: never = encryptionMode
  throw new ServiceError(
    `Unsupported encryption mode: ${String(_exhaustive)}`,
    'SEAL_ERROR',
    500,
  )
}
