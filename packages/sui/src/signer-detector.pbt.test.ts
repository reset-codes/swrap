// packages/sui/src/signer-detector.pbt.test.ts
// Property-based tests for Signer_Detector (packages/sui/src/signer-detector.ts)
//
// **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
//
// R17 supporting invariant — PocSigner never serializes secret bytes.
// fast-check generates random PocSigner constructions; assert that
// JSON.stringify(signer), String(signer), util.inspect(signer), and
// enumeration of Object.keys(signer) never contain any byte of the source secret.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { inspect } from 'node:util';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { detectLocalSigner, type PocSigner } from './signer-detector';

// ---------------------------------------------------------------------------
// Mock node:fs/promises
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
const mockReadFile = vi.mocked(readFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyKeypair = Ed25519Keypair | Secp256k1Keypair | Secp256r1Keypair;

/**
 * Set up mocks so that detectLocalSigner() returns a PocSigner for the given keypair.
 */
function setupMocksForKeypair(kp: AnyKeypair): void {
  const address = kp.toSuiAddress();
  const bech32Key = kp.getSecretKey();
  const keystorePath = '/home/user/.sui/sui_config/sui.keystore';
  const clientYaml = `active_address: '${address}'\nactive_env: testnet\nkeystore:\n  File: '${keystorePath}'\n`;
  const keystore = JSON.stringify([bech32Key]);

  mockReadFile.mockImplementation(async (path: unknown) => {
    if (String(path).endsWith('client.yaml')) return clientYaml;
    if (String(path) === keystorePath) return keystore;
    throw new Error(`ENOENT: no such file or directory, open '${path}'`);
  });
}

/**
 * Extract the raw 32-byte secret from a keypair (same logic as signer-detector.ts).
 */
function extractSecret(kp: AnyKeypair): Uint8Array {
  return decodeSuiPrivateKey(kp.getSecretKey()).secretKey;
}

/**
 * Convert a Uint8Array to a lowercase hex string.
 */
function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Convert a Uint8Array to a base64 string.
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Check whether a string contains any individual byte of the secret
 * encoded as hex (2-char hex per byte) or as base64.
 *
 * We check:
 * 1. The full secret as a contiguous hex string
 * 2. The full secret as a contiguous base64 string
 * 3. Any individual byte value as a 2-char hex substring (conservative check)
 *    — we skip single-byte checks since single hex bytes like "00", "ff" are
 *    common in non-secret data; instead we check 4+ byte windows.
 */
function containsSecretBytes(serialized: string, secret: Uint8Array): boolean {
  const hexSecret = toHex(secret);
  const base64Secret = toBase64(secret);

  // Check full secret as hex
  if (serialized.toLowerCase().includes(hexSecret.toLowerCase())) return true;

  // Check full secret as base64
  if (serialized.includes(base64Secret)) return true;

  // Check any 4-byte (8 hex char) window of the secret
  for (let i = 0; i <= secret.length - 4; i++) {
    const window = toHex(secret.slice(i, i + 4));
    if (serialized.toLowerCase().includes(window.toLowerCase())) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary that generates a random Ed25519 keypair.
 * We use fc.integer to seed randomness, then generate a keypair.
 */
const ed25519KeypairArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((seed) => {
    // Use the seed bytes directly as the secret key
    try {
      return Ed25519Keypair.fromSecretKey(seed);
    } catch {
      // If the seed is invalid (unlikely for Ed25519), generate a fresh one
      return Ed25519Keypair.generate();
    }
  });

/**
 * Arbitrary that generates a random Secp256k1 keypair.
 */
const secp256k1KeypairArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .filter((seed) => {
    // Secp256k1 requires the secret to be in [1, n-1]; filter out zero
    return seed.some((b) => b !== 0);
  })
  .map((seed) => {
    try {
      return Secp256k1Keypair.fromSecretKey(seed);
    } catch {
      return Secp256k1Keypair.generate();
    }
  });

/**
 * Arbitrary that generates a random Secp256r1 keypair.
 */
const secp256r1KeypairArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .filter((seed) => {
    return seed.some((b) => b !== 0);
  })
  .map((seed) => {
    try {
      return Secp256r1Keypair.fromSecretKey(seed);
    } catch {
      return Secp256r1Keypair.generate();
    }
  });

/**
 * Arbitrary that generates any of the three supported keypair types.
 */
const anyKeypairArb: fc.Arbitrary<AnyKeypair> = fc.oneof(
  ed25519KeypairArb,
  secp256k1KeypairArb,
  secp256r1KeypairArb,
);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('PocSigner no-secret-leak invariant (R17.7)', () => {
  /**
   * Core property: JSON.stringify(signer) must not contain any byte of the
   * raw secret key as a hex or base64 string.
   *
   * **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
   */
  it('Property: JSON.stringify(signer) never contains secret bytes', async () => {
    await fc.assert(
      fc.asyncProperty(anyKeypairArb, async (kp) => {
        setupMocksForKeypair(kp);
        const secret = extractSecret(kp);
        const { signer } = await detectLocalSigner();

        const serialized = JSON.stringify(signer);
        expect(containsSecretBytes(serialized, secret)).toBe(false);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property: String(signer) must not contain any byte of the raw secret key.
   *
   * **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
   */
  it('Property: String(signer) never contains secret bytes', async () => {
    await fc.assert(
      fc.asyncProperty(anyKeypairArb, async (kp) => {
        setupMocksForKeypair(kp);
        const secret = extractSecret(kp);
        const { signer } = await detectLocalSigner();

        const serialized = String(signer);
        expect(containsSecretBytes(serialized, secret)).toBe(false);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property: util.inspect(signer, { depth: null }) must not contain any byte
   * of the raw secret key.
   *
   * **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
   */
  it('Property: util.inspect(signer) never contains secret bytes', async () => {
    await fc.assert(
      fc.asyncProperty(anyKeypairArb, async (kp) => {
        setupMocksForKeypair(kp);
        const secret = extractSecret(kp);
        const { signer } = await detectLocalSigner();

        const serialized = inspect(signer, { depth: null });
        expect(containsSecretBytes(serialized, secret)).toBe(false);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property: Object.keys(signer).join(',') must not contain any byte of the
   * raw secret key.
   *
   * **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
   */
  it('Property: Object.keys(signer) enumeration never contains secret bytes', async () => {
    await fc.assert(
      fc.asyncProperty(anyKeypairArb, async (kp) => {
        setupMocksForKeypair(kp);
        const secret = extractSecret(kp);
        const { signer } = await detectLocalSigner();

        const keyList = Object.keys(signer).join(',');
        expect(containsSecretBytes(keyList, secret)).toBe(false);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Combined property: all four serialization paths simultaneously must not
   * leak secret bytes for any randomly generated keypair.
   *
   * **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
   */
  it('Property: all serialization paths simultaneously never contain secret bytes', async () => {
    await fc.assert(
      fc.asyncProperty(anyKeypairArb, async (kp) => {
        setupMocksForKeypair(kp);
        const secret = extractSecret(kp);
        const { signer } = await detectLocalSigner();

        const paths = [
          JSON.stringify(signer),
          String(signer),
          inspect(signer, { depth: null }),
          Object.keys(signer).join(','),
        ];

        for (const serialized of paths) {
          expect(containsSecretBytes(serialized, secret)).toBe(false);
        }
      }),
      { numRuns: 15 },
    );
  });

  /**
   * Property: the PocSigner object has no enumerable properties whose names
   * suggest secret material (secret, private, key, seed, keystore).
   *
   * **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
   */
  it('Property: PocSigner has no enumerable secret-named properties', async () => {
    await fc.assert(
      fc.asyncProperty(anyKeypairArb, async (kp) => {
        setupMocksForKeypair(kp);
        const { signer } = await detectLocalSigner();

        const keys = Object.keys(signer);
        // These patterns indicate raw secret storage — not legitimate method names like getPublicKey
        const forbiddenPatterns = ['secret', 'privatekey', 'keystore', 'seed', 'rawkey'];
        for (const pattern of forbiddenPatterns) {
          const found = keys.filter((k) => k.toLowerCase().replace(/[^a-z]/g, '').includes(pattern));
          expect(found).toHaveLength(0);
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property: the PocSigner is frozen — no new properties can be added that
   * might later expose secret material.
   *
   * **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
   */
  it('Property: PocSigner is always frozen (immutable)', async () => {
    await fc.assert(
      fc.asyncProperty(anyKeypairArb, async (kp) => {
        setupMocksForKeypair(kp);
        const { signer } = await detectLocalSigner();

        expect(Object.isFrozen(signer)).toBe(true);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property: the public key returned by getPublicKey() does NOT equal the
   * secret key — confirming the signer exposes only the public portion.
   *
   * **Validates: Requirements R3.7, R17.7 (plaintext-leak precondition)**
   */
  it('Property: getPublicKey() does not return the secret key bytes', async () => {
    await fc.assert(
      fc.asyncProperty(ed25519KeypairArb, async (kp) => {
        setupMocksForKeypair(kp);
        const secret = extractSecret(kp);
        const { signer } = await detectLocalSigner();

        const pubKey = signer.getPublicKey();
        // Public key must not equal the secret key
        const pubKeyBytes = pubKey.toRawBytes();
        expect(Buffer.from(pubKeyBytes).equals(Buffer.from(secret))).toBe(false);
      }),
      { numRuns: 10 },
    );
  });
});
