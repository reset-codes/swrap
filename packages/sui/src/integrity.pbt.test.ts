// packages/sui/src/integrity.pbt.test.ts
// Property-based tests for SHA-256 integrity invariant
//
// **Validates: Requirements R13.4, R13.5, R17.6**
//
// Property 6: sha256(decrypt(retrieve(record.blob_id))) == record.schema_hash
//
// Concretely, this test verifies:
//   schemaHashHex(s) === sha256hex(canonicalize(s))
// for all valid FormSchema s, where sha256hex is computed using Node's
// crypto.createHash('sha256').
//
// This ensures that the schema_hash stored in a MetadataRecord anchor input
// equals the SHA-256 of the canonical bytes of the FormSchema.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createHash } from 'node:crypto';
import { canonicalize } from '@poc/shared/pretty-printer';
import { schemaHashHexSync } from '@poc/shared/schema-hash-server';
import { FIELD_TYPES } from '@poc/shared/validator';
import type { PocField, FormSchema } from '@poc/shared/validator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 of bytes using Node's crypto module, returning a lowercase
 * hex string. This is the reference implementation used to verify schemaHashHex.
 */
function sha256hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// Arbitraries (same pattern as schema.pbt.test.ts)
// ---------------------------------------------------------------------------

/** Arbitrary for a valid FieldType from the FIELD_TYPES palette. */
const fieldTypeArb = fc.constantFrom(...FIELD_TYPES);

/**
 * Arbitrary for a non-empty string of a given max length.
 * Uses printable ASCII (excluding backslash and double-quote) to avoid
 * JSON encoding edge cases and keep round-trips clean.
 * Also filters out prototype-polluting keys.
 */
function nonEmptyStringArb(maxLength: number): fc.Arbitrary<string> {
  const BANNED_KEYS = new Set([
    '__proto__',
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'prototype',
  ]);
  return fc
    .stringMatching(/^[ !#-[\]-~]+$/, { maxLength })
    .filter((s) => s.length >= 1 && !BANNED_KEYS.has(s));
}

/**
 * Arbitrary for a valid PocField.
 */
const pocFieldArb: fc.Arbitrary<PocField> = fc.tuple(fieldTypeArb, fc.uuid()).chain(([type, id]) => {
  if (type === 'select') {
    return fc
      .record({
        type: fc.constant(type as 'select'),
        label: nonEmptyStringArb(100),
        required: fc.option(fc.boolean(), { nil: undefined }),
        options: fc.option(
          fc.array(nonEmptyStringArb(50), { minLength: 1, maxLength: 10 }),
          { nil: undefined },
        ),
      })
      .map((f) => {
        const result: PocField = { id, type: f.type, label: f.label };
        if (f.required !== undefined) result.required = f.required;
        if (f.options !== undefined) result.options = f.options;
        return result;
      });
  }

  return fc
    .record({
      type: fc.constant(type),
      label: nonEmptyStringArb(100),
      required: fc.option(fc.boolean(), { nil: undefined }),
    })
    .map((f) => {
      const result: PocField = { id, type: f.type, label: f.label };
      if (f.required !== undefined) result.required = f.required;
      return result;
    });
});

/**
 * Arbitrary for a valid ISO datetime string.
 * Generates dates between 2020-01-01 and 2030-12-31.
 */
const isoDateArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

/**
 * Arbitrary for a valid FormSchema.
 */
const formSchemaArb: fc.Arbitrary<FormSchema> = fc.record({
  title: nonEmptyStringArb(200),
  fields: fc.array(pocFieldArb, { minLength: 0, maxLength: 50 }),
  version: fc.constant(1 as const),
  created_at: isoDateArb,
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('SHA-256 integrity invariant PBT — R13.4, R13.5, R17.6', () => {
  /**
   * Property 6 (R17.6): schemaHashHex(s) === sha256hex(canonicalize(s))
   *
   * For any valid FormSchema s:
   *   1. Canonicalize: bytes = canonicalize(s)
   *   2. Compute reference hash: expected = sha256hex(bytes) via Node crypto
   *   3. Compute via schemaHashHexSync: actual = schemaHashHexSync(s)
   *   4. Assert: actual === expected
   *
   * This verifies that schemaHashHexSync is consistent with sha256(canonicalize(value)).
   *
   * **Validates: Requirements R13.4, R13.5, R17.6**
   */
  it('Property 6 (R17.6): schemaHashHexSync(s) === sha256hex(canonicalize(s)) for all valid FormSchema', () => {
    fc.assert(
      fc.property(formSchemaArb, (schema) => {
        const bytes = canonicalize(schema);
        const expected = sha256hex(bytes);
        const actual = schemaHashHexSync(schema);
        expect(actual).toBe(expected);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * Property 6b (R17.6): hash is a valid 64-character lowercase hex string
   *
   * For any valid FormSchema, schemaHashHexSync must return exactly 64
   * lowercase hex characters (SHA-256 produces 32 bytes = 64 hex chars).
   *
   * **Validates: Requirements R13.4, R17.6**
   */
  it('Property 6b (R17.6): schemaHashHexSync always returns a 64-char lowercase hex string', () => {
    fc.assert(
      fc.property(formSchemaArb, (schema) => {
        const hash = schemaHashHexSync(schema);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * Property 6c (R17.6): anchor flow integrity — schema_hash stored in a
   * MetadataRecord equals sha256(canonicalize(formSchema))
   *
   * This simulates the anchor flow: the schema_hash that would be stored in
   * a MetadataRecord is computed as schemaHashHexSync(formSchema). This test
   * asserts that value equals sha256(canonicalize(formSchema)), confirming
   * the integrity invariant holds end-to-end.
   *
   * **Validates: Requirements R13.4, R13.5, R17.6**
   */
  it('Property 6c (R17.6): anchor schema_hash equals sha256(canonicalize(formSchema)) for all FormSchema', () => {
    fc.assert(
      fc.property(formSchemaArb, (schema) => {
        // Simulate what the anchor flow does: compute schema_hash
        const schemaHashForAnchor = schemaHashHexSync(schema);

        // Reference: sha256 of the canonical bytes
        const canonicalBytes = canonicalize(schema);
        const referenceHash = sha256hex(canonicalBytes);

        // The anchor schema_hash must equal the reference sha256
        expect(schemaHashForAnchor).toBe(referenceHash);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * Property 6d (R17.6): determinism — same FormSchema always produces the
   * same hash (no randomness or timestamp contamination in the hash function).
   *
   * **Validates: Requirements R13.4, R17.6**
   */
  it('Property 6d (R17.6): schemaHashHexSync is deterministic for the same FormSchema', () => {
    fc.assert(
      fc.property(formSchemaArb, (schema) => {
        const hash1 = schemaHashHexSync(schema);
        const hash2 = schemaHashHexSync(schema);
        expect(hash1).toBe(hash2);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * Property 6e (R17.6): two distinct FormSchemas (differing in at least one
   * field) produce different hashes (collision resistance for the test domain).
   *
   * We generate two schemas and mutate the title of the second to guarantee
   * they differ, then assert the hashes differ.
   *
   * **Validates: Requirements R13.5, R17.6**
   */
  it('Property 6e (R17.6): distinct FormSchemas produce distinct hashes', () => {
    fc.assert(
      fc.property(
        formSchemaArb,
        nonEmptyStringArb(200),
        (schema, altTitle) => {
          // Ensure the alt title is different from the original
          fc.pre(altTitle !== schema.title);

          const schemaA = schema;
          const schemaB = { ...schema, title: altTitle };

          const hashA = schemaHashHexSync(schemaA);
          const hashB = schemaHashHexSync(schemaB);

          expect(hashA).not.toBe(hashB);
        },
      ),
      { numRuns: 25 },
    );
  });
});
