/**
 * Shared TypeScript types for forms and fields.
 * These types are the foundation for the form builder, submission system, and API layer.
 * They align with the Prisma schema enums (FormMode, EncryptionMode).
 *
 * See: Requirements R3, R5
 */

// ─── Field Types ──────────────────────────────────────────────────────────────

/** All 11 supported field types */
export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'rich_text'
  | 'dropdown'
  | 'multi_select'
  | 'checkbox'
  | 'star_rating'
  | 'url'
  | 'image_upload'
  | 'video_upload'
  | 'file_upload';

// ─── Form Enums ───────────────────────────────────────────────────────────────

/** Form presentation mode — aligns with Prisma FormMode enum */
export type FormMode = 'conversational' | 'table';

/** Encryption mode for a form — aligns with Prisma EncryptionMode enum */
export type EncryptionMode = 'none' | 'field_level' | 'full_submission';

// ─── Field Configuration ──────────────────────────────────────────────────────

/** Validation rules per field type */
export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  minValue?: number; // for star_rating
  maxValue?: number; // for star_rating
  maxFileSizeBytes?: number; // for upload fields
  allowedMimeTypes?: string[]; // for upload fields
  pattern?: string; // regex pattern for text fields
}

/** Dropdown/multi-select option */
export interface FieldOption {
  id: string;
  label: string;
  value: string;
}

/** Full field configuration */
export interface FieldConfig {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  encrypted: boolean;
  validation?: FieldValidation;
  options?: FieldOption[]; // for dropdown, multi_select
  order: number;
}

// ─── Form Schema ──────────────────────────────────────────────────────────────

/** Complete form schema — stored as a blob on Walrus */
export interface FormSchema {
  id: string;
  title: string;
  description?: string;
  slug: string;
  mode: FormMode;
  encryptionMode: EncryptionMode;
  sealPolicyId?: string;
  fields: FieldConfig[];
  version: number;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Lightweight form metadata — stored in PostgreSQL index */
export interface FormMetadata {
  id: string;
  slug: string;
  title: string;
  description?: string;
  ownerId: string;
  schemaBlobId: string | null;
  /**
   * Full draft schema JSON (fields, title, version) — stored in PostgreSQL for persistence.
   * Null until the first Save Draft. On publish, this is written to Walrus as `schemaBlobId`.
   */
  draftSchema?: Record<string, unknown> | null;
  mode: FormMode;
  encryptionMode: EncryptionMode;
  sealPolicyId: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submissionCount?: number;
}

// ─── Form Input Types ─────────────────────────────────────────────────────────

/** Input for creating a new form */
export interface CreateFormInput {
  title: string;
  description?: string;
  slug?: string; // auto-generated if not provided
  mode: FormMode;
  encryptionMode: EncryptionMode;
  fields: Omit<FieldConfig, 'id' | 'order'>[];
}

/** Input for updating an existing form */
export interface UpdateFormInput {
  title?: string;
  description?: string;
  slug?: string;
  mode?: FormMode;
  encryptionMode?: EncryptionMode;
  fields?: FieldConfig[];
}
