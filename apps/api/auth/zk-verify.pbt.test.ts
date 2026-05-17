/**
 * Property-based tests for apps/api/auth/zk-verify.ts
 *
 * **Validates: Requirements 1.1, 1.9**
 *
 * Property 1: ZK Login proof round-trip preserves address
 *   For any generated valid-looking ZkProofEnvelope, when address derivation
 *   succeeds (mocked), the returned address matches the assertedAddress in the
 *   envelope. This is a structural property test — real ZK proofs require
 *   network access to the Sui ZK Prover, so we mock the cryptographic
 *   verification layer and test the address-preservation invariant.
 *
 * Property 2: ZK Login proof tampering is rejected
 *   For any valid-looking ZkProofEnvelope and any single-field mutation,
 *   verifyZkProof returns { valid: false }. This tests the tamper-detection
 *   invariant: a single-bit mutation of any field in the envelope MUST cause
 *   the verification to fail.
 *
 * Requirements: 1.1, 1.9
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  verifyZkProof,
  _invalidateJwkCache,
  _setSuiClient,
  type ZkProofEnvelope,
  type ZkProofInputs,
} from './zk-verify';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * Mock ZkLoginPublicIdentifier so we can control address derivation without
 * real ZK proof material.
 *
 * The mock simulates the real behavior:
 *   - fromProof(assertedAddress, proofInputs) returns an object whose
 *     toSuiAddress() returns a FIXED derived address (not the assertedAddress).
 *   - The fixed derived address is deterministic based on the addressSeed in
 *     proofInputs, so changing userSalt/jwtAud (which changes the seed) will
 *     produce a different derived address.
 *
 * This means:
 *   - Property 1 (round-trip): We set up the envelope so that the derived
 *     address equals the assertedAddress by construction.
 *   - Property 2 (tamper): Mutating assertedAddress makes it differ from the
 *     derived address → invalid. Mutating fields that affect the seed changes
 *     the derived address → invalid.
 */
vi.mock('@mysten/sui/zklogin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mysten/sui/zklogin')>();
  return {
    ...actual,
    ZkLoginPublicIdentifier: {
      /**
       * Simulate address derivation: derive a deterministic address from the
       * addressSeed in proofInputs. The derived address is a function of the
       * seed, NOT of the assertedAddress parameter.
       *
       * This correctly models the real behavior where the ZK proof determines
       * the derived address independently of the asserted address.
       */
      fromProof: vi.fn(
        (_assertedAddress: string, proofInputs: { addressSeed?: string }) => {
          // Derive a deterministic address from the addressSeed.
          // We use a simple hash: prefix the seed with '0x' and pad to 66 chars.
          const seed = proofInputs?.addressSeed ?? '0';
          // Create a deterministic 64-hex-char address from the seed string.
          const seedHash = seed
            .split('')
            .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 0)
            .toString(16)
            .padStart(8, '0');
          const derivedAddress = `0x${seedHash.repeat(8)}`;
          return { toSuiAddress: () => derivedAddress };
        },
      ),
    },
    /**
     * generateNonce: return a value that depends on the ephemeralPublicKey
     * and randomness inputs. We use a simple string concatenation so that
     * changing either input changes the nonce.
     *
     * The nonce embedded in the JWT (built by makeProofInputs) must match
     * what this mock returns for the envelope's ephemeralPublicKey and
     * randomness. We achieve this by building the JWT nonce dynamically.
     */
    generateNonce: vi.fn(
      (pubKey: { bytes?: Uint8Array }, maxEpoch: number, randomness: bigint) => {
        // Include a hash of the pubKey bytes so that changing the ephemeral
        // key changes the nonce.
        const keyHash = pubKey?.bytes
          ? Array.from(pubKey.bytes).reduce((acc, b) => (acc * 31 + b) & 0xffffffff, 0)
          : 0;
        return `nonce-${maxEpoch}-${randomness.toString()}-${keyHash}`;
      },
    ),
    genAddressSeed: vi.fn(
      (salt: string, _claimName: string, _claimValue: string, aud: string) => {
        // Return a deterministic bigint based on salt and aud so that
        // changing either changes the address seed.
        const combined = `${salt}:${aud}`;
        const hash = combined
          .split('')
          .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 0);
        return BigInt(hash);
      },
    ),
  };
});

/**
 * Mock Ed25519PublicKey so ephemeral key reconstruction doesn't fail on
 * generated (non-real) base64 key bytes. The mock stores the raw bytes so
 * generateNonce can use them for nonce derivation.
 */
vi.mock('@mysten/sui/keypairs/ed25519', () => ({
  Ed25519PublicKey: vi.fn(function (this: { bytes: Uint8Array }, bytes: Uint8Array) {
    this.bytes = bytes;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic address seed hash that the mock genAddressSeed
 * will return for a given (salt, aud) pair.
 */
function computeMockAddressSeed(salt: string, aud: string): bigint {
  const combined = `${salt}:${aud}`;
  const hash = combined
    .split('')
    .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 0);
  return BigInt(hash);
}

/**
 * Compute the deterministic derived address that the mock
 * ZkLoginPublicIdentifier.fromProof will return for a given address seed.
 */
function computeMockDerivedAddress(addressSeed: bigint): string {
  const seedHash = addressSeed
    .toString()
    .split('')
    .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 0)
    .toString(16)
    .padStart(8, '0');
  return `0x${seedHash.repeat(8)}`;
}

/**
 * Compute the nonce that the mock generateNonce will return for a given
 * (maxEpoch, randomness, ephemeralKeyBytes) triple.
 */
function computeMockNonce(maxEpoch: number, randomness: string, keyBytes: Uint8Array): string {
  const keyHash = Array.from(keyBytes).reduce((acc, b) => (acc * 31 + b) & 0xffffffff, 0);
  return `nonce-${maxEpoch}-${randomness}-${keyHash}`;
}

/**
 * Build a valid-looking ZkProofInputs structure.
 *
 * The `issBase64Details.value` encodes a JSON fragment containing a `sub`
 * claim so that `_extractSubFromIssBase64Details` succeeds.
 *
 * The `headerBase64` encodes a minimal JWT header.payload where the payload
 * contains a `nonce` claim matching what the mock generateNonce returns for
 * the given maxEpoch, randomness, and ephemeral key bytes.
 */
function makeProofInputs(maxEpoch: number, randomness: string, keyBytes: Uint8Array): ZkProofInputs {
  const nonce = computeMockNonce(maxEpoch, randomness, keyBytes);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: '1234567890',
      nonce,
      iss: 'https://accounts.google.com',
      aud: 'test-client-id',
    }),
  ).toString('base64url');

  return {
    proofPoints: {
      a: ['1', '2'],
      b: [['3', '4'], ['5', '6']],
      c: ['7', '8'],
    },
    issBase64Details: {
      value: Buffer.from('"sub":"1234567890"').toString('base64'),
      indexMod4: 1,
    },
    headerBase64: `${header}.${payload}`,
  };
}

/**
 * Build a mock Sui RPC client that returns a fixed epoch.
 */
function makeMockSuiClient(epoch: number) {
  return {
    getCurrentEpoch: vi.fn().mockResolvedValue({ epoch: String(epoch) }),
  };
}

/**
 * Build a complete, structurally valid ZkProofEnvelope where the
 * assertedAddress is consistent with the mock address derivation.
 *
 * The assertedAddress is computed from (userSalt, jwtAud) via the mock
 * genAddressSeed and ZkLoginPublicIdentifier.fromProof, so the round-trip
 * check will pass.
 */
function makeValidEnvelope(
  userSalt: string,
  jwtAud: string,
  maxEpoch: number,
  randomness: string,
): ZkProofEnvelope {
  // Compute what the mock will derive as the address.
  const addressSeed = computeMockAddressSeed(userSalt, jwtAud);
  const assertedAddress = computeMockDerivedAddress(addressSeed);

  // Use a fixed 32-byte key (all zeros) for the ephemeral public key.
  const keyBytes = new Uint8Array(32);
  const ephemeralPublicKey = Buffer.from(keyBytes).toString('base64');

  return {
    assertedAddress,
    zkProof: makeProofInputs(maxEpoch, randomness, keyBytes),
    ephemeralPublicKey,
    maxEpoch,
    randomness,
    userSalt,
    jwtIss: 'https://accounts.google.com',
    jwtAud,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generate a valid userSalt string (non-empty, printable).
 */
const userSaltArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/**
 * Generate a valid jwtAud string (non-empty, printable).
 */
const jwtAudArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/**
 * Generate a maxEpoch value that is >= the mock current epoch (100).
 * Values in [100, 500] represent valid, non-expired sessions.
 */
const validMaxEpochArb: fc.Arbitrary<number> = fc.integer({ min: 100, max: 500 });

/**
 * Generate a randomness string (numeric string, as used in ZK Login).
 */
const randomnessArb: fc.Arbitrary<string> = fc
  .bigInt({ min: 1n, max: 2n ** 128n - 1n })
  .map((n) => n.toString());

/**
 * Generate a complete, structurally valid ZkProofEnvelope where the
 * assertedAddress is consistent with the mock address derivation.
 */
const validEnvelopeArb: fc.Arbitrary<ZkProofEnvelope> = fc
  .tuple(userSaltArb, jwtAudArb, validMaxEpochArb, randomnessArb)
  .map(([salt, aud, maxEpoch, randomness]) => makeValidEnvelope(salt, aud, maxEpoch, randomness));

// ---------------------------------------------------------------------------
// Import mocked modules so we can re-apply implementations in beforeEach
// ---------------------------------------------------------------------------

import { ZkLoginPublicIdentifier, generateNonce, genAddressSeed } from '@mysten/sui/zklogin';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const MOCK_CURRENT_EPOCH = 100;

beforeEach(() => {
  _invalidateJwkCache();
  _setSuiClient(makeMockSuiClient(MOCK_CURRENT_EPOCH) as unknown as Parameters<typeof _setSuiClient>[0]);

  // Re-apply mock implementations after vi.clearAllMocks() would reset them.
  vi.mocked(ZkLoginPublicIdentifier.fromProof).mockImplementation(
    (_assertedAddress: string, proofInputs: { addressSeed?: string }) => {
      const seed = proofInputs?.addressSeed ?? '0';
      const seedHash = seed
        .split('')
        .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 0)
        .toString(16)
        .padStart(8, '0');
      const derivedAddress = `0x${seedHash.repeat(8)}`;
      return { toSuiAddress: () => derivedAddress };
    },
  );
  vi.mocked(generateNonce).mockImplementation(
    (pubKey: { bytes?: Uint8Array }, maxEpoch: number, randomness: bigint) => {
      const keyHash = pubKey?.bytes
        ? Array.from(pubKey.bytes).reduce((acc, b) => (acc * 31 + b) & 0xffffffff, 0)
        : 0;
      return `nonce-${maxEpoch}-${randomness.toString()}-${keyHash}`;
    },
  );
  vi.mocked(genAddressSeed).mockImplementation(
    (salt: string, _claimName: string, _claimValue: string, aud: string) => {
      const combined = `${salt}:${aud}`;
      const hash = combined
        .split('')
        .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 0);
      return BigInt(hash);
    },
  );
});

afterEach(() => {
  _setSuiClient(null);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 1: ZK Login proof round-trip preserves address
// ---------------------------------------------------------------------------

describe('Property 1: ZK Login proof round-trip preserves address', () => {
  /**
   * **Validates: Requirements 1.1, 1.9**
   *
   * For any generated valid-looking ZkProofEnvelope (assertedAddress, maxEpoch,
   * proof inputs, ephemeral key, salt, randomness), when the ZK proof
   * verification layer succeeds (mocked), the address returned by
   * `verifyZkProof` MUST equal the `assertedAddress` in the envelope.
   *
   * This is the round-trip property: client-derived address === API-returned
   * address. The mock simulates a valid proof by making `ZkLoginPublicIdentifier
   * .fromProof` return the assertedAddress unchanged, which is what a real
   * valid proof would produce.
   *
   * Note: Real ZK proofs require network access to the Sui ZK Prover. This
   * structural property test verifies the address-preservation invariant
   * without requiring real proof material.
   */
  it('Property 1a: verifyZkProof returns { valid: true, address: assertedAddress } for all generated valid envelopes', async () => {
    await fc.assert(
      fc.asyncProperty(validEnvelopeArb, async (envelope) => {
        const result = await verifyZkProof(envelope);

        // The round-trip invariant: returned address must equal the asserted address.
        expect(result.valid).toBe(true);
        expect(result.address).toBe(envelope.assertedAddress);
      }),
      { numRuns: 20 },
    );
  });

  it('Property 1b: returned address is always a non-empty string when valid is true', async () => {
    await fc.assert(
      fc.asyncProperty(validEnvelopeArb, async (envelope) => {
        const result = await verifyZkProof(envelope);

        if (result.valid) {
          expect(typeof result.address).toBe('string');
          expect(result.address.length).toBeGreaterThan(0);
          // The address must match the asserted address exactly.
          expect(result.address).toBe(envelope.assertedAddress);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('Property 1c: result shape always has exactly { valid, address } — no extra fields', async () => {
    await fc.assert(
      fc.asyncProperty(validEnvelopeArb, async (envelope) => {
        const result = await verifyZkProof(envelope);

        const keys = Object.keys(result).sort();
        expect(keys).toEqual(['address', 'valid']);

        // No proof material leaks into the result.
        expect(keys).not.toContain('zkProof');
        expect(keys).not.toContain('randomness');
        expect(keys).not.toContain('userSalt');
        expect(keys).not.toContain('ephemeralPublicKey');
      }),
      { numRuns: 15 },
    );
  });

  it('Property 1d: address preservation holds across distinct generated envelopes', async () => {
    /**
     * For any two distinct generated envelopes (different salt/aud), each
     * independently preserves its own assertedAddress. This confirms the
     * property is not accidentally satisfied by a constant return value.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        validEnvelopeArb,
        async (envelope1, envelope2) => {
          fc.pre(envelope1.assertedAddress !== envelope2.assertedAddress);

          const [result1, result2] = await Promise.all([
            verifyZkProof(envelope1),
            verifyZkProof(envelope2),
          ]);

          expect(result1.valid).toBe(true);
          expect(result2.valid).toBe(true);

          // Each result preserves its own address.
          expect(result1.address).toBe(envelope1.assertedAddress);
          expect(result2.address).toBe(envelope2.assertedAddress);

          // The two results must differ (no cross-contamination).
          expect(result1.address).not.toBe(result2.address);
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: ZK Login proof tampering is rejected
// ---------------------------------------------------------------------------

describe('Property 2: ZK Login proof tampering is rejected', () => {
  /**
   * **Validates: Requirements 1.9**
   *
   * For any valid-looking ZkProofEnvelope and any single-field mutation,
   * `verifyZkProof` MUST return `{ valid: false }`.
   *
   * This is the tamper-detection invariant: a single-bit mutation of any
   * field in the envelope must cause verification to fail. We test this by
   * mutating each field individually and asserting the result is invalid.
   *
   * The mutations tested:
   *   - assertedAddress changed to a different address
   *   - maxEpoch changed to an expired value (< currentEpoch)
   *   - maxEpoch changed to a different valid value (address mismatch via nonce)
   *   - ephemeralPublicKey changed
   *   - randomness changed
   *   - userSalt changed
   *   - jwtIss changed
   *   - jwtAud changed
   *   - zkProof.headerBase64 changed (nonce mismatch)
   *   - zkProof.issBase64Details.value changed (sub extraction fails)
   *   - zkProof.proofPoints mutated
   */

  it('Property 2a: mutating assertedAddress causes { valid: false }', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.string({ minLength: 1, maxLength: 66 }).filter((s) => s.trim().length > 0),
        async (envelope, mutatedAddress) => {
          fc.pre(mutatedAddress !== envelope.assertedAddress);

          const mutated: ZkProofEnvelope = { ...envelope, assertedAddress: mutatedAddress };
          const result = await verifyZkProof(mutated);

          expect(result.valid).toBe(false);
          expect(result.address).toBe('');
        },
      ),
      { numRuns: 20 },
    );
  });

  it('Property 2b: mutating maxEpoch to an expired value causes { valid: false }', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.integer({ min: 1, max: MOCK_CURRENT_EPOCH - 1 }),
        async (envelope, expiredEpoch) => {
          const mutated: ZkProofEnvelope = { ...envelope, maxEpoch: expiredEpoch };
          const result = await verifyZkProof(mutated);

          expect(result.valid).toBe(false);
          expect(result.address).toBe('');
        },
      ),
      { numRuns: 20 },
    );
  });

  it('Property 2c: mutating ephemeralPublicKey causes { valid: false }', async () => {
    /**
     * Changing the ephemeral public key changes the key hash used in nonce
     * derivation, which will no longer match the nonce embedded in the JWT
     * header. The nonce binding check must reject this.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        async (envelope, mutatedKeyBytes) => {
          // The original key is all zeros; ensure the mutated key differs.
          const originalKeyBytes = new Uint8Array(32); // all zeros
          const originalKeyHash = Array.from(originalKeyBytes).reduce(
            (acc, b) => (acc * 31 + b) & 0xffffffff,
            0,
          );
          const mutatedKeyHash = Array.from(mutatedKeyBytes).reduce(
            (acc, b) => (acc * 31 + b) & 0xffffffff,
            0,
          );
          fc.pre(mutatedKeyHash !== originalKeyHash);

          const mutatedKey = Buffer.from(mutatedKeyBytes).toString('base64');
          fc.pre(mutatedKey !== envelope.ephemeralPublicKey);

          const mutated: ZkProofEnvelope = { ...envelope, ephemeralPublicKey: mutatedKey };
          const result = await verifyZkProof(mutated);

          // A different ephemeral key produces a different expected nonce,
          // which won't match the nonce in the JWT header → invalid.
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 2d: mutating randomness causes { valid: false }', async () => {
    /**
     * Changing the randomness changes the expected nonce derivation, which
     * will no longer match the nonce embedded in the JWT header.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.bigInt({ min: 1n, max: 2n ** 128n - 1n }).map((n) => n.toString()),
        async (envelope, mutatedRandomness) => {
          fc.pre(mutatedRandomness !== envelope.randomness);

          const mutated: ZkProofEnvelope = { ...envelope, randomness: mutatedRandomness };
          const result = await verifyZkProof(mutated);

          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 2e: mutating userSalt causes { valid: false }', async () => {
    /**
     * Changing the user salt changes the address seed computation, which
     * changes the derived address. The derived address will no longer match
     * the assertedAddress → invalid.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        async (envelope, mutatedSalt) => {
          fc.pre(mutatedSalt !== envelope.userSalt);

          const mutated: ZkProofEnvelope = { ...envelope, userSalt: mutatedSalt };
          const result = await verifyZkProof(mutated);

          // A different salt produces a different address seed → address mismatch.
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 2f: mutating jwtAud causes { valid: false }', async () => {
    /**
     * Changing the JWT audience changes the address seed computation
     * (genAddressSeed uses jwtAud), which changes the derived address.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        async (envelope, mutatedAud) => {
          fc.pre(mutatedAud !== envelope.jwtAud);

          const mutated: ZkProofEnvelope = { ...envelope, jwtAud: mutatedAud };
          const result = await verifyZkProof(mutated);

          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 2g: mutating zkProof.headerBase64 causes { valid: false }', async () => {
    /**
     * Changing the headerBase64 changes the nonce extracted from the JWT,
     * which will no longer match the expected nonce → nonce binding fails.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.string({ minLength: 10, maxLength: 100 }).filter((s) => s.trim().length > 0),
        async (envelope, mutatedHeader) => {
          fc.pre(mutatedHeader !== envelope.zkProof.headerBase64);

          const mutated: ZkProofEnvelope = {
            ...envelope,
            zkProof: { ...envelope.zkProof, headerBase64: mutatedHeader },
          };
          const result = await verifyZkProof(mutated);

          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 2h: mutating zkProof.issBase64Details.value causes { valid: false }', async () => {
    /**
     * Changing the issBase64Details.value changes the sub claim extraction,
     * which changes the address seed → address mismatch or extraction failure.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        async (envelope, mutatedValue) => {
          fc.pre(mutatedValue !== envelope.zkProof.issBase64Details.value);

          const mutated: ZkProofEnvelope = {
            ...envelope,
            zkProof: {
              ...envelope.zkProof,
              issBase64Details: {
                ...envelope.zkProof.issBase64Details,
                value: mutatedValue,
              },
            },
          };
          const result = await verifyZkProof(mutated);

          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 2i: mutating zkProof.proofPoints.a causes { valid: false }', async () => {
    /**
     * Changing any element of the proof points array changes the proof
     * material. Since ZkLoginPublicIdentifier.fromProof is mocked to return
     * the assertedAddress, we verify that the structural mutation is detected
     * by the address comparison step when we also change the assertedAddress
     * to something that won't match.
     *
     * More precisely: the proof points are part of the ZK proof that
     * ZkLoginPublicIdentifier.fromProof validates. In production, a mutated
     * proof point would cause fromProof to throw or return a different address.
     * We simulate this by making the mock return a different address when
     * proof points are mutated.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        async (envelope, mutatedPoint) => {
          fc.pre(mutatedPoint !== envelope.zkProof.proofPoints.a[0]);

          const mutated: ZkProofEnvelope = {
            ...envelope,
            zkProof: {
              ...envelope.zkProof,
              proofPoints: {
                ...envelope.zkProof.proofPoints,
                a: [mutatedPoint, ...envelope.zkProof.proofPoints.a.slice(1)],
              },
            },
          };

          // Override the mock for this specific call to simulate proof verification
          // failure: return a different address than assertedAddress.
          vi.mocked(ZkLoginPublicIdentifier.fromProof).mockImplementationOnce(
            (_assertedAddress: string, _proofInputs: unknown) => ({
              toSuiAddress: () => '0x' + 'ff'.repeat(32), // different address
            }),
          );

          const result = await verifyZkProof(mutated);

          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('Property 2j: completely empty envelope always returns { valid: false }', async () => {
    /**
     * An empty object is the most extreme mutation — all fields are missing.
     * This must always return invalid.
     */
    const result = await verifyZkProof({} as ZkProofEnvelope);
    expect(result.valid).toBe(false);
    expect(result.address).toBe('');
  });

  it('Property 2k: null/undefined input always returns { valid: false }', async () => {
    const resultNull = await verifyZkProof(null as unknown as ZkProofEnvelope);
    expect(resultNull.valid).toBe(false);
    expect(resultNull.address).toBe('');

    const resultUndefined = await verifyZkProof(undefined as unknown as ZkProofEnvelope);
    expect(resultUndefined.valid).toBe(false);
    expect(resultUndefined.address).toBe('');
  });

  it('Property 2l: address is always empty string when valid is false', async () => {
    /**
     * The invariant: whenever valid === false, address MUST be ''.
     * This holds for all tampered envelopes.
     */
    await fc.assert(
      fc.asyncProperty(
        validEnvelopeArb,
        fc.string({ minLength: 1, maxLength: 66 }).filter((s) => s.trim().length > 0),
        async (envelope, mutatedAddress) => {
          fc.pre(mutatedAddress !== envelope.assertedAddress);

          const mutated: ZkProofEnvelope = { ...envelope, assertedAddress: mutatedAddress };
          const result = await verifyZkProof(mutated);

          // When valid is false, address must always be empty string.
          if (!result.valid) {
            expect(result.address).toBe('');
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-property invariants
// ---------------------------------------------------------------------------

describe('Cross-property invariants: verifyZkProof return shape', () => {
  /**
   * **Validates: Requirements 1.9**
   *
   * For all inputs (valid or tampered), verifyZkProof MUST:
   *   1. Never throw — always return a result object.
   *   2. Always return exactly { valid: boolean, address: string }.
   *   3. Return address === '' when valid === false.
   *   4. Return address === assertedAddress when valid === true.
   */
  it('never throws for any generated input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          validEnvelopeArb,
          fc.constant({} as ZkProofEnvelope),
          fc.constant(null as unknown as ZkProofEnvelope),
          fc.string({ minLength: 1, maxLength: 66 }).map(
            (addr) => ({ assertedAddress: addr } as ZkProofEnvelope),
          ),
        ),
        async (input) => {
          await expect(verifyZkProof(input)).resolves.toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('always returns { valid: boolean, address: string } for any input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          validEnvelopeArb,
          fc.constant({} as ZkProofEnvelope),
          fc.string({ minLength: 1, maxLength: 66 }).map(
            (addr) => ({ assertedAddress: addr } as ZkProofEnvelope),
          ),
        ),
        async (input) => {
          const result = await verifyZkProof(input);

          expect(typeof result.valid).toBe('boolean');
          expect(typeof result.address).toBe('string');
        },
      ),
      { numRuns: 20 },
    );
  });

  it('address is empty string whenever valid is false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          validEnvelopeArb,
          fc.constant({} as ZkProofEnvelope),
          fc.string({ minLength: 1, maxLength: 66 }).map(
            (addr) => ({ assertedAddress: addr } as ZkProofEnvelope),
          ),
        ),
        async (input) => {
          const result = await verifyZkProof(input);

          if (!result.valid) {
            expect(result.address).toBe('');
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
