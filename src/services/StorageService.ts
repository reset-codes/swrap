/**
 * StorageService — Credit-gated Walrus storage operations.
 *
 * Enforces Engineering Rule 5: credits MUST be checked before any Walrus write.
 * The invariant is: check credits → write to Walrus → deduct credits.
 * A write never proceeds without confirmed sufficient credits.
 * A credit deduction never happens if the write failed.
 *
 * Requirements: R8, R10
 */

import { prisma } from '@/lib/prisma/client'
import {
  executeWalrusRead,
  executeWalrusWrite,
} from '@/lib/wallet/manager'
import { readBlobAsJson, readBlobAsText } from '@/lib/walrus/client'
import { BlobType } from '@prisma/client'
import { checkSufficient, deduct } from './CreditService'
import { ServiceError } from './FormService'

// ─── Cost estimation ──────────────────────────────────────────────────────────

/**
 * Estimate the WAL cost for storing a given number of bytes.
 *
 * Formula: 0.001 WAL per KB (1 KB = 1024 bytes), rounded up.
 *
 * @param dataSize  The size of the data in bytes.
 * @returns         Estimated cost in WAL.
 */
export function estimateCost(dataSize: number): number {
  return Math.ceil(dataSize / 1024) * 0.001
}

// ─── Credit-gated write ───────────────────────────────────────────────────────

/**
 * Write data to Walrus with a credit check gate.
 *
 * Enforces the credit-check-before-write invariant (Engineering Rule 5):
 *   1. Estimate cost from data size
 *   2. Check admin has sufficient credits — throw 402 if not
 *   3. Execute Walrus write — throw 503 if it fails
 *   4. Create BlobReference record in PostgreSQL
 *   5. Deduct credits (best-effort — log on failure, do not fail the operation)
 *
 * @param adminId      The authenticated admin's user ID.
 * @param data         The raw bytes to store on Walrus.
 * @param blobType     The type of blob being stored (from Prisma BlobType enum).
 * @param contentType  MIME type for the Walrus write. Defaults to 'application/octet-stream'.
 * @param formId       Optional form ID to associate with the BlobReference.
 * @param submissionId Optional submission ID to associate with the BlobReference.
 * @returns            The Walrus blob ID and the size of the stored data in bytes.
 * @throws ServiceError 402 if the admin has insufficient storage credits.
 * @throws ServiceError 503 if the Walrus write fails after all retries.
 */
export async function writeWithCreditCheck(
  adminId: string,
  data: Buffer,
  blobType: BlobType,
  contentType = 'application/octet-stream',
  formId?: string,
  submissionId?: string,
): Promise<{ blobId: string; sizeBytes: number }> {
  // ── Step 1: Estimate cost ─────────────────────────────────────────────────
  const cost = estimateCost(data.length)

  // ── Step 2: Check credits (Engineering Rule 5) ────────────────────────────
  const hasSufficientCredits = await checkSufficient(adminId, cost)
  if (!hasSufficientCredits) {
    throw new ServiceError(
      'Insufficient storage credits. Please deposit more credits before writing to Walrus.',
      'INSUFFICIENT_CREDITS',
      402,
    )
  }

  // ── Step 3: Execute Walrus write ──────────────────────────────────────────
  // Only reached if credits are confirmed sufficient.
  let blobId: string
  try {
    const result = await executeWalrusWrite(data, contentType)
    blobId = result.blobId
  } catch {
    // Do NOT deduct credits — the write failed.
    throw new ServiceError(
      'Failed to store data on Walrus. Please try again.',
      'WALRUS_WRITE_FAILED',
      503,
    )
  }

  // ── Step 4: Create BlobReference in PostgreSQL ────────────────────────────
  // Best-effort index — if this fails, the Walrus blob still exists.
  try {
    await prisma.blobReference.create({
      data: {
        walrusBlobId: blobId,
        blobType,
        sizeBytes: data.length,
        formId: formId ?? null,
        submissionId: submissionId ?? null,
      },
    })
  } catch (err) {
    // Log but do not fail — Walrus is the source of truth (Engineering Rule 1).
    console.error(
      `[StorageService] BlobReference creation failed for blob ${blobId}:`,
      err,
    )
  }

  // ── Step 5: Deduct credits (best-effort) ──────────────────────────────────
  // The write succeeded, so we deduct. If deduction fails, log and continue —
  // a reconciliation job can handle discrepancies later.
  try {
    await deduct(adminId, cost, blobId)
  } catch (err) {
    console.error(
      `[StorageService] Credit deduction failed for admin ${adminId}, blob ${blobId}:`,
      err,
    )
  }

  return { blobId, sizeBytes: data.length }
}

// ─── Read operations ──────────────────────────────────────────────────────────

/**
 * Read a blob from Walrus by its blob ID.
 *
 * @param blobId  The Walrus blob ID to fetch.
 * @returns       The raw blob content as a Buffer.
 * @throws ServiceError 503 if the Walrus read fails after all retries.
 */
export async function readBlob(blobId: string): Promise<Buffer> {
  try {
    return await executeWalrusRead(blobId)
  } catch {
    throw new ServiceError(
      'Failed to retrieve data from Walrus. Please try again.',
      'WALRUS_READ_FAILED',
      503,
    )
  }
}

/**
 * Read a blob from Walrus and decode it as a UTF-8 string.
 *
 * @param blobId  The Walrus blob ID to fetch.
 * @returns       The blob content as a UTF-8 string.
 * @throws ServiceError 503 if the Walrus read fails after all retries.
 */
export async function readBlobAsTextService(blobId: string): Promise<string> {
  try {
    return await readBlobAsText(blobId)
  } catch {
    throw new ServiceError(
      'Failed to retrieve data from Walrus. Please try again.',
      'WALRUS_READ_FAILED',
      503,
    )
  }
}

/**
 * Read a blob from Walrus and parse it as JSON.
 *
 * @param blobId  The Walrus blob ID to fetch.
 * @returns       The parsed JSON value typed as T.
 * @throws ServiceError 503 if the Walrus read fails after all retries.
 * @throws SyntaxError if the blob content is not valid JSON.
 */
export async function readBlobAsJsonService<T>(blobId: string): Promise<T> {
  try {
    return await readBlobAsJson<T>(blobId)
  } catch (err) {
    // Re-throw SyntaxError as-is (caller may want to handle malformed JSON separately)
    if (err instanceof SyntaxError) throw err
    throw new ServiceError(
      'Failed to retrieve data from Walrus. Please try again.',
      'WALRUS_READ_FAILED',
      503,
    )
  }
}
