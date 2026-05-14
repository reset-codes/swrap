/**
 * Schema hashing utilities using RFC 8785 canonicalization + SHA-256.
 *
 * Requirements: R13.1, R13.4
 */

import { createHash } from 'node:crypto';
import { canonicalize } from './pretty-printer';

/**
 * Returns the SHA-256 hash of the RFC 8785 canonical JSON encoding of `value`.
 */
export function schemaHash(value: unknown): Uint8Array {
  const bytes = canonicalize(value);
  return new Uint8Array(createHash('sha256').update(bytes).digest().buffer);
}

/**
 * Returns the SHA-256 hash of the RFC 8785 canonical JSON encoding of `value`
 * as a lowercase hex string.
 */
export function schemaHashHex(value: unknown): string {
  const bytes = canonicalize(value);
  return createHash('sha256').update(bytes).digest('hex');
}
