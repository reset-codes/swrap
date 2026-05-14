/**
 * packages/seal/src/encrypted-blob.ts
 *
 * Wire format codec for the Swrap encrypted blob format (Plan B fallback).
 *
 * Plan A migration note: when @mysten/seal stabilizes, this file will be
 * updated to use version 0x02 for Seal SDK blobs. Version 0x01 blobs (this
 * implementation) remain decodable for backward compatibility.
 *
 * 82-byte header layout:
 *
 * Offset  Size  Field           Notes
 * ------  ----  --------------  ---------------------------------
 *   0      1   version          0x01 (legacy), 0x02 (Seal SDK)
 *   1      1   scheme_id        0x01 (legacy), 0x02 (Seal SDK)
 *   2     32   owner_address    tx sender's 32-byte Sui address (raw bytes)
 *  34    var   header_params    V1: salt(16) || nonce(12) || tag(16) || type(4) = 48 bytes
 *                               V2: SDK-specific metadata
 */

export const HEADER_SIZE_V1 = 82;
export const VERSION_V1 = 0x01;
export const VERSION_V2 = 0x02;
export const SCHEME_ID_V1 = 0x01;
export const SCHEME_ID_V2 = 0x02;

export const VERSION = VERSION_V2;
export const SCHEME_ID = SCHEME_ID_V2;
export const HEADER_SIZE = 166; // Matches CIPHERTEXT_OFFSET_V2

// Seal Testnet Configuration (R7.8)
export const SEAL_TESTNET_PACKAGE_ID =
  '0x4016869413374eaa71df2a043d1660ed7bc927ab7962831f8b07efbc7efdb2c3';
export const SEAL_TESTNET_SERVER_CONFIGS = [
  {
    objectId: '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98',
    aggregatorUrl: 'https://seal-aggregator-testnet.mystenlabs.com',
    weight: 1,
  },
];

const OWNER_ADDRESS_OFFSET = 2;
const OWNER_ADDRESS_SIZE = 32;

// V1 offsets (legacy)
const SALT_OFFSET_V1 = 34;
const SALT_SIZE_V1 = 16;
const NONCE_OFFSET_V1 = 50;
const NONCE_SIZE_V1 = 12;
const TAG_OFFSET_V1 = 62;
const TAG_SIZE_V1 = 16;
const BLOB_TYPE_OFFSET_V1 = 78;
const BLOB_TYPE_SIZE_V1 = 4;
const CIPHERTEXT_OFFSET_V1 = 82;

// V2 offsets (SDK)
const IDENTITY_OFFSET_V2 = 34;
const IDENTITY_SIZE_V2 = 128;
const BLOB_TYPE_OFFSET_V2 = 162;
const BLOB_TYPE_SIZE_V2 = 4;
const CIPHERTEXT_OFFSET_V2 = 166;

export type BlobType = 'form' | 'subm';

export interface EncryptedBlobHeaderV1 {
  version: 1;
  schemeId: 1; // AES-256-GCM + HKDF-SHA-256
  ownerAddress: string;
  salt: Uint8Array;
  nonce: Uint8Array;
  tag: Uint8Array;
  blobType: BlobType;
}

export interface EncryptedBlobHeaderV2 {
  version: 2;
  schemeId: 2; // @mysten/seal
  ownerAddress: string;
  identity: string; // The Seal IBE identity (address or policy ID)
  blobType: BlobType;
}

export type EncryptedBlobHeader = EncryptedBlobHeaderV1 | EncryptedBlobHeaderV2;

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
 */
export function encode(blob: EncryptedBlob): Uint8Array {
  const { header, ciphertext } = blob;

  // Decode owner address
  const ownerBytes = hexToBytes(header.ownerAddress);
  if (ownerBytes.length !== OWNER_ADDRESS_SIZE) {
    throw new ParseError(
      `owner_address must be ${OWNER_ADDRESS_SIZE} bytes, got ${ownerBytes.length}`,
    );
  }

  // Version 2 — SDK (Plan A)
  if (header.version === VERSION_V2) {
    const v2Header = header as EncryptedBlobHeaderV2;
    const out = new Uint8Array(CIPHERTEXT_OFFSET_V2 + ciphertext.length);
    out[0] = VERSION_V2;
    out[1] = SCHEME_ID_V2;
    out.set(ownerBytes, OWNER_ADDRESS_OFFSET);
    out.set(encodeString(v2Header.identity, IDENTITY_SIZE_V2), IDENTITY_OFFSET_V2);
    out.set(encodeBlobType(v2Header.blobType), BLOB_TYPE_OFFSET_V2);
    out.set(ciphertext, CIPHERTEXT_OFFSET_V2);
    return out;
  }

  // Version 1 — Legacy (Plan B fallback)
  if (header.version === VERSION_V1) {
    const v1Header = header as EncryptedBlobHeaderV1;
    if (v1Header.salt.length !== SALT_SIZE_V1) throw new ParseError('invalid salt size');
    if (v1Header.nonce.length !== NONCE_SIZE_V1) throw new ParseError('invalid nonce size');
    if (v1Header.tag.length !== TAG_SIZE_V1) throw new ParseError('invalid tag size');

    const out = new Uint8Array(CIPHERTEXT_OFFSET_V1 + ciphertext.length);
    out[0] = VERSION_V1;
    out[1] = SCHEME_ID_V1;
    out.set(ownerBytes, OWNER_ADDRESS_OFFSET);
    out.set(v1Header.salt, SALT_OFFSET_V1);
    out.set(v1Header.nonce, NONCE_OFFSET_V1);
    out.set(v1Header.tag, TAG_OFFSET_V1);
    out.set(encodeBlobType(v1Header.blobType), BLOB_TYPE_OFFSET_V1);
    out.set(ciphertext, CIPHERTEXT_OFFSET_V1);
    return out;
  }

  throw new ParseError(`unsupported version for encoding: ${(header as any).version}`);
}

/**
 * Decode wire-format bytes into an EncryptedBlob.
 */
export function decode(bytes: Uint8Array): EncryptedBlob {
  if (bytes.length < OWNER_ADDRESS_OFFSET + OWNER_ADDRESS_SIZE) {
    throw new ParseError('buffer too short to contain owner address');
  }

  const version = bytes[0];
  const schemeId = bytes[1];
  const ownerBytes = bytes.slice(OWNER_ADDRESS_OFFSET, OWNER_ADDRESS_OFFSET + OWNER_ADDRESS_SIZE);
  const ownerAddress = '0x' + bytesToHex(ownerBytes);

  // Version 2 — SDK
  if (version === VERSION_V2) {
    if (schemeId !== SCHEME_ID_V2) {
      throw new ParseError(`unknown scheme_id for v2: 0x${schemeId.toString(16)}`);
    }
    const identityRaw = bytes.slice(IDENTITY_OFFSET_V2, IDENTITY_OFFSET_V2 + IDENTITY_SIZE_V2);
    const identity = decodeString(identityRaw);
    const blobTypeRaw = bytes.slice(BLOB_TYPE_OFFSET_V2, BLOB_TYPE_OFFSET_V2 + BLOB_TYPE_SIZE_V2);
    const blobType = decodeBlobType(blobTypeRaw);
    const ciphertext = bytes.slice(CIPHERTEXT_OFFSET_V2);

    return {
      header: { version: 2, schemeId: 2, ownerAddress, identity, blobType },
      ciphertext,
    };
  }

  // Version 1 — Legacy
  if (version === VERSION_V1) {
    if (bytes.length < HEADER_SIZE_V1) {
      throw new ParseError(
        `buffer too short for v1: expected ${HEADER_SIZE_V1}, got ${bytes.length}`,
      );
    }
    if (schemeId !== SCHEME_ID_V1) {
      throw new ParseError(`unknown scheme_id for v1: 0x${schemeId.toString(16)}`);
    }

    const salt = bytes.slice(SALT_OFFSET_V1, SALT_OFFSET_V1 + SALT_SIZE_V1);
    const nonce = bytes.slice(NONCE_OFFSET_V1, NONCE_OFFSET_V1 + NONCE_SIZE_V1);
    const tag = bytes.slice(TAG_OFFSET_V1, TAG_OFFSET_V1 + TAG_SIZE_V1);
    const blobTypeRaw = bytes.slice(BLOB_TYPE_OFFSET_V1, BLOB_TYPE_OFFSET_V1 + BLOB_TYPE_SIZE_V1);
    const blobType = decodeBlobType(blobTypeRaw);
    const ciphertext = bytes.slice(CIPHERTEXT_OFFSET_V1);

    return {
      header: {
        version: 1,
        schemeId: 1,
        ownerAddress,
        salt,
        nonce,
        tag,
        blobType,
      },
      ciphertext,
    };
  }

  throw new ParseError(`unsupported version: 0x${version.toString(16)}`);
}

/**
 * Quick check to determine if a byte buffer looks like an EncryptedBlob.
 */
export function looksLikeEncryptedBlob(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  const version = bytes[0];
  const schemeId = bytes[1];
  return (
    (version === VERSION_V1 && schemeId === SCHEME_ID_V1) ||
    (version === VERSION_V2 && schemeId === SCHEME_ID_V2)
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function encodeBlobType(blobType: BlobType): Uint8Array {
  return encodeString(blobType, BLOB_TYPE_SIZE_V1);
}

function decodeBlobType(bytes: Uint8Array): BlobType {
  const raw = decodeString(bytes);
  if (raw === 'form' || raw === 'subm') {
    return raw;
  }
  throw new ParseError(`unknown blob_type: "${raw}" (expected 'form' or 'subm')`);
}

function encodeString(str: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  const encoded = new TextEncoder().encode(str);
  if (encoded.length > length) {
    throw new ParseError(`string too long: ${encoded.length} bytes (max ${length})`);
  }
  out.fill(0x20); // space padding
  out.set(encoded);
  return out;
}

function decodeString(bytes: Uint8Array): string {
  return new TextDecoder('ascii').decode(bytes).trimEnd();
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
