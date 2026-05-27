/**
 * POST /api/forms/[formId]/publish — publish a form using the infrastructure wallet.
 *
 * For drafts (no schemaBlobId): reads draftSchema from DB, writes to Walrus
 * using the infra wallet, marks published, returns publicUrl.
 *
 * For already-indexed forms: simply marks published and returns publicUrl.
 *
 * No wallet interaction is required from the user. The infra wallet
 * sponsors all Walrus writes.
 *
 * Requirements: R4, R11, R16
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { publishForm, ServiceError } from '@/services/FormService'

type RouteContext = { params: Promise<{ formId: string }> }

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  const { formId } = await params
  const idempotencyKey = _request.headers.get('x-idempotency-key') || _request.headers.get('X-Idempotency-Key')

  try {
    const result = await publishForm(formId, session.user.id, idempotencyKey)
    return NextResponse.json(apiSuccess(result))
  } catch (err) {
    if (err instanceof ServiceError) {
      console.error(`[POST /api/forms/${formId}/publish] ServiceError:`, err.code, err.message)
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(`[POST /api/forms/${formId}/publish] Unexpected error:`, err instanceof Error ? err.stack : err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
