/**
 * Public API for the forms library.
 * Re-exports serialization utilities, Zod schemas, and validation helpers.
 */

export { serializeFormSchema, parseFormSchema, SerializationError } from './serializer'
export {
  FieldTypeSchema,
  FormModeSchema,
  EncryptionModeSchema,
  FieldValidationSchema,
  FieldOptionSchema,
  FieldConfigSchema,
  FormSchemaSchema,
} from './schemas'
export type { FormSchemaInput, FormSchemaOutput } from './schemas'
export { validateFieldValue, validateAllFields, validateFile } from './validator'
export type { ValidationResult } from './validator'
