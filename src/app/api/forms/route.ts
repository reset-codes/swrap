/**
 * GET  /api/forms  — list all forms for the authenticated admin
 * POST /api/forms  — create a new form
 *
 * Requirements: R4, R11, R16
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getCanonicalUserId } from '@/lib/auth/canonical'
import { apiError, apiSuccess } from '@/types/api'
import {
  createForm,
  createFormDraft,
  getFormsByOwner,
  ServiceError,
} from '@/services/FormService'
import {
  FieldTypeSchema,
  FieldValidationSchema,
  FieldOptionSchema,
  FormModeSchema,
  EncryptionModeSchema,
} from '@/lib/forms/schemas'

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

/** Field input schema for POST body — no id/order (service assigns them) */
const CreateFieldSchema = z.object({
  type: FieldTypeSchema,
  label: z.string().min(1, 'Field label is required'),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  required: z.boolean().default(false),
  encrypted: z.boolean().default(false),
  validation: FieldValidationSchema,
  options: z.array(FieldOptionSchema).optional(),
})

const CreateFormBodySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  mode: FormModeSchema,
  encryptionMode: EncryptionModeSchema,
  fields: z.array(CreateFieldSchema).default([]),
  /**
   * When true: skip Walrus write, create DB-only draft.
   * Used by the canvas builder "Save Draft" flow.
   */
  isDraft: z.boolean().optional(),
})

// ─── GET /api/forms ───────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth()
  const canonicalUserId = await getCanonicalUserId(session)
  if (!canonicalUserId) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  try {
    const forms = await getFormsByOwner(canonicalUserId)
    return NextResponse.json(apiSuccess(forms))
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error('[API] GET /api/forms unexpected error:', err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}

// ─── POST /api/forms ──────────────────────────────────────────────────────────

export async function POST(request: Request) {
  console.log('[API Forms] Request received')
  const session = await auth()
  const canonicalUserId = await getCanonicalUserId(session)
  console.log('[API Forms] User authenticated =', !!canonicalUserId)
  
  if (!canonicalUserId) {
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

  const parsed = CreateFormBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    console.error('[POST /api/forms] Validation error:', message, 'body:', JSON.stringify(body))
    return NextResponse.json(apiError('VALIDATION_ERROR', message), {
      status: 400,
    })
  }

  console.log('[API Forms] Draft validation passed')

  try {
    console.log('[API Forms] DB write started')
    const form = parsed.data.isDraft
      ? await createFormDraft(canonicalUserId, parsed.data)
      : await createForm(canonicalUserId, parsed.data)
    console.log('[API Forms] DB write success')
    return NextResponse.json(apiSuccess(form), { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      console.error('[POST /api/forms] ServiceError:', err.code, err.message)
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error('[API Forms] DB write failed:', err instanceof Error ? err.stack : err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', err instanceof Error ? err.message : 'An unexpected error occurred during database write.'),
      { status: 500 },
    )
  }
}
