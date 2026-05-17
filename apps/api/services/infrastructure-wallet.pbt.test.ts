/**
 * Property-based tests for apps/api/services/infrastructure-wallet.ts
 *
 * **Validates: Requirements 2.2, 2.3, 4.3**
 *
 * Property 7:  Seal encryption round-trip
 *              sealDecrypt(sealEncrypt(p, policy(s)), infra_wallet) deep-equals p
 *
 * Property 8:  Seal encryption is non-deterministic but functionally invariant
 *              Two encryptions of the same payload produce different ciphertexts,
 *              but both decrypt correctly to the original plaintext.
 *
 * Property 9:  Seal encryption output structure and digest correctness
 *              Returned tuple has non-empty ciphertext, non-empty policyId, and
 *              digest == SHA-256(ciphertext).
 *
 * Property 10: Seal_Policy authorizes the Form_Owner
 *              policyId resolves to a policy whose authorized signer set contains
 *              the form owner address.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Test keypair — generated once, reused across all tests
// ---------------------------------------------------------------------------

const TEST_KEYPAIR = new Ed25519Keypair();
const TEST_SECRET_BECH32 = TEST_KEYPAIR.getSecretKey();

// ---------------------------------------------------------------------------
// Mock state — allows per-test control of encrypt/decrypt behaviour
// ---------------------------------------------------------------------------

/**
 * The mock Seal SDK simulates non-deterministic encryption by XOR-ing the
 * plaintext with a random nonce prefix. This means:
 *   - Two calls with the same plaintext produce different ciphertexts (Property 8).
 *   - The mock decrypt reverses the XOR so the round-trip holds (Property 7).
 *
 * Ciphertext layout: [nonce (4 bytes)] ++ [plaintext XOR nonce[i % 4]]
 */

// Track which policyId was used during the most recent encrypt call so
// Property 10 can assert it equals the policyOwnerAddress.
let lastEncryptedPolicyId: string | null = null;

// Track all encrypt calls for Property 8 (non-determinism check).
const encryptCallArgs: Array<{ data: Uint8Array; id: string }> = [];

vi.mock('@mysten/seal', () => {
  function mockEncrypt(data: Uint8Array, id: string): Uint8Array {
    // Record the call for Property 10 assertions.
    lastEncryptedPolicyId = id;
    encryptCallArgs.push({ data: new Uint8Array(data), id });

    // Non-deterministic: generate a fresh 4-byte nonce each call.
    const nonce = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      nonce[i] = Math.floor(Math.random() * 256);
    }

    // Ciphertext = nonce ++ (data XOR nonce[i % 4])
    const ct = new Uint8Array(4 + data.length);
    ct.set(nonce, 0);
    for (let i = 0; i < data.length; i++) {
      ct[4 + i] = data[i] ^ nonce[i % 4];
    }
    return ct;
  }

  function mockDecrypt(ciphertext: Uint8Array): Uint8Array {
    if (ciphertext.length < 4) {
      throw new Error('mock: ciphertext too short');
    }
    const nonce = ciphertext.slice(0, 4);
    const body = ciphertext.slice(4);
    const plain = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) {
      plain[i] = body[i] ^ nonce[i % 4];
    }
    return plain;
  }

  function MockSealClient(this: any) {
    this.encrypt = vi.fn().mockImplementation(
      ({ data, id }: { data: Uint8Array; id: string }) => {
        return Promise.resolve({ encryptedObject: mockEncrypt(data, id) });
      },
    );
    this.decrypt = vi.fn().mockImplementation(
      ({ data }: { data: Uint8Array }) => {
        return Promise.resolve(mockDecrypt(data));
      },
    );
  }

  return {
    SealClient: vi.fn(function (this: any) {
      return new (MockSealClient as any)();
    }),
    SessionKey: {
      create: vi.fn().mockResolvedValue({ getAddress: () => '0x' + 'ab'.repeat(32) }),
    },
  };
});

vi.mock('@mysten/sui/grpc', () => {
  function MockSuiGrpcClient(this: any) {}
  return {
    SuiGrpcClient: vi.fn(function (this: any) {
      return new (MockSuiGrpcClient as any)();
    }),
  };
});

vi.mock('@mysten/sui/transactions', () => {
  function MockTransaction(this: any) {
    this.moveCall = vi.fn();
    this.setSender = vi.fn();
    this.pure = { vector: vi.fn().mockReturnValue('mock-arg') };
    this.build = vi.fn().mockResolvedValue(new Uint8Array([0x01, 0x02]));
  }
  return {
    Transaction: vi.fn(function (this: any) {
      return new (MockTransaction as any)();
    }),
  };
});

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import { sealEncrypt, sealDecrypt } from './infrastructure-wallet';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/**
 * Arbitrary: non-empty Uint8Array of 1–256 bytes.
 * Represents a Submission_Payload that has been UTF-8 encoded.
 */
const plaintextArb: fc.Arbitrary<Uint8Array> = fc
  .uint8Array({ minLength: 1, maxLength: 256 })
  .filter((arr) => arr.length > 0);

/**
 * Arbitrary: a valid-looking Sui address (0x-prefixed, 64 hex chars).
 * Represents a Form_Owner Authorization_Identity address.
 */
const suiAddressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/)
  .map((hex) => `0x${hex}`);

// ---------------------------------------------------------------------------
// Environment setup / teardown
// ---------------------------------------------------------------------------

const ORIGINAL_WALLET_SECRET = process.env.INFRASTRUCTURE_WALLET_SECRET;
const ORIGINAL_PACKAGE_ID = process.env.SUI_POC_PACKAGE_ID;

beforeEach(() => {
  setEnv('INFRASTRUCTURE_WALLET_SECRET', TEST_SECRET_BECH32);
  setEnv('SUI_POC_PACKAGE_ID', '0x' + '12'.repeat(32));
  lastEncryptedPolicyId = null;
  encryptCallArgs.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  setEnv('INFRASTRUCTURE_WALLET_SECRET', ORIGINAL_WALLET_SECRET);
  setEnv('SUI_POC_PACKAGE_ID', ORIGINAL_PACKAGE_ID);
});

// ---------------------------------------------------------------------------
// Property 7: Seal encryption round-trip
// ---------------------------------------------------------------------------

describe('Property 7: Seal encryption round-trip', () => {
  /**
   * **Validates: Requirements 2.2, 2.3**
   *
   * For all generated plaintext payloads `p` and all generated authorized
   * Form_Owner addresses `s`:
   *
   *   sealDecrypt(sealEncrypt(p, policy(s)), infra_wallet) deep-equals p
   *
   * This is the core correctness invariant for the managed encryption authority:
   * the Infrastructure_Wallet must be able to recover the original plaintext
   * from any ciphertext it produced.
   */
  it('Property 7: decrypt(encrypt(p, s)) deep-equals p for all generated payloads and addresses', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArb, suiAddressArb, async (plaintext, ownerAddress) => {
        // Keep a copy of the original bytes before sealEncrypt zeroes the buffer.
        const original = new Uint8Array(plaintext);

        const { ciphertext, policyId } = await sealEncrypt(plaintext, ownerAddress);

        const recovered = await sealDecrypt(ciphertext, policyId);

        // Deep equality: every byte must match.
        expect(recovered).toEqual(original);
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Non-deterministic encryption, functionally invariant
// ---------------------------------------------------------------------------

describe('Property 8: Seal encryption is non-deterministic but functionally invariant', () => {
  /**
   * **Validates: Requirements 2.2, 2.3**
   *
   * For all generated plaintext payloads `p` and Form_Owner addresses `s`:
   *   1. Two independent encryptions of `p` produce different ciphertexts.
   *   2. Both ciphertexts decrypt correctly to `p`.
   *
   * Non-determinism is a security property: identical plaintexts must not
   * produce identical ciphertexts (prevents ciphertext equality attacks).
   * Functional invariance ensures both ciphertexts are usable.
   */
  it('Property 8: two encryptions of the same payload produce different ciphertexts, both decrypt correctly', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArb, suiAddressArb, async (plaintext, ownerAddress) => {
        const original = new Uint8Array(plaintext);

        // First encryption — sealEncrypt zeroes the buffer, so we need a fresh copy.
        const copy1 = new Uint8Array(original);
        const result1 = await sealEncrypt(copy1, ownerAddress);

        // Second encryption — fresh copy of the same plaintext.
        const copy2 = new Uint8Array(original);
        const result2 = await sealEncrypt(copy2, ownerAddress);

        // 8a: The two ciphertexts must differ (non-determinism).
        // Note: for single-byte payloads the nonce space is large enough that
        // collisions are astronomically unlikely; we assert inequality.
        expect(result1.ciphertext).not.toEqual(result2.ciphertext);

        // 8b: Both ciphertexts must decrypt to the original plaintext.
        const recovered1 = await sealDecrypt(result1.ciphertext, result1.policyId);
        const recovered2 = await sealDecrypt(result2.ciphertext, result2.policyId);

        expect(recovered1).toEqual(original);
        expect(recovered2).toEqual(original);
      }),
      { numRuns: 8 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Output structure and digest correctness
// ---------------------------------------------------------------------------

describe('Property 9: Seal encryption output structure and digest correctness', () => {
  /**
   * **Validates: Requirements 2.3, 2.4**
   *
   * For all generated plaintext payloads `p` and Form_Owner addresses `s`,
   * the tuple returned by sealEncrypt must satisfy:
   *   - ciphertext is a non-empty Uint8Array
   *   - policyId is a non-empty string
   *   - digest === SHA-256(ciphertext) (hex-encoded, 64 chars)
   *
   * The digest is stored in Postgres metadata for integrity verification at
   * retrieval time (Requirement 2.4 / 3.7).
   */
  it('Property 9: returned tuple has non-empty ciphertext, non-empty policyId, and digest == SHA-256(ciphertext)', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArb, suiAddressArb, async (plaintext, ownerAddress) => {
        const { ciphertext, policyId, digest } = await sealEncrypt(plaintext, ownerAddress);

        // 9a: ciphertext must be a non-empty Uint8Array.
        expect(ciphertext).toBeInstanceOf(Uint8Array);
        expect(ciphertext.length).toBeGreaterThan(0);

        // 9b: policyId must be a non-empty string.
        expect(typeof policyId).toBe('string');
        expect(policyId.length).toBeGreaterThan(0);

        // 9c: digest must equal SHA-256(ciphertext), hex-encoded.
        const expectedDigest = sha256Hex(ciphertext);
        expect(digest).toBe(expectedDigest);

        // 9d: digest must be a 64-character lowercase hex string (SHA-256).
        expect(digest).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Seal_Policy authorizes the Form_Owner
// ---------------------------------------------------------------------------

describe('Property 10: Seal_Policy authorizes the Form_Owner', () => {
  /**
   * **Validates: Requirements 2.3, 4.3**
   *
   * For all generated Form_Owner addresses `s`:
   *   policyId returned by sealEncrypt(p, s) resolves to a policy whose
   *   authorized signer set contains `s`.
   *
   * In the current implementation the policyId IS the Form_Owner address
   * (the Seal IBE identity is bound to the owner address). This property
   * asserts that invariant holds for all generated addresses, ensuring that
   * the Infrastructure_Wallet always creates owner-bound policies.
   *
   * Concretely: policyId === ownerAddress (the authorized signer set is
   * {ownerAddress}, and the policyId encodes that identity).
   */
  it('Property 10: policyId returned by sealEncrypt equals the Form_Owner address for all generated addresses', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArb, suiAddressArb, async (plaintext, ownerAddress) => {
        const { policyId } = await sealEncrypt(plaintext, ownerAddress);

        // The policyId must equal the Form_Owner address so that the policy's
        // authorized signer set contains the owner.
        expect(policyId).toBe(ownerAddress);

        // Additionally verify that the policyId passed to the Seal SDK during
        // encryption matches the ownerAddress (the mock records this).
        expect(lastEncryptedPolicyId).toBe(ownerAddress);
      }),
      { numRuns: 10 },
    );
  });

  it('Property 10: policyId is distinct for distinct Form_Owner addresses', async () => {
    /**
     * Two different Form_Owner addresses must produce two different policyIds,
     * ensuring policies are owner-scoped and not shared across owners.
     */
    await fc.assert(
      fc.asyncProperty(
        plaintextArb,
        suiAddressArb,
        suiAddressArb,
        async (plaintext, ownerA, ownerB) => {
          fc.pre(ownerA !== ownerB);

          const copyA = new Uint8Array(plaintext);
          const copyB = new Uint8Array(plaintext);

          const resultA = await sealEncrypt(copyA, ownerA);
          const resultB = await sealEncrypt(copyB, ownerB);

          expect(resultA.policyId).not.toBe(resultB.policyId);
          expect(resultA.policyId).toBe(ownerA);
          expect(resultB.policyId).toBe(ownerB);
        },
      ),
      { numRuns: 8 },
    );
  });
});
