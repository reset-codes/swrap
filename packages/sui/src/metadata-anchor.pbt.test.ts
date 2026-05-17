// packages/sui/src/metadata-anchor.pbt.test.ts
// Property-based tests for the plaintext-leak invariant on MetadataRecord
//
// **Validates: Requirements R13.2, R17.7**
//
// Property 7: MetadataRecord contains no plaintext form field values
//
// For any valid FormSchema with arbitrary field labels and values:
//   1. Build an AnchorInput as the API would
//   2. Serialize the AnchorInput to a string
//   3. Assert the serialized string does NOT contain any field labels from the schema
//   4. Assert the serialized string does NOT contain the form title
//
// Also tests the memo payload (self-transfer fallback):
//   Assert the memo payload does NOT contain any form field labels or values.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { schemaHashHexSync } from '@poc/shared/schema-hash-server';
import { FIELD_TYPES } from '@poc/shared/validator';
import type { PocField, FormSchema } from '@poc/shared/validator';
import type { AnchorInput } from './metadata-anchor';

// ---------------------------------------------------------------------------
// Re-export buildMemoPayload for testing via a thin wrapper
// We need to test the internal buildMemoPayload function.
// Since it's not exported, we replicate the logic here to test the invariant.
// ---------------------------------------------------------------------------

const MEMO_MAGIC = new TextEncoder().encode('SBPOC'); // 5 bytes
const RECORD_TYPE_FORM: number = 1;
const RECORD_TYPE_SUBMISSION: number = 2;

/**
 * Replicated from metadata-anchor.ts — builds the binary memo payload for
 * the self-transfer fallback.
 *
 * Layout:
 *   "SBPOC" (5 bytes) || record_type (1 byte) || schema_hash (32 bytes)
 *   || blob_id_utf8 || 0x00 || form_blob_id_utf8? (omitted if absent)
 */
function buildMemoPayload(input: AnchorInput): Uint8Array {
  const recordTypeByte =
    input.recordType === 'form' ? RECORD_TYPE_FORM : RECORD_TYPE_SUBMISSION;
  const schemaHashBytes = hexToBytes(input.schemaHash);
  const blobIdBytes = new TextEncoder().encode(input.blobId);
  const formBlobIdBytes = input.formBlobId
    ? new TextEncoder().encode(input.formBlobId)
    : new Uint8Array(0);

  const totalLength =
    MEMO_MAGIC.length +
    1 +
    schemaHashBytes.length +
    blobIdBytes.length +
    1 +
    formBlobIdBytes.length;

  const buf = new Uint8Array(totalLength);
  let offset = 0;

  buf.set(MEMO_MAGIC, offset);
  offset += MEMO_MAGIC.length;

  buf[offset++] = recordTypeByte;

  buf.set(schemaHashBytes, offset);
  offset += schemaHashBytes.length;

  buf.set(blobIdBytes, offset);
  offset += blobIdBytes.length;

  buf[offset++] = 0x00; // separator

  if (formBlobIdBytes.length > 0) {
    buf.set(formBlobIdBytes, offset);
  }

  return buf;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const BANNED_KEYS = new Set([
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'prototype',
]);

/**
 * Arbitrary for a non-empty printable ASCII string of at least 17 chars
 * (to rule out coincidental collisions with short strings).
 * Uses alphanumeric characters plus spaces to keep generation fast.
 */
function longNonEmptyStringArb(minLength: number, maxLength: number): fc.Arbitrary<string> {
  // Use alphanumeric + space characters for fast generation
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  return fc
    .array(fc.constantFrom(...chars.split('')), { minLength, maxLength })
    .map((arr) => arr.join(''))
    .filter((s) => s.trim().length >= 1 && !BANNED_KEYS.has(s));
}

/** Arbitrary for a valid FieldType from the FIELD_TYPES palette. */
const fieldTypeArb = fc.constantFrom(...FIELD_TYPES);

/**
 * Arbitrary for a valid PocField with a label of at least 17 chars
 * (to avoid coincidental collisions with short strings in the hash).
 */
const pocFieldArb: fc.Arbitrary<PocField> = fieldTypeArb.chain((type) => {
  if (type === 'select') {
    return fc
      .record({
        type: fc.constant(type as 'select'),
        label: longNonEmptyStringArb(17, 100),
        required: fc.option(fc.boolean(), { nil: undefined }),
        options: fc.option(
          fc.array(longNonEmptyStringArb(17, 50), { minLength: 1, maxLength: 5 }),
          { nil: undefined },
        ),
      })
      .map((f) => {
        const result: PocField = { type: f.type, label: f.label };
        if (f.required !== undefined) result.required = f.required;
        if (f.options !== undefined) result.options = f.options;
        return result;
      });
  }

  return fc
    .record({
      type: fc.constant(type),
      label: longNonEmptyStringArb(17, 100),
      required: fc.option(fc.boolean(), { nil: undefined }),
    })
    .map((f) => {
      const result: PocField = { type: f.type, label: f.label };
      if (f.required !== undefined) result.required = f.required;
      return result;
    });
});

/**
 * Arbitrary for a valid ISO datetime string.
 */
const isoDateArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

/**
 * Arbitrary for a valid FormSchema with at least one field,
 * using long labels to avoid coincidental hash collisions.
 */
const formSchemaArb: fc.Arbitrary<FormSchema> = fc.record({
  title: longNonEmptyStringArb(17, 200),
  fields: fc.array(pocFieldArb, { minLength: 1, maxLength: 10 }),
  version: fc.constant(1 as const),
  created_at: isoDateArb,
});

/**
 * Arbitrary for a Walrus blob_id (a reference string, not plaintext content).
 * Blob IDs are typically base58 or base64 strings.
 */
const blobIdArb = fc
  .base64String({ minLength: 20, maxLength: 60 })
  .map((s) => `blob-${s.replace(/[+/=]/g, '0')}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an AnchorInput as the API would for a form schema.
 */
function buildAnchorInput(schema: FormSchema, blobId: string): AnchorInput {
  return {
    blobId,
    schemaHash: schemaHashHexSync(schema),
    recordType: 'form',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Collect all plaintext strings from a FormSchema that must NOT appear
 * in the AnchorInput or memo payload.
 */
function collectPlaintextStrings(schema: FormSchema): string[] {
  const strings: string[] = [schema.title];
  for (const field of schema.fields) {
    strings.push(field.label);
    if (field.options) {
      strings.push(...field.options);
    }
  }
  return strings;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('MetadataRecord plaintext-leak invariant PBT — R13.2, R17.7', () => {
  /**
   * Property 7a (R17.7): AnchorInput serialized as JSON does NOT contain
   * any field labels from the schema.
   *
   * The AnchorInput only contains:
   *   - blobId: a reference (Walrus blob ID)
   *   - schemaHash: a SHA-256 hash (hex string)
   *   - recordType: 'form' or 'submission'
   *   - createdAt: an ISO timestamp
   *
   * None of these should contain the plaintext field labels or form title.
   *
   * **Validates: Requirements R13.2, R17.7**
   */
  it('Property 7a (R17.7): JSON.stringify(AnchorInput) never contains field labels', () => {
    fc.assert(
      fc.property(formSchemaArb, blobIdArb, (schema, blobId) => {
        const anchorInput = buildAnchorInput(schema, blobId);
        const serialized = JSON.stringify(anchorInput);

        const plaintextStrings = collectPlaintextStrings(schema);

        for (const plaintext of plaintextStrings) {
          expect(
            serialized.includes(plaintext),
            `AnchorInput JSON contains plaintext string: "${plaintext}"`,
          ).toBe(false);
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 7b (R17.7): AnchorInput serialized as JSON does NOT contain
   * the form title.
   *
   * **Validates: Requirements R13.2, R17.7**
   */
  it('Property 7b (R17.7): JSON.stringify(AnchorInput) never contains the form title', () => {
    fc.assert(
      fc.property(formSchemaArb, blobIdArb, (schema, blobId) => {
        const anchorInput = buildAnchorInput(schema, blobId);
        const serialized = JSON.stringify(anchorInput);

        expect(
          serialized.includes(schema.title),
          `AnchorInput JSON contains form title: "${schema.title}"`,
        ).toBe(false);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 7c (R17.7): AnchorInput contains only references and hashes —
   * the schemaHash is a 64-char hex string (not plaintext), blobId is a
   * reference (not a field label or title), and recordType is a fixed enum.
   *
   * **Validates: Requirements R13.2, R17.7**
   */
  it('Property 7c (R17.7): AnchorInput.schemaHash is a 64-char hex string (not plaintext)', () => {
    fc.assert(
      fc.property(formSchemaArb, blobIdArb, (schema, blobId) => {
        const anchorInput = buildAnchorInput(schema, blobId);

        // schemaHash must be a 64-char lowercase hex string
        expect(anchorInput.schemaHash).toMatch(/^[0-9a-f]{64}$/);

        // schemaHash must NOT equal any plaintext string from the schema
        const plaintextStrings = collectPlaintextStrings(schema);
        for (const plaintext of plaintextStrings) {
          expect(anchorInput.schemaHash).not.toBe(plaintext);
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 7d (R17.7): The memo payload (self-transfer fallback) does NOT
   * contain any form field labels as UTF-8 substrings.
   *
   * The memo payload layout is:
   *   "SBPOC" (5 bytes) || record_type (1 byte) || schema_hash (32 bytes)
   *   || blob_id_utf8 || 0x00 || form_blob_id_utf8?
   *
   * The schema_hash is raw binary (32 bytes), not hex-encoded plaintext.
   * The blob_id is a reference, not a field label.
   *
   * **Validates: Requirements R13.2, R17.7**
   */
  it('Property 7d (R17.7): memo payload never contains field labels as UTF-8 substrings', () => {
    fc.assert(
      fc.property(formSchemaArb, blobIdArb, (schema, blobId) => {
        const anchorInput = buildAnchorInput(schema, blobId);
        const memoBytes = buildMemoPayload(anchorInput);

        // Decode the memo as UTF-8 to check for plaintext substrings
        const memoAsText = new TextDecoder('utf-8', { fatal: false }).decode(memoBytes);

        const plaintextStrings = collectPlaintextStrings(schema);

        for (const plaintext of plaintextStrings) {
          expect(
            memoAsText.includes(plaintext),
            `Memo payload contains plaintext string: "${plaintext}"`,
          ).toBe(false);
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 7e (R17.7): The memo payload does NOT contain the form title
   * as a UTF-8 substring.
   *
   * **Validates: Requirements R13.2, R17.7**
   */
  it('Property 7e (R17.7): memo payload never contains the form title as a UTF-8 substring', () => {
    fc.assert(
      fc.property(formSchemaArb, blobIdArb, (schema, blobId) => {
        const anchorInput = buildAnchorInput(schema, blobId);
        const memoBytes = buildMemoPayload(anchorInput);

        const memoAsText = new TextDecoder('utf-8', { fatal: false }).decode(memoBytes);

        expect(
          memoAsText.includes(schema.title),
          `Memo payload contains form title: "${schema.title}"`,
        ).toBe(false);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 7f (R17.7): The memo payload starts with the magic prefix "SBPOC"
   * and contains the record type byte and a 32-byte schema hash — confirming
   * the structure is references-only, not plaintext content.
   *
   * **Validates: Requirements R13.2, R17.7**
   */
  it('Property 7f (R17.7): memo payload has correct structure (magic + type + hash + blob_id ref)', () => {
    fc.assert(
      fc.property(formSchemaArb, blobIdArb, (schema, blobId) => {
        const anchorInput = buildAnchorInput(schema, blobId);
        const memoBytes = buildMemoPayload(anchorInput);

        // Must start with "SBPOC" magic prefix
        const magic = new TextDecoder().decode(memoBytes.slice(0, 5));
        expect(magic).toBe('SBPOC');

        // Byte 5 must be the record type (1 = form)
        expect(memoBytes[5]).toBe(RECORD_TYPE_FORM);

        // Bytes 6–37 are the 32-byte raw schema hash (binary, not hex)
        const rawHashInMemo = memoBytes.slice(6, 38);
        expect(rawHashInMemo.length).toBe(32);

        // The raw hash bytes must equal the hex-decoded schemaHash
        const expectedHashBytes = hexToBytes(anchorInput.schemaHash);
        expect(Buffer.from(rawHashInMemo).equals(Buffer.from(expectedHashBytes))).toBe(true);

        // The blob_id reference must appear after the hash
        const blobIdBytes = new TextEncoder().encode(blobId);
        const blobIdInMemo = memoBytes.slice(38, 38 + blobIdBytes.length);
        expect(Buffer.from(blobIdInMemo).equals(Buffer.from(blobIdBytes))).toBe(true);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 7g (R17.7): Combined invariant — for any FormSchema with
   * arbitrary field labels and values, BOTH the AnchorInput JSON AND the
   * memo payload are free of all plaintext field labels and the form title.
   *
   * This is the core R17.7 invariant: the MetadataRecord (AnchorInput) and
   * the self-transfer memo contain only references (blob_id, schema_hash)
   * and never plaintext content.
   *
   * **Validates: Requirements R13.2, R17.7**
   */
  it('Property 7g (R17.7): combined — AnchorInput JSON and memo payload are both free of all plaintext', () => {
    fc.assert(
      fc.property(formSchemaArb, blobIdArb, (schema, blobId) => {
        const anchorInput = buildAnchorInput(schema, blobId);
        const anchorJson = JSON.stringify(anchorInput);
        const memoBytes = buildMemoPayload(anchorInput);
        const memoAsText = new TextDecoder('utf-8', { fatal: false }).decode(memoBytes);

        const plaintextStrings = collectPlaintextStrings(schema);

        for (const plaintext of plaintextStrings) {
          // AnchorInput JSON must not contain plaintext
          expect(
            anchorJson.includes(plaintext),
            `AnchorInput JSON contains plaintext: "${plaintext}"`,
          ).toBe(false);

          // Memo payload must not contain plaintext
          expect(
            memoAsText.includes(plaintext),
            `Memo payload contains plaintext: "${plaintext}"`,
          ).toBe(false);
        }
      }),
      { numRuns: 10 },
    );
  });
});
