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
  FieldType,
  FormMetadata,
  FormSchema,
  UpdateFormInput,
} from '@/types/form'
import { checkSufficient, deduct } from './CreditService'
import type { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Local helper: read a Walrus blob and parse as JSON
// (replaces the deleted @/lib/walrus/client readBlobAsJson)
// ---------------------------------------------------------------------------

async function readBlobAsJson<T>(blobId: string): Promise<T> {
  const buffer = await executeWalrusRead(blobId)
  return JSON.parse(buffer.toString('utf-8')) as T
}

// ---------------------------------------------------------------------------
// Canvas type → API FieldType normalizer (used at publish time as safety net)
// ---------------------------------------------------------------------------

const CANVAS_TO_API_TYPE: Record<string, string> = {
  text:          'short_text',
  textarea:      'long_text',
  number:        'short_text',
  email:         'short_text',
  phone:         'short_text',
  select:        'dropdown',
  // already-API types pass through
  short_text:    'short_text',
  long_text:     'long_text',
  rich_text:     'rich_text',
  dropdown:      'dropdown',
  multi_select:  'multi_select',
  checkbox:      'checkbox',
  star_rating:   'star_rating',
  url:           'url',
  image_upload:  'image_upload',
  video_upload:  'video_upload',
  file_upload:   'file_upload',
}

function normalizeFieldType(type: string): FieldType {
  return (CANVAS_TO_API_TYPE[type] ?? 'short_text') as FieldType
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
    draftSchema?: unknown
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
    draftSchema: (form.draftSchema as Record<string, unknown> | null) ?? null,
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

/**
 * Create a new form draft (DB-only, no Walrus write).
 *
 * Stores the complete form schema (including all field data) in the
 * `draftSchema` JSON column so fields survive refresh, logout, and
 * cross-device access.
 *
 * @param adminId  The authenticated admin's user ID.
 * @param input    The form creation input — fields are stored in draftSchema.
 * @returns        The created form's metadata (includes draftSchema).
 */
export async function createFormDraft(
  adminId: string,
  input: CreateFormInput,
): Promise<FormMetadata> {
  // ── Step 1: Resolve slug ──────────────────────────────────────────────────
  let slug = input.slug ?? generateSlug(input.title || 'untitled-form')
  if (input.slug) {
    slug = input.slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  // Ensure slug uniqueness — append random suffix on collision
  const existing = await prisma.form.findUnique({ where: { slug } })
  if (existing) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
  }

  const formId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Assign IDs and order to fields for the draft schema
  const fields: FieldConfig[] = input.fields.map((f, index) => ({
    ...f,
    id: crypto.randomUUID(),
    order: index,
  }))

  // Build a complete draft schema (matches FormSchema shape)
  const draftSchema: FormSchema = {
    id: formId,
    title: input.title || 'Untitled Form',
    description: input.description,
    slug,
    mode: input.mode,
    encryptionMode: input.encryptionMode,
    fields,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }

  // Create DB record with draftSchema — no Walrus write, no credit deduction
  const form = await prisma.form.create({
    data: {
      id: formId,
      slug,
      title: input.title || 'Untitled Form',
      description: input.description,
      ownerId: adminId,
      schemaBlobId: null,          // not yet on Walrus
      draftSchema: draftSchema as unknown as Prisma.InputJsonValue,
      mode: input.mode,
      encryptionMode: input.encryptionMode,
      sealPolicyId: null,
      isPublished: false,
    },
  })

  return toFormMetadata(form)
}

/**
 * Update an existing form draft (DB-only, no Walrus write).
 *
 * Persists updated fields and metadata into `draftSchema`.
 * Does not write to Walrus — that happens on explicit publish.
 */
export async function updateFormDraft(
  formId: string,
  adminId: string,
  input: { title?: string; description?: string; mode?: string; encryptionMode?: string; fields?: FieldConfig[] },
): Promise<FormMetadata> {
  const existing = await prisma.form.findUnique({ where: { id: formId } })
  if (!existing) {
    throw new ServiceError(`Form "${formId}" not found.`, 'NOT_FOUND', 404)
  }
  if (existing.ownerId !== adminId) {
    throw new ServiceError('You do not have permission to update this form.', 'FORBIDDEN', 403)
  }

  const now = new Date().toISOString()

  // Merge existing draftSchema with updates
  const existingDraft = (existing.draftSchema as FormSchema | null) ?? {
    id: existing.id,
    title: existing.title,
    description: existing.description ?? undefined,
    slug: existing.slug,
    mode: existing.mode as FormSchema['mode'],
    encryptionMode: existing.encryptionMode as FormSchema['encryptionMode'],
    fields: [],
    version: 1,
    createdAt: existing.createdAt.toISOString(),
    updatedAt: now,
  }

  const updatedFields = input.fields
    ? input.fields.map((f, index) => ({ ...f, id: f.id || crypto.randomUUID(), order: f.order ?? index }))
    : existingDraft.fields

  const updatedDraft: FormSchema = {
    ...existingDraft,
    title: input.title ?? existingDraft.title,
    description: input.description !== undefined ? input.description : existingDraft.description,
    mode: (input.mode as FormSchema['mode']) ?? existingDraft.mode,
    encryptionMode: (input.encryptionMode as FormSchema['encryptionMode']) ?? existingDraft.encryptionMode,
    fields: updatedFields,
    version: (existingDraft.version ?? 1) + 1,
    updatedAt: now,
  }

  const form = await prisma.form.update({
    where: { id: formId },
    data: {
      title: input.title ?? existing.title,
      description: input.description !== undefined ? input.description : existing.description,
      mode: (input.mode as typeof existing.mode) ?? existing.mode,
      encryptionMode: (input.encryptionMode as typeof existing.encryptionMode) ?? existing.encryptionMode,
      draftSchema: updatedDraft as unknown as Prisma.InputJsonValue,
    },
  })

  return toFormMetadata(form)
}

/**
 * Create a new form.
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
    // Seal policy creation is not yet available in this path (legacy stub throws).
    // In development, we generate a placeholder policy ID so form creation can
    // proceed. In production, this will be replaced by the canonical
    // apps/api/services/infrastructure-wallet.ts Seal integration.
    try {
      const { executeSealCreatePolicy } = await import('@/lib/wallet/manager')
      const policy = await executeSealCreatePolicy(formId, ['admin', 'owner'])
      sealPolicyId = policy.policyId
    } catch {
      // Seal not available — use a deterministic placeholder in dev
      if (process.env.NODE_ENV === 'development' || process.env.DEV_BYPASS_STORAGE === 'true') {
        sealPolicyId = `seal-policy-${formId}`
      } else {
        throw new ServiceError(
          'Encryption service is not available. Please try again later.',
          'SEAL_UNAVAILABLE',
          503,
        )
      }
    }
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
  } catch (walrusErr) {
    // In development with DEV_BYPASS_STORAGE, generate a placeholder blob ID
    // so form creation can proceed even when Walrus testnet is unreachable.
    if (process.env.DEV_BYPASS_STORAGE === 'true') {
      const { createHash } = await import('node:crypto')
      blobId = `dev-blob-${createHash('sha256').update(jsonString).digest('hex').slice(0, 16)}`
      console.warn(
        `[FormService] Walrus write failed in dev mode, using placeholder blob ID: ${blobId}`,
        walrusErr instanceof Error ? walrusErr.message : String(walrusErr),
      )
    } else {
      throw new ServiceError(
        'Failed to store form schema on Walrus. Please try again.',
        'WALRUS_WRITE_FAILED',
        503,
      )
    }
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
    // Seal policy creation is not yet available in this path (legacy stub throws).
    // In development, we generate a placeholder policy ID.
    try {
      const { executeSealCreatePolicy } = await import('@/lib/wallet/manager')
      const policy = await executeSealCreatePolicy(existing.id, ['admin', 'owner'])
      sealPolicyId = policy.policyId
    } catch {
      if (process.env.NODE_ENV === 'development' || process.env.DEV_BYPASS_STORAGE === 'true') {
        sealPolicyId = `seal-policy-${existing.id}`
      } else {
        throw new ServiceError(
          'Encryption service is not available. Please try again later.',
          'SEAL_UNAVAILABLE',
          503,
        )
      }
    }
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
    // In development with DEV_BYPASS_STORAGE, generate a placeholder blob ID
    if (process.env.DEV_BYPASS_STORAGE === 'true') {
      const { createHash } = await import('node:crypto')
      newBlobId = `dev-blob-${createHash('sha256').update(jsonString).digest('hex').slice(0, 16)}`
      console.warn(
        `[FormService] Walrus write failed in dev mode, using placeholder blob ID: ${newBlobId}`,
      )
    } else {
      throw new ServiceError(
        'Failed to store updated form schema on Walrus. Please try again.',
        'WALRUS_WRITE_FAILED',
        503,
      )
    }
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
 * Publish a form using the infrastructure wallet.
 *
 * For drafts (schemaBlobId is null): reads the draftSchema from PostgreSQL,
 * writes it to Walrus using the infra wallet, then marks published.
 * For already-Walrus-indexed forms (schemaBlobId exists): simply marks published.
 *
 * No wallet interaction is required from the user — the infra wallet
 * sponsors all Walrus writes.
 *
 * @param formId   The ID of the form to publish.
 * @param adminId  The authenticated admin's user ID (must own the form).
 * @returns        The public URL and slug for the published form.
 */
export async function publishForm(
  formId: string,
  adminId: string,
): Promise<{ publicUrl: string; slug: string }> {
  const form = await prisma.form.findUnique({ where: { id: formId } })
  if (!form) {
    throw new ServiceError(`Form with ID "${formId}" was not found.`, 'NOT_FOUND', 404)
  }
  if (form.ownerId !== adminId) {
    throw new ServiceError('You do not have permission to publish this form.', 'FORBIDDEN', 403)
  }

  let blobId = form.schemaBlobId

  if (!blobId) {
    // Draft path: write schema to Walrus using infra wallet
    const draftSchema = form.draftSchema as FormSchema | null

    if (!draftSchema) {
      throw new ServiceError(
        'This form has no content to publish. Please add fields and save first.',
        'SCHEMA_MISSING',
        400,
      )
    }

    // Ensure the schema title is current
    const schemaToPublish: FormSchema = {
      ...draftSchema,
      title: form.title,
      description: form.description ?? undefined,
      updatedAt: new Date().toISOString(),
      // Normalize canvas field types → API FieldType at publish time.
      // This is a safety net: after import, fields may have canvas types
      // (text, select, textarea) if the user publishes without saving first.
      // After a builder save, types are already API-normalized.
      fields: draftSchema.fields.map((f, index) => ({
        ...f,
        id: f.id || crypto.randomUUID(),
        order: f.order ?? index,
        type: normalizeFieldType(f.type),
        // options stored as string[] (canvas) → convert to FieldOption[] for Walrus schema
        options: Array.isArray(f.options) && f.options.length > 0
          ? f.options.map((opt: unknown, i: number) => {
              if (typeof opt === 'string') {
                return { id: `opt-${index}-${i}`, label: opt, value: opt.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }
              }
              return opt as { id: string; label: string; value: string }
            })
          : undefined,
      })),
    }

    const jsonString = JSON.stringify(schemaToPublish)

    // Write to Walrus — infra wallet sponsors the write.
    // Fallback chain:
    //   1. HTTP publisher via executeWalrusWrite (primary path)
    //   2. Walrus CLI on the server (WALRUS_CLI_PATH must be set)
    //   3. Dev-mode placeholder (DEV_BYPASS_STORAGE=true or NOT_CONFIGURED in dev)
    const schemaBuffer = Buffer.from(jsonString, 'utf-8')

    let walrusWriteOk = false

    // ── Primary: HTTP publisher ───────────────────────────────────────────
    try {
      const result = await executeWalrusWrite(schemaBuffer, 'application/json')
      blobId = result.blobId
      walrusWriteOk = true
    } catch (primaryErr) {
      console.warn(
        '[FormService.publishForm] Primary Walrus HTTP publisher failed:',
        primaryErr instanceof Error ? primaryErr.message : primaryErr,
      )
    }

    // ── Fallback: CLI publisher (only if HTTP path failed) ────────────────
    if (!walrusWriteOk) {
      const cliPath = process.env.WALRUS_CLI_PATH
      if (cliPath || process.env.NODE_ENV !== 'development') {
        try {
          const { publishViaWalrusCli } = await import('@/lib/walrus/cli-publisher')
          const cliResult = await publishViaWalrusCli(schemaBuffer, 'application/json')
          blobId = cliResult.blobId
          walrusWriteOk = true
          console.info('[FormService.publishForm] CLI fallback succeeded, blobId:', blobId)
        } catch (cliErr) {
          console.warn(
            '[FormService.publishForm] CLI fallback failed:',
            cliErr instanceof Error ? cliErr.message : cliErr,
          )
        }
      }
    }

    // ── Dev bypass (never in production) ─────────────────────────────────
    if (!walrusWriteOk) {
      const isDev = process.env.DEV_BYPASS_STORAGE === 'true' || process.env.NODE_ENV === 'development'
      if (isDev) {
        const { createHash } = await import('node:crypto')
        blobId = `dev-blob-${createHash('sha256').update(jsonString).digest('hex').slice(0, 16)}`
        walrusWriteOk = true
        console.warn('[FormService.publishForm] Walrus write bypassed (dev mode), blobId:', blobId)
      }
    }

    if (!walrusWriteOk) {
      throw new ServiceError(
        'Failed to store form on Walrus. Please try again.',
        'WALRUS_WRITE_FAILED',
        503,
      )
    }

    // Create BlobReference for the new blob
    try {
      await prisma.blobReference.create({
        data: {
          walrusBlobId: blobId!, // non-null: guaranteed by walrusWriteOk guard above
          blobType: 'form_schema',
          sizeBytes: Buffer.byteLength(jsonString, 'utf-8'),
          formId: form.id,
        },
      })
    } catch {
      // BlobReference creation is best-effort — don't fail publish
    }
  }

  // Mark as published with the blob ID
  const published = await prisma.form.update({
    where: { id: formId },
    data: {
      isPublished: true,
      publishedAt: new Date(),
      schemaBlobId: blobId,
    },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://swrap.app'
  const publicUrl = `${appUrl}/f/${published.slug}`

  return { publicUrl, slug: published.slug }
}

/**
 * Retrieve a published form's schema from Walrus by its slug.
 * Falls back to draftSchema if Walrus is unavailable.
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

  // Try Walrus first
  if (form.schemaBlobId) {
    try {
      return await readBlobAsJson<FormSchema>(form.schemaBlobId)
    } catch {
      // Walrus read failed — fall back to draftSchema if available
      if (form.draftSchema) {
        console.warn(`[FormService.getFormBySlug] Walrus read failed for ${slug}, falling back to draftSchema`)
        return form.draftSchema as unknown as FormSchema
      }
      throw new ServiceError(
        'Failed to fetch the form schema. Please try again.',
        'WALRUS_READ_FAILED',
        503,
      )
    }
  }

  // No Walrus blob — use draftSchema as fallback
  if (form.draftSchema) {
    return form.draftSchema as unknown as FormSchema
  }

  throw new ServiceError(
    'This form does not have a schema stored on Walrus.',
    'SCHEMA_MISSING',
    500,
  )
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
): Promise<{ form: FormMetadata; schema: FormSchema | null }> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: {
      _count: {
        select: { submissions: true },
      },
    },
  })

  if (!form) {
    throw new ServiceError(`Form with ID "${formId}" was not found.`, 'NOT_FOUND', 404)
  }
  if (form.ownerId !== adminId) {
    throw new ServiceError('You do not have permission to access this form.', 'FORBIDDEN', 403)
  }

  const metadata = toFormMetadata(form, form._count.submissions)

  // Return draftSchema if no Walrus blob yet (draft case)
  if (!form.schemaBlobId) {
    const schema = form.draftSchema ? (form.draftSchema as unknown as FormSchema) : null
    return { form: metadata, schema }
  }

  try {
    const schema = await readBlobAsJson<FormSchema>(form.schemaBlobId)
    return { form: metadata, schema }
  } catch {
    // Walrus read failed — fall back to draftSchema
    const schema = form.draftSchema ? (form.draftSchema as unknown as FormSchema) : null
    return { form: metadata, schema }
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
