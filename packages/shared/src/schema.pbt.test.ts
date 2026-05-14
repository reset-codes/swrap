// packages/shared/src/schema.pbt.test.ts
// Property-based tests for Pretty_Printer + Parser round-trips
// Requirements: R9.4, R9.5, R17.1, R17.2
//
// **Validates: Requirements R9.4, R9.5, R17.1, R17.2**
//
// Property 1 (R17.1): parse(print(s)) == s for all valid FormSchema s
//   Assert parseFormSchema(canonicalize(s)) deep-equals s.
//
// Property 2 (R17.2): parse(print(r)) == r for all valid Submission r
//   Assert parseSubmission(canonicalize(r)) deep-equals r.
//
// Property 3 (R9.5): print(parse(b)) == b for canonical bytes
//   Generate arbitrary object, canonicalize once, parse, canonicalize again,
//   assert byte equality.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { canonicalize } from './pretty-printer';
import { parseFormSchema, parseSubmission } from './parser';
import { schemaHashHex } from './schema-hash';
import { FIELD_TYPES } from './validator';
import type { PocField, FormSchema, Submission } from './validator';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for a valid FieldType from the FIELD_TYPES palette. */
const fieldTypeArb = fc.constantFrom(...FIELD_TYPES);

/**
 * Arbitrary for a non-empty string of a given max length.
 * Uses printable ASCII (excluding backslash and double-quote) to avoid
 * JSON encoding edge cases and keep round-trips clean.
 * Also filters out prototype-polluting keys like __proto__, constructor, toString.
 */
function nonEmptyStringArb(maxLength: number): fc.Arbitrary<string> {
  // Printable ASCII range 0x20–0x7E, excluding " (0x22) and \ (0x5C)
  const BANNED_KEYS = new Set(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'prototype']);
  return fc.stringMatching(/^[ !#-[\]-~]+$/, { maxLength })
    .filter((s) => s.length >= 1 && !BANNED_KEYS.has(s));
}

/**
 * Arbitrary for a valid PocField.
 * - type: one of FIELD_TYPES
 * - label: 1–100 chars
 * - required: optional boolean
 * - options: only present for 'select' type, array of non-empty strings
 */
const pocFieldArb: fc.Arbitrary<PocField> = fieldTypeArb.chain((type) => {
  const baseField = fc.record({
    type: fc.constant(type),
    label: nonEmptyStringArb(100),
    required: fc.option(fc.boolean(), { nil: undefined }),
  });

  if (type === 'select') {
    return fc.record({
      type: fc.constant(type as 'select'),
      label: nonEmptyStringArb(100),
      required: fc.option(fc.boolean(), { nil: undefined }),
      options: fc.option(
        fc.array(nonEmptyStringArb(50), { minLength: 1, maxLength: 10 }),
        { nil: undefined },
      ),
    }).map((f) => {
      // Remove undefined keys to keep the object clean
      const result: PocField = { type: f.type, label: f.label };
      if (f.required !== undefined) result.required = f.required;
      if (f.options !== undefined) result.options = f.options;
      return result;
    });
  }

  return baseField.map((f) => {
    const result: PocField = { type: f.type, label: f.label };
    if (f.required !== undefined) result.required = f.required;
    return result;
  });
});

/**
 * Arbitrary for a valid ISO datetime string.
 * Generates dates between 2020-01-01 and 2030-12-31.
 * Filters out invalid dates that fast-check may generate during shrinking.
 */
const isoDateArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

/**
 * Arbitrary for a valid FormSchema.
 * - title: 1–200 chars
 * - fields: 0–50 PocFields
 * - version: 1 (literal)
 * - created_at: ISO datetime
 */
const formSchemaArb: fc.Arbitrary<FormSchema> = fc
  .record({
    title: nonEmptyStringArb(200),
    fields: fc.array(pocFieldArb, { minLength: 0, maxLength: 50 }),
    version: fc.constant(1 as const),
    created_at: isoDateArb,
  });

/**
 * Arbitrary for a valid Submission given a FormSchema.
 * - form_blob_id: non-empty string
 * - form_schema_hash: computed from the form using schemaHashHex
 * - answers: record of field-label → string answers
 * - submitted_at: ISO datetime
 */
function submissionArb(form: FormSchema): fc.Arbitrary<Submission> {
  const answersArb = fc.record(
    Object.fromEntries(
      form.fields.map((f) => [f.label, fc.option(nonEmptyStringArb(500), { nil: null })])
    ) as Record<string, fc.Arbitrary<string | null>>,
  ) as fc.Arbitrary<Record<string, unknown>>;

  return fc.record({
    form_blob_id: nonEmptyStringArb(100),
    form_schema_hash: fc.constant(schemaHashHex(form)),
    answers: form.fields.length > 0 ? answersArb : fc.constant({}),
    submitted_at: isoDateArb,
  });
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Schema round-trip PBT — R17.1, R17.2, R9.4, R9.5', () => {
  /**
   * Property 1 (R17.1): parse(print(s)) == s for all valid FormSchema s.
   *
   * For any valid FormSchema, canonicalizing it to bytes and then parsing
   * those bytes must produce a deep-equal FormSchema.
   *
   * **Validates: Requirements R9.4, R17.1**
   */
  it('Property 1 (R17.1): parseFormSchema(canonicalize(s)) deep-equals s for all valid FormSchema', () => {
    fc.assert(
      fc.property(formSchemaArb, (schema) => {
        const bytes = canonicalize(schema);
        const parsed = parseFormSchema(bytes);
        expect(parsed).toEqual(schema);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 2 (R17.2): parse(print(r)) == r for all valid Submission r.
   *
   * For any valid Submission, canonicalizing it to bytes and then parsing
   * those bytes must produce a deep-equal Submission.
   *
   * **Validates: Requirements R9.4, R17.2**
   */
  it('Property 2 (R17.2): parseSubmission(canonicalize(r)) deep-equals r for all valid Submission', () => {
    fc.assert(
      fc.property(formSchemaArb.chain((form) => submissionArb(form)), (submission) => {
        const bytes = canonicalize(submission);
        const parsed = parseSubmission(bytes);
        expect(parsed).toEqual(submission);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3 (R9.5): print(parse(b)) == b for canonical bytes.
   *
   * Generate an arbitrary FormSchema, canonicalize it once to get canonical
   * bytes b, parse those bytes, then canonicalize again. The resulting bytes
   * must be byte-for-byte identical to b.
   *
   * This verifies that the canonical form is stable: re-canonicalizing a
   * parsed value produces the same bytes as the original canonical encoding.
   *
   * **Validates: Requirements R9.5**
   */
  it('Property 3 (R9.5): canonicalize(parseFormSchema(b)) == b for canonical FormSchema bytes', () => {
    fc.assert(
      fc.property(formSchemaArb, (schema) => {
        // First canonicalization: produce canonical bytes b
        const b = canonicalize(schema);
        // Parse the canonical bytes
        const parsed = parseFormSchema(b);
        // Re-canonicalize the parsed value
        const bPrime = canonicalize(parsed);
        // Assert byte equality
        expect(bPrime).toEqual(b);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3b (R9.5): print(parse(b)) == b for canonical Submission bytes.
   *
   * Same stability property for Submission objects.
   *
   * **Validates: Requirements R9.5**
   */
  it('Property 3b (R9.5): canonicalize(parseSubmission(b)) == b for canonical Submission bytes', () => {
    fc.assert(
      fc.property(formSchemaArb.chain((form) => submissionArb(form)), (submission) => {
        // First canonicalization: produce canonical bytes b
        const b = canonicalize(submission);
        // Parse the canonical bytes
        const parsed = parseSubmission(b);
        // Re-canonicalize the parsed value
        const bPrime = canonicalize(parsed);
        // Assert byte equality
        expect(bPrime).toEqual(b);
      }),
      { numRuns: 200 },
    );
  });
});
