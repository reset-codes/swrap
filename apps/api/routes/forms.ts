/**
 * Forms route for the Express VPS server.
 *
 * GET /api/forms/:formId — Retrieves a form schema from Walrus (decrypted)
 *
 * Requires admin auth (enforced at the /api router level).
 *
 * Requirements: R6, R8
 */

import { Router } from 'express';
import type { ServerConfig } from '../server-config';
import { decrypt } from '@poc/seal';
import { createWalrusClient } from '@poc/walrus';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { PocSigner } from '@poc/sui';
import { ApiError } from '../middleware/error-handler';

function getInfraSigner(): PocSigner {
  const rawKey = process.env.INFRA_WALLET_PRIVATE_KEY ?? '';
  if (!rawKey) {
    throw new ApiError(500, 'INFRA_NOT_CONFIGURED', 'Infrastructure wallet not configured.');
  }
  const { scheme, secretKey } = decodeSuiPrivateKey(rawKey);
  if (scheme !== 'ED25519') {
    throw new ApiError(500, 'INFRA_KEY_INVALID', 'Infrastructure wallet must be an ED25519 key.');
  }
  const kp = Ed25519Keypair.fromSecretKey(secretKey);
  return Object.freeze({
    scheme: 'ed25519' as const,
    address: kp.toSuiAddress(),
    toSuiAddress: () => kp.toSuiAddress(),
    getKeyScheme: () => 'ed25519' as const,
    getPublicKey: () => kp.getPublicKey(),
    signPersonalMessage: (bytes: Uint8Array) => kp.signPersonalMessage(bytes),
    signTransaction: (txBytes: Uint8Array) => kp.signTransaction(txBytes),
  } satisfies PocSigner);
}

export function formsRouter(config: ServerConfig): Router {
  const router = Router();

  /**
   * GET /api/forms/:formId?blob_id=<walrus_blob_id>
   *
   * Retrieves and decrypts a form schema blob from Walrus.
   * Requires ?blob_id query param (the Walrus blob ID for the form schema).
   */
  router.get('/:formId', async (req, res, next) => {
    try {
      const { formId } = req.params;
      const blobId = req.query.blob_id as string | undefined;

      if (!blobId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'blob_id query parameter is required.');
      }

      // Fetch from Walrus
      const walrus = createWalrusClient({
        publisherUrl: config.walrusPublisherUrl,
        aggregatorUrl: config.walrusAggregatorUrl,
      });

      let blobBytes: Uint8Array;
      try {
        blobBytes = await walrus.get(blobId);
      } catch (err) {
        console.error('[FormsRoute] Walrus read failed:', err instanceof Error ? err.message : String(err));
        throw new ApiError(502, 'STORAGE_READ_FAILED', 'Failed to retrieve form from storage.');
      }

      // Decrypt with infra signer
      const signer = getInfraSigner();
      let decryptedBytes: Uint8Array;
      try {
        decryptedBytes = await decrypt(blobBytes, signer);
      } catch (err) {
        console.error('[FormsRoute] Decryption failed:', err instanceof Error ? err.message : String(err));
        throw new ApiError(422, 'DECRYPT_FAILED', 'Failed to decrypt form data.');
      }

      // Parse as JSON
      let formSchema: unknown;
      try {
        formSchema = JSON.parse(new TextDecoder().decode(decryptedBytes));
      } catch {
        throw new ApiError(422, 'PARSE_FAILED', 'Decrypted form data is not valid JSON.');
      }

      res.json({
        formId,
        blobId,
        formSchema,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
