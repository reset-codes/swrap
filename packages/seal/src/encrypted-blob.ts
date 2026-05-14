/**
 * packages/seal/src/encrypted-blob.ts
 *
 * Wire format codec for the SEALBASE encrypted blob format (Plan B fallback).
 *
 * Plan A migration note: when @mysten/seal stabilizes, this file will be
 * updated to use version 0x02 for Seal SDK blobs. Version 0x01 blobs (this
 * implementation) remain decodable for backward compatibility.
 *
 * 82-byte header layout:
 *
 * Offset  Size  Field           Notes
 * ------  ----  --------------  ---------------------------------
 *   0      1   version          0x01 (only value accepted)
 *   1      1   scheme_id        0x01 = AES-256-GCM + HKDF-SHA-256
 *   2     32   owner_address    tx sender's 32-byte Sui address (raw bytes)
 *  34     16   salt             per-blob random salt (HKDF)
 *  50     12   nonce            AES-GCM IV (96-bit)
 *  62     16   tag              AES-GCM auth tag
 *  78      4   blob_type        'form' | 'subm' (ASCII, padded with spaces)
 *  82    var   ciphertext       AES-GCM ciphertext (consumes rest of bytes)
 */

export const HEADER_SIZE = 82;
export const VERSION = 0x01;
export const SCHEME_ID = 0x01;

const OWNER_ADDRESS_OFFSET = 2;
const OWNER_ADDRESS_SIZE = 32;
const SALT_OFFSET = 34;
const SALT_SIZE = 16;
const NONCE_OFFSET = 50;
const NONCE_SIZE = 12;
const TAG_OFFSET = 62;
const TAG_SIZE = 16;
const BLOB_TYPE_OFFSET = 78;
const BLOB_TYPE_SIZE = 4;
const CIPHERTEXT_OFFSET = 82;

export type BlobType = 'form' | 'subm';

export interface EncryptedBlobHeader {
  version: 1;
  schemeId: 1; // AES-256-GCM + HKDF-SHA-256
  ownerAddress: string; // hex, 0x-prefixed (32 bytes = 64 hex chars)
  salt: Uint8Array; // 16 bytes
  nonce: Uint8Array; // 12 bytes
  tag: Uint8Array; // 16 bytes
  blobType: BlobType;
}

export interface EncryptedBlob {
  header: EncryptedBlobHeader;
  ciphertext: Uint8Array;
}

/**
 * ParseError is thrown by `decode` when the byte buffer does not conform to
 * the expected wire format.
 */
export class ParseError extends Error {
  readonly category = 'parse' as const;

  constructor(public readonly reason: string) {
    super(`ParseError: ${reason}`);
    this.name = 'ParseError';
  }
}

/**
 * Encode an EncryptedBlob to its wire-format byte representation.
 *
 * The caller is responsible for ensuring all fields have the correct sizes.
 * This function will throw if field sizes are wrong.
 */
export function encode(blob: EncryptedBlob): Uint8Array {
  const { header, ciphertext } = blob;

  if (header.salt.length !== SALT_SIZE) {
    throw new ParseError(`salt must be ${SALT_SIZE} bytes, got ${header.salt.length}`);
  }
  if (header.nonce.length !== NONCE_SIZE) {
    throw new ParseError(`nonce must be ${NONCE_SIZE} bytes, got ${header.nonce.length}`);
  }
  if (header.tag.length !== TAG_SIZE) {
    throw new ParseError(`tag must be ${TAG_SIZE} bytes, got ${header.tag.length}`);
  }

  // Decode owner address from hex string to raw bytes
  const ownerBytes = hexToBytes(header.ownerAddress);
  if (ownerBytes.length !== OWNER_ADDRESS_SIZE) {
    throw new ParseError(
      `owner_address must be ${OWNER_ADDRESS_SIZE} bytes (64 hex chars), got ${ownerBytes.length}`,
    );
  }

  // Encode blob_type as 4 ASCII bytes (padded with spaces if needed)
  const blobTypeBytes = encodeBlobType(header.blobType);

  const out = new Uint8Array(HEADER_SIZE + ciphertext.length);
  out[0] = VERSION;
  out[1] = SCHEME_ID;
  out.set(ownerBytes, OWNER_ADDRESS_OFFSET);
  out.set(header.salt, SALT_OFFSET);
  out.set(header.nonce, NONCE_OFFSET);
  out.set(header.tag, TAG_OFFSET);
  out.set(blobTypeBytes, BLOB_TYPE_OFFSET);
  out.set(ciphertext, CIPHERTEXT_OFFSET);

  return out;
}

/**
 * Decode wire-format bytes into an EncryptedBlob.
 *
 * Throws `ParseError` on:
 * - Buffer shorter than 82 bytes
 * - Version byte !== 0x01
 * - Scheme ID byte !== 0x01
 * - Unknown or malformed blob_type field
 */
export function decode(bytes: Uint8Array): EncryptedBlob {
  if (bytes.length < HEADER_SIZE) {
    throw new ParseError(
      `buffer too short: expected at least ${HEADER_SIZE} bytes, got ${bytes.length}`,
    );
  }

  const version = bytes[0];
  if (version !== VERSION) {
    throw new ParseError(`unsupported version: expected 0x${VERSION.toString(16)}, got 0x${version.toString(16)}`);
  }

  const schemeId = bytes[1];
  if (schemeId !== SCHEME_ID) {
    throw new ParseError(
      `unknown scheme_id: expected 0x${SCHEME_ID.toString(16)}, got 0x${schemeId.toString(16)}`,
    );
  }

  const ownerBytes = bytes.slice(OWNER_ADDRESS_OFFSET, OWNER_ADDRESS_OFFSET + OWNER_ADDRESS_SIZE);
  const ownerAddress = '0x' + bytesToHex(ownerBytes);

  const salt = bytes.slice(SALT_OFFSET, SALT_OFFSET + SALT_SIZE);
  const nonce = bytes.slice(NONCE_OFFSET, NONCE_OFFSET + NONCE_SIZE);
  const tag = bytes.slice(TAG_OFFSET, TAG_OFFSET + TAG_SIZE);

  const blobTypeRaw = bytes.slice(BLOB_TYPE_OFFSET, BLOB_TYPE_OFFSET + BLOB_TYPE_SIZE);
  const blobType = decodeBlobType(blobTypeRaw);

  const ciphertext = bytes.slice(CIPHERTEXT_OFFSET);

  return {
    header: {
      version: 1,
      schemeId: 1,
      ownerAddress,
      salt: new Uint8Array(salt),
      nonce: new Uint8Array(nonce),
      tag: new Uint8Array(tag),
      blobType,
    },
    ciphertext: new Uint8Array(ciphertext),
  };
}

/**
 * Quick check to determine if a byte buffer looks like an EncryptedBlob.
 *
 * This is a cheap header check only — it does NOT fully validate the blob.
 * Use `decode` for full validation.
 *
 * Returns true iff:
 * - bytes.length >= 82
 * - bytes[0] === 0x01 (version)
 * - bytes[1] === 0x01 (scheme_id)
 */
export function looksLikeEncryptedBlob(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER_SIZE && bytes[0] === VERSION && bytes[1] === SCHEME_ID;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function encodeBlobType(blobType: BlobType): Uint8Array {
  const out = new Uint8Array(BLOB_TYPE_SIZE);
  const encoded = new TextEncoder().encode(blobType);
  // Pad with spaces if shorter than 4 bytes (shouldn't happen for 'form'/'subm')
  out.fill(0x20); // space
  out.set(encoded.slice(0, BLOB_TYPE_SIZE));
  return out;
}

function decodeBlobType(bytes: Uint8Array): BlobType {
  // Trim trailing spaces (padding)
  const raw = new TextDecoder('ascii').decode(bytes).trimEnd();
  if (raw === 'form' || raw === 'subm') {
    return raw;
  }
  throw new ParseError(`unknown blob_type: "${raw}" (expected 'form' or 'subm')`);
}

function hexToBytes(hex: string): Uint8Array {
  // Strip 0x prefix if present
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new ParseError(`invalid hex string length: ${clean.length}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (isNaN(byte)) {
      throw new ParseError(`invalid hex character at position ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
