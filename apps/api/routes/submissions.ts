/**
 * Submissions route for the Express VPS server.
 *
 * POST /api/forms/:formId/submissions
 *   - Validates request body
 *   - Encrypts payload via @poc/seal using INFRA_WALLET_PRIVATE_KEY
 *   - Stores encrypted blob on Walrus
 *   - Returns { blob_id, form_id, submitted_at }
 *
 * Public route — no authentication required for submitting.
 * Authentication is enforced at the /api router level for admin reads.
 *
 * Requirements: R6, R7, R9
 */

import { Router } from 'express';
import type { ServerConfig } from '../server-config';
import { loadPocEnv } from '@poc/shared';
import { encrypt } from '@poc/seal';
import { createWalrusClient } from '@poc/walrus';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { PocSigner } from '@poc/sui';
import { ApiError } from '../middleware/error-handler';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldValue {
  fieldId: string;
  fieldType: string;
  value: string | number | boolean | string[] | null;
  encrypted?: boolean;
}

interface SubmitBody {
  formSlug: string;
  formVersion: number;
  fields: FieldValue[];
  metadata?: { userAgent?: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function validateSubmitBody(body: unknown): SubmitBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }

  const b = body as Record<string, unknown>;

  if (typeof b.formSlug !== 'string' || !b.formSlug) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'formSlug is required.');
  }
  if (typeof b.formVersion !== 'number' || !Number.isInteger(b.formVersion) || b.formVersion < 1) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'formVersion must be a positive integer.');
  }
  if (!Array.isArray(b.fields)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'fields must be an array.');
  }

  return b as unknown as SubmitBody;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function submissionsRouter(config: ServerConfig): Router {
  const router = Router();

  /**
   * POST /api/forms/:formId/submissions
   *
   * Public — no auth required (form submitters are anonymous).
   * Encrypts the submission via @poc/seal and stores on Walrus.
   */
  router.post('/:formId/submissions', async (req, res, next) => {
    try {
      const { formId } = req.params;

      if (!formId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'formId is required.');
      }

      const body = validateSubmitBody(req.body);

      // Load env (cached after first call)
      const env = loadPocEnv();

      // Build the submission payload
      const submittedAt = new Date().toISOString();
      const submissionId = crypto.randomUUID();

      const payload = {
        id: submissionId,
        formId,
        formSlug: body.formSlug,
        formVersion: body.formVersion,
        fields: body.fields,
        submittedAt,
        metadata: {
          userAgent: body.metadata?.userAgent ?? '',
          // SECURITY: IP address is never logged or stored (Engineering Rule 4)
        },
      };

      // ── Encrypt with Seal ──────────────────────────────────────────────────
      // Use formId as the Seal IBE identity — deterministic, tied to the form
      const sealIdentity = `swrap-form-${formId}`;
      const signer = getInfraSigner();
      const plaintext = new TextEncoder().encode(JSON.stringify(payload));

      let encryptedBytes: Uint8Array;
      try {
        encryptedBytes = await encrypt(plaintext, signer, 'subm', sealIdentity);
      } catch (err) {
        console.error('[SubmissionsRoute] Seal encryption failed:', err instanceof Error ? err.message : String(err));
        throw new ApiError(500, 'ENCRYPTION_FAILED', 'Submission encryption failed. Please try again.');
      }

      // ── Store on Walrus ───────────────────────────────────────────────────
      const walrus = createWalrusClient({
        publisherUrl: config.walrusPublisherUrl,
        aggregatorUrl: config.walrusAggregatorUrl,
      });

      let blobId: string;
      try {
        const result = await walrus.put(encryptedBytes);
        blobId = result.blobId;
      } catch (err) {
        console.error('[SubmissionsRoute] Walrus write failed:', err instanceof Error ? err.message : String(err));
        throw new ApiError(502, 'STORAGE_FAILED', 'Failed to store submission. Please try again.');
      }

      console.log(
        JSON.stringify({
          event: 'submission_stored',
          submissionId,
          formId,
          blobId,
          isEncrypted: true,
          timestamp: submittedAt,
        }),
      );

      res.status(201).json({
        submissionId,
        blobId,
        formId,
        submittedAt,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
