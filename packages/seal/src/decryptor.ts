/**
 * packages/seal/src/decryptor.ts
 *
 * Plan A migration note: when @mysten/seal stabilizes and is available as a
 * production-ready package, replace this file with a thin wrapper around the
 * real Seal SDK's decrypt() call. The wire format version byte will move from
 * 0x01 (this fallback) to 0x02 (Seal SDK blobs). Version 0x01 blobs remain
 * decodable for backward compatibility during the migration window.
 *
 * Requirements: R7.1, R7.2, R7.4, R7.5, R7.6
 */

import { SessionKey, SealClient } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import type { PocSigner } from '@poc/sui';
import { loadPocEnv } from '@poc/shared';
import { decode, ParseError, SEAL_TESTNET_SERVER_CONFIGS, VERSION_V2 } from './encrypted-blob';
import { createSealSuiClient } from './sui-client';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when the signer's address does not match the owner address encoded
 * in the blob header. The caller does not have authorization to decrypt.
 */
export class SealAuthError extends Error {
  readonly category = 'authorization' as const;

  constructor(
    public readonly signerAddress: string,
    message?: string,
  ) {
    super(message ?? `Owner address mismatch: signer is ${signerAddress}`);
    this.name = 'SealAuthError';
  }
}

/**
 * Thrown when the blob bytes cannot be decoded (malformed wire format),
 * when AES-GCM authentication fails, or when the Seal SDK fails.
 */
export class SealParseError extends Error {
  readonly category = 'parse' as const;

  constructor(public readonly reason: string) {
    super(`SealParseError: ${reason}`);
    this.name = 'SealParseError';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decrypt a wire-format encrypted blob produced by `encrypt()`.
 *
 * Throws:
 * - `SealParseError`  — malformed wire format (category: 'parse')
 * - `SealAuthError`   — signer address does not match blob owner (category: 'authorization')
 * - `SealParseError`  — AES-GCM or Seal SDK decryption failure (category: 'parse')
 *
 * @param blobBytes  Wire-format bytes as returned by `encrypt()`.
 * @param signer     Local POC signer (provides address).
 */
export async function decrypt(blobBytes: Uint8Array, signer: PocSigner): Promise<Uint8Array> {
  // 1. Decode wire format — throws SealParseError on malformed input
  let blob;
  try {
    blob = decode(blobBytes);
  } catch (err) {
    if (err instanceof ParseError) {
      throw new SealParseError(err.reason);
    }
    throw new SealParseError(String(err));
  }

  // 2. Owner address check — case-insensitive hex comparison
  if (blob.header.ownerAddress.toLowerCase() !== signer.address.toLowerCase()) {
    throw new SealAuthError(signer.address, 'Owner address mismatch');
  }

  // 3. Decrypt based on version
  if (blob.header.version === VERSION_V2) {
    return decryptV2(blob.ciphertext, blob.header.identity, signer);
  }

  throw new SealParseError(`Unsupported blob version: ${blob.header.version}`);
}

/**
 * Decrypt a Version 2 blob using the official @mysten/seal SDK.
 */
async function decryptV2(
  ciphertext: Uint8Array,
  identity: string,
  signer: PocSigner,
): Promise<Uint8Array> {
  const env = loadPocEnv();
  const suiClient = createSealSuiClient(env.SUI_RPC_URL);

  if (!env.SUI_POC_PACKAGE_ID) {
    throw new Error('SUI_POC_PACKAGE_ID is required for Seal decryption');
  }

  // 1. Create Session Key
  const sessionKey = await SessionKey.create({
    address: signer.address,
    packageId: env.SUI_POC_PACKAGE_ID,
    ttlMin: 30, // Max 30 mins per SDK
    signer: signer as any, // PocSigner has the methods Seal needs, but not the SDK nominal type.
    suiClient,
  });

  // 2. Prepare approval transaction (dry-run only).
  // The identity passed here must match what was used during encryption.
  const tx = new Transaction();
  tx.moveCall({
    target: `${env.SUI_POC_PACKAGE_ID}::metadata::seal_approve`,
    arguments: [tx.pure.vector('u8', hexToBytes(identity))],
  });
  tx.setSender(signer.address);
  const txBytes = await tx.build({ client: suiClient as any, onlyTransactionKind: true });

  // 3. Decrypt via SDK
  const sealClient = new SealClient({
    suiClient,
    serverConfigs: SEAL_TESTNET_SERVER_CONFIGS,
    verifyKeyServers: false,
  });

  try {
    const plaintext = await sealClient.decrypt({
      data: ciphertext,
      sessionKey,
      txBytes,
    });
    return new Uint8Array(plaintext);
  } catch (err) {
    throw new SealParseError(
      `Seal SDK decryption failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new SealParseError('Seal identity must be a hex string for decryption approval');
  }

  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
