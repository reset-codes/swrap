/**
 * POST /api/import/airtable
 *
 * Accepts an Airtable base schema export, maps field types to Swrap
 * equivalents, and creates a draft Form record in PostgreSQL (no Walrus
 * write — drafts do not consume storage credits).
 *
 * Uses the first table in the export. The Admin can then review and edit
 * the imported form in the Form Builder before publishing it.
 *
 * Requirements: R17
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { parseAirtableExport } from '@/lib/import/airtable'
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

  // ── Parse Airtable export ─────────────────────────────────────────────────
  let result: ReturnType<typeof parseAirtableExport>
  try {
    result = parseAirtableExport(body)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to parse Airtable export.'
    return NextResponse.json(apiError('VALIDATION_ERROR', message), {
      status: 400,
    })
  }

  const { title, fields, skippedFields } = result

  // ── Create draft form in PostgreSQL (no Walrus write) ─────────────────────
  // schemaBlobId is intentionally null — the form is a draft.
  // The Walrus write (and credit deduction) happens when the Admin publishes.
  try {
    const form = await prisma.form.create({
      data: {
        slug: generateSlug(title),
        title,
        ownerId: session.user.id,
        mode: 'table',
        encryptionMode: 'none',
        isPublished: false,
        // schemaBlobId omitted → null (draft, not yet stored on Walrus)
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
    console.error('[API] Airtable import — draft form creation failed:', err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'Failed to create draft form.'),
      { status: 500 },
    )
  }
}
