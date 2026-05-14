/**
 * packages/seal/src/encryptor.ts
 *
 * Plan A migration note: when @mysten/seal stabilizes and is available as a
 * production-ready package, replace this file with a thin wrapper around the
 * real Seal SDK's encrypt() call. The wire format version byte will move from
 * 0x01 (this fallback) to 0x02 (Seal SDK blobs). Version 0x01 blobs remain
 * decodable for backward compatibility during the migration window.
 *
 * Requirements: R7.1, R7.2, R7.4, R7.5, R7.6
 */

import { SealClient } from '@mysten/seal';
import type { PocSigner } from '@poc/sui';
import { loadPocEnv } from '@poc/shared';
import { encode, type BlobType, SEAL_TESTNET_SERVER_CONFIGS } from './encrypted-blob';
import { createSealSuiClient } from './sui-client';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt `plaintext` using the official @mysten/seal SDK.
 * The resulting blob uses wire-format version 0x02.
 *
 * @param plaintext  Raw bytes to encrypt.
 * @param signer     Local POC signer (provides address).
 * @param blobType   'form' | 'subm' — encoded into the wire header.
 * @param identity   Optional Seal IBE identity string (defaults to signer.address).
 */
export async function encrypt(
  plaintext: Uint8Array,
  signer: PocSigner,
  blobType: BlobType,
  identity?: string,
): Promise<Uint8Array> {
  const env = loadPocEnv();
  const suiClient = createSealSuiClient(env.SUI_RPC_URL);

  const sealClient = new SealClient({
    suiClient,
    serverConfigs: SEAL_TESTNET_SERVER_CONFIGS,
    verifyKeyServers: false,
  });

  // Use the POC package ID for authorization (seal_approve is there)
  if (!env.SUI_POC_PACKAGE_ID) {
    throw new Error('SUI_POC_PACKAGE_ID is required for Seal encryption');
  }

  const finalIdentity = identity ?? signer.address;

  const { encryptedObject } = await sealClient.encrypt({
    packageId: env.SUI_POC_PACKAGE_ID,
    id: finalIdentity,
    data: plaintext,
    threshold: 1, // For POC, threshold 1 is sufficient
  });

  return encode({
    header: {
      version: 2,
      schemeId: 2,
      ownerAddress: signer.address,
      identity: finalIdentity,
      blobType,
    },
    ciphertext: encryptedObject,
  });
}
