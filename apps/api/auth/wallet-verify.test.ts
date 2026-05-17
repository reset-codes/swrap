/**
 * Unit tests for `apps/api/auth/wallet-verify.ts`
 *
 * Tests the `verifyWalletSignature` function.
 * These tests cover:
 *   - Returns invalid for null/empty inputs
 *   - Returns invalid for malformed signatures
 *   - Returns invalid when address doesn't match recovered address
 *   - Never throws
 *   - Returns valid for a real Ed25519 signature over a challenge
 *
 * Requirements: 1.3
 */

import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { verifyWalletSignature } from './wallet-verify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a fresh Ed25519 keypair and sign a challenge, returning
 * the address, challenge, and base64-encoded signature ready for
 * `verifyWalletSignature`.
 */
async function makeValidSignature(challenge: string): Promise<{
  address: string;
  challenge: string;
  signature: string;
}> {
  const keypair = new Ed25519Keypair();
  const address = keypair.getPublicKey().toSuiAddress();
  const messageBytes = new TextEncoder().encode(challenge);
  const { signature } = await keypair.signPersonalMessage(messageBytes);
  return { address, challenge, signature };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('verifyWalletSignature — valid signature', () => {
  it('returns valid for a correctly signed challenge', async () => {
    const { address, challenge, signature } = await makeValidSignature('swrap-auth-challenge');
    const result = await verifyWalletSignature(address, challenge, signature);
    expect(result.valid).toBe(true);
  });

  it('returns valid for a challenge with special characters', async () => {
    const { address, challenge, signature } = await makeValidSignature(
      'challenge:abc123!@#$%^&*()',
    );
    const result = await verifyWalletSignature(address, challenge, signature);
    expect(result.valid).toBe(true);
  });

  it('returns valid for a long challenge string', async () => {
    const longChallenge = 'x'.repeat(1024);
    const { address, challenge, signature } = await makeValidSignature(longChallenge);
    const result = await verifyWalletSignature(address, challenge, signature);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Null / empty input validation
// ---------------------------------------------------------------------------

describe('verifyWalletSignature — null/empty inputs', () => {
  it('returns invalid for null address', async () => {
    const result = await verifyWalletSignature(
      null as unknown as string,
      'challenge',
      'signature',
    );
    expect(result.valid).toBe(false);
  });

  it('returns invalid for undefined address', async () => {
    const result = await verifyWalletSignature(
      undefined as unknown as string,
      'challenge',
      'signature',
    );
    expect(result.valid).toBe(false);
  });

  it('returns invalid for empty address', async () => {
    const result = await verifyWalletSignature('', 'challenge', 'signature');
    expect(result.valid).toBe(false);
  });

  it('returns invalid for whitespace-only address', async () => {
    const result = await verifyWalletSignature('   ', 'challenge', 'signature');
    expect(result.valid).toBe(false);
  });

  it('returns invalid for null challenge', async () => {
    const result = await verifyWalletSignature(
      '0x1234',
      null as unknown as string,
      'signature',
    );
    expect(result.valid).toBe(false);
  });

  it('returns invalid for empty challenge', async () => {
    const result = await verifyWalletSignature('0x1234', '', 'signature');
    expect(result.valid).toBe(false);
  });

  it('returns invalid for whitespace-only challenge', async () => {
    const result = await verifyWalletSignature('0x1234', '   ', 'signature');
    expect(result.valid).toBe(false);
  });

  it('returns invalid for null signature', async () => {
    const result = await verifyWalletSignature(
      '0x1234',
      'challenge',
      null as unknown as string,
    );
    expect(result.valid).toBe(false);
  });

  it('returns invalid for empty signature', async () => {
    const result = await verifyWalletSignature('0x1234', 'challenge', '');
    expect(result.valid).toBe(false);
  });

  it('returns invalid for whitespace-only signature', async () => {
    const result = await verifyWalletSignature('0x1234', 'challenge', '   ');
    expect(result.valid).toBe(false);
  });

  it('returns invalid when all inputs are empty', async () => {
    const result = await verifyWalletSignature('', '', '');
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Malformed signature
// ---------------------------------------------------------------------------

describe('verifyWalletSignature — malformed signature', () => {
  it('returns invalid for a random non-base64 string', async () => {
    const result = await verifyWalletSignature('0x1234', 'challenge', 'not-a-valid-signature!!!');
    expect(result.valid).toBe(false);
  });

  it('returns invalid for a valid base64 string that is not a Sui signature', async () => {
    // Valid base64 but not a Sui signature format
    const fakeBase64 = Buffer.from('this is not a sui signature').toString('base64');
    const result = await verifyWalletSignature('0x1234', 'challenge', fakeBase64);
    expect(result.valid).toBe(false);
  });

  it('returns invalid for a truncated signature', async () => {
    const { address, challenge, signature } = await makeValidSignature('test-challenge');
    // Truncate the signature to make it invalid
    const truncated = signature.slice(0, Math.floor(signature.length / 2));
    const result = await verifyWalletSignature(address, challenge, truncated);
    expect(result.valid).toBe(false);
  });

  it('returns invalid for a signature over a different challenge', async () => {
    const { address, signature } = await makeValidSignature('original-challenge');
    // Use the signature but with a different challenge
    const result = await verifyWalletSignature(address, 'different-challenge', signature);
    expect(result.valid).toBe(false);
  });

  it('returns invalid for a signature from a different keypair', async () => {
    const { address } = await makeValidSignature('challenge');
    // Sign with a different keypair
    const { signature } = await makeValidSignature('challenge');
    // address is from keypair1, signature is from keypair2
    const result = await verifyWalletSignature(address, 'challenge', signature);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Address mismatch
// ---------------------------------------------------------------------------

describe('verifyWalletSignature — address mismatch', () => {
  it('returns invalid when address does not match recovered address', async () => {
    const { challenge, signature } = await makeValidSignature('test-challenge');
    // Use a different (wrong) address
    const wrongAddress = new Ed25519Keypair().getPublicKey().toSuiAddress();
    const result = await verifyWalletSignature(wrongAddress, challenge, signature);
    expect(result.valid).toBe(false);
  });

  it('returns invalid for a plausible-looking but wrong address', async () => {
    const { address, challenge, signature } = await makeValidSignature('test-challenge');
    // Flip the last character of the address
    const lastChar = address[address.length - 1];
    const flippedChar = lastChar === 'a' ? 'b' : 'a';
    const mutatedAddress = address.slice(0, -1) + flippedChar;
    const result = await verifyWalletSignature(mutatedAddress, challenge, signature);
    expect(result.valid).toBe(false);
  });

  it('returns invalid for an all-zeros address', async () => {
    const { challenge, signature } = await makeValidSignature('test-challenge');
    const zeroAddress = '0x' + '0'.repeat(64);
    const result = await verifyWalletSignature(zeroAddress, challenge, signature);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Never throws
// ---------------------------------------------------------------------------

describe('verifyWalletSignature — never throws', () => {
  it('resolves (does not throw) for completely invalid inputs', async () => {
    await expect(
      verifyWalletSignature(
        undefined as unknown as string,
        undefined as unknown as string,
        undefined as unknown as string,
      ),
    ).resolves.toEqual({ valid: false });
  });

  it('resolves (does not throw) for numeric inputs', async () => {
    await expect(
      verifyWalletSignature(
        42 as unknown as string,
        42 as unknown as string,
        42 as unknown as string,
      ),
    ).resolves.toEqual({ valid: false });
  });

  it('resolves (does not throw) for object inputs', async () => {
    await expect(
      verifyWalletSignature(
        {} as unknown as string,
        {} as unknown as string,
        {} as unknown as string,
      ),
    ).resolves.toEqual({ valid: false });
  });

  it('resolves (does not throw) for array inputs', async () => {
    await expect(
      verifyWalletSignature(
        [] as unknown as string,
        [] as unknown as string,
        [] as unknown as string,
      ),
    ).resolves.toEqual({ valid: false });
  });

  it('resolves (does not throw) for a garbage signature string', async () => {
    await expect(
      verifyWalletSignature('0xdeadbeef', 'some-challenge', 'AAAAAAAAAAAAAAAA'),
    ).resolves.toEqual({ valid: false });
  });
});

// ---------------------------------------------------------------------------
// Return shape invariants
// ---------------------------------------------------------------------------

describe('verifyWalletSignature — return shape', () => {
  it('always returns an object with a boolean valid field', async () => {
    const result = await verifyWalletSignature('', '', '');
    expect(result).toHaveProperty('valid');
    expect(typeof result.valid).toBe('boolean');
  });

  it('result object has only the valid field', async () => {
    const result = await verifyWalletSignature('', '', '');
    expect(Object.keys(result)).toEqual(['valid']);
  });

  it('valid result also has only the valid field', async () => {
    const { address, challenge, signature } = await makeValidSignature('shape-test');
    const result = await verifyWalletSignature(address, challenge, signature);
    expect(Object.keys(result)).toEqual(['valid']);
  });
});
