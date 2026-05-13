/**
 * GET /api/submissions/[submissionId] — admin only
 *
 * Returns the full submission view: metadata from PostgreSQL,
 * payload from Walrus, and status history.
 *
 * Requirements: R7, R16
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { getSubmissionWithHistory } from '@/services/SubmissionService'
import { ServiceError } from '@/services/FormService'

// ─── Route params type ────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ submissionId: string }> }

// ─── GET /api/submissions/[submissionId] ──────────────────────────────────────

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  const { submissionId } = await params

  try {
    const submissionView = await getSubmissionWithHistory(submissionId)
    return NextResponse.json(apiSuccess(submissionView))
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(
      `[API] GET /api/submissions/${submissionId} unexpected error:`,
      err,
    )
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
