/**
 * Seal encryption client wrapper using official @mysten/seal SDK.
 *
 * Provides field-level and full-submission encryption with decentralized
 * access-control policies.
 *
 * Environment variables:
 *   SUI_RPC_URL — Sui fullnode RPC (default: testnet)
 *   SUI_POC_PACKAGE_ID — the package containing seal_approve logic
 */

import { encrypt as sealEncrypt, decrypt as sealDecrypt } from '@poc/seal';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  SealDecryptResult,
  SealEncryptResult,
  SealError,
  SealPolicy,
} from './types';
import type { PocSigner } from '@poc/sui';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a PocSigner from a private key string.
 * This is a lightweight wrapper around Ed25519Keypair to match @poc/seal's PocSigner interface.
 */
function getPocSignerFromKey(privateKey: string): PocSigner {
  const { schema, secretKey } = decodeSuiPrivateKey(privateKey);
  if (schema !== 'ED25519') {
    throw new Error(`Unsupported key schema: ${schema}. Only ED25519 is supported.`);
  }
  const kp = Ed25519Keypair.fromSecretKey(secretKey);

  return Object.freeze({
    scheme: 'ed25519',
    address: kp.toSuiAddress(),
    toSuiAddress: () => kp.toSuiAddress(),
    getKeyScheme: () => 'ed25519',
    getPublicKey: () => kp.getPublicKey(),
    signPersonalMessage: (bytes: Uint8Array) => kp.signPersonalMessage(bytes),
    signTransaction: (txBytes: Uint8Array) => kp.signTransaction(txBytes),
    deriveSymmetricKey: () => {
      throw new Error('deriveSymmetricKey not implemented in client wrapper');
    },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a string value under a Seal policy.
 *
 * @param value     The plaintext string to encrypt.
 * @param policyId  The Seal policy ID governing decryption access.
 * @param adminKey  Infrastructure wallet private key (required for encryption in this wrapper).
 * @returns         Encrypted result with base64-encoded blob.
 */
export async function encrypt(
  value: string,
  policyId: string,
  adminKey?: string,
): Promise<SealEncryptResult> {
  if (!policyId || policyId.trim() === '') {
    throw new SealError('A valid policyId is required.', 'ENCRYPT_FAILED');
  }

  // Use the provided adminKey or read from environment
  const key = adminKey || process.env.INFRA_WALLET_PRIVATE_KEY;
  if (!key) {
    throw new SealError('INFRA_WALLET_PRIVATE_KEY is not configured.', 'NOT_CONFIGURED');
  }

  try {
    const signer = getPocSignerFromKey(key);
    const plaintext = new TextEncoder().encode(value);
    
    const encryptedBytes = await sealEncrypt(plaintext, signer, 'subm', policyId);

    return {
      encryptedData: Buffer.from(encryptedBytes).toString('base64'),
      policyId,
      algorithm: 'Seal-IBE-BonehFranklin',
    };
  } catch (err) {
    throw new SealError(
      `Encryption failed: ${err instanceof Error ? err.message : String(err)}`,
      'ENCRYPT_FAILED',
    );
  }
}

/**
 * Decrypt an encrypted blob in-memory.
 *
 * @param encryptedData  Base64-encoded encrypted blob.
 * @param adminKey       Infrastructure wallet private key.
 * @returns              Decrypted plaintext.
 */
export async function decrypt(
  encryptedData: string,
  adminKey: string,
): Promise<SealDecryptResult> {
  if (!adminKey) throw new SealError('adminKey is required.', 'INVALID_KEY');

  try {
    const signer = getPocSignerFromKey(adminKey);
    const blobBytes = Buffer.from(encryptedData, 'base64');

    const plaintextBytes = await sealDecrypt(blobBytes, signer);

    return { plaintext: new TextDecoder().decode(plaintextBytes) };
  } catch (err) {
    throw new SealError(
      `Decryption failed: ${err instanceof Error ? err.message : String(err)}`,
      'DECRYPT_FAILED',
    );
  }
}

/**
 * Create a Seal access-control policy for a form.
 */
export async function createPolicy(
  formId: string,
  authorizedRoles: string[],
): Promise<SealPolicy> {
  // Use formId as the identity basis for decentralized encryption.
  const policyId = `policy-${formId}-${Math.random().toString(36).slice(2, 10)}`;
  
  return {
    policyId,
    formId,
    authorizedRoles,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Encrypt an entire object by JSON-serializing it then encrypting the string.
 */
export async function encryptObject(
  obj: Record<string, unknown>,
  policyId: string,
): Promise<string> {
  const serialized = JSON.stringify(obj);
  const result = await encrypt(serialized, policyId);
  return result.encryptedData;
}

/**
 * Decrypt a base64-encoded encrypted blob and JSON-parse it back to an object.
 */
export async function decryptObject<T>(
  encryptedData: string,
  adminKey: string,
): Promise<T> {
  const result = await decrypt(encryptedData, adminKey);
  return JSON.parse(result.plaintext) as T;
}
