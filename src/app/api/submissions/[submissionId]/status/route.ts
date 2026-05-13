/**
 * POST /api/submissions/[submissionId]/status — admin only, append-only
 *
 * Appends a new status entry to a submission's status history.
 * Submissions are immutable — this creates a new log record, never
 * modifying the original Walrus blob (Engineering Rule 3).
 *
 * Requirements: R7, R16
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { updateSubmissionStatus } from '@/services/SubmissionService'
import { ServiceError } from '@/services/FormService'

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const UpdateStatusBodySchema = z.object({
  status: z.enum(['open', 'under_review', 'planned', 'resolved', 'rejected']),
  note: z.string().optional(),
})

// ─── Route params type ────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ submissionId: string }> }

// ─── POST /api/submissions/[submissionId]/status ──────────────────────────────

export async function POST(request: Request, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  const { submissionId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'),
      { status: 400 },
    )
  }

  const parsed = UpdateStatusBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    return NextResponse.json(apiError('VALIDATION_ERROR', message), {
      status: 400,
    })
  }

  const { status, note } = parsed.data

  try {
    await updateSubmissionStatus(submissionId, session.user.id, status, note)
    return NextResponse.json(apiSuccess({ updated: true }))
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(
      `[API] POST /api/submissions/${submissionId}/status unexpected error:`,
      err,
    )
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
