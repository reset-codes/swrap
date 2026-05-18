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
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  const { formId } = await params

  try {
    const data = await getFormWithSchema(formId, session.user.id)
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
  const session = await auth()
  if (!session?.user?.id) {
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
      return NextResponse.json(apiError('VALIDATION_ERROR', message), { status: 400 })
    }
    try {
      const form = await updateFormDraft(formId, session.user.id, {
        title: parsed.data.title,
        description: parsed.data.description,
        mode: parsed.data.mode,
        encryptionMode: parsed.data.encryptionMode,
        fields: parsed.data.fields as FieldConfig[] | undefined,
      })
      return NextResponse.json(apiSuccess(form))
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(apiError(err.code, err.message), { status: err.statusCode })
      }
      console.error(`[PUT /api/forms/${formId}] Draft update error:`, err instanceof Error ? err.message : err)
      return NextResponse.json(apiError('INTERNAL_ERROR', 'An unexpected error occurred.'), { status: 500 })
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

  try {
    const form = await updateForm(formId, session.user.id, parsed.data)
    return NextResponse.json(apiSuccess(form))
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error(`[API] PUT /api/forms/${formId} unexpected error:`, err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}

// ─── DELETE /api/forms/[formId] ───────────────────────────────────────────────

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  // DELETE is owner-only (Engineering Rule 15, R16)
  if (session.user.role !== 'owner') {
    return NextResponse.json(
      apiError('FORBIDDEN', 'Only the workspace owner can delete forms.'),
      { status: 403 },
    )
  }

  const { formId } = await params

  try {
    await deleteForm(formId, session.user.id)
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
