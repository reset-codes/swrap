/**
 * Schema hashing utilities using RFC 8785 canonicalization + SHA-256.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle) so this module is safe
 * to bundle for the browser as well as run in Node.js 18+.
 *
 * Requirements: R13.1, R13.4
 */

import { canonicalize } from './pretty-printer';

/**
 * Returns the SHA-256 hash of the RFC 8785 canonical JSON encoding of `value`.
 * Async because Web Crypto subtle.digest is always async.
 */
export async function schemaHash(value: unknown): Promise<Uint8Array> {
  const bytes = canonicalize(value);
  // Copy into a fresh ArrayBuffer to satisfy the strict BufferSource type.
  const plainBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(plainBuffer).set(bytes);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', plainBuffer);
  return new Uint8Array(hashBuffer);
}

/**
 * Returns the SHA-256 hash of the RFC 8785 canonical JSON encoding of `value`
 * as a lowercase hex string.
 */
export async function schemaHashHex(value: unknown): Promise<string> {
  const hash = await schemaHash(value);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
