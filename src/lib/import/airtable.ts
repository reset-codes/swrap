/**
 * Airtable import parser.
 *
 * Parses an Airtable base schema export and maps field types to Swrap
 * field types on a best-effort basis. Unsupported field types are skipped
 * and reported back to the caller.
 *
 * Airtable base schema export structure (from Airtable API):
 * {
 *   "tables": [
 *     {
 *       "name": "My Table",
 *       "fields": [
 *         { "id": "fldXxx", "name": "Name", "type": "singleLineText" },
 *         { "id": "fldYyy", "name": "Notes", "type": "multilineText" },
 *         { "id": "fldZzz", "name": "Status", "type": "singleSelect",
 *           "options": { "choices": [{ "name": "Active" }, { "name": "Inactive" }] } }
 *       ]
 *     }
 *   ]
 * }
 *
 * Requirements: R17
 */

import type { FieldConfig, FieldOption, FieldType } from '@/types/form'
import crypto from 'node:crypto'

// ─── Airtable field type map ──────────────────────────────────────────────────

/**
 * Maps Airtable field types to Swrap field types.
 * A value of `null` means the type is not supported and the field will be skipped.
 */
const AIRTABLE_TYPE_MAP: Record<string, FieldType | null> = {
  // Text
  singleLineText: 'short_text',
  multilineText: 'long_text',
  richText: 'rich_text',
  email: 'short_text',
  url: 'url',
  phoneNumber: 'short_text',
  // Numbers
  number: 'short_text',
  currency: 'short_text',
  percent: 'short_text',
  rating: 'star_rating',
  // Select
  singleSelect: 'dropdown',
  multipleSelects: 'multi_select',
  // Checkbox
  checkbox: 'checkbox',
  // Date / time
  date: 'short_text',
  dateTime: 'short_text',
  // Attachments
  multipleAttachments: 'file_upload',
  // Unsupported
  autoNumber: null,
  barcode: null,
  button: null,
  count: null,
  createdBy: null,
  createdTime: null,
  currency_formula: null,
  externalSyncSource: null,
  formula: null,
  lastModifiedBy: null,
  lastModifiedTime: null,
  lookup: null,
  multipleLookupValues: null,
  multipleRecordLinks: null,
  rollup: null,
  singleCollaborator: null,
  multipleCollaborators: null,
}

// ─── Airtable JSON shapes ─────────────────────────────────────────────────────

interface AirtableChoice {
  name: string
  color?: string
}

interface AirtableFieldOptions {
  choices?: AirtableChoice[]
  max?: number  // for rating fields
}

interface AirtableField {
  id?: string
  name: string
  type: string
  options?: AirtableFieldOptions
  description?: string
}

interface AirtableTable {
  id?: string
  name: string
  fields: AirtableField[]
  description?: string
}

interface AirtableBaseSchema {
  tables?: AirtableTable[]
  // Some exports wrap in a "base" key
  base?: {
    tables?: AirtableTable[]
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AirtableImportResult {
  /** Mapped fields ready to be inserted into a Swrap form (without id/order). */
  fields: Omit<FieldConfig, 'id' | 'order'>[]
  /** Fields that were skipped because their type is not supported. */
  skippedFields: { title: string; type: string; reason: string }[]
  /** The table name used as the form title. */
  title: string
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse an Airtable base schema export and produce an `AirtableImportResult`.
 *
 * Uses the first table in the export. If the export contains multiple tables,
 * only the first is imported (the admin can run multiple imports for each table).
 *
 * @param json  The raw parsed JSON from an Airtable base schema export.
 * @returns     Mapped fields, skipped fields, and the table name as title.
 * @throws      `Error` if the input is not a valid Airtable schema object.
 */
export function parseAirtableExport(json: unknown): AirtableImportResult {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Invalid Airtable export: expected a JSON object.')
  }

  const data = json as AirtableBaseSchema

  // Support both { tables: [...] } and { base: { tables: [...] } } shapes
  const tables = data.tables ?? data.base?.tables

  if (!Array.isArray(tables) || tables.length === 0) {
    throw new Error(
      'Invalid Airtable export: "tables" must be a non-empty array. ' +
      'Export your base schema from the Airtable API or Airtable Web Clipper.',
    )
  }

  // Use the first table
  const table = tables[0]

  if (!table || typeof table.name !== 'string' || !table.name.trim()) {
    throw new Error('Invalid Airtable export: first table is missing a name.')
  }

  if (!Array.isArray(table.fields)) {
    throw new Error('Invalid Airtable export: table "fields" must be an array.')
  }

  const title = table.name.trim()
  const fields: Omit<FieldConfig, 'id' | 'order'>[] = []
  const skippedFields: AirtableImportResult['skippedFields'] = []

  for (const rawField of table.fields) {
    if (!rawField || typeof rawField !== 'object') continue

    const airtableField = rawField as AirtableField

    if (!airtableField.type || typeof airtableField.type !== 'string') {
      skippedFields.push({
        title: airtableField.name ?? '(untitled)',
        type: '(unknown)',
        reason: 'Field has no type.',
      })
      continue
    }

    const mappedType: FieldType | null | undefined = AIRTABLE_TYPE_MAP[airtableField.type]

    if (mappedType === undefined) {
      skippedFields.push({
        title: airtableField.name ?? '(untitled)',
        type: airtableField.type,
        reason: `Unknown Airtable field type "${airtableField.type}".`,
      })
      continue
    }

    if (mappedType === null) {
      skippedFields.push({
        title: airtableField.name ?? '(untitled)',
        type: airtableField.type,
        reason: `Airtable field type "${airtableField.type}" is not supported in Swrap (computed/linked fields cannot be imported).`,
      })
      continue
    }

    // Build options for select fields
    const options: FieldOption[] = []
    if (airtableField.options?.choices) {
      for (const choice of airtableField.options.choices) {
        if (choice.name) {
          options.push({
            id: crypto.randomUUID(),
            label: choice.name,
            value: choice.name.toLowerCase().replace(/\s+/g, '_'),
          })
        }
      }
    }

    // Build validation for rating fields
    const validation: FieldConfig['validation'] = {}
    if (airtableField.type === 'rating' && airtableField.options?.max) {
      validation.maxValue = airtableField.options.max
      validation.minValue = 1
    }

    const field: Omit<FieldConfig, 'id' | 'order'> = {
      type: mappedType,
      label: airtableField.name ?? '(untitled)',
      required: false, // Airtable schema doesn't expose required in base schema export
      encrypted: false,
      ...(airtableField.description ? { helpText: airtableField.description } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(Object.keys(validation).length > 0 ? { validation } : {}),
    }

    fields.push(field)
  }

  return { fields, skippedFields, title }
}
