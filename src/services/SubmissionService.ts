/**
 * SubmissionService — Submission CRUD business logic.
 *
 * Enforces the core submission invariants for Swrap:
 *   1. Encrypt BEFORE store (Engineering Rule 6)
 *   2. Walrus write BEFORE PostgreSQL index (Engineering Rule 1)
 *   3. Submissions are IMMUTABLE — never update, only append status layers (Engineering Rule 3)
 *   4. Storage credits checked BEFORE any Walrus write (Engineering Rule 5)
 *
 * Requirements: R6, R7, R9
 */

import { prisma } from '@/lib/prisma/client'
import crypto from 'node:crypto'
import { processSubmissionEncryption } from '@/services/EncryptionService'
import { ServiceError } from '@/services/FormService'
import {
  readBlobAsJsonService,
  writeWithCreditCheck,
} from '@/services/StorageService'
import type { EncryptionMode } from '@/types/form'
import type {
  FieldValue,
  PaginatedSubmissions,
  SubmissionFilters,
  SubmissionMetadata,
  SubmissionPayload,
  SubmissionStatusLogEntry,
  SubmissionView,
} from '@/types/submission'
import { Prisma, SubmissionStatus } from '@prisma/client'

// ─── Payload Assembly ─────────────────────────────────────────────────────────

/**
 * Assemble a SubmissionPayload from raw field values and metadata.
 *
 * Creates a new UUID for the submission. Does NOT encrypt — encryption is
 * handled separately by processSubmissionEncryption.
 *
 * @param formId       The ID of the form being submitted.
 * @param formSlug     The slug of the form being submitted.
 * @param formVersion  The version of the form schema at submission time.
 * @param fieldValues  The array of field values provided by the submitter.
 * @param metadata     Optional metadata (e.g. userAgent). No IP addresses per Engineering Rule 4.
 * @returns            A fully assembled SubmissionPayload with a new UUID.
 */
export function assemblePayload(
  formId: string,
  formSlug: string,
  formVersion: number,
  fieldValues: FieldValue[],
  metadata: SubmissionPayload['metadata'] = {},
): SubmissionPayload {
  return {
    id: crypto.randomUUID(),
    formId,
    formSlug,
    formVersion,
    fields: fieldValues,
    submittedAt: new Date().toISOString(),
    metadata,
  }
}

// ─── Store Submission ─────────────────────────────────────────────────────────

/**
 * Store a submission payload on Walrus and index its metadata in PostgreSQL.
 *
 * Flow (enforces Engineering Rules 1, 5, 6):
 *   1. Process encryption via processSubmissionEncryption (encrypt BEFORE store)
 *   2. Serialize processed payload to JSON
 *   3. Write to Walrus via writeWithCreditCheck (credit check enforced inside)
 *   4. Index submission metadata in PostgreSQL (Walrus write MUST succeed first)
 *   5. If encryptedPayload exists (full_submission mode), store it as a separate blob
 *
 * @param adminId        The authenticated admin's user ID (for credit deduction).
 * @param formId         The ID of the form this submission belongs to.
 * @param payload        The assembled SubmissionPayload (not yet encrypted).
 * @param encryptionMode The form's configured encryption mode.
 * @param sealPolicyId   The Seal policy ID (required for field_level and full_submission modes).
 * @returns              The Walrus blob ID for the stored submission.
 * @throws ServiceError with code 'SEAL_ERROR' if encryption fails.
 * @throws ServiceError with code 'INSUFFICIENT_CREDITS' if credits are too low.
 * @throws ServiceError with code 'WALRUS_WRITE_FAILED' if the Walrus write fails.
 */
export async function storeSubmission(
  adminId: string,
  formId: string,
  payload: SubmissionPayload,
  encryptionMode: EncryptionMode,
  sealPolicyId?: string,
): Promise<{ submissionBlobId: string }> {
  // ── Step 1: Encrypt BEFORE store (Engineering Rule 6) ─────────────────────
  const { payload: processedPayload, encryptedPayload } =
    await processSubmissionEncryption(payload, encryptionMode, sealPolicyId)

  // ── Step 2: Serialize processed payload ───────────────────────────────────
  // SECURITY: processedPayload may still contain plaintext for non-encrypted
  // fields — do not log it.
  const json = JSON.stringify(processedPayload)

  // ── Step 3: Write to Walrus (credit check enforced inside) ────────────────
  // Engineering Rule 1: Walrus write MUST succeed before PostgreSQL index.
  // Engineering Rule 5: writeWithCreditCheck enforces credit check internally.
  const { blobId } = await writeWithCreditCheck(
    adminId,
    Buffer.from(json, 'utf-8'),
    'submission',
    'application/json',
    formId,
  )

  // ── Step 4: Index metadata in PostgreSQL ──────────────────────────────────
  // Only reached if the Walrus write succeeded (Engineering Rule 1).
  // The submission ID comes from the payload (set during assemblePayload).
  const submissionId = payload.id

  try {
    await prisma.submission.create({
      data: {
        id: submissionId,
        formId,
        walrusBlobId: blobId,
        status: SubmissionStatus.open,
        submittedAt: new Date(processedPayload.submittedAt),
      },
    })
  } catch (err) {
    // Log but do not fail — Walrus is the source of truth (Engineering Rule 1).
    // The submission blob exists on Walrus even if PG indexing fails.
    console.error(
      `[SubmissionService] PostgreSQL index failed for submission ${submissionId}, blob ${blobId}:`,
      err,
    )
  }

  // ── Step 5: Store encrypted payload blob (full_submission mode only) ──────
  // If encryptedPayload exists, store it as a separate blob on Walrus.
  // This blob contains the full encrypted submission content.
  if (encryptedPayload) {
    try {
      await writeWithCreditCheck(
        adminId,
        Buffer.from(encryptedPayload, 'utf-8'),
        'encrypted_field',
        'application/octet-stream',
        formId,
        submissionId,
      )
    } catch (err) {
      // Log but do not fail the overall operation — the main submission blob
      // is already stored. The encrypted payload blob is supplementary.
      console.error(
        `[SubmissionService] Encrypted payload blob write failed for submission ${submissionId}:`,
        err,
      )
    }
  }

  return { submissionBlobId: blobId }
}

// ─── Get Submission ───────────────────────────────────────────────────────────

/**
 * Fetch a submission payload from Walrus by its blob ID.
 *
 * Walrus is the canonical source of truth (Engineering Rule 1).
 *
 * @param submissionBlobId  The Walrus blob ID for the submission.
 * @returns                 The parsed SubmissionPayload.
 * @throws ServiceError with code 'WALRUS_READ_FAILED' if the fetch fails.
 */
export async function getSubmission(
  submissionBlobId: string,
): Promise<SubmissionPayload> {
  return readBlobAsJsonService<SubmissionPayload>(submissionBlobId)
}

// ─── List Submissions ─────────────────────────────────────────────────────────

/**
 * List submissions for a form with optional filters and pagination.
 *
 * Queries the PostgreSQL index only — does not fetch Walrus blobs.
 * Returns lightweight metadata, not full payloads.
 *
 * Note: search is limited to indexed metadata for MVP (no full-text search
 * on Walrus blobs — Engineering Rule 7: no overengineering).
 *
 * @param formId      The ID of the form to list submissions for.
 * @param filters     Optional filters (status, search).
 * @param pagination  Optional pagination (page, pageSize).
 * @returns           Paginated submission metadata.
 */
export async function listSubmissions(
  formId: string,
  filters: SubmissionFilters = {},
  pagination: { page?: number; pageSize?: number } = {},
): Promise<PaginatedSubmissions> {
  const page = Math.max(1, pagination.page ?? filters.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? filters.pageSize ?? 20))

  const where: Prisma.SubmissionWhereInput = { formId }

  if (filters.status?.length) {
    where.status = { in: filters.status as SubmissionStatus[] }
  }

  // Note: search is limited to metadata for MVP (no full-text search on Walrus blobs)

  const [submissions, total] = await prisma.$transaction([
    prisma.submission.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.submission.count({ where }),
  ])

  const submissionMetadata: SubmissionMetadata[] = submissions.map((s) => ({
    id: s.id,
    formId: s.formId,
    walrusBlobId: s.walrusBlobId,
    status: s.status as SubmissionMetadata['status'],
    submittedAt: s.submittedAt.toISOString(),
  }))

  return {
    submissions: submissionMetadata,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }
}

// ─── Update Submission Status ─────────────────────────────────────────────────

/**
 * Append a new status to a submission (append-only — never modifies the original blob).
 *
 * Enforces Engineering Rule 3 (submissions are immutable):
 *   - Creates a new SubmissionStatusLog record (append-only)
 *   - Updates the current status on the Submission record (index layer only)
 *   - NEVER modifies the original submission blob on Walrus
 *
 * @param submissionId  The ID of the submission to update.
 * @param adminId       The authenticated admin's user ID.
 * @param newStatus     The new status to apply.
 * @param note          Optional admin note for this status change.
 * @throws ServiceError with code 'NOT_FOUND' if the submission does not exist.
 */
export async function updateSubmissionStatus(
  submissionId: string,
  adminId: string,
  newStatus: SubmissionMetadata['status'],
  note?: string,
): Promise<void> {
  // Verify the submission exists before attempting the update
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
  })
  if (!submission) {
    throw new ServiceError(
      `Submission with ID "${submissionId}" was not found.`,
      'NOT_FOUND',
      404,
    )
  }

  // Append-only: create status log entry + update current status in a transaction.
  // Engineering Rule 3: the original Walrus blob is NEVER touched.
  await prisma.$transaction([
    prisma.submissionStatusLog.create({
      data: {
        submissionId,
        adminId,
        status: newStatus as SubmissionStatus,
        note: note ?? null,
      },
    }),
    prisma.submission.update({
      where: { id: submissionId },
      data: { status: newStatus as SubmissionStatus },
    }),
  ])
}

// ─── Get Submission With History ──────────────────────────────────────────────

/**
 * Fetch a full submission view: metadata from PostgreSQL, payload from Walrus,
 * and status history from PostgreSQL.
 *
 * If the Walrus fetch fails, payload is returned as null (Walrus may be
 * temporarily unavailable — the PG index is still valid).
 *
 * @param submissionId  The PostgreSQL submission ID.
 * @returns             A SubmissionView with metadata, payload, and status history.
 * @throws ServiceError with code 'NOT_FOUND' if the submission does not exist in PostgreSQL.
 */
export async function getSubmissionWithHistory(
  submissionId: string,
): Promise<SubmissionView> {
  // ── Fetch metadata and status history from PostgreSQL ─────────────────────
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      statusLogs: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!submission) {
    throw new ServiceError(
      `Submission with ID "${submissionId}" was not found.`,
      'NOT_FOUND',
      404,
    )
  }

  const metadata: SubmissionMetadata = {
    id: submission.id,
    formId: submission.formId,
    walrusBlobId: submission.walrusBlobId,
    status: submission.status as SubmissionMetadata['status'],
    submittedAt: submission.submittedAt.toISOString(),
  }

  const statusHistory: SubmissionStatusLogEntry[] = submission.statusLogs.map(
    (log) => ({
      id: log.id,
      submissionId: log.submissionId,
      adminId: log.adminId,
      status: log.status as SubmissionStatusLogEntry['status'],
      note: log.note ?? undefined,
      createdAt: log.createdAt.toISOString(),
    }),
  )

  // ── Fetch payload from Walrus ─────────────────────────────────────────────
  // Walrus is the canonical source of truth (Engineering Rule 1).
  // If the fetch fails, return null payload — the metadata is still valid.
  let payload: SubmissionPayload | null = null
  try {
    payload = await readBlobAsJsonService<SubmissionPayload>(
      submission.walrusBlobId,
    )
  } catch (err) {
    // Log internally — do not surface Walrus internals to the caller.
    console.error(
      `[SubmissionService] Walrus fetch failed for submission ${submissionId}, blob ${submission.walrusBlobId}:`,
      err,
    )
  }

  return { metadata, payload, statusHistory }
}
