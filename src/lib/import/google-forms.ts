/**
 * Google Forms import parser.
 *
 * Parses a Google Forms JSON export (Google Forms API shape) and maps
 * question types to Swrap field types on a best-effort basis.
 * Unsupported types are skipped and reported back to the caller.
 *
 * Requirements: R17
 */

import type { FieldConfig, FieldOption, FieldType } from '@/types/form'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GoogleFormsImportResult {
  /** Mapped fields ready to be inserted into a Swrap form (without id/order). */
  fields: Omit<FieldConfig, 'id' | 'order'>[]
  /** Fields that were skipped because their type is not supported. */
  skippedFields: { title: string; type: string; reason: string }[]
  /** The form title from `info.title` in the Google Forms export. */
  title: string
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a Google Forms JSON export and produce a `GoogleFormsImportResult`.
 *
 * Supported mappings:
 *   - textQuestion (paragraph: false) → short_text
 *   - textQuestion (paragraph: true)  → long_text
 *   - scaleQuestion                   → star_rating (uses `high` as maxValue)
 *   - choiceQuestion RADIO/DROP_DOWN  → dropdown
 *   - choiceQuestion CHECKBOX         → multi_select
 *   - fileUploadQuestion              → file_upload
 *   - dateQuestion/timeQuestion/ratingQuestion → short_text
 *   - Everything else (pageBreakItem, sectionHeaderItem, imageItem, videoItem) → skipped
 *
 * @param json  Raw parsed JSON from a Google Forms export.
 * @returns     Mapped fields, skipped fields, and the form title.
 * @throws      `Error` if the input is not a valid Google Forms export object.
 */
export function parseGoogleFormsExport(json: unknown): GoogleFormsImportResult {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Invalid Google Forms export: expected a JSON object.')
  }

  const data = json as Record<string, unknown>
  const info = data.info as Record<string, unknown> | undefined
  const title = typeof info?.title === 'string' ? info.title.trim() : ''

  if (!title) {
    throw new Error('Invalid Google Forms export: missing or empty info.title.')
  }

  if (!Array.isArray(data.items)) {
    throw new Error('Invalid Google Forms export: items must be an array.')
  }

  const fields: Omit<FieldConfig, 'id' | 'order'>[] = []
  const skippedFields: GoogleFormsImportResult['skippedFields'] = []

  for (const rawItem of data.items as unknown[]) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      continue
    }

    const item = rawItem as Record<string, unknown>
    const itemTitle = typeof item.title === 'string' ? item.title : '(untitled)'

    // Only questionItem is a form field — page breaks, section headers,
    // images, and videos are intentionally skipped.
    if (!item.questionItem) {
      skippedFields.push({
        title: itemTitle,
        type: 'non-question',
        reason: 'Only question items are supported.',
      })
      continue
    }

    const questionItem = item.questionItem as Record<string, unknown>
    const question = questionItem.question as Record<string, unknown> | undefined
    if (!question) {
      skippedFields.push({
        title: itemTitle,
        type: '(unknown)',
        reason: 'Question item has no question payload.',
      })
      continue
    }

    const required = question.required === true
    const base = { label: itemTitle, required, encrypted: false }

    // ── textQuestion → short_text / long_text ──────────────────────────────
    if (question.textQuestion) {
      const tq = question.textQuestion as { paragraph?: boolean }
      const type: FieldType = tq.paragraph === true ? 'long_text' : 'short_text'
      fields.push({ ...base, type })
      continue
    }

    // ── scaleQuestion → star_rating ────────────────────────────────────────
    if (question.scaleQuestion) {
      const sq = question.scaleQuestion as { high?: number }
      const maxValue =
        typeof sq.high === 'number' && sq.high >= 1 && sq.high <= 10
          ? sq.high
          : 5
      fields.push({
        ...base,
        type: 'star_rating',
        validation: { maxValue },
      })
      continue
    }

    // ── choiceQuestion → dropdown / multi_select ──────────────────────────
    if (question.choiceQuestion) {
      const cq = question.choiceQuestion as {
        type?: string
        options?: { value?: string }[]
      }

      let type: FieldType
      if (cq.type === 'CHECKBOX') {
        type = 'multi_select'
      } else if (cq.type === 'RADIO' || cq.type === 'DROP_DOWN') {
        type = 'dropdown'
      } else {
        skippedFields.push({
          title: itemTitle,
          type: `choiceQuestion/${cq.type ?? 'unknown'}`,
          reason: 'Unknown choice question type.',
        })
        continue
      }

      const options: FieldOption[] = (cq.options ?? [])
        .filter(
          (opt): opt is { value: string } =>
            typeof opt?.value === 'string' && opt.value.length > 0,
        )
        .map((opt) => ({
          id: crypto.randomUUID(),
          label: opt.value,
          value: opt.value.toLowerCase().replace(/\s+/g, '_'),
        }))

      fields.push({ ...base, type, ...(options.length > 0 ? { options } : {}) })
      continue
    }

    // ── fileUploadQuestion → file_upload ──────────────────────────────────
    if (question.fileUploadQuestion) {
      fields.push({ ...base, type: 'file_upload' })
      continue
    }

    // ── dateQuestion / timeQuestion / ratingQuestion → short_text ─────────
    if (
      question.dateQuestion ||
      question.timeQuestion ||
      question.ratingQuestion
    ) {
      fields.push({ ...base, type: 'short_text' })
      continue
    }

    // ── Unknown question type ──────────────────────────────────────────────
    skippedFields.push({
      title: itemTitle,
      type: 'unknown-question',
      reason: 'Unsupported Google Forms question type.',
    })
  }

  return { fields, skippedFields, title }
}
