/**
 * GET    /api/forms/[formId]  — get a single form's metadata
 * PUT    /api/forms/[formId]  — update a form
 * DELETE /api/forms/[formId]  — delete a form (owner only)
 *
 * Requirements: R4, R11, R16
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getCanonicalUserId } from '@/lib/auth/canonical'
import { apiError, apiSuccess } from '@/types/api'
import {
  deleteForm,
  getFormWithSchema,
  ServiceError,
  updateForm,
  updateFormDraft,
} from '@/services/FormService'
import {
  FieldConfigSchema,
  FormModeSchema,
  EncryptionModeSchema,
} from '@/lib/forms/schemas'
import type { FieldConfig } from '@/types/form'

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const UpdateFormBodySchema = z.object({
  title: z.string().min(1, 'Title must not be empty').optional(),
  description: z.string().optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  mode: FormModeSchema.optional(),
  encryptionMode: EncryptionModeSchema.optional(),
  fields: z.array(FieldConfigSchema).optional(),
  /** When true: DB-only update, no Walrus write. Used by canvas builder. */
  isDraft: z.boolean().optional(),
})

// For draft updates from the canvas builder, fields may have unknown types
// and don't need strict FieldConfigSchema validation
const UpdateDraftBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  mode: FormModeSchema.optional(),
  encryptionMode: EncryptionModeSchema.optional(),
  fields: z.array(z.record(z.unknown())).optional(),
  isDraft: z.literal(true),
})

// ─── Route params type ────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ formId: string }> }

// ─── GET /api/forms/[formId] ──────────────────────────────────────────────────

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth()
  const canonicalUserId = await getCanonicalUserId(session)
  if (!canonicalUserId) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  const { formId } = await params

  try {
    const data = await getFormWithSchema(formId, canonicalUserId)
    return NextResponse.json(apiSuccess(data))
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(`[API] GET /api/forms/${formId} unexpected error:`, err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
// ─── PUT /api/forms/[formId] ──────────────────────────────────────────────────

export async function PUT(request: Request, { params }: RouteContext) {
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

  const { formId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'),
      { status: 400 },
    )
  }

  const rawBody = body as Record<string, unknown>
  const isDraftUpdate = rawBody['isDraft'] === true

  if (isDraftUpdate) {
    // Draft update: loose schema, fields can be any shape
    const parsed = UpdateDraftBodySchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
      console.error('[POST /api/forms] Validation error:', message)
      return NextResponse.json(apiError('VALIDATION_ERROR', message), { status: 400 })
    }
    console.log('[API Forms] Draft validation passed')
    try {
      console.log('[API Forms] DB write started')
      const form = await updateFormDraft(formId, canonicalUserId, {
        title: parsed.data.title,
        description: parsed.data.description,
        slug: parsed.data.slug,
        mode: parsed.data.mode,
        encryptionMode: parsed.data.encryptionMode,
        fields: parsed.data.fields as FieldConfig[] | undefined,
      })
      console.log('[API Forms] DB write success')
      return NextResponse.json(apiSuccess(form))
    } catch (err) {
      if (err instanceof ServiceError) {
        console.error('[API Forms] DB write failed (ServiceError):', err.code, err.message)
        return NextResponse.json(apiError(err.code, err.message), { status: err.statusCode })
      }
      console.error(`[API Forms] DB write failed:`, err instanceof Error ? err.stack : err)
      return NextResponse.json(apiError('INTERNAL_ERROR', err instanceof Error ? err.message : 'An unexpected error occurred during database write.'), { status: 500 })
    }
  }

  const parsed = UpdateFormBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    return NextResponse.json(apiError('VALIDATION_ERROR', message), {
      status: 400,
    })
  }

  console.log('[API Forms] Draft validation passed')

  try {
    console.log('[API Forms] DB write started')
    const form = await updateForm(formId, canonicalUserId, parsed.data)
    console.log('[API Forms] DB write success')
    return NextResponse.json(apiSuccess(form))
  } catch (err) {
    if (err instanceof ServiceError) {
      console.error('[API Forms] DB write failed (ServiceError):', err.code, err.message)
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(`[API Forms] DB write failed:`, err instanceof Error ? err.stack : err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', err instanceof Error ? err.message : 'An unexpected error occurred during database write.'),
      { status: 500 },
    )
  }
}

// ─── DELETE /api/forms/[formId] ───────────────────────────────────────────────

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await auth()
  const canonicalUserId = await getCanonicalUserId(session)
  if (!canonicalUserId) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  // DELETE is owner-only (Engineering Rule 15, R16)
  if (session?.user?.role !== 'owner') {
    return NextResponse.json(
      apiError('FORBIDDEN', 'Only the workspace owner can delete forms.'),
      { status: 403 },
    )
  }

  const { formId } = await params

  try {
    await deleteForm(formId, canonicalUserId)
    return NextResponse.json(apiSuccess({ deleted: true }))
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(`[API] DELETE /api/forms/${formId} unexpected error:`, err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
