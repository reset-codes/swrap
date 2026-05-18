/**
 * GET  /api/forms  — list all forms for the authenticated admin
 * POST /api/forms  — create a new form
 *
 * Requirements: R4, R11, R16
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
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
  if (!session?.user?.id) {
    return NextResponse.json(
      apiError('UNAUTHORIZED', 'Authentication required.'),
      { status: 401 },
    )
  }

  try {
    const forms = await getFormsByOwner(session.user.id)
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

  // Ensure the user exists in the DB — covers the race where signIn callback
  // ran before the DB was available, leaving the user without a Prisma record.
  try {
    const { prisma } = await import('@/lib/prisma/client')
    const existing = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true },
    })
    if (!existing) {
      // User record missing — attempt to create it now
      if (session.user.email) {
        await prisma.$transaction(async (tx) => {
          const u = await tx.user.upsert({
            where: { email: session.user.email! },
            create: {
              id: session.user.id,
              email: session.user.email!,
              name: session.user.name ?? null,
              image: session.user.image ?? null,
              role: 'admin',
            },
            update: {},
          })
          const creditExists = await tx.storageCredit.findUnique({
            where: { userId: u.id },
          })
          if (!creditExists) {
            await tx.storageCredit.create({ data: { userId: u.id, balance: 100 } })
          }
        })
      } else {
        return NextResponse.json(
          apiError('UNAUTHORIZED', 'User account not found. Please sign out and sign in again.'),
          { status: 401 },
        )
      }
    }
  } catch (dbErr) {
    // DB check failed — log and continue; createForm will surface the error
    console.error('[POST /api/forms] User existence check failed:', dbErr instanceof Error ? dbErr.message : dbErr)
  }

  try {
    const form = parsed.data.isDraft
      ? await createFormDraft(session.user.id, parsed.data)
      : await createForm(session.user.id, parsed.data)
    return NextResponse.json(apiSuccess(form), { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      console.error('[POST /api/forms] ServiceError:', err.code, err.message)
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      })
    }
    console.error('[POST /api/forms] Unexpected error:', err instanceof Error ? err.stack : err)
    return NextResponse.json(
      apiError('INTERNAL_ERROR', 'An unexpected error occurred.'),
      { status: 500 },
    )
  }
}
