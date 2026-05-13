/**
 * GET /api/forms/[formId]/export — admin or owner only
 *
 * Streams a CSV file containing all submissions for the given form.
 * Columns: submission_id, submitted_at, status, and one column per form field.
 *
 * For encrypted fields:
 *   - admin/owner callers: decrypted value is included
 *   - viewer callers: not reachable (role check blocks at entry)
 *   - decryption failure: "[decryption failed]" is used for that field
 *
 * If a submission's Walrus fetch fails, all field columns for that row
 * contain "[unavailable]" — the export never fails due to a single bad blob.
 *
 * SECURITY INVARIANTS:
 *   - Plaintext decrypted values are NEVER logged (Engineering Rule 6)
 *   - Only admin and owner roles may export (R2.3, Engineering Rule 15)
 *
 * Requirements: R2, R12
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { auth } from '@/lib/auth'
import { apiError } from '@/types/api'
import { listSubmissions, getSubmission } from '@/services/SubmissionService'
import { decryptField } from '@/services/EncryptionService'
import { ServiceError } from '@/services/FormService'
import { readBlobAsJson } from '@/lib/walrus/client'
import type { FormSchema, FieldConfig } from '@/types/form'
import type { FieldValue } from '@/types/submission'

// ─── Route params type ────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ formId: string }> }

// ─── CSV helpers ──────────────────────────────────────────────────────────────

/**
 * Escape a single CSV value.
 * Wraps in double-quotes if the value contains a comma, newline, or double-quote.
 * Internal double-quotes are escaped by doubling them ("").
 */
function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Build a single CSV row from an array of string values.
 */
function buildCsvRow(values: string[]): string {
  return values.map(escapeCsvValue).join(',')
}

/**
 * Serialize a FieldValue's value to a plain string for CSV output.
 * Arrays are joined with "; ", objects are JSON-stringified.
 */
function serializeFieldValue(value: FieldValue['value']): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join('; ')
  }
  // BlobRef or other object
  return JSON.stringify(value)
}

// ─── GET /api/forms/[formId]/export ──────────────────────────────────────────

export async function GET(_request: Request, { params }: RouteContext) {
  // ── Auth check ────────────────────────────────────────────────────────────
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  // Export is restricted to admin and owner roles (R2.3, Engineering Rule 15)
  const role = session.user.role
  if (role !== 'admin' && role !== 'owner') {
    return NextResponse.json(
      apiError(
        'FORBIDDEN',
        'You do not have permission to export submissions. Only admin and owner roles may export.',
      ),
      { status: 403 },
    )
  }

  const { formId } = await params

  // ── Verify form exists and caller has access ──────────────────────────────
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: {
      id: true,
      ownerId: true,
      schemaBlobId: true,
      title: true,
    },
  })

  if (!form) {
    return NextResponse.json(
      apiError('NOT_FOUND', `Form with ID "${formId}" was not found.`),
      { status: 404 },
    )
  }

  // Only the owner or an admin may export — admins can access any form's export
  // (consistent with how GET /api/forms/[formId]/submissions works)
  if (role !== 'owner' && form.ownerId !== session.user.id) {
    return NextResponse.json(
      apiError('FORBIDDEN', 'You do not have permission to export this form.'),
      { status: 403 },
    )
  }

  // ── Fetch form schema from Walrus ─────────────────────────────────────────
  let formFields: FieldConfig[] = []
  if (form.schemaBlobId) {
    try {
      const schema = await readBlobAsJson<FormSchema>(form.schemaBlobId)
      // Sort fields by their declared order for consistent column ordering
      formFields = [...schema.fields].sort((a, b) => a.order - b.order)
    } catch (err) {
      // Schema fetch failed — log internally, proceed with no field columns
      console.error(
        `[API] GET /api/forms/${formId}/export: failed to fetch form schema (blob: ${form.schemaBlobId}):`,
        err,
      )
    }
  }

  // ── Fetch all submissions (up to 1000 for MVP) ────────────────────────────
  let submissionList: Awaited<ReturnType<typeof listSubmissions>>
  try {
    submissionList = await listSubmissions(formId, {}, { page: 1, pageSize: 1000 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(`[API] GET /api/forms/${formId}/export: listSubmissions failed:`, err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }

  // ── Build CSV ─────────────────────────────────────────────────────────────

  // Header row: fixed columns + one column per form field (using field label)
  const fieldLabels = formFields.map((f) => f.label)
  const headerRow = buildCsvRow(['submission_id', 'submitted_at', 'status', ...fieldLabels])

  const csvRows: string[] = [headerRow]

  for (const submissionMeta of submissionList.submissions) {
    // Fixed columns
    const fixedValues: string[] = [
      submissionMeta.id,
      submissionMeta.submittedAt,
      submissionMeta.status,
    ]

    // If there are no form fields, emit the row with just fixed columns
    if (formFields.length === 0) {
      csvRows.push(buildCsvRow(fixedValues))
      continue
    }

    // Fetch submission payload from Walrus
    let fieldValues: string[]
    try {
      const payload = await getSubmission(submissionMeta.walrusBlobId)

      // Build a lookup map: fieldId → FieldValue
      const fieldMap = new Map<string, FieldValue>()
      for (const fv of payload.fields) {
        fieldMap.set(fv.fieldId, fv)
      }

      // Resolve each form field column
      fieldValues = await Promise.all(
        formFields.map(async (fieldConfig) => {
          const fv = fieldMap.get(fieldConfig.id)

          if (!fv) {
            // Field not present in this submission (e.g. added after submission)
            return ''
          }

          // Handle encrypted fields
          if (fv.encrypted && fv.encryptedData) {
            // admin/owner: attempt decryption (role check already passed above)
            try {
              // SECURITY: decrypted value is never logged
              const plaintext = await decryptField(fv.encryptedData, role)
              return plaintext
            } catch {
              // SECURITY: do NOT log the encryptedData or any derivative
              return '[decryption failed]'
            }
          }

          // Non-encrypted field — serialize value to string
          return serializeFieldValue(fv.value)
        }),
      )
    } catch {
      // Walrus fetch failed for this submission — use [unavailable] for all fields
      // Never fail the entire export due to a single submission error
      fieldValues = formFields.map(() => '[unavailable]')
    }

    csvRows.push(buildCsvRow([...fixedValues, ...fieldValues]))
  }

  const csvContent = csvRows.join('\n')

  // ── Return CSV response ───────────────────────────────────────────────────
  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="submissions-${formId}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
