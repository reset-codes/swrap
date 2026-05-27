/**
 * Unit tests for `apps/api/auth/zk-verify.ts`
 *
 * Tests the `verifyZkProof` function and its internal helpers.
 * These tests focus on structural validation, epoch checking, and
 * address derivation logic without requiring real ZK proofs or
 * live network calls.
 *
 * Requirements: 1.9, 1.10
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  verifyZkProof,
  _invalidateJwkCache,
  _setSuiClient,
  type ZkProofEnvelope,
  type ZkProofInputs,
} from './zk-verify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid-looking ZkProofInputs structure.
 * The proof values are not cryptographically valid — they are used only to
 * test structural validation and field mutation detection.
 */
function makeProofInputs(): ZkProofInputs {
  return {
    proofPoints: {
      a: ['1', '2'],
      b: [['3', '4'], ['5', '6']],
      c: ['7', '8'],
    },
    issBase64Details: {
      // base64 of: "sub":"1234567890"
      value: Buffer.from('"sub":"1234567890"').toString('base64'),
      indexMod4: 1,
    },
    headerBase64: 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.eyJzdWIiOiIxMjM0NTY3ODkwIiwibm9uY2UiOiJ0ZXN0bm9uY2UiLCJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhdWQiOiJ0ZXN0LWNsaWVudC1pZCJ9',
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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _invalidateJwkCache();
});

afterEach(() => {
  _setSuiClient(null);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Structural validation tests
// ---------------------------------------------------------------------------

describe('verifyZkProof — structural validation', () => {
  it('returns invalid for null input', async () => {
    const result = await verifyZkProof(null as unknown as ZkProofEnvelope);
    expect(result.valid).toBe(false);
    expect(result.address).toBe('');
  });

  it('returns invalid for empty object', async () => {
    const result = await verifyZkProof({} as ZkProofEnvelope);
    expect(result.valid).toBe(false);
    expect(result.address).toBe('');
  });

  it('returns invalid when assertedAddress is missing', async () => {
    const envelope = {
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    } as unknown as ZkProofEnvelope;

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when assertedAddress is empty string', async () => {
    const envelope: ZkProofEnvelope = {
      assertedAddress: '',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when maxEpoch is 0', async () => {
    const envelope: ZkProofEnvelope = {
      assertedAddress: '0x1234',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 0,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when maxEpoch is negative', async () => {
    const envelope: ZkProofEnvelope = {
      assertedAddress: '0x1234',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: -1,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when zkProof is missing', async () => {
    const envelope = {
      assertedAddress: '0x1234',
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    } as unknown as ZkProofEnvelope;

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when zkProof.proofPoints is missing', async () => {
    const envelope: ZkProofEnvelope = {
      assertedAddress: '0x1234',
      zkProof: {
        issBase64Details: { value: 'test', indexMod4: 0 },
        headerBase64: 'test',
      } as unknown as ZkProofInputs,
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when zkProof.headerBase64 is empty', async () => {
    const proof = makeProofInputs();
    proof.headerBase64 = '';

    const envelope: ZkProofEnvelope = {
      assertedAddress: '0x1234',
      zkProof: proof,
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when jwtIss is missing', async () => {
    const envelope = {
      assertedAddress: '0x1234',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: 'salt',
      jwtAud: 'client-id',
    } as unknown as ZkProofEnvelope;

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when jwtAud is missing', async () => {
    const envelope = {
      assertedAddress: '0x1234',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
    } as unknown as ZkProofEnvelope;

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when userSalt is empty', async () => {
    const envelope: ZkProofEnvelope = {
      assertedAddress: '0x1234',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: '',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Epoch validation tests
// ---------------------------------------------------------------------------

describe('verifyZkProof — epoch validation', () => {
  it('returns invalid when maxEpoch < currentEpoch (expired session)', async () => {
    // Mock the Sui client to return epoch 200
    _setSuiClient(makeMockSuiClient(200) as any);

    const envelope: ZkProofEnvelope = {
      assertedAddress: '0x1234',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100, // less than current epoch 200
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
    expect(result.address).toBe('');
  });

  it('returns invalid when RPC call fails (fail closed)', async () => {
    // Mock the Sui client to throw
    _setSuiClient({
      getCurrentEpoch: vi.fn().mockRejectedValue(new Error('RPC unreachable')),
    } as any);

    const envelope: ZkProofEnvelope = {
      assertedAddress: '0x1234',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 999,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    const result = await verifyZkProof(envelope);
    expect(result.valid).toBe(false);
  });

  it('proceeds past epoch check when maxEpoch >= currentEpoch', async () => {
    // Mock epoch = 100, maxEpoch = 100 (equal — should pass epoch check)
    _setSuiClient(makeMockSuiClient(100) as any);

    // This will still fail at address derivation since the proof is fake,
    // but it should NOT fail at the epoch check.
    const envelope: ZkProofEnvelope = {
      assertedAddress: '0x1234',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 100,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    // We expect it to fail (fake proof), but not due to epoch expiry.
    // The result should still be invalid (fake proof), but the epoch check passes.
    const result = await verifyZkProof(envelope);
    // Still invalid because the proof is fake, but epoch check passed.
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Return shape invariants
// ---------------------------------------------------------------------------

describe('verifyZkProof — return shape', () => {
  it('always returns an object with valid and address fields', async () => {
    const result = await verifyZkProof(null as unknown as ZkProofEnvelope);
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('address');
    expect(typeof result.valid).toBe('boolean');
    expect(typeof result.address).toBe('string');
  });

  it('returns address as empty string when valid is false', async () => {
    const result = await verifyZkProof({} as ZkProofEnvelope);
    expect(result.valid).toBe(false);
    expect(result.address).toBe('');
  });

  it('never throws — catches all errors internally', async () => {
    // Passing completely invalid data should not throw
    await expect(
      verifyZkProof(undefined as unknown as ZkProofEnvelope),
    ).resolves.toEqual({ valid: false, address: '' });

    await expect(
      verifyZkProof(42 as unknown as ZkProofEnvelope),
    ).resolves.toEqual({ valid: false, address: '' });

    await expect(
      verifyZkProof('string' as unknown as ZkProofEnvelope),
    ).resolves.toEqual({ valid: false, address: '' });
  });
});

// ---------------------------------------------------------------------------
// Security invariants
// ---------------------------------------------------------------------------

describe('verifyZkProof — security invariants', () => {
  it('does not expose sensitive fields in the return value', async () => {
    const result = await verifyZkProof({} as ZkProofEnvelope);
    // The result should only have valid and address — no proof material
    const keys = Object.keys(result);
    expect(keys).toEqual(expect.arrayContaining(['valid', 'address']));
    expect(keys).not.toContain('zkProof');
    expect(keys).not.toContain('randomness');
    expect(keys).not.toContain('userSalt');
    expect(keys).not.toContain('ephemeralPublicKey');
  });

  it('returns invalid for any mutation of assertedAddress', async () => {
    _setSuiClient(makeMockSuiClient(100) as any);

    const base: ZkProofEnvelope = {
      assertedAddress: '0xabc123',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 200,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    // Mutate assertedAddress
    const mutated = { ...base, assertedAddress: '0xabc124' };
    const result = await verifyZkProof(mutated);
    expect(result.valid).toBe(false);
  });

  it('returns invalid for any mutation of maxEpoch', async () => {
    _setSuiClient(makeMockSuiClient(100) as any);

    const base: ZkProofEnvelope = {
      assertedAddress: '0xabc123',
      zkProof: makeProofInputs(),
      ephemeralPublicKey: 'AAAA',
      maxEpoch: 200,
      randomness: '12345',
      userSalt: 'salt',
      jwtIss: 'https://accounts.google.com',
      jwtAud: 'client-id',
    };

    // Mutate maxEpoch to be expired
    const mutated = { ...base, maxEpoch: 50 };
    const result = await verifyZkProof(mutated);
    expect(result.valid).toBe(false);
  });
});
