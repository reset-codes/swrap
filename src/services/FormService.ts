/**
 * FormService — Form CRUD business logic.
 *
 * Enforces the core data-integrity invariants for forms:
 *   1. Walrus write BEFORE PostgreSQL index (Engineering Rule 1)
 *   2. Storage credits checked BEFORE any Walrus write (Engineering Rule 5)
 *   3. Slugs are unique and immutable after publication (R4.7, R4.8, R19.3, R19.4)
 *   4. Form schema versioning: each save creates a new Walrus blob (R4.9)
 *
 * Requirements: R3, R4, R5, R8, R10
 */

import { prisma } from '@/lib/prisma/client'
import { executeWalrusWrite, executeWalrusRead } from '@/lib/wallet/manager'
import type {
  CreateFormInput,
  FieldConfig,
  FormMetadata,
  FormSchema,
  UpdateFormInput,
} from '@/types/form'
import { checkSufficient, deduct } from './CreditService'

// ---------------------------------------------------------------------------
// Local helper: read a Walrus blob and parse as JSON
// (replaces the deleted @/lib/walrus/client readBlobAsJson)
// ---------------------------------------------------------------------------

async function readBlobAsJson<T>(blobId: string): Promise<T> {
  const buffer = await executeWalrusRead(blobId)
  return JSON.parse(buffer.toString('utf-8')) as T
}

// ─── ServiceError ─────────────────────────────────────────────────────────────

/**
 * Service-level error with a machine-readable code and HTTP status hint.
 *
 * Callers (API routes) should map these to the standard
 * `{ success: false, error: { code, message } }` response shape.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a title.
 *
 * Converts to lowercase, replaces non-alphanumeric runs with hyphens,
 * strips leading/trailing hyphens, and appends a 6-character random suffix
 * to reduce collision probability.
 *
 * @param title  The form title to derive a slug from.
 * @returns      A URL-safe slug string.
 */
export function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) // cap base length to keep URLs reasonable

  const suffix = Math.random().toString(36).slice(2, 8) // 6 random alphanumeric chars
  return `${base}-${suffix}`
}

/**
 * Estimate the WAL storage cost for a JSON payload.
 *
 * Rough estimate: 0.001 WAL per KB (1024 bytes).
 *
 * @param jsonString  The serialized JSON string to estimate cost for.
 * @returns           Estimated cost in WAL.
 */
function estimateCost(jsonString: string): number {
  return Math.ceil(jsonString.length / 1024) * 0.001
}

/**
 * Map a Prisma Form row to the FormMetadata shape.
 */
function toFormMetadata(
  form: {
    id: string
    slug: string
    title: string
    description: string | null
    ownerId: string
    schemaBlobId: string | null
    mode: string
    encryptionMode: string
    sealPolicyId: string | null
    isPublished: boolean
    publishedAt: Date | null
    createdAt: Date
    updatedAt: Date
  },
  submissionCount?: number,
): FormMetadata {
  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    description: form.description ?? undefined,
    ownerId: form.ownerId,
    schemaBlobId: form.schemaBlobId,
    mode: form.mode as FormMetadata['mode'],
    encryptionMode: form.encryptionMode as FormMetadata['encryptionMode'],
    sealPolicyId: form.sealPolicyId,
    isPublished: form.isPublished,
    publishedAt: form.publishedAt?.toISOString() ?? null,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
    submissionCount,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new form.
 *
 * Flow:
 *   1. Generate or validate slug uniqueness
 *   2. Assemble FormSchema
 *   3. Serialize to JSON
 *   4. Check storage credits
 *   5. Write schema to Walrus
 *   6. Index form metadata in PostgreSQL (with schemaBlobId)
 *   7. Create BlobReference record
 *   8. Deduct credits
 *
 * @param adminId  The authenticated admin's user ID.
 * @param input    The form creation input.
 * @returns        The created form's metadata.
 * @throws ServiceError with code 'SLUG_TAKEN' if the slug is already in use.
 * @throws ServiceError with code 'INSUFFICIENT_CREDITS' if credits are too low.
 */
export async function createForm(
  adminId: string,
  input: CreateFormInput,
): Promise<FormMetadata> {
  // ── Step 1: Resolve slug ──────────────────────────────────────────────────
  let slug = input.slug ?? generateSlug(input.title)

  // Normalise caller-provided slug to the same format
  if (input.slug) {
    slug = input.slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  const existing = await prisma.form.findUnique({ where: { slug } })
  if (existing) {
    throw new ServiceError(
      `The slug "${slug}" is already taken. Please choose a different slug.`,
      'SLUG_TAKEN',
      409,
    )
  }

  // ── Step 2: Assemble FormSchema ───────────────────────────────────────────
  const now = new Date().toISOString()
  const formId = crypto.randomUUID()

  // Generate Seal policy if encryption is enabled
  let sealPolicyId: string | undefined = undefined
  if (input.encryptionMode !== 'none') {
    // NOTE: Seal policy creation has been migrated to apps/api/services/infrastructure-wallet.ts.
    // This legacy src/ path throws until the form creation flow is migrated to the canonical API.
    const { executeSealCreatePolicy } = await import('@/lib/wallet/manager')
    const policy = await executeSealCreatePolicy(formId, ['admin', 'owner'])
    sealPolicyId = policy.policyId
  }

  const fields: FieldConfig[] = input.fields.map((f, index) => ({
    ...f,
    id: crypto.randomUUID(),
    order: index,
  }))

  const schema: FormSchema = {
    id: formId,
    title: input.title,
    description: input.description,
    slug,
    mode: input.mode,
    encryptionMode: input.encryptionMode,
    sealPolicyId,
    fields,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }

  // ── Step 3: Serialize ─────────────────────────────────────────────────────
  const jsonString = JSON.stringify(schema)

  // ── Step 4: Check credits ─────────────────────────────────────────────────
  const cost = estimateCost(jsonString)
  const hasSufficientCredits = await checkSufficient(adminId, cost)
  if (!hasSufficientCredits) {
    throw new ServiceError(
      'Insufficient storage credits. Please deposit more credits before creating a form.',
      'INSUFFICIENT_CREDITS',
      402,
    )
  }

  // ── Step 5: Write to Walrus ───────────────────────────────────────────────
  // If this fails, we do NOT index in PostgreSQL (Engineering Rule 1).
  let blobId: string
  try {
    const result = await executeWalrusWrite(
      Buffer.from(jsonString, 'utf-8'),
      'application/json',
    )
    blobId = result.blobId
  } catch {
    throw new ServiceError(
      'Failed to store form schema on Walrus. Please try again.',
      'WALRUS_WRITE_FAILED',
      503,
    )
  }

  // ── Step 6 & 7: Index in PostgreSQL + BlobReference ──────────────────────
  const form = await prisma.$transaction(async (tx) => {
    const created = await tx.form.create({
      data: {
        id: formId,
        slug,
        title: input.title,
        description: input.description,
        ownerId: adminId,
        schemaBlobId: blobId,
        mode: input.mode,
        encryptionMode: input.encryptionMode,
        sealPolicyId: sealPolicyId ?? null,
      },
    })

    await tx.blobReference.create({
      data: {
        walrusBlobId: blobId,
        blobType: 'form_schema',
        sizeBytes: Buffer.byteLength(jsonString, 'utf-8'),
        formId: created.id,
      },
    })

    return created
  })

  // ── Step 8: Deduct credits ────────────────────────────────────────────────
  // Best-effort: credits are deducted after a successful write. If deduction
  // fails, the form is still created (the write already happened on Walrus).
  try {
    await deduct(adminId, cost, blobId)
  } catch {
    // Log internally but do not fail the operation — the Walrus write succeeded.
    // A reconciliation job can handle credit discrepancies.
    console.error(
      `[FormService] Credit deduction failed for admin ${adminId}, blob ${blobId}`,
    )
  }

  return toFormMetadata(form)
}

/**
 * Update an existing form by writing a new schema blob to Walrus and
 * updating the schemaBlobId reference in PostgreSQL.
 *
 * Slug is NOT updatable via this method — slugs are immutable after
 * publication (R4.8). Before publication, slug changes are handled via
 * form settings, not this method.
 *
 * @param formId   The ID of the form to update.
 * @param adminId  The authenticated admin's user ID (must own the form).
 * @param input    The fields to update.
 * @returns        The updated form's metadata.
 * @throws ServiceError with code 'NOT_FOUND' if the form does not exist.
 * @throws ServiceError with code 'FORBIDDEN' if adminId does not own the form.
 * @throws ServiceError with code 'INSUFFICIENT_CREDITS' if credits are too low.
 */
export async function updateForm(
  formId: string,
  adminId: string,
  input: UpdateFormInput,
): Promise<FormMetadata> {
  // ── Verify form exists and caller has access ──────────────────────────────
  const existing = await prisma.form.findUnique({ where: { id: formId } })
  if (!existing) {
    throw new ServiceError(
      `Form with ID "${formId}" was not found.`,
      'NOT_FOUND',
      404,
    )
  }
  if (existing.ownerId !== adminId) {
    throw new ServiceError(
      'You do not have permission to update this form.',
      'FORBIDDEN',
      403,
    )
  }

  // ── Fetch current schema from Walrus ──────────────────────────────────────
  let currentSchema: FormSchema
  if (existing.schemaBlobId) {
    try {
      currentSchema = await readBlobAsJson<FormSchema>(existing.schemaBlobId)
    } catch {
      throw new ServiceError(
        'Failed to fetch the current form schema from Walrus. Please try again.',
        'WALRUS_READ_FAILED',
        503,
      )
    }
  } else {
    // Form was created but schema blob was never written — build a minimal schema
    currentSchema = {
      id: existing.id,
      title: existing.title,
      description: existing.description ?? undefined,
      slug: existing.slug,
      mode: existing.mode as FormSchema['mode'],
      encryptionMode: existing.encryptionMode as FormSchema['encryptionMode'],
      sealPolicyId: existing.sealPolicyId ?? undefined,
      fields: [],
      version: 0,
      createdAt: existing.createdAt.toISOString(),
      updatedAt: existing.updatedAt.toISOString(),
    }
  }

  // ── Merge updates into schema ─────────────────────────────────────────────
  const now = new Date().toISOString()

  // Handle Seal policy if encryption mode is changing or being enabled
  let sealPolicyId = currentSchema.sealPolicyId
  const newEncryptionMode = input.encryptionMode ?? currentSchema.encryptionMode
  
  if (newEncryptionMode !== 'none' && !sealPolicyId) {
    // NOTE: Seal policy creation has been migrated to apps/api/services/infrastructure-wallet.ts.
    const { executeSealCreatePolicy } = await import('@/lib/wallet/manager')
    const policy = await executeSealCreatePolicy(existing.id, ['admin', 'owner'])
    sealPolicyId = policy.policyId
  }

  const updatedSchema: FormSchema = {
    ...currentSchema,
    title: input.title ?? currentSchema.title,
    description: input.description ?? currentSchema.description,
    mode: input.mode ?? currentSchema.mode,
    encryptionMode: newEncryptionMode,
    sealPolicyId,
    fields: input.fields ?? currentSchema.fields,
    version: currentSchema.version + 1,
    updatedAt: now,
  }

  // ── Serialize ─────────────────────────────────────────────────────────────
  const jsonString = JSON.stringify(updatedSchema)

  // ── Check credits ─────────────────────────────────────────────────────────
  const cost = estimateCost(jsonString)
  const hasSufficientCredits = await checkSufficient(adminId, cost)
  if (!hasSufficientCredits) {
    throw new ServiceError(
      'Insufficient storage credits. Please deposit more credits before updating this form.',
      'INSUFFICIENT_CREDITS',
      402,
    )
  }

  // ── Write new schema blob to Walrus ───────────────────────────────────────
  let newBlobId: string
  try {
    const result = await executeWalrusWrite(
      Buffer.from(jsonString, 'utf-8'),
      'application/json',
    )
    newBlobId = result.blobId
  } catch {
    throw new ServiceError(
      'Failed to store updated form schema on Walrus. Please try again.',
      'WALRUS_WRITE_FAILED',
      503,
    )
  }

  // ── Update schemaBlobId in PostgreSQL + new BlobReference ─────────────────
  const updated = await prisma.$transaction(async (tx) => {
    const form = await tx.form.update({
      where: { id: formId },
      data: {
        title: input.title ?? existing.title,
        description:
          input.description !== undefined
            ? input.description
            : existing.description,
        mode: input.mode ?? existing.mode,
        encryptionMode: input.encryptionMode ?? existing.encryptionMode,
        sealPolicyId: sealPolicyId ?? null,
        schemaBlobId: newBlobId,
      },
    })

    await tx.blobReference.create({
      data: {
        walrusBlobId: newBlobId,
        blobType: 'form_schema',
        sizeBytes: Buffer.byteLength(jsonString, 'utf-8'),
        formId: form.id,
      },
    })

    return form
  })

  // ── Deduct credits ────────────────────────────────────────────────────────
  try {
    await deduct(adminId, cost, newBlobId)
  } catch {
    console.error(
      `[FormService] Credit deduction failed for admin ${adminId}, blob ${newBlobId}`,
    )
  }

  return toFormMetadata(updated)
}

/**
 * Publish a form, making it publicly accessible at its slug URL.
 *
 * Marks the form as published in PostgreSQL. The slug becomes immutable
 * from this point forward (R4.8, R19.4).
 *
 * @param formId   The ID of the form to publish.
 * @param adminId  The authenticated admin's user ID (must own the form).
 * @returns        The public URL for the published form.
 * @throws ServiceError with code 'NOT_FOUND' if the form does not exist.
 * @throws ServiceError with code 'FORBIDDEN' if adminId does not own the form.
 * @throws ServiceError with code 'SCHEMA_MISSING' if the form has no schema blob.
 */
export async function publishForm(
  formId: string,
  adminId: string,
): Promise<{ publicUrl: string }> {
  const form = await prisma.form.findUnique({ where: { id: formId } })
  if (!form) {
    throw new ServiceError(
      `Form with ID "${formId}" was not found.`,
      'NOT_FOUND',
      404,
    )
  }
  if (form.ownerId !== adminId) {
    throw new ServiceError(
      'You do not have permission to publish this form.',
      'FORBIDDEN',
      403,
    )
  }
  if (!form.schemaBlobId) {
    throw new ServiceError(
      'This form cannot be published because it has no schema stored on Walrus. Please save the form first.',
      'SCHEMA_MISSING',
      400,
    )
  }

  // Mark as published
  const published = await prisma.form.update({
    where: { id: formId },
    data: {
      isPublished: true,
      publishedAt: new Date(),
    },
  })

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? 'https://swrap.app'
  const publicUrl = `${appUrl}/f/${published.slug}`

  return { publicUrl }
}

/**
 * Retrieve a published form's schema from Walrus by its slug.
 *
 * Only published forms are accessible via this method (public form renderer).
 *
 * @param slug  The form's URL slug.
 * @returns     The full FormSchema fetched from Walrus.
 * @throws ServiceError with code 'NOT_FOUND' if no published form has this slug.
 * @throws ServiceError with code 'SCHEMA_MISSING' if the form has no blob ID.
 */
export async function getFormBySlug(slug: string): Promise<FormSchema> {
  const form = await prisma.form.findUnique({
    where: { slug, isPublished: true },
  })
  if (!form) {
    throw new ServiceError(
      `No published form found with slug "${slug}".`,
      'NOT_FOUND',
      404,
    )
  }
  if (!form.schemaBlobId) {
    throw new ServiceError(
      'This form does not have a schema stored on Walrus.',
      'SCHEMA_MISSING',
      500,
    )
  }

  try {
    return await readBlobAsJson<FormSchema>(form.schemaBlobId)
  } catch {
    throw new ServiceError(
      'Failed to fetch the form schema from Walrus. Please try again.',
      'WALRUS_READ_FAILED',
      503,
    )
  }
}

/**
 * Retrieve a single form's metadata by ID.
 *
 * Queries the PostgreSQL index only — does not fetch the Walrus blob.
 * The caller must own the form (or be an admin with access).
 *
 * @param formId   The ID of the form to retrieve.
 * @param adminId  The authenticated admin's user ID (must own the form).
 * @returns        The form's metadata.
 * @throws ServiceError with code 'NOT_FOUND' if the form does not exist.
 * @throws ServiceError with code 'FORBIDDEN' if adminId does not own the form.
 */
export async function getFormById(
  formId: string,
  adminId: string,
): Promise<FormMetadata> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: {
      _count: {
        select: { submissions: true },
      },
    },
  })

  if (!form) {
    throw new ServiceError(
      `Form with ID "${formId}" was not found.`,
      'NOT_FOUND',
      404,
    )
  }
  if (form.ownerId !== adminId) {
    throw new ServiceError(
      'You do not have permission to access this form.',
      'FORBIDDEN',
      403,
    )
  }

  return toFormMetadata(form, form._count.submissions)
}

/**
 * Retrieve a single form's metadata and its full schema from Walrus.
 *
 * @param formId   The ID of the form to retrieve.
 * @param adminId  The authenticated admin's user ID (must own the form).
 * @returns        The form's metadata and its schema.
 * @throws ServiceError with code 'NOT_FOUND' if the form does not exist.
 * @throws ServiceError with code 'FORBIDDEN' if adminId does not own the form.
 * @throws ServiceError with code 'SCHEMA_MISSING' if the form has no blob ID.
 */
export async function getFormWithSchema(
  formId: string,
  adminId: string,
): Promise<{ form: FormMetadata; schema: FormSchema }> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: {
      _count: {
        select: { submissions: true },
      },
    },
  })

  if (!form) {
    throw new ServiceError(
      `Form with ID "${formId}" was not found.`,
      'NOT_FOUND',
      404,
    )
  }
  if (form.ownerId !== adminId) {
    throw new ServiceError(
      'You do not have permission to access this form.',
      'FORBIDDEN',
      403,
    )
  }

  if (!form.schemaBlobId) {
    throw new ServiceError(
      'This form does not have a schema stored on Walrus.',
      'SCHEMA_MISSING',
      500,
    )
  }

  try {
    const schema = await readBlobAsJson<FormSchema>(form.schemaBlobId)
    return {
      form: toFormMetadata(form, form._count.submissions),
      schema,
    }
  } catch {
    throw new ServiceError(
      'Failed to fetch the form schema from Walrus. Please try again.',
      'WALRUS_READ_FAILED',
      503,
    )
  }
}

/**
 * List all forms owned by an admin, including submission counts.
 *
 * Queries the PostgreSQL index only — does not fetch Walrus blobs.
 *
 * @param adminId  The authenticated admin's user ID.
 * @returns        Array of FormMetadata sorted by creation date (newest first).
 */
export async function getFormsByOwner(
  adminId: string,
): Promise<FormMetadata[]> {
  const forms = await prisma.form.findMany({
    where: { ownerId: adminId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { submissions: true },
      },
    },
  })

  return forms.map((form) =>
    toFormMetadata(form, form._count.submissions),
  )
}

/**
 * Delete a form's metadata from PostgreSQL.
 *
 * This is an owner-only operation (R2.1, Engineering Rule 15).
 * Walrus blobs are immutable and are NOT deleted — they remain on the
 * decentralized network indefinitely.
 *
 * @param formId   The ID of the form to delete.
 * @param ownerId  The user ID of the owner (must match form.ownerId).
 * @throws ServiceError with code 'NOT_FOUND' if the form does not exist.
 * @throws ServiceError with code 'FORBIDDEN' if ownerId does not own the form.
 */
export async function deleteForm(
  formId: string,
  ownerId: string,
): Promise<void> {
  const form = await prisma.form.findUnique({ where: { id: formId } })
  if (!form) {
    throw new ServiceError(
      `Form with ID "${formId}" was not found.`,
      'NOT_FOUND',
      404,
    )
  }
  if (form.ownerId !== ownerId) {
    throw new ServiceError(
      'Only the form owner can delete a form.',
      'FORBIDDEN',
      403,
    )
  }

  // Delete form metadata from PostgreSQL.
  // Cascade rules in the Prisma schema handle related Submission and
  // BlobReference rows (onDelete: Cascade / SetNull).
  // Walrus blobs are immutable — we do NOT attempt to delete them.
  await prisma.form.delete({ where: { id: formId } })
}
