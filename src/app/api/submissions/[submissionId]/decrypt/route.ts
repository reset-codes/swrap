/**
 * POST /api/submissions/[submissionId]/decrypt — admin or owner only
 *
 * Decrypts an encrypted field value in-memory. The plaintext result is
 * returned to the caller and NEVER logged or persisted (Engineering Rule 6,
 * R9.6, Engineering Rule 15).
 *
 * SECURITY INVARIANTS:
 *   - Plaintext is NEVER logged, even in error paths
 *   - Decryption is restricted to admin and owner roles (R9.6, R2.2)
 *   - The decrypted value is returned directly to the caller — callers must
 *     treat it as ephemeral and display-only
 *
 * Requirements: R9, R16
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { decryptField } from '@/services/EncryptionService'
import { ServiceError } from '@/services/FormService'

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const DecryptBodySchema = z.object({
  encryptedData: z.string().min(1, 'encryptedData is required'),
})

// ─── Route params type ────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ submissionId: string }> }

// ─── POST /api/submissions/[submissionId]/decrypt ─────────────────────────────

export async function POST(request: Request, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  // Role check: only admin and owner may decrypt (R9.6, R2.2, Engineering Rule 15)
  const role = session.user.role
  if (role !== 'admin' && role !== 'owner') {
    return NextResponse.json(
      apiError(
        'FORBIDDEN',
        'You do not have permission to decrypt submission data. Only admin and owner roles may decrypt.',
      ),
      { status: 403 },
    )
  }

  // submissionId is available for audit/logging purposes (no plaintext logged)
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

  const parsed = DecryptBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    return NextResponse.json(apiError('VALIDATION_ERROR', message), {
      status: 400,
    })
  }

  const { encryptedData } = parsed.data

  try {
    // SECURITY: decryptField enforces the role check internally as well.
    // The returned plaintext is NEVER logged — not here, not in the service.
    const plaintext = await decryptField(encryptedData, role)

    // Log the decrypt event (submission ID only — no plaintext, no encryptedData)
    console.info(
      `[API] POST /api/submissions/${submissionId}/decrypt: decrypted by user ${session.user.id} (role: ${role})`,
    )

    // SECURITY: plaintext is returned directly — never assigned to a variable
    // that could be accidentally logged elsewhere in this scope
    return NextResponse.json(apiSuccess({ plaintext }))
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    // SECURITY: do NOT include encryptedData or any derivative in this log
    console.error(
      `[API] POST /api/submissions/${submissionId}/decrypt unexpected error (user: ${session.user.id})`,
    )
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
