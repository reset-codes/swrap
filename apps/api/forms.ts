/**
 * Forms handler for the POC.
 *
 * POST /api/poc/forms
 *   - Default (no `plaintext: true`): encrypted path.
 *     validate → canonicalize → schemaHashHex → Seal.encrypt → walrus.put
 *     → anchorMetadata (best-effort) → return { blob_id, schema_hash, created_at, tx_digest }
 *   - When DEV_ALLOW_PLAINTEXT=true and body.plaintext===true: plaintext path.
 *     canonicalize → walrus.put → return { blob_id, created_at }
 *
 * GET /api/poc/forms/[blob_id]
 *   - Default (no `?raw=true`): encrypted path.
 *     walrus.get → Seal.decrypt → parseFormSchema → return { form_schema, blob_id, schema_hash }
 *   - When ?raw=true: return raw bytes as application/octet-stream.
 *
 * Requirements: R6.1, R6.2, R6.3, R6.6, R6.7, R7.1, R7.2, R8.1, R8.2, R8.3, R8.6, R13.1, R13.6
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadPocEnv,
  canonicalize,
  FormSchemaSchema,
  parseFormSchema,
} from '@poc/shared';
import { schemaHashHexSync } from '@poc/shared/schema-hash-server';
import { encrypt, decrypt, looksLikeEncryptedBlob } from '@poc/seal';
import { detectLocalSigner, anchorMetadata, createSuiClient } from '@poc/sui';
import { createWalrusClient } from '@poc/walrus';
import { toErrorResponse } from './error-envelope';

// ---------------------------------------------------------------------------
// POST handler — upload form_schema to Walrus
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Load env
  let env: ReturnType<typeof loadPocEnv>;
  try {
    env = loadPocEnv();
  } catch (err) {
    return toErrorResponse(err);
  }

  // 2. Parse body: { form_schema: unknown, plaintext?: boolean }
  let body: { form_schema: unknown; plaintext?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', stage: 'validate', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  // 3. Plaintext path: only allowed when DEV_ALLOW_PLAINTEXT=true AND body.plaintext===true
  if (body.plaintext === true) {
    if (!env.DEV_ALLOW_PLAINTEXT) {
      return NextResponse.json(
        { error: { code: 'PLAINTEXT_DISABLED', stage: 'validate' } },
        { status: 400 },
      );
    }

    // Validate form_schema is present
    if (body.form_schema === undefined || body.form_schema === null) {
      return NextResponse.json(
        { error: { code: 'MISSING_FORM_SCHEMA', stage: 'validate', message: 'form_schema is required' } },
        { status: 400 },
      );
    }

    // Serialize form_schema to canonical JSON bytes
    let bytes: Uint8Array;
    try {
      bytes = canonicalize(body.form_schema);
    } catch (err) {
      return NextResponse.json(
        {
          error: {
            code: 'SERIALIZE_FAILED',
            stage: 'serialize',
            message: err instanceof Error ? err.message : 'Failed to serialize form_schema',
          },
        },
        { status: 500 },
      );
    }

    const walrus = createWalrusClient({
      publisherUrl: env.WALRUS_PUBLISHER_URL,
      aggregatorUrl: env.WALRUS_AGGREGATOR_URL,
    });

    let putResult: Awaited<ReturnType<typeof walrus.put>>;
    try {
      putResult = await walrus.put(bytes);
    } catch (err) {
      return toErrorResponse(err);
    }

    return NextResponse.json(
      {
        blob_id: putResult.blobId,
        created_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  // ---------------------------------------------------------------------------
  // Encrypted path (default — body.plaintext !== true)
  // ---------------------------------------------------------------------------

  // 4. Validate form_schema against FormSchemaSchema
  const parseResult = FormSchemaSchema.safeParse(body.form_schema);
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_FORM_SCHEMA',
          stage: 'validate',
          message: 'form_schema failed validation',
          details: { issues },
        },
      },
      { status: 400 },
    );
  }

  // 5. Canonicalize the validated form_schema
  let plainBytes: Uint8Array;
  try {
    plainBytes = canonicalize(parseResult.data);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'SERIALIZE_FAILED',
          stage: 'serialize',
          message: err instanceof Error ? err.message : 'Failed to canonicalize form_schema',
        },
      },
      { status: 500 },
    );
  }

  // 6. Compute schema_hash from canonical bytes
  const schema_hash = schemaHashHexSync(parseResult.data);

  // 7. Detect local signer
  let signerResult: Awaited<ReturnType<typeof detectLocalSigner>>;
  try {
    signerResult = await detectLocalSigner();
  } catch (err) {
    return toErrorResponse(err);
  }

  // 8. Encrypt the canonical bytes
  let encryptedBytes: Uint8Array;
  try {
    encryptedBytes = await encrypt(plainBytes, signerResult.signer, 'form');
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

  // 9. R8.6: When DEV_ALLOW_PLAINTEXT=false, verify the encrypted output looks like an Encrypted_Blob
  if (!env.DEV_ALLOW_PLAINTEXT && !looksLikeEncryptedBlob(encryptedBytes)) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_ENCRYPTED_BLOB',
          stage: 'validate',
          message: 'Upload rejected: output does not look like an Encrypted_Blob (DEV_ALLOW_PLAINTEXT=false)',
        },
      },
      { status: 400 },
    );
  }

  // 10. Upload to Walrus
  const walrus = createWalrusClient({
    publisherUrl: env.WALRUS_PUBLISHER_URL,
    aggregatorUrl: env.WALRUS_AGGREGATOR_URL,
  });

  let putResult: Awaited<ReturnType<typeof walrus.put>>;
  try {
    putResult = await walrus.put(encryptedBytes);
  } catch (err) {
    return toErrorResponse(err);
  }

  const blobId = putResult.blobId;
  const createdAt = new Date().toISOString();

  // 11. Anchor metadata on Sui (best-effort — errors are logged but do not fail the request)
  let tx_digest: string | null = null;
  try {
    const suiClient = createSuiClient(env.SUI_RPC_URL);
    const anchorResult = await anchorMetadata(
      suiClient,
      signerResult.signer,
      { blobId, schemaHash: schema_hash, recordType: 'form', createdAt },
      env.SUI_POC_PACKAGE_ID,
    );
    tx_digest = anchorResult.txDigest;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Metadata_Anchor: anchoring failed (non-fatal)', err);
  }

  // 12. Return blob_id, schema_hash, created_at, tx_digest
  return NextResponse.json(
    {
      blob_id: blobId,
      schema_hash,
      created_at: createdAt,
      tx_digest,
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// GET handler — retrieve blob from Walrus
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
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
      { error: { code: 'MISSING_BLOB_ID', stage: 'validate', message: 'blob_id is required' } },
      { status: 400 },
    );
  }

  // 3. Create walrus client and retrieve blob
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

  // 4. If ?raw=true, return bytes as application/octet-stream (raw path)
  const raw = request.nextUrl.searchParams.get('raw');
  if (raw === 'true') {
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }

  // ---------------------------------------------------------------------------
  // Encrypted path (default — no ?raw=true)
  // ---------------------------------------------------------------------------

  // 5. Detect local signer
  let signerResult: Awaited<ReturnType<typeof detectLocalSigner>>;
  try {
    signerResult = await detectLocalSigner();
  } catch (err) {
    return toErrorResponse(err);
  }

  // 6. Decrypt the blob bytes
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

  // 7. Parse the decrypted bytes as a FormSchema
  let formSchema: ReturnType<typeof parseFormSchema>;
  try {
    formSchema = parseFormSchema(decryptedBytes);
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

  // 8. Compute schema_hash from the decrypted bytes
  const schema_hash = schemaHashHexSync(formSchema);

  // 9. Return form_schema, blob_id, schema_hash
  return NextResponse.json(
    {
      form_schema: formSchema,
      blob_id,
      schema_hash,
    },
    { status: 200 },
  );
}
