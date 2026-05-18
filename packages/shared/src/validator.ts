/**
 * Zod schemas, types, and FIELD_TYPES for the Walrus Testnet POC.
 *
 * Extended for Canvas_Builder (task 16):
 *   - Nine field types: existing six + url, star_rating, wallet_address
 *   - PocField: id, helpText, maxStars, encrypted, width, validation
 *   - FormSchema: theme, bannerUrl
 *   - All changes are additive — existing six field types continue to parse
 *
 * Requirements: R9.1, R9.2, R9.3, R9.4, R9.5, R9.6,
 *               R10.1, R10.2, R12.2, R19.9
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Field types — extended to nine types (was six)
// ---------------------------------------------------------------------------

export const FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'number',
  'select',
  'checkbox',
  'url',
  'star_rating',
  'wallet_address',
  'phone',
  'file_upload',
  'image_upload',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

// ---------------------------------------------------------------------------
// Theme type
// ---------------------------------------------------------------------------

export type FormTheme =
  | 'minimal'
  | 'hacker'
  | 'soft_gradient'
  | 'corporate'
  | 'dark';

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

export interface PocField {
  id: string;              // stable UUID, generated on field creation
  type: FieldType;
  label: string;           // 1–100 chars
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];      // 'select' only
  maxStars?: number;       // 'star_rating' only; valid range 3–10, default 5
  encrypted?: boolean;     // Privacy: Seal encryption flag
  width?: 'full' | 'half' | 'third'; // Style: rendered width on public form
  validation?: {
    minLength?: number;    // 'text' | 'textarea'
    maxLength?: number;
    minValue?: number;     // 'number'
    maxValue?: number;
  };
}

export interface FormSchema {
  title: string;
  fields: PocField[];
  version: 1;
  created_at: string; // ISO 8601 UTC
  theme?: FormTheme;
  bannerUrl?: string;
}

export interface Submission {
  form_blob_id: string;
  form_schema_hash: string; // 64-char hex
  answers: Record<string, unknown>;
  submitted_at: string; // ISO 8601 UTC
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const PocFieldSchema: z.ZodType<PocField> = z.object({
  id: z.string().uuid(),
  type: z.enum(FIELD_TYPES),
  label: z.string().min(1).max(100),
  required: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  helpText: z.string().max(500).optional(),
  options: z.array(z.string().min(1)).optional(), // only for 'select'
  maxStars: z.number().int().min(3).max(10).optional(), // only for 'star_rating'
  encrypted: z.boolean().optional(),
  width: z.enum(['full', 'half', 'third']).optional(),
  validation: z
    .object({
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).optional(),
      minValue: z.number().optional(),
      maxValue: z.number().optional(),
    })
    .optional(),
});

export const FormSchemaSchema: z.ZodType<FormSchema> = z.object({
  title: z.string().min(1).max(200), // R10.1
  fields: z.array(PocFieldSchema).max(50), // R10.1
  version: z.literal(1), // migration fence
  created_at: z.string().datetime(), // ISO 8601
  theme: z
    .enum(['minimal', 'hacker', 'soft_gradient', 'corporate', 'dark'])
    .optional(),
  bannerUrl: z.string().url().startsWith('https://').optional(),
});

export const SubmissionSchema: z.ZodType<Submission> = z.object({
  form_blob_id: z.string().min(1),
  form_schema_hash: z.string().regex(/^[0-9a-f]{64}$/), // 64-char hex
  answers: z.record(z.string(), z.unknown()),
  submitted_at: z.string().datetime(), // ISO 8601
});
