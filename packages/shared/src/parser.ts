/**
 * Parser functions and error classes for the Walrus Testnet POC.
 *
 * ParseError  — thrown when bytes are not valid UTF-8 or not valid JSON.
 * ValidateError — thrown when the JSON does not conform to the expected shape.
 *
 * Requirements: R9.3, R9.6, R9.7, R10.1, R10.2, R12.2
 */

import { canonicalize } from './pretty-printer';
import {
  FormSchemaSchema,
  SubmissionSchema,
  type FormSchema,
  type Submission,
} from './validator';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ParseError extends Error {
  readonly category = 'parse' as const;

  constructor(public readonly reason: string) {
    super(`ParseError: ${reason}`);
    this.name = 'ParseError';
  }
}

export class ValidateError extends Error {
  readonly category = 'validate' as const;

  constructor(public readonly issues: string[]) {
    super(`ValidateError: ${issues.join('; ')}`);
    this.name = 'ValidateError';
  }
}

// ---------------------------------------------------------------------------
// Parser functions
// ---------------------------------------------------------------------------

/**
 * Decode UTF-8 bytes, parse JSON, and validate against FormSchemaSchema.
 * Throws ParseError if bytes are not valid UTF-8 or not valid JSON.
 * Throws ValidateError if the JSON does not conform to FormSchema shape.
 */
export function parseFormSchema(bytes: Uint8Array): FormSchema {
  let json: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    json = JSON.parse(text);
  } catch (e) {
    throw new ParseError((e as Error).message);
  }

  const result = FormSchemaSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ValidateError(issues);
  }

  return result.data;
}

/**
 * Decode UTF-8 bytes, parse JSON, and validate against SubmissionSchema.
 * Throws ParseError if bytes are not valid UTF-8 or not valid JSON.
 * Throws ValidateError if the JSON does not conform to Submission shape.
 */
export function parseSubmission(bytes: Uint8Array): Submission {
  let json: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    json = JSON.parse(text);
  } catch (e) {
    throw new ParseError((e as Error).message);
  }

  const result = SubmissionSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ValidateError(issues);
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Cross-schema validation
// ---------------------------------------------------------------------------

/**
 * Validate a Submission against its corresponding FormSchema.
 *
 * Checks:
 * 1. All answer keys are a subset of field labels in the form.
 * 2. Required fields have non-null, non-empty answers.
 * 3. `form_schema_hash` equals the SHA-256 hash of the canonical form bytes.
 *
 * Throws ValidateError with all issues found.
 *
 * Requirements: R12.2
 */
export async function validateSubmissionAgainstForm(
  submission: Submission,
  form: FormSchema,
): Promise<void> {
  const issues: string[] = [];

  // Build a map of field label → field for quick lookup
  const fieldsByLabel = new Map(form.fields.map((f) => [f.label, f]));
  const fieldLabels = new Set(fieldsByLabel.keys());

  // 1. Check answers ⊆ fields (all answer keys must correspond to a field label)
  for (const key of Object.keys(submission.answers)) {
    if (!fieldLabels.has(key)) {
      issues.push(`Answer key "${key}" does not match any field label in the form`);
    }
  }

  // 2. Check required fields have non-null, non-empty answers
  for (const field of form.fields) {
    if (field.required === true) {
      const answer = submission.answers[field.label];
      if (answer === null || answer === undefined) {
        issues.push(`Required field "${field.label}" has no answer`);
      } else if (typeof answer === 'string' && answer.trim() === '') {
        issues.push(`Required field "${field.label}" must not be empty`);
      }
    }
  }

  // 3. Check form_schema_hash equals recomputed hash of the canonical form bytes
  const canonicalBytes = canonicalize(form);
  // Use Web Crypto API (browser + Node.js 18+) to avoid bundling node:crypto.
  // Copy into a fresh ArrayBuffer to satisfy the strict BufferSource type.
  const plainBuffer = new ArrayBuffer(canonicalBytes.byteLength);
  new Uint8Array(plainBuffer).set(canonicalBytes);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', plainBuffer);
  const recomputedHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (submission.form_schema_hash !== recomputedHash) {
    issues.push(
      `form_schema_hash mismatch: expected ${recomputedHash}, got ${submission.form_schema_hash}`,
    );
  }

  if (issues.length > 0) {
    throw new ValidateError(issues);
  }
}
