/**
 * POST /api/forms/[formId]/submissions — public, no auth required (R6, R7, Engineering Rule 4)
 * GET  /api/forms/[formId]/submissions — admin only, paginated (R16)
 *
 * Requirements: R6, R7, R16
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma/client';
import { auth } from '@/lib/auth';
import { apiError, apiSuccess } from '@/types/api';
import { assemblePayload, listSubmissions, storeSubmission } from '@/services/SubmissionService';
import { createFormPolicy } from '@/services/EncryptionService';
import { ServiceError } from '@/services/FormService';
import { FieldTypeSchema } from '@/lib/forms/schemas';

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const SubmitFormBodySchema = z.object({
  formSlug: z.string().min(1, 'formSlug is required'),
  formVersion: z.number().int().positive('formVersion must be a positive integer'),
  fields: z.array(
    z.object({
      fieldId: z.string().min(1, 'fieldId is required'),
      fieldType: FieldTypeSchema,
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
      encrypted: z.boolean().default(false),
      encryptedData: z.string().optional(),
    }),
  ),
  metadata: z
    .object({
      userAgent: z.string().optional(),
    })
    .optional(),
});

// ─── Route params type ────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ formId: string }> };

function isHexSealPolicyId(policyId: string | null): policyId is string {
  return /^0x[0-9a-fA-F]{64}$/.test(policyId ?? '');
}

// ─── POST /api/forms/[formId]/submissions ─────────────────────────────────────
// PUBLIC — no authentication required (Engineering Rule 4, R6)

export async function POST(request: Request, { params }: RouteContext) {
  const { formId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'), {
      status: 400,
    });
  }

  const parsed = SubmitFormBodySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return NextResponse.json(apiError('VALIDATION_ERROR', message), {
      status: 400,
    });
  }

  const { formSlug, formVersion, fields, metadata } = parsed.data;

  // Look up the form to get ownerId, encryptionMode, and sealPolicyId.
  // The form must exist and be published before accepting submissions.
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: {
      id: true,
      ownerId: true,
      encryptionMode: true,
      sealPolicyId: true,
      isPublished: true,
    },
  });

  if (!form) {
    return NextResponse.json(apiError('NOT_FOUND', `Form with ID "${formId}" was not found.`), {
      status: 404,
    });
  }

  if (!form.isPublished) {
    return NextResponse.json(
      apiError('NOT_FOUND', 'This form is not currently accepting submissions.'),
      { status: 404 },
    );
  }

  try {
    let sealPolicyId = form.sealPolicyId ?? undefined;
    if (form.encryptionMode !== 'none' && !isHexSealPolicyId(form.sealPolicyId)) {
      sealPolicyId = await createFormPolicy(formId);
      await prisma.form.update({
        where: { id: formId },
        data: { sealPolicyId },
      });
    }

    // Assemble the payload (assigns a new UUID for the submission)
    const payload = assemblePayload(
      formId,
      formSlug,
      formVersion,
      // Cast field values — FieldValue.value supports BlobRef too, but
      // submitters send primitive values; BlobRef uploads go through /api/upload
      fields as Parameters<typeof assemblePayload>[3],
      metadata,
    );

    // Store: encrypt → write to Walrus → index in PostgreSQL
    const { submissionBlobId } = await storeSubmission(
      form.ownerId,
      formId,
      payload,
      form.encryptionMode as Parameters<typeof storeSubmission>[3],
      sealPolicyId,
    );

    return NextResponse.json(apiSuccess({ submissionId: payload.id, submissionBlobId }), {
      status: 201,
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      });
    }
    console.error(`[API] POST /api/forms/${formId}/submissions unexpected error:`, err);
    return NextResponse.json(apiError('INTERNAL_ERROR', 'An unexpected error occurred.'), {
      status: 500,
    });
  }
}

// ─── GET /api/forms/[formId]/submissions ──────────────────────────────────────
// Admin only — requires authentication (R16)

export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(apiError('UNAUTHORIZED', 'Authentication required.'), { status: 401 });
  }

  const { formId } = await params;

  // Parse query params for filtering and pagination
  const url = new URL(request.url);
  const statusParam = url.searchParams.getAll('status');
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10) || 20),
  );

  // Validate status values if provided
  const validStatuses = ['open', 'under_review', 'planned', 'resolved', 'rejected'] as const;
  type ValidStatus = (typeof validStatuses)[number];
  const filteredStatuses = statusParam.filter((s): s is ValidStatus =>
    (validStatuses as readonly string[]).includes(s),
  );

  try {
    const result = await listSubmissions(
      formId,
      filteredStatuses.length > 0 ? { status: filteredStatuses } : {},
      { page, pageSize },
    );
    return NextResponse.json(apiSuccess(result));
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(apiError(err.code, err.message), {
        status: err.statusCode,
      });
    }
    console.error(`[API] GET /api/forms/${formId}/submissions unexpected error:`, err);
    return NextResponse.json(apiError('INTERNAL_ERROR', 'An unexpected error occurred.'), {
      status: 500,
    });
  }
}
