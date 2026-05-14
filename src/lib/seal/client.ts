/**
 * Seal encryption client wrapper using official @mysten/seal SDK via @poc/seal.
 *
 * Provides field-level and full-submission encryption with decentralized
 * access-control policies. Uses the infrastructure wallet private key from
 * the environment — no local Sui CLI required (production-safe for VPS deployment).
 *
 * Environment variables:
 *   INFRA_WALLET_PRIVATE_KEY — Ed25519 bech32 private key (suiprivkey1...)
 *   SUI_RPC_URL              — Sui fullnode gRPC-capable RPC (default: testnet)
 *   SUI_POC_PACKAGE_ID       — The deployed package containing seal_approve logic
 *   POC_ALLOW_PROD           — Must be "true" in NODE_ENV=production
 */

import { encrypt as sealEncrypt, decrypt as sealDecrypt } from '@poc/seal';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
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
 * Generate a valid Seal IBE identity (32-byte hex string) from a form ID.
 *
 * The Seal SDK requires the identity to be a valid hex string for its
 * internal authorization logic (e.g. hexToBytes calls). We hash the form ID
 * to produce a stable, correctly-formatted identity string.
 */
function getSealIdentity(formId: string): string {
  // Use Blake2b to hash the formId string into 32 bytes
  const hash = blake2b(new TextEncoder().encode(`swrap-form-${formId}`), { dkLen: 32 });
  return `0x${bytesToHex(hash)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a PocSigner from a bech32-encoded Ed25519 private key.
 *
 * The returned signer satisfies the PocSigner interface exactly — it is
 * compatible with @poc/seal's encrypt() and decrypt() functions, which need:
 *   - signer.address  — used as ownerAddress in the encrypted blob header
 *   - signer.signPersonalMessage — used by SessionKey.create() during decryption
 *   - signer.signTransaction     — used during transaction building for decryption
 *
 * SECURITY: The keypair object is never returned directly. Only the wrapped
 * interface methods are exposed. The raw secret bytes live only inside this
 * function's closure.
 *
 * @param privateKey  Bech32-encoded Ed25519 key (suiprivkey1...).
 * @throws SealError with 'INVALID_KEY' if the key format is unsupported.
 */
function getPocSignerFromKey(privateKey: string): PocSigner {
  let scheme: string;
  let secretKey: Uint8Array;

  try {
    const decoded = decodeSuiPrivateKey(privateKey);
    scheme = decoded.scheme;
    secretKey = decoded.secretKey;
  } catch (err) {
    throw new SealError(
      `Failed to decode private key: ${err instanceof Error ? err.message : String(err)}`,
      'INVALID_KEY',
    );
  }

  if (scheme !== 'ED25519') {
    throw new SealError(
      `Unsupported key scheme: ${scheme}. Only ED25519 is supported.`,
      'INVALID_KEY',
    );
  }

  const kp = Ed25519Keypair.fromSecretKey(secretKey);

  // Use `satisfies PocSigner` to enforce the exact interface contract at the
  // object literal — no extra properties can slip in, and no required ones
  // can be omitted. This mirrors the pattern used in packages/sui/src/signer-detector.ts.
  return Object.freeze({
    scheme: 'ed25519',
    address: kp.toSuiAddress(),
    toSuiAddress: () => kp.toSuiAddress(),
    getKeyScheme: () => 'ed25519' as const,
    getPublicKey: () => kp.getPublicKey(),
    signPersonalMessage: (bytes: Uint8Array) => kp.signPersonalMessage(bytes),
    signTransaction: (txBytes: Uint8Array) => kp.signTransaction(txBytes),
  } satisfies PocSigner);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a string value under a Seal policy.
 *
 * Internally calls @poc/seal's encrypt(), which uses @mysten/seal SDK with
 * the SUI_RPC_URL gRPC endpoint and SUI_POC_PACKAGE_ID for authorization.
 *
 * IMPORTANT: Requires these env vars to be set:
 *   - POC_ALLOW_PROD=true (if NODE_ENV=production)
 *   - SUI_POC_PACKAGE_ID
 *   - DEV_BYPASS_STORAGE, DEV_LOCAL_SIGNER, DEV_ALLOW_PLAINTEXT, USE_WALRUS_TESTNET, USE_SUI_TESTNET
 *   - INFRA_WALLET_PRIVATE_KEY (or pass adminKey explicitly)
 *
 * @param value     The plaintext string to encrypt.
 * @param policyId  The Seal IBE identity / policy ID governing decryption access.
 * @param adminKey  Infrastructure wallet private key (falls back to INFRA_WALLET_PRIVATE_KEY).
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

  const key = adminKey ?? process.env.INFRA_WALLET_PRIVATE_KEY;
  if (!key || key.trim() === '') {
    throw new SealError(
      'INFRA_WALLET_PRIVATE_KEY is not configured.',
      'NOT_CONFIGURED',
    );
  }

  const signer = getPocSignerFromKey(key);
  const plaintext = new TextEncoder().encode(value);

  try {
    // @poc/seal encrypt: (plaintext: Uint8Array, signer: PocSigner, blobType: BlobType, identity?: string)
    // We pass policyId as the Seal IBE identity so that decryption requires the same identity.
    const encryptedBytes = await sealEncrypt(plaintext, signer, 'subm', policyId);

    return {
      encryptedData: Buffer.from(encryptedBytes).toString('base64'),
      policyId,
      algorithm: 'Seal-IBE-BonehFranklin',
    };
  } catch (err) {
    // SECURITY: 'value' is never referenced in this error message
    throw new SealError(
      `Encryption failed: ${err instanceof Error ? err.message : String(err)}`,
      'ENCRYPT_FAILED',
    );
  }
}

/**
 * Decrypt an encrypted blob in-memory.
 *
 * @param encryptedData  Base64-encoded encrypted blob produced by encrypt().
 * @param adminKey       Infrastructure wallet private key.
 * @returns              Decrypted plaintext.
 */
export async function decrypt(
  encryptedData: string,
  adminKey: string,
): Promise<SealDecryptResult> {
  if (!adminKey || adminKey.trim() === '') {
    throw new SealError('adminKey is required.', 'INVALID_KEY');
  }

  const signer = getPocSignerFromKey(adminKey);
  const blobBytes = new Uint8Array(Buffer.from(encryptedData, 'base64'));

  try {
    const plaintextBytes = await sealDecrypt(blobBytes, signer);
    // SECURITY: plaintextBytes is returned directly — callers must not log or persist it
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
 *
 * For now, generates a stable deterministic policy ID based on the form ID.
 * In production, this would register the policy on-chain via the Sui package.
 */
export async function createPolicy(
  formId: string,
  authorizedRoles: string[],
): Promise<SealPolicy> {
  // Use a stable, correctly-formatted hex identity tied to the formId.
  const policyId = getSealIdentity(formId);

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
