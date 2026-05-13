/**
 * POST /api/credits/deposit — Deposit storage credits for the authenticated admin.
 *
 * Requirements: R10, R13
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { deposit, getBalance } from '@/services/CreditService'
import { ServiceError } from '@/services/FormService'

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const DepositBodySchema = z.object({
  amount: z
    .number({ invalid_type_error: 'Amount must be a number.' })
    .positive('Amount must be greater than zero.'),
})

// ─── POST /api/credits/deposit ────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'),
      { status: 400 },
    )
  }

  const parsed = DepositBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    return NextResponse.json(apiError('VALIDATION_ERROR', message), {
      status: 400,
    })
  }

  try {
    await deposit(session.user.id, parsed.data.amount)
    const newBalance = await getBalance(session.user.id)
    return NextResponse.json(apiSuccess({ newBalance }), { status: 200 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error('[API] POST /api/credits/deposit unexpected error:', err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
