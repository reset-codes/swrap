/**
 * Zod schemas for FormSchema and related types.
 * Used for validation during serialization/deserialization.
 *
 * See: Requirements R5
 */

import { z } from 'zod'

// ─── Enum Schemas ─────────────────────────────────────────────────────────────

export const FieldTypeSchema = z.enum([
  'short_text',
  'long_text',
  'rich_text',
  'dropdown',
  'multi_select',
  'checkbox',
  'star_rating',
  'url',
  'image_upload',
  'video_upload',
  'file_upload',
])

export const FormModeSchema = z.enum(['conversational', 'table'])

export const EncryptionModeSchema = z.enum(['none', 'field_level', 'full_submission'])

// ─── Field Sub-schemas ────────────────────────────────────────────────────────

export const FieldValidationSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    maxFileSizeBytes: z.number().int().positive().optional(),
    allowedMimeTypes: z.array(z.string()).optional(),
    pattern: z.string().optional(),
  })
  .optional()

export const FieldOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
})

export const FieldConfigSchema = z.object({
  id: z.string().min(1),
  type: FieldTypeSchema,
  label: z.string().min(1, 'Field label is required'),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  required: z.boolean(),
  encrypted: z.boolean(),
  validation: FieldValidationSchema,
  options: z.array(FieldOptionSchema).optional(),
  order: z.number().int().nonnegative(),
})

// ─── Form Schema ──────────────────────────────────────────────────────────────

export const FormSchemaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1, 'Form title is required'),
  description: z.string().optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  mode: FormModeSchema,
  encryptionMode: EncryptionModeSchema,
  sealPolicyId: z.string().optional(),
  fields: z.array(FieldConfigSchema),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

// ─── Inferred Types ───────────────────────────────────────────────────────────

/** Zod-inferred input type — should align with FormSchema in @/types/form */
export type FormSchemaInput = z.input<typeof FormSchemaSchema>

/** Zod-inferred output type — should align with FormSchema in @/types/form */
export type FormSchemaOutput = z.output<typeof FormSchemaSchema>
