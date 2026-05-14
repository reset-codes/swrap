/**
 * packages/seal/src/encryptor.ts
 *
 * Plan A migration note: when @mysten/seal stabilizes and is available as a
 * production-ready package, replace this file with a thin wrapper around the
 * real Seal SDK's encrypt() call. The wire format version byte will move from
 * 0x01 (this fallback) to 0x02 (Seal SDK blobs). Version 0x01 blobs remain
 * decodable for backward compatibility during the migration window.
 *
 * Requirements: R7.1, R7.2, R7.4, R7.5, R7.6
 */

import { randomBytes, createCipheriv } from 'node:crypto';
import { encode, type BlobType } from './encrypted-blob';
import type { PocSigner } from '@poc/sui';

// ---------------------------------------------------------------------------
// Startup warning — emitted once at module load time (R7.6)
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-console
console.warn('Seal fallback mode active — NOT real Seal');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt `plaintext` using AES-256-GCM with a key derived via HKDF-SHA-256
 * from the signer's secret. The derivation info encodes the blob type and
 * owner address so that keys are domain-separated per (owner, blobType) pair.
 *
 * Returns the wire-format encoded blob (header + ciphertext).
 *
 * @param plaintext  Raw bytes to encrypt.
 * @param signer     Local POC signer (provides address + deriveSymmetricKey).
 * @param blobType   'form' | 'subm' — encoded into the wire header.
 */
export async function encrypt(
  plaintext: Uint8Array,
  signer: PocSigner,
  blobType: BlobType,
): Promise<Uint8Array> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);

  // info = "sealbase-poc-v1|<blobType>|<ownerAddress>"
  const info = new TextEncoder().encode(`sealbase-poc-v1|${blobType}|${signer.address}`);

  // Derive 32-byte AES key via HKDF-SHA-256
  const key = signer.deriveSymmetricKey(new Uint8Array(salt), info); // 32 bytes

  // AES-256-GCM encrypt
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  return encode({
    header: {
      version: 1,
      schemeId: 1,
      ownerAddress: signer.address,
      salt: new Uint8Array(salt),
      nonce: new Uint8Array(nonce),
      tag: new Uint8Array(tag),
      blobType,
    },
    ciphertext: new Uint8Array(ciphertext),
  });
}
