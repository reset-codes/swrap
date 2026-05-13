/**
 * Shared client-side form validation utilities.
 *
 * Provides field-level and form-level validation functions used by both
 * TableModeForm and ConversationalModeForm.
 *
 * Requirements: R14
 */

import type { FieldConfig } from '@/types/form'
import type { FieldValue } from '@/types/submission'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  error?: string
}

// ─── Field validation ─────────────────────────────────────────────────────────

/**
 * Validate a single field value against its configuration.
 * Returns { valid: true } when the value passes all rules,
 * or { valid: false, error: string } with a human-readable message.
 */
export function validateFieldValue(
  field: FieldConfig,
  value: FieldValue['value'],
): ValidationResult {
  // Required check
  if (field.required) {
    if (value === null || value === undefined || value === '') {
      return { valid: false, error: 'This field is required.' }
    }
    if (Array.isArray(value) && value.length === 0) {
      return { valid: false, error: 'Please select at least one option.' }
    }
    if (typeof value === 'boolean' && !value) {
      return { valid: false, error: 'This field is required.' }
    }
  }

  // URL validation
  if (field.type === 'url' && value && typeof value === 'string') {
    try {
      new URL(value)
    } catch {
      return { valid: false, error: 'Please enter a valid URL (e.g. https://example.com).' }
    }
  }

  // Text length validation
  if (typeof value === 'string' && value.length > 0) {
    const { minLength, maxLength } = field.validation ?? {}
    if (minLength !== undefined && value.length < minLength) {
      return { valid: false, error: `Must be at least ${minLength} characters.` }
    }
    if (maxLength !== undefined && value.length > maxLength) {
      return { valid: false, error: `Must be at most ${maxLength} characters.` }
    }
  }

  // Star rating range validation
  if (field.type === 'star_rating' && typeof value === 'number') {
    const maxValue = field.validation?.maxValue ?? 5
    if (value < 1 || value > maxValue) {
      return { valid: false, error: `Please select a rating between 1 and ${maxValue}.` }
    }
  }

  return { valid: true }
}

/**
 * Validate all fields in a form and return a map of fieldId → error message.
 * Returns an empty object if all fields are valid.
 */
export function validateAllFields(
  fields: FieldConfig[],
  values: Record<string, FieldValue['value']>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const result = validateFieldValue(field, values[field.id] ?? null)
    if (!result.valid && result.error) {
      errors[field.id] = result.error
    }
  }
  return errors
}

/**
 * Validate a file against field constraints (size and MIME type).
 */
export function validateFile(
  file: File,
  field: FieldConfig,
): ValidationResult {
  const maxBytes = field.validation?.maxFileSizeBytes
  if (maxBytes !== undefined && file.size > maxBytes) {
    const maxMB = Math.round(maxBytes / (1024 * 1024))
    return { valid: false, error: `File size must not exceed ${maxMB}MB.` }
  }

  const allowedTypes = field.validation?.allowedMimeTypes
  if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type not allowed. Accepted types: ${allowedTypes.join(', ')}.`,
    }
  }

  return { valid: true }
}
