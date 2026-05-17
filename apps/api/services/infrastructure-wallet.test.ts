/**
 * Unit tests for apps/api/services/infrastructure-wallet.ts
 *
 * Tests cover:
 *   - `getInfrastructureWallet()` — env var loading, error cases
 *   - `sealEncrypt()` — output structure, digest correctness, plaintext release
 *   - `sealDecrypt()` — error propagation, wallet misconfiguration
 *
 * Requirements: 2.2, 2.3, 2.4, 2.7, 9.3, 9.4, 12.2, 13.1, 13.2, 13.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// ---------------------------------------------------------------------------
// Generate a real test keypair for use in tests
// ---------------------------------------------------------------------------

const TEST_KEYPAIR = new Ed25519Keypair();
const TEST_SECRET_BECH32 = TEST_KEYPAIR.getSecretKey(); // suiprivkey1... format

// ---------------------------------------------------------------------------
// Mock @mysten/seal so tests don't hit the network
// ---------------------------------------------------------------------------

const mockEncryptedObject = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
const mockPlaintext = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"

vi.mock('@mysten/seal', () => {
  const mockSessionKey = {
    getAddress: () => '0x' + 'ab'.repeat(32),
  };

  function MockSealClient(this: any) {
    this.encrypt = vi.fn().mockResolvedValue({ encryptedObject: mockEncryptedObject });
    this.decrypt = vi.fn().mockResolvedValue(mockPlaintext);
  }

  return {
    SealClient: vi.fn(function (this: any, ...args: any[]) {
      return new (MockSealClient as any)();
    }),
    SessionKey: {
      create: vi.fn().mockResolvedValue(mockSessionKey),
    },
  };
});

// Mock @mysten/sui/grpc to avoid network calls
vi.mock('@mysten/sui/grpc', () => {
  function MockSuiGrpcClient(this: any) {
    // empty mock client
  }
  return {
    SuiGrpcClient: vi.fn(function (this: any) {
      return new (MockSuiGrpcClient as any)();
    }),
  };
});

// Mock @mysten/sui/transactions to avoid network calls during tx.build
vi.mock('@mysten/sui/transactions', () => {
  function MockTransaction(this: any) {
    this.moveCall = vi.fn();
    this.setSender = vi.fn();
    this.pure = {
      vector: vi.fn().mockReturnValue('mock-arg'),
    };
    this.build = vi.fn().mockResolvedValue(new Uint8Array([0x01, 0x02]));
  }
  return {
    Transaction: vi.fn(function (this: any) {
      return new (MockTransaction as any)();
    }),
  };
});

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import {
  getInfrastructureWallet,
  sealEncrypt,
  sealDecrypt,
  WalletNotConfiguredError,
  SealEncryptionError,
  SealDecryptionError,
} from './infrastructure-wallet';

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

// ---------------------------------------------------------------------------
// getInfrastructureWallet
// ---------------------------------------------------------------------------

describe('getInfrastructureWallet', () => {
  const originalEnv = process.env.INFRASTRUCTURE_WALLET_SECRET;

  afterEach(() => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', originalEnv);
  });

  it('returns an Ed25519Keypair when INFRASTRUCTURE_WALLET_SECRET is a valid bech32 key', () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', TEST_SECRET_BECH32);
    const kp = getInfrastructureWallet();
    expect(kp).toBeInstanceOf(Ed25519Keypair);
  });

  it('returned keypair has the correct Sui address', () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', TEST_SECRET_BECH32);
    const kp = getInfrastructureWallet();
    expect(kp.toSuiAddress()).toBe(TEST_KEYPAIR.toSuiAddress());
  });

  it('throws WalletNotConfiguredError with reason "missing" when env var is absent', () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', undefined);
    expect(() => getInfrastructureWallet()).toThrow(WalletNotConfiguredError);
    try {
      getInfrastructureWallet();
    } catch (err) {
      expect((err as WalletNotConfiguredError).code).toBe('WALLET_NOT_CONFIGURED');
      expect((err as WalletNotConfiguredError).message).toContain('not set');
    }
  });

  it('throws WalletNotConfiguredError with reason "missing" when env var is empty string', () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', '');
    expect(() => getInfrastructureWallet()).toThrow(WalletNotConfiguredError);
  });

  it('throws WalletNotConfiguredError with reason "missing" when env var is whitespace only', () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', '   ');
    expect(() => getInfrastructureWallet()).toThrow(WalletNotConfiguredError);
  });

  it('throws WalletNotConfiguredError with reason "malformed" when env var is not a valid bech32 key', () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', 'not-a-valid-key');
    expect(() => getInfrastructureWallet()).toThrow(WalletNotConfiguredError);
    try {
      getInfrastructureWallet();
    } catch (err) {
      expect((err as WalletNotConfiguredError).message).toContain('decoded');
    }
  });

  it('throws WalletNotConfiguredError with reason "malformed" when env var is a random hex string', () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', '0x' + 'ab'.repeat(32));
    expect(() => getInfrastructureWallet()).toThrow(WalletNotConfiguredError);
  });

  it('error message does NOT contain the raw secret value', () => {
    const fakeSecret = 'suiprivkey1_this_is_malformed_but_starts_right';
    setEnv('INFRASTRUCTURE_WALLET_SECRET', fakeSecret);
    try {
      getInfrastructureWallet();
    } catch (err) {
      // The error message must not echo back the raw secret
      expect((err as Error).message).not.toContain(fakeSecret);
    }
  });
});

// ---------------------------------------------------------------------------
// sealEncrypt
// ---------------------------------------------------------------------------

describe('sealEncrypt', () => {
  const originalWalletSecret = process.env.INFRASTRUCTURE_WALLET_SECRET;
  const originalPackageId = process.env.SUI_POC_PACKAGE_ID;

  beforeEach(() => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', TEST_SECRET_BECH32);
    setEnv('SUI_POC_PACKAGE_ID', '0x' + '12'.repeat(32));
  });

  afterEach(() => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', originalWalletSecret);
    setEnv('SUI_POC_PACKAGE_ID', originalPackageId);
    vi.clearAllMocks();
  });

  it('returns an object with ciphertext, policyId, and digest fields', async () => {
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await sealEncrypt(plaintext, '0x' + 'aa'.repeat(32));
    expect(result).toHaveProperty('ciphertext');
    expect(result).toHaveProperty('policyId');
    expect(result).toHaveProperty('digest');
  });

  it('ciphertext is a non-empty Uint8Array', async () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const { ciphertext } = await sealEncrypt(plaintext, '0x' + 'aa'.repeat(32));
    expect(ciphertext).toBeInstanceOf(Uint8Array);
    expect(ciphertext.length).toBeGreaterThan(0);
  });

  it('policyId equals the policyOwnerAddress passed in', async () => {
    const ownerAddress = '0x' + 'cc'.repeat(32);
    const plaintext = new Uint8Array([1, 2, 3]);
    const { policyId } = await sealEncrypt(plaintext, ownerAddress);
    expect(policyId).toBe(ownerAddress);
  });

  it('digest is a valid hex-encoded SHA-256 of the ciphertext', async () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const { ciphertext, digest } = await sealEncrypt(plaintext, '0x' + 'aa'.repeat(32));
    const expectedDigest = sha256Hex(ciphertext);
    expect(digest).toBe(expectedDigest);
  });

  it('digest is a 64-character hex string (SHA-256)', async () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const { digest } = await sealEncrypt(plaintext, '0x' + 'aa'.repeat(32));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws WalletNotConfiguredError when INFRASTRUCTURE_WALLET_SECRET is absent', async () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', undefined);
    const plaintext = new Uint8Array([1, 2, 3]);
    await expect(sealEncrypt(plaintext, '0x' + 'aa'.repeat(32))).rejects.toThrow(
      WalletNotConfiguredError,
    );
  });

  it('throws SealEncryptionError when SUI_POC_PACKAGE_ID is absent', async () => {
    setEnv('SUI_POC_PACKAGE_ID', undefined);
    const plaintext = new Uint8Array([1, 2, 3]);
    await expect(sealEncrypt(plaintext, '0x' + 'aa'.repeat(32))).rejects.toThrow(
      SealEncryptionError,
    );
  });

  it('throws SealEncryptionError when the Seal SDK throws', async () => {
    const { SealClient } = await import('@mysten/seal');
    vi.mocked(SealClient).mockImplementationOnce(function (this: any) {
      this.encrypt = vi.fn().mockRejectedValue(new Error('Seal network error'));
      this.decrypt = vi.fn();
    } as any);

    const plaintext = new Uint8Array([1, 2, 3]);
    await expect(sealEncrypt(plaintext, '0x' + 'aa'.repeat(32))).rejects.toThrow(
      SealEncryptionError,
    );
  });

  it('releases plaintext reference even when encryption fails', async () => {
    const { SealClient } = await import('@mysten/seal');
    vi.mocked(SealClient).mockImplementationOnce(function (this: any) {
      this.encrypt = vi.fn().mockRejectedValue(new Error('Seal network error'));
      this.decrypt = vi.fn();
    } as any);

    const plaintext = new Uint8Array([0x73, 0x65, 0x63, 0x72, 0x65, 0x74]); // "secret"
    try {
      await sealEncrypt(plaintext, '0x' + 'aa'.repeat(32));
    } catch {
      // Expected — check that plaintext was zeroed
    }
    // After the call (success or failure), the buffer should be zeroed
    expect(plaintext.every((b) => b === 0)).toBe(true);
  });

  it('releases plaintext reference on success', async () => {
    const plaintext = new Uint8Array([0x73, 0x65, 0x63, 0x72, 0x65, 0x74]); // "secret"
    await sealEncrypt(plaintext, '0x' + 'aa'.repeat(32));
    // After successful encryption, the buffer should be zeroed
    expect(plaintext.every((b) => b === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sealDecrypt
// ---------------------------------------------------------------------------

describe('sealDecrypt', () => {
  const originalWalletSecret = process.env.INFRASTRUCTURE_WALLET_SECRET;
  const originalPackageId = process.env.SUI_POC_PACKAGE_ID;

  beforeEach(() => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', TEST_SECRET_BECH32);
    setEnv('SUI_POC_PACKAGE_ID', '0x' + '12'.repeat(32));
  });

  afterEach(() => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', originalWalletSecret);
    setEnv('SUI_POC_PACKAGE_ID', originalPackageId);
    vi.clearAllMocks();
  });

  it('returns a Uint8Array on success', async () => {
    const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const policyId = '0x' + 'aa'.repeat(32);
    const result = await sealDecrypt(ciphertext, policyId);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('returns the decrypted bytes from the Seal SDK', async () => {
    const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const policyId = '0x' + 'aa'.repeat(32);
    const result = await sealDecrypt(ciphertext, policyId);
    // mockPlaintext is what the mock SealClient.decrypt returns
    expect(result).toEqual(mockPlaintext);
  });

  it('throws WalletNotConfiguredError when INFRASTRUCTURE_WALLET_SECRET is absent', async () => {
    setEnv('INFRASTRUCTURE_WALLET_SECRET', undefined);
    const ciphertext = new Uint8Array([0xde, 0xad]);
    await expect(sealDecrypt(ciphertext, '0x' + 'aa'.repeat(32))).rejects.toThrow(
      WalletNotConfiguredError,
    );
  });

  it('throws SealDecryptionError when SUI_POC_PACKAGE_ID is absent', async () => {
    setEnv('SUI_POC_PACKAGE_ID', undefined);
    const ciphertext = new Uint8Array([0xde, 0xad]);
    await expect(sealDecrypt(ciphertext, '0x' + 'aa'.repeat(32))).rejects.toThrow(
      SealDecryptionError,
    );
  });

  it('throws SealDecryptionError when the Seal SDK decrypt throws', async () => {
    const { SealClient } = await import('@mysten/seal');
    vi.mocked(SealClient).mockImplementationOnce(function (this: any) {
      this.encrypt = vi.fn();
      this.decrypt = vi.fn().mockRejectedValue(new Error('Seal decryption network error'));
    } as any);

    const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await expect(sealDecrypt(ciphertext, '0x' + 'aa'.repeat(32))).rejects.toThrow(
      SealDecryptionError,
    );
  });

  it('throws SealDecryptionError when policyId is not valid hex', async () => {
    const ciphertext = new Uint8Array([0xde, 0xad]);
    // Odd-length hex string
    await expect(sealDecrypt(ciphertext, '0xabc')).rejects.toThrow(SealDecryptionError);
  });

  it('SealDecryptionError has code SEAL_DECRYPTION_FAILED', async () => {
    setEnv('SUI_POC_PACKAGE_ID', undefined);
    const ciphertext = new Uint8Array([0xde, 0xad]);
    try {
      await sealDecrypt(ciphertext, '0x' + 'aa'.repeat(32));
    } catch (err) {
      expect((err as SealDecryptionError).code).toBe('SEAL_DECRYPTION_FAILED');
    }
  });
});

// ---------------------------------------------------------------------------
// WalletNotConfiguredError
// ---------------------------------------------------------------------------

describe('WalletNotConfiguredError', () => {
  it('has code WALLET_NOT_CONFIGURED', () => {
    const err = new WalletNotConfiguredError('missing');
    expect(err.code).toBe('WALLET_NOT_CONFIGURED');
  });

  it('is an instance of Error', () => {
    const err = new WalletNotConfiguredError('missing');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name WalletNotConfiguredError', () => {
    const err = new WalletNotConfiguredError('missing');
    expect(err.name).toBe('WalletNotConfiguredError');
  });

  it('message for "missing" mentions INFRASTRUCTURE_WALLET_SECRET', () => {
    const err = new WalletNotConfiguredError('missing');
    expect(err.message).toContain('INFRASTRUCTURE_WALLET_SECRET');
  });

  it('message for "malformed" mentions decoding', () => {
    const err = new WalletNotConfiguredError('malformed');
    expect(err.message).toContain('decoded');
  });

  it('message for "wrong_scheme" mentions ED25519', () => {
    const err = new WalletNotConfiguredError('wrong_scheme');
    expect(err.message).toContain('ED25519');
  });
});
