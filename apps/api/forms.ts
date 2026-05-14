/**
 * Forms handler for the POC.
 *
 * POST /api/poc/forms
 *   - When DEV_ALLOW_PLAINTEXT=true and body.plaintext===true:
 *     serializes form_schema to canonical JSON bytes and uploads to Walrus.
 *   - Otherwise returns HTTP 400 PLAINTEXT_DISABLED.
 *
 * GET /api/poc/forms/[blob_id]?raw=true
 *   - Retrieves blob bytes from Walrus.
 *   - If ?raw=true, streams as application/octet-stream.
 *   - Otherwise returns base64-encoded JSON.
 *
 * Requirements: R6.1, R6.2, R6.3, R6.6, R6.7
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadPocEnv } from '@poc/shared';
import { createWalrusClient } from '@poc/walrus';
import { toErrorResponse } from './error-envelope';

// ---------------------------------------------------------------------------
// Canonical JSON serializer (placeholder pre-Phase-3)
// Phase 3 will replace this with Pretty_Printer.canonicalize()
// ---------------------------------------------------------------------------

function canonicalizeJson(value: unknown): Uint8Array {
  const sorted = JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return v;
  });
  return new TextEncoder().encode(sorted);
}

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

  // 3. Gate: if DEV_ALLOW_PLAINTEXT is false OR body.plaintext is not true, reject
  if (!env.DEV_ALLOW_PLAINTEXT || body.plaintext !== true) {
    return NextResponse.json(
      { error: { code: 'PLAINTEXT_DISABLED', stage: 'validate' } },
      { status: 400 },
    );
  }

  // 4. Validate form_schema is present
  if (body.form_schema === undefined || body.form_schema === null) {
    return NextResponse.json(
      { error: { code: 'MISSING_FORM_SCHEMA', stage: 'validate', message: 'form_schema is required' } },
      { status: 400 },
    );
  }

  // 5. Serialize form_schema to canonical JSON bytes
  let bytes: Uint8Array;
  try {
    bytes = canonicalizeJson(body.form_schema);
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

  // 6. Create walrus client and upload
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

  // 7. Return blob_id and created_at
  return NextResponse.json(
    {
      blob_id: putResult.blobId,
      created_at: new Date().toISOString(),
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

  // 4. If ?raw=true, return bytes as application/octet-stream
  const raw = request.nextUrl.searchParams.get('raw');
  if (raw === 'true') {
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }

  // 5. Otherwise return base64-encoded JSON
  const base64 = Buffer.from(bytes).toString('base64');
  return NextResponse.json({ blob_id, data: base64 }, { status: 200 });
}
