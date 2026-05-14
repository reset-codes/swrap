/**
 * Zod schemas, types, and FIELD_TYPES for the Walrus Testnet POC.
 *
 * R19.9 field-type palette: exactly six types.
 * Requirements: R9.3, R9.6, R9.7, R10.1, R10.2, R12.2, R19.9
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Field types — R19.9 palette (6 types; `long_text` → `textarea`, `url` dropped)
// ---------------------------------------------------------------------------

export const FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'number',
  'select',
  'checkbox',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

export interface PocField {
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[]; // for 'select' type
}

export interface FormSchema {
  title: string;
  fields: PocField[];
  version: 1;
  created_at: string; // ISO 8601 UTC
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
  type: z.enum(FIELD_TYPES),
  label: z.string().min(1).max(100), // R10.2
  required: z.boolean().optional(),
  options: z.array(z.string().min(1)).optional(), // only for 'select'
});

export const FormSchemaSchema: z.ZodType<FormSchema> = z.object({
  title: z.string().min(1).max(200), // R10.1
  fields: z.array(PocFieldSchema).max(50), // R10.1
  version: z.literal(1), // migration fence
  created_at: z.string().datetime(), // ISO 8601
});

export const SubmissionSchema: z.ZodType<Submission> = z.object({
  form_blob_id: z.string().min(1),
  form_schema_hash: z.string().regex(/^[0-9a-f]{64}$/), // 64-char hex
  answers: z.record(z.string(), z.unknown()),
  submitted_at: z.string().datetime(), // ISO 8601
});
