/**
 * POST /api/import/url
 *
 * Accepts a public Airtable shared form URL, scrapes the field schema,
 * and creates a draft form in PostgreSQL ready for the builder.
 *
 * Input:  { url: string }
 * Output: { success: true, data: { formId, redirectUrl, title, fieldCount, skipped } }
 *
 * Does NOT require authentication for the import itself — but DOES require
 * auth to create the draft (same as POST /api/forms).
 *
 * Design: no Walrus write, no credit deduction. The draft is purely DB-only.
 * When the user publishes, the normal publish flow handles Walrus + credits.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import { apiError, apiSuccess } from '@/types/api'
import { scrapeAirtableSharedForm, isValidAirtableShareUrl } from '@/lib/importers/airtable-scraper'
import { generateSlug } from '@/services/FormService'
import { prisma } from '@/lib/prisma/client'

// ─── Input schema ─────────────────────────────────────────────────────────────

const BodySchema = z.object({
  url: z
    .string()
    .min(1, 'URL is required')
    .refine(
      (u) => isValidAirtableShareUrl(u),
      'URL must be a public Airtable shared form link (airtable.com/app.../shr...)',
    ),
})

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  console.log('[API] Processing Airtable import request.');
  // ── Parse input ────────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    console.error('[API] Parse request body failed: Invalid JSON');
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'),
      { status: 400 },
    )
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => e.message).join('; ')
    console.warn('[API] Input validation failed:', msg);
    return NextResponse.json(apiError('VALIDATION_ERROR', msg), { status: 400 })
  }

  const { url } = parsed.data

  // ── Scrape Airtable ────────────────────────────────────────────────────────
  let scraped: Awaited<ReturnType<typeof scrapeAirtableSharedForm>>
  try {
    scraped = await scrapeAirtableSharedForm(url)
    console.log('[API] Airtable import success: fields =', scraped.fields.length);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Could not import this Airtable form yet.'
    console.error('[API] Airtable import failed:', message);
    return NextResponse.json(apiError('IMPORT_FAILED', message), { status: 422 })
  }

  if (scraped.fields.length === 0) {
    return NextResponse.json(
      apiError(
        'IMPORT_FAILED',
        'No importable fields found in this Airtable form. The form may only contain computed or linked fields.',
      ),
      { status: 422 },
    )
  }

  // ── Build canvas-native PocFields for draftSchema ──────────────────────────
  const canvasFields = scraped.fields.map((f, index) => ({
    id: f.id,
    type: f.type,          // canvas type: 'text', 'select', 'textarea', etc.
    label: f.label,
    required: f.required ?? false,
    encrypted: false,
    order: index,
    ...(f.placeholder ? { placeholder: f.placeholder } : {}),
    ...(f.helpText     ? { helpText: f.helpText }     : {}),
    ...(f.options && f.options.length > 0
      ? {
          options: f.options,
        }
      : {}),
    ...(f.validation ? { validation: f.validation } : {}),
  }))

  const formId   = crypto.randomUUID()
  const now      = new Date().toISOString()
  let   slug     = generateSlug(scraped.title || 'imported-form')

  const draftSchema = {
    id:              formId,
    title:           scraped.title,
    description:     scraped.description,
    slug,
    mode:            'table',
    encryptionMode:  'none',
    fields:          canvasFields,
    version:         1,
    createdAt:       now,
    updatedAt:       now,
  }

  // ── Auth Check for Persistence ─────────────────────────────────────────────
  const session = await auth()

  if (!session?.user?.id) {
    // GUEST FLOW: Return the scraped data directly.
    // The frontend will save this to localStorage and navigate to the builder.
    return NextResponse.json(
      apiSuccess({
        isGuest: true,
        title: scraped.title,
        fields: canvasFields,
        fieldCount: canvasFields.length,
        skipped: scraped.skipped,
        redirectUrl: '/dashboard/forms/new?import=local', // Frontend will handle loading the data
      }),
    )
  }

  // ── AUTHENTICATED FLOW: Create draft in DB ────────────────────────────────
  // Ensure slug uniqueness
  const slugExists = await prisma.form.findUnique({ where: { slug } })
  if (slugExists) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  let form: { id: string; title: string }
  try {
    form = await prisma.form.create({
      data: {
        id:            formId,
        slug,
        title:         scraped.title,
        description:   scraped.description,
        ownerId:       session.user.id,
        schemaBlobId:  null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        draftSchema:   draftSchema as any,
        mode:          'table',
        encryptionMode:'none',
        sealPolicyId:  null,
        isPublished:   false,
      },
      select: { id: true, title: true },
    })
  } catch (err) {
    console.error('[POST /api/import/url] Draft creation failed:', err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'Failed to save imported form. Please try again.'),
      { status: 500 },
    )
  }

  return NextResponse.json(
    apiSuccess({
      formId: form.id,
      title: form.title,
      fieldCount: scraped.fields.length,
      skipped: scraped.skipped,
      redirectUrl: `/dashboard/forms/new?draft=${form.id}`,
    }),
    { status: 201 },
  )
}

// ─── (no type mapping needed — canvas types stored directly in draftSchema) ──
