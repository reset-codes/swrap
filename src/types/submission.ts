/**
 * Shared TypeScript types for submissions.
 * These types cover the full submission lifecycle: payload assembly, Walrus storage,
 * PostgreSQL indexing, status management, and paginated retrieval.
 *
 * See: Requirements R3, R5
 */

import type { FieldType } from './form';

// ─── Submission Status ────────────────────────────────────────────────────────

/** Submission status tags — aligns with Prisma SubmissionStatus enum */
export type SubmissionStatus =
  | 'open'
  | 'under_review'
  | 'planned'
  | 'resolved'
  | 'rejected';

// ─── Blob Reference ───────────────────────────────────────────────────────────

/** A reference to a file blob stored on Walrus */
export interface BlobRef {
  blobId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

// ─── Field Value ──────────────────────────────────────────────────────────────

/** A single field value in a submission */
export interface FieldValue {
  fieldId: string;
  fieldType: FieldType;
  value: string | string[] | number | boolean | BlobRef | BlobRef[] | null;
  encrypted: boolean;
  encryptedData?: string; // base64 encrypted blob if encrypted=true
}

// ─── Submission Payload ───────────────────────────────────────────────────────

/** Complete submission payload — stored as a blob on Walrus */
export interface SubmissionPayload {
  id: string;
  formId: string;
  formSlug: string;
  formVersion: number;
  fields: FieldValue[];
  submittedAt: string; // ISO 8601
  metadata: {
    userAgent?: string;
    // No IP addresses or fingerprints per ENGINEERING_RULES.md Rule 4
  };
}

// ─── Submission Metadata ──────────────────────────────────────────────────────

/** Lightweight submission metadata — stored in PostgreSQL index */
export interface SubmissionMetadata {
  id: string;
  formId: string;
  walrusBlobId: string;
  status: SubmissionStatus;
  submittedAt: string;
}

// ─── Status Log ───────────────────────────────────────────────────────────────

/** Status log entry (append-only) */
export interface SubmissionStatusLogEntry {
  id: string;
  submissionId: string;
  adminId: string;
  status: SubmissionStatus;
  note?: string;
  createdAt: string;
}

// ─── Submission Views ─────────────────────────────────────────────────────────

/** Full submission view (metadata + payload from Walrus) */
export interface SubmissionView {
  metadata: SubmissionMetadata;
  payload: SubmissionPayload | null; // null if Walrus fetch failed
  statusHistory: SubmissionStatusLogEntry[];
}

/** Paginated list response */
export interface PaginatedSubmissions {
  submissions: SubmissionMetadata[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Filters for submission list */
export interface SubmissionFilters {
  status?: SubmissionStatus[];
  search?: string;
  formId?: string;
  page?: number;
  pageSize?: number;
}
