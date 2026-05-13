/**
 * POST /api/import/google-forms
 *
 * Accepts a Google Forms JSON export, maps question types to SEALBASE
 * equivalents, and creates a draft Form record in PostgreSQL (no Walrus
 * write — drafts do not consume storage credits).
 *
 * The Admin can then review and edit the imported form in the Form Builder
 * before publishing it (which triggers the Walrus write).
 *
 * Requirements: R17
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { parseGoogleFormsExport } from '@/lib/import/google-forms'
import { prisma } from '@/lib/prisma/client'
import { generateSlug } from '@/services/FormService'

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'),
      { status: 400 },
    )
  }

  // ── Parse Google Forms export ─────────────────────────────────────────────
  let result: ReturnType<typeof parseGoogleFormsExport>
  try {
    result = parseGoogleFormsExport(body)
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to parse Google Forms export.'
    return NextResponse.json(apiError('VALIDATION_ERROR', message), {
      status: 400,
    })
  }

  const { title, fields, skippedFields } = result

  // ── Create draft form in PostgreSQL (no Walrus write) ─────────────────────
  try {
    const form = await prisma.form.create({
      data: {
        slug: generateSlug(title),
        title,
        ownerId: session.user.id,
        mode: 'table',
        encryptionMode: 'none',
        isPublished: false,
      },
    })

    return NextResponse.json(
      apiSuccess({
        formId: form.id,
        title: form.title,
        fieldCount: fields.length,
        fields,
        skippedFields,
      }),
    )
  } catch (err) {
    console.error(
      '[API] Google Forms import — draft form creation failed:',
      err,
    )
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'Failed to create draft form.'),
      { status: 500 },
    )
  }
}
