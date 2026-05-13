/**
 * POST /api/forms/[formId]/publish — publish a form
 *
 * Makes the form publicly accessible at its slug URL.
 * The slug becomes immutable after publication (R4.8, R19.4).
 *
 * Requirements: R4, R11, R16
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { publishForm, ServiceError } from '@/services/FormService'

// ─── Route params type ────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ formId: string }> }

// ─── POST /api/forms/[formId]/publish ────────────────────────────────────────

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  const { formId } = await params

  try {
    const result = await publishForm(formId, session.user.id)
    return NextResponse.json(apiSuccess(result))
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(
      `[API] POST /api/forms/${formId}/publish unexpected error:`,
      err,
    )
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
