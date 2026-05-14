/**
 * Server-side-only schema hashing utilities using Node.js crypto.
 *
 * DO NOT import this file in browser-bundled code (e.g., apps/web components).
 * Use schema-hash.ts (Web Crypto API) for browser-compatible hashing.
 *
 * Requirements: R13.1, R13.4
 */

import { createHash } from 'node:crypto';
import { canonicalize } from './pretty-printer';

/**
 * Synchronous SHA-256 of the RFC 8785 canonical JSON encoding of `value`.
 * Returns raw bytes.
 *
 * Server-side only — uses Node.js `node:crypto`.
 */
export function schemaHashSync(value: unknown): Uint8Array {
  const bytes = canonicalize(value);
  return new Uint8Array(createHash('sha256').update(bytes).digest().buffer);
}

/**
 * Synchronous hex-encoded SHA-256 of the RFC 8785 canonical JSON encoding of `value`.
 *
 * Server-side only — uses Node.js `node:crypto`.
 */
export function schemaHashHexSync(value: unknown): string {
  const bytes = canonicalize(value);
  return createHash('sha256').update(bytes).digest('hex');
}
