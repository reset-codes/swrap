/**
 * Form schema serialization and deserialization.
 * Provides round-trip JSON serialization with Zod validation.
 *
 * See: Requirements R5
 */

import type { FormSchema } from '@/types/form'
import { FormSchemaSchema } from './schemas'

// ─── Error Type ───────────────────────────────────────────────────────────────

export class SerializationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SerializationError'
  }
}

// ─── Serializer ───────────────────────────────────────────────────────────────

/**
 * Serialize a FormSchema to a canonical JSON string.
 *
 * Validates the schema with Zod before serializing to ensure only valid,
 * well-formed schemas are written to storage.
 *
 * @throws {SerializationError} if the schema fails Zod validation
 */
export function serializeFormSchema(schema: FormSchema): string {
  const result = FormSchemaSchema.safeParse(schema)
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join(', ')
    throw new SerializationError(`Invalid form schema: ${messages}`, result.error)
  }
  return JSON.stringify(result.data)
}

/**
 * Parse a JSON string into a validated FormSchema.
 *
 * Returns a fully validated FormSchema object. Provides descriptive errors
 * for malformed JSON, unrecognized field types, and missing required properties.
 *
 * @throws {SerializationError} if the JSON is malformed or fails Zod validation
 */
export function parseFormSchema(json: string): FormSchema {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new SerializationError(
      'Form schema JSON is malformed and cannot be parsed.',
      err,
    )
  }

  const result = FormSchemaSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues

    // Surface unrecognized field type errors with a dedicated message
    const fieldTypeIssues = issues.filter((i) => i.path.includes('type'))
    if (fieldTypeIssues.length > 0) {
      const details = fieldTypeIssues.map((i) => i.message).join(', ')
      throw new SerializationError(
        `Form schema contains unrecognized field type(s): ${details}`,
        result.error,
      )
    }

    // General validation failure
    const details = issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new SerializationError(
      `Form schema validation failed: ${details}`,
      result.error,
    )
  }

  return result.data as FormSchema
}
