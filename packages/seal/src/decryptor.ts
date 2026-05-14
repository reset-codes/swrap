/**
 * packages/seal/src/decryptor.ts
 *
 * Plan A migration note: when @mysten/seal stabilizes and is available as a
 * production-ready package, replace this file with a thin wrapper around the
 * real Seal SDK's decrypt() call. The wire format version byte will move from
 * 0x01 (this fallback) to 0x02 (Seal SDK blobs). Version 0x01 blobs remain
 * decodable for backward compatibility during the migration window.
 *
 * Requirements: R7.1, R7.2, R7.4, R7.5, R7.6
 */

import { createDecipheriv } from 'node:crypto';
import { decode, ParseError } from './encrypted-blob';
import type { PocSigner } from '@poc/sui';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when the signer's address does not match the owner address encoded
 * in the blob header. The caller does not have authorization to decrypt.
 */
export class SealAuthError extends Error {
  readonly category = 'authorization' as const;

  constructor(
    public readonly signerAddress: string,
    message?: string,
  ) {
    super(message ?? `Owner address mismatch: signer is ${signerAddress}`);
    this.name = 'SealAuthError';
  }
}

/**
 * Thrown when the blob bytes cannot be decoded (malformed wire format) or
 * when AES-GCM authentication fails (tampered ciphertext or wrong key).
 */
export class SealParseError extends Error {
  readonly category = 'parse' as const;

  constructor(public readonly reason: string) {
    super(`SealParseError: ${reason}`);
    this.name = 'SealParseError';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decrypt a wire-format encrypted blob produced by `encrypt()`.
 *
 * Throws:
 * - `SealParseError`  — malformed wire format (category: 'parse')
 * - `SealAuthError`   — signer address does not match blob owner (category: 'authorization')
 * - `SealParseError`  — AES-GCM authentication tag mismatch (category: 'parse',
 *                       reason: 'AES-GCM authentication failed')
 *
 * @param blobBytes  Wire-format bytes as returned by `encrypt()`.
 * @param signer     Local POC signer (provides address + deriveSymmetricKey).
 */
export async function decrypt(
  blobBytes: Uint8Array,
  signer: PocSigner,
): Promise<Uint8Array> {
  // 1. Decode wire format — throws SealParseError on malformed input
  let blob;
  try {
    blob = decode(blobBytes);
  } catch (err) {
    if (err instanceof ParseError) {
      throw new SealParseError(err.reason);
    }
    throw new SealParseError(String(err));
  }

  // 2. Owner address check — case-insensitive hex comparison
  if (blob.header.ownerAddress.toLowerCase() !== signer.address.toLowerCase()) {
    throw new SealAuthError(signer.address, 'Owner address mismatch');
  }

  // 3. Derive the same key used during encryption
  // info must match exactly what encrypt() used: "sealbase-poc-v1|<blobType>|<ownerAddress>"
  // Use the ownerAddress from the blob header (canonical form) to ensure consistency.
  const info = new TextEncoder().encode(
    `sealbase-poc-v1|${blob.header.blobType}|${blob.header.ownerAddress}`,
  );
  const key = signer.deriveSymmetricKey(blob.header.salt, info);

  // 4. AES-256-GCM decrypt — throws SealParseError on auth tag mismatch
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, blob.header.nonce);
    decipher.setAuthTag(blob.header.tag);
    const plaintext = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
    return new Uint8Array(plaintext);
  } catch {
    throw new SealParseError('AES-GCM authentication failed');
  }
}
