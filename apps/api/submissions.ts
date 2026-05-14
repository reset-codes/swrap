/**
 * Submissions handler for the POC.
 *
 * POST /api/poc/submissions
 *   Body: { form_blob_id: string, answers: Record<string, unknown> }
 *   - Fetch form blob from Walrus, decrypt, parse FormSchema
 *   - Compute schema_hash, assemble Submission
 *   - Validate submission against form (validateSubmissionAgainstForm)
 *   - Canonicalize → encrypt → walrus.put
 *   - anchorMetadata (best-effort)
 *   - Return { blob_id, form_blob_id, schema_hash, submitted_at, tx_digest }
 *
 * GET /api/poc/submissions/[blob_id]
 *   - Owner-only decrypt of submission blob
 *   - Returns parsed Submission
 *
 * Requirements: R12.1, R12.2, R12.3, R12.5, R13.1, R13.6
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadPocEnv,
  canonicalize,
  parseFormSchema,
  parseSubmission,
  validateSubmissionAgainstForm,
} from '@poc/shared';
import { schemaHashHexSync } from '@poc/shared/schema-hash-server';
import { encrypt, decrypt } from '@poc/seal';
import { detectLocalSigner, anchorMetadata, createSuiClient } from '@poc/sui';
import { createWalrusClient } from '@poc/walrus';
import { toErrorResponse } from './error-envelope';
import type { Submission } from '@poc/shared';

// ---------------------------------------------------------------------------
// POST handler — submit answers for a form
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Load env
  let env: ReturnType<typeof loadPocEnv>;
  try {
    env = loadPocEnv();
  } catch (err) {
    return toErrorResponse(err);
  }

  // 2. Parse body: { form_blob_id: string, answers: Record<string, unknown> }
  let body: { form_blob_id: unknown; answers: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_BODY',
          stage: 'validate',
          message: 'Request body must be valid JSON',
        },
      },
      { status: 400 },
    );
  }

  if (typeof body.form_blob_id !== 'string' || !body.form_blob_id) {
    return NextResponse.json(
      {
        error: {
          code: 'MISSING_FORM_BLOB_ID',
          stage: 'validate',
          message: 'form_blob_id is required and must be a non-empty string',
        },
      },
      { status: 400 },
    );
  }

  if (
    body.answers === null ||
    body.answers === undefined ||
    typeof body.answers !== 'object' ||
    Array.isArray(body.answers)
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'MISSING_ANSWERS',
          stage: 'validate',
          message: 'answers is required and must be an object',
        },
      },
      { status: 400 },
    );
  }

  const form_blob_id = body.form_blob_id;
  const answers = body.answers as Record<string, unknown>;

  // 3. Detect local signer
  let signerResult: Awaited<ReturnType<typeof detectLocalSigner>>;
  try {
    signerResult = await detectLocalSigner();
  } catch (err) {
    return toErrorResponse(err);
  }

  // 4. Create Walrus client
  const walrus = createWalrusClient({
    publisherUrl: env.WALRUS_PUBLISHER_URL,
    aggregatorUrl: env.WALRUS_AGGREGATOR_URL,
  });

  // 5. Fetch form blob from Walrus
  let formBytes: Uint8Array;
  try {
    formBytes = await walrus.get(form_blob_id);
  } catch (err) {
    return toErrorResponse(err);
  }

  // 6. Decrypt form blob
  let decryptedFormBytes: Uint8Array;
  try {
    decryptedFormBytes = await decrypt(formBytes, signerResult.signer);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'DECRYPT_FAILED',
          stage: 'decrypt',
          message: err instanceof Error ? err.message : 'Decryption of form blob failed',
        },
      },
      { status: 422 },
    );
  }

  // 7. Parse form schema
  let formSchema: ReturnType<typeof parseFormSchema>;
  try {
    formSchema = parseFormSchema(decryptedFormBytes);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'PARSE_FAILED',
          stage: 'parse',
          message: err instanceof Error ? err.message : 'Failed to parse form schema',
        },
      },
      { status: 422 },
    );
  }

  // 8. Compute schema hash
  const schema_hash = schemaHashHexSync(formSchema);

  // 9. Assemble Submission
  const submitted_at = new Date().toISOString();
  const submission: Submission = {
    form_blob_id,
    form_schema_hash: schema_hash,
    answers,
    submitted_at,
  };

  // 10. Validate submission against form (async — uses Web Crypto API)
  try {
    await validateSubmissionAgainstForm(submission, formSchema);
  } catch (err) {
    const issues =
      err instanceof Error && 'issues' in err
        ? (err as { issues: string[] }).issues
        : [err instanceof Error ? err.message : 'Validation failed'];
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_SUBMISSION',
          stage: 'validate',
          message: 'Submission failed validation against form schema',
          details: { issues },
        },
      },
      { status: 400 },
    );
  }

  // 11. Canonicalize
  let plainBytes: Uint8Array;
  try {
    plainBytes = canonicalize(submission);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'SERIALIZE_FAILED',
          stage: 'serialize',
          message: err instanceof Error ? err.message : 'Failed to canonicalize submission',
        },
      },
      { status: 500 },
    );
  }

  // 12. Encrypt
  let encryptedBytes: Uint8Array;
  try {
    encryptedBytes = await encrypt(plainBytes, signerResult.signer, 'subm');
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'ENCRYPT_FAILED',
          stage: 'encrypt',
          message: err instanceof Error ? err.message : 'Encryption failed',
        },
      },
      { status: 500 },
    );
  }

  // 13. Upload to Walrus
  let putResult: Awaited<ReturnType<typeof walrus.put>>;
  try {
    putResult = await walrus.put(encryptedBytes);
  } catch (err) {
    return toErrorResponse(err);
  }

  const blobId = putResult.blobId;

  // 14. Anchor metadata on Sui (best-effort — errors are logged but do not fail the request)
  let tx_digest: string | null = null;
  try {
    const suiClient = createSuiClient(env.SUI_RPC_URL);
    const anchorResult = await anchorMetadata(
      suiClient,
      signerResult.signer,
      { blobId, schemaHash: schema_hash, recordType: 'submission', formBlobId: form_blob_id, createdAt: submitted_at },
      env.SUI_POC_PACKAGE_ID,
    );
    tx_digest = anchorResult.txDigest;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Metadata_Anchor: anchoring failed (non-fatal)', err);
  }

  // 15. Return { blob_id, form_blob_id, schema_hash, submitted_at, tx_digest }
  return NextResponse.json(
    {
      blob_id: blobId,
      form_blob_id,
      schema_hash,
      submitted_at,
      tx_digest,
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// GET handler — retrieve and decrypt a submission blob
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ blob_id: string }> },
): Promise<NextResponse> {
  // 1. Load env
  let env: ReturnType<typeof loadPocEnv>;
  try {
    env = loadPocEnv();
  } catch (err) {
    return toErrorResponse(err);
  }

  // 2. Get blob_id from params
  const { blob_id } = await context.params;

  if (!blob_id) {
    return NextResponse.json(
      {
        error: {
          code: 'MISSING_BLOB_ID',
          stage: 'validate',
          message: 'blob_id is required',
        },
      },
      { status: 400 },
    );
  }

  // 3. Detect local signer
  let signerResult: Awaited<ReturnType<typeof detectLocalSigner>>;
  try {
    signerResult = await detectLocalSigner();
  } catch (err) {
    return toErrorResponse(err);
  }

  // 4. Create Walrus client and fetch submission blob
  const walrus = createWalrusClient({
    publisherUrl: env.WALRUS_PUBLISHER_URL,
    aggregatorUrl: env.WALRUS_AGGREGATOR_URL,
  });

  let bytes: Uint8Array;
  try {
    bytes = await walrus.get(blob_id);
  } catch (err) {
    return toErrorResponse(err);
  }

  // 5. Decrypt
  let decryptedBytes: Uint8Array;
  try {
    decryptedBytes = await decrypt(bytes, signerResult.signer);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'DECRYPT_FAILED',
          stage: 'decrypt',
          message: err instanceof Error ? err.message : 'Decryption failed',
        },
      },
      { status: 422 },
    );
  }

  // 6. Parse submission
  let submission: ReturnType<typeof parseSubmission>;
  try {
    submission = parseSubmission(decryptedBytes);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'PARSE_FAILED',
          stage: 'parse',
          message: err instanceof Error ? err.message : 'Failed to parse submission',
        },
      },
      { status: 422 },
    );
  }

  // 7. Return parsed submission
  return NextResponse.json(submission, { status: 200 });
}
