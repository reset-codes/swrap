/**
 * Typeform import parser.
 *
 * Parses a Typeform JSON export and maps field types to Swrap field types
 * on a best-effort basis. Unsupported field types are skipped and reported
 * back to the caller.
 *
 * Requirements: R17
 */

import type { FieldConfig, FieldOption, FieldType } from '@/types/form'

// ─── Typeform type map ────────────────────────────────────────────────────────

/**
 * Maps Typeform field types to Swrap field types.
 * A value of `null` means the type is not supported and the field will be skipped.
 */
const TYPEFORM_TYPE_MAP: Record<string, FieldType | null> = {
  short_text: 'short_text',
  long_text: 'long_text',
  email: 'short_text',
  url: 'url',
  number: 'short_text',
  rating: 'star_rating',
  opinion_scale: 'star_rating',
  yes_no: 'checkbox',
  multiple_choice: 'dropdown', // single choice → dropdown
  picture_choice: 'dropdown',
  dropdown: 'dropdown',
  file_upload: 'file_upload',
  date: 'short_text',
  phone_number: 'short_text',
  website: 'url',
  // Unsupported:
  payment: null,
  legal: null,
  group: null,
  statement: null,
}

// ─── Typeform JSON shapes ─────────────────────────────────────────────────────

interface TypeformChoice {
  label: string
}

interface TypeformFieldProperties {
  choices?: TypeformChoice[]
  steps?: number
  description?: string
  allow_multiple_selection?: boolean
}

interface TypeformFieldValidations {
  required?: boolean
}

interface TypeformField {
  id: string
  title: string
  type: string
  properties?: TypeformFieldProperties
  validations?: TypeformFieldValidations
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TypeformImportResult {
  /** Mapped fields ready to be inserted into a Swrap form (without id/order). */
  fields: Omit<FieldConfig, 'id' | 'order'>[]
  /** Fields that were skipped because their type is not supported. */
  skippedFields: { title: string; type: string; reason: string }[]
  /** The form title from the Typeform export. */
  title: string
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a Typeform JSON export and produce a `TypeformImportResult`.
 *
 * @param json  The raw parsed JSON from a Typeform export file.
 * @returns     Mapped fields, skipped fields, and the form title.
 * @throws      `Error` if the input is not a valid Typeform export object.
 */
export function parseTypeformExport(json: unknown): TypeformImportResult {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Invalid Typeform export: expected a JSON object.')
  }

  const data = json as Record<string, unknown>

  if (typeof data.title !== 'string' || !data.title.trim()) {
    throw new Error('Invalid Typeform export: missing or empty "title" field.')
  }

  if (!Array.isArray(data.fields)) {
    throw new Error('Invalid Typeform export: "fields" must be an array.')
  }

  const title = data.title.trim()
  const fields: Omit<FieldConfig, 'id' | 'order'>[] = []
  const skippedFields: TypeformImportResult['skippedFields'] = []

  for (const rawField of data.fields as unknown[]) {
    if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) {
      continue
    }

    const tf = rawField as TypeformField

    if (!tf.type || typeof tf.type !== 'string') {
      skippedFields.push({
        title: tf.title ?? '(untitled)',
        type: '(unknown)',
        reason: 'Field has no type.',
      })
      continue
    }

    // Look up the mapped type; undefined means the key isn't in the map at all
    const mappedType: FieldType | null | undefined = TYPEFORM_TYPE_MAP[tf.type]

    if (mappedType === undefined) {
      // Unknown type — not in our map
      skippedFields.push({
        title: tf.title ?? '(untitled)',
        type: tf.type,
        reason: `Unknown Typeform field type "${tf.type}".`,
      })
      continue
    }

    if (mappedType === null) {
      // Explicitly unsupported type
      skippedFields.push({
        title: tf.title ?? '(untitled)',
        type: tf.type,
        reason: `Typeform field type "${tf.type}" is not supported in Swrap.`,
      })
      continue
    }

    // Build options for choice-based fields
    const options: FieldOption[] = []

    if (tf.type === 'yes_no') {
      // yes_no maps to checkbox — no dropdown options needed
    } else if (tf.properties?.choices && tf.properties.choices.length > 0) {
      for (const choice of tf.properties.choices) {
        if (choice.label) {
          options.push({
            id: crypto.randomUUID(),
            label: choice.label,
            value: choice.label.toLowerCase().replace(/\s+/g, '_'),
          })
        }
      }
    }

    const field: Omit<FieldConfig, 'id' | 'order'> = {
      type: mappedType,
      label: tf.title ?? '(untitled)',
      required: tf.validations?.required ?? false,
      encrypted: false,
      ...(tf.properties?.description
        ? { helpText: tf.properties.description }
        : {}),
      ...(options.length > 0 ? { options } : {}),
    }

    fields.push(field)
  }

  return { fields, skippedFields, title }
}
