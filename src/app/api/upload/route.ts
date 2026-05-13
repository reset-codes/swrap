/**
 * POST /api/upload — File upload endpoint.
 *
 * Accepts multipart/form-data with a 'file' field and uploads the file
 * buffer to Walrus via StorageService with a credit check gate.
 *
 * Auth model:
 *   - Authenticated requests: use session.user.id as adminId
 *   - Unauthenticated requests (public form submissions): require a formId
 *     query param to look up the form owner for credit deduction
 *
 * Requirements: R6, R8, R10
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { writeWithCreditCheck } from '@/services/StorageService'
import { ServiceError } from '@/services/FormService'
import { prisma } from '@/lib/prisma/client'

// 50 MB default maximum file size
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

export async function POST(request: Request) {
  // ── Parse multipart form data ─────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Request must be multipart/form-data.'),
      { status: 400 },
    )
  }

  // ── Validate file field ───────────────────────────────────────────────────
  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'A file must be provided in the "file" field.'),
      { status: 400 },
    )
  }

  // ── Validate file size ────────────────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      apiError(
        'VALIDATION_ERROR',
        `File size exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
      ),
      { status: 400 },
    )
  }

  // ── Resolve adminId ───────────────────────────────────────────────────────
  const url = new URL(request.url)
  const formId = url.searchParams.get('formId') ?? undefined

  const session = await auth()
  let adminId: string

  if (session?.user?.id) {
    // Authenticated request — use the session user's ID directly
    adminId = session.user.id
  } else if (formId) {
    // Unauthenticated public form submission — look up the form owner
    const form = await prisma.form.findUnique({
      where: { id: formId },
      select: { ownerId: true },
    })
    if (!form) {
      return NextResponse.json(
        apiError('NOT_FOUND', 'Form not found.'),
        { status: 404 },
      )
    }
    adminId = form.ownerId
  } else {
    // No session and no formId — cannot determine who to charge
    return NextResponse.json(
      apiError(
        'VALIDATION_ERROR',
        'Either authentication or a formId query parameter is required for file uploads.',
      ),
      { status: 400 },
    )
  }

  // ── Convert File to Buffer ────────────────────────────────────────────────
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // ── Upload to Walrus with credit check ────────────────────────────────────
  const mimeType = file.type || 'application/octet-stream'

  try {
    const { blobId, sizeBytes } = await writeWithCreditCheck(
      adminId,
      buffer,
      'file_upload',
      mimeType,
      formId,
    )

    return NextResponse.json(
      apiSuccess({
        blobId,
        blobType: 'file_upload',
        size: sizeBytes,
        fileName: file.name,
        mimeType,
      }),
    )
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error('[API] POST /api/upload unexpected error:', err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
