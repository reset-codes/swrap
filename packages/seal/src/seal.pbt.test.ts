// packages/seal/src/seal.pbt.test.ts
//
// Property-based tests for Seal_Encryptor + Seal_Decryptor (Plan B fallback).
//
// **Validates: Requirements R7.3, R7.4, R7.5, R8.5, R17.3, R17.8, R17.9**
//
// Three properties are tested:
//   Property 3 (R17.3): decrypt(encrypt(p, signer, 'form'), signer) == p  (round-trip)
//   Property 8 (R17.8): encrypt(p, signer, 'form') does NOT contain p as a contiguous substring
//   Property 9 (R17.9): decrypt(encrypt(p, O, 'form'), O') throws SealAuthError for O != O'

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { hkdfSync } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { encrypt } from './encryptor';
import { decrypt, SealAuthError } from './decryptor';
import type { PocSigner } from '@poc/sui';

// ---------------------------------------------------------------------------
// Test signer factory
// ---------------------------------------------------------------------------

/**
 * Build a PocSigner directly from an Ed25519Keypair, without touching the
 * filesystem. Mirrors the wrapKeypair logic in signer-detector.ts.
 */
function makeTestSigner(keypair: Ed25519Keypair): PocSigner {
  const secret = decodeSuiPrivateKey(keypair.getSecretKey()).secretKey;
  // Defensive copy so the keypair's internal buffer cannot be mutated
  const secretCopy = new Uint8Array(secret);

  return Object.freeze({
    scheme: 'ed25519' as const,
    address: keypair.toSuiAddress(),
    getPublicKey: () => keypair.getPublicKey().toRawBytes(),
    signPersonalMessage: (bytes: Uint8Array) => keypair.signPersonalMessage(bytes),
    signTransaction: (txBytes: Uint8Array) => keypair.signTransaction(txBytes),
    deriveSymmetricKey: (salt: Uint8Array, info: Uint8Array): Uint8Array => {
      const derived = hkdfSync('sha256', secretCopy, salt, info, 32);
      return new Uint8Array(derived);
    },
  } satisfies PocSigner);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary for non-empty plaintext bytes (up to 64 KiB for test speed).
 */
const plaintextArb = fc.uint8Array({ minLength: 1, maxLength: 65536 });

/**
 * Arbitrary that generates a PocSigner from a random 32-byte seed.
 * Ed25519 accepts any 32-byte value as a secret key.
 */
const signerArb: fc.Arbitrary<PocSigner> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((seed) => {
    try {
      return makeTestSigner(Ed25519Keypair.fromSecretKey(seed));
    } catch {
      // Fallback for any edge-case seed that the library rejects
      return makeTestSigner(Ed25519Keypair.generate());
    }
  });

/**
 * Arbitrary that generates a pair of DISTINCT signers (different addresses).
 * We filter out the (astronomically unlikely) case where two random seeds
 * produce the same Sui address.
 */
const distinctSignerPairArb: fc.Arbitrary<[PocSigner, PocSigner]> = fc
  .tuple(
    fc.uint8Array({ minLength: 32, maxLength: 32 }),
    fc.uint8Array({ minLength: 32, maxLength: 32 }),
  )
  .filter(([seedA, seedB]) => {
    // Ensure the two seeds are different (byte-level) to guarantee distinct keys
    return !seedA.every((b, i) => b === seedB[i]);
  })
  .map(([seedA, seedB]) => {
    const signerA = (() => {
      try {
        return makeTestSigner(Ed25519Keypair.fromSecretKey(seedA));
      } catch {
        return makeTestSigner(Ed25519Keypair.generate());
      }
    })();
    const signerB = (() => {
      try {
        return makeTestSigner(Ed25519Keypair.fromSecretKey(seedB));
      } catch {
        return makeTestSigner(Ed25519Keypair.generate());
      }
    })();
    return [signerA, signerB] as [PocSigner, PocSigner];
  })
  .filter(([a, b]) => a.address !== b.address);

// ---------------------------------------------------------------------------
// Helper: check if `needle` appears as a contiguous byte substring of `haystack`
// ---------------------------------------------------------------------------

function containsSubarray(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;

  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Seal encrypt/decrypt property-based tests', () => {
  /**
   * Property 3 (R17.3): decrypt(encrypt(p, signer, 'form'), signer) == p
   *
   * For any non-empty plaintext p and any signer, the round-trip must
   * produce byte-identical output.
   *
   * **Validates: Requirements R7.3, R7.5, R17.3**
   */
  it('Property 3: decrypt(encrypt(p, signer, form), signer) deep-equals p', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArb, signerArb, async (plaintext, signer) => {
        const ciphertext = await encrypt(plaintext, signer, 'form');
        const recovered = await decrypt(ciphertext, signer);

        // Byte-for-byte equality
        if (recovered.length !== plaintext.length) return false;
        for (let i = 0; i < plaintext.length; i++) {
          if (recovered[i] !== plaintext[i]) return false;
        }
        return true;
      }),
      { numRuns: 50 },
    );
  });

  /**
   * Property 8 (R17.8 / R7.4 / R8.5): public-unreadability
   *
   * The encrypted blob must NOT contain the plaintext as a contiguous
   * byte substring. This ensures the ciphertext leaks no raw plaintext.
   *
   * **Validates: Requirements R7.4, R8.5, R17.8**
   */
  it('Property 8: encrypt(p, signer, form) does NOT contain p as a contiguous substring', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArb, signerArb, async (plaintext, signer) => {
        const ciphertext = await encrypt(plaintext, signer, 'form');

        // The encrypted blob must not contain the plaintext verbatim.
        // We only check plaintexts of length >= 4 to avoid trivially-short
        // sequences that could appear by coincidence in the header.
        if (plaintext.length < 4) return true; // skip trivially short inputs

        return !containsSubarray(ciphertext, plaintext);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * Property 9 (R17.9): owner-only decryption
   *
   * Decrypting a blob encrypted for owner O with a different signer O'
   * MUST throw SealAuthError and MUST NOT return any plaintext bytes.
   *
   * **Validates: Requirements R7.5, R17.9**
   */
  it('Property 9: decrypt(encrypt(p, O, form), O-prime) throws SealAuthError', async () => {
    await fc.assert(
      fc.asyncProperty(
        plaintextArb,
        distinctSignerPairArb,
        async (plaintext, [signerO, signerOPrime]) => {
          const ciphertext = await encrypt(plaintext, signerO, 'form');

          let threw = false;
          let errorWasSealAuthError = false;

          try {
            await decrypt(ciphertext, signerOPrime);
          } catch (err) {
            threw = true;
            errorWasSealAuthError = err instanceof SealAuthError;
          }

          // Must have thrown, and the error must be SealAuthError
          return threw && errorWasSealAuthError;
        },
      ),
      { numRuns: 50 },
    );
  });
});
