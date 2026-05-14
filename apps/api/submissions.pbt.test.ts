/**
 * Submissions handler end-to-end pipeline property-based tests
 *
 * **Validates: Requirements R12.3, R12.5**
 *
 * Property: For any valid FormSchema, the full round-trip
 *   create form → submit answers → retrieve submission
 * must return answers that deep-equal what was submitted.
 *
 * Requirements: R12.3, R12.5
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NextRequest } from 'next/server';
import { hkdfSync } from 'node:crypto';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Build a deterministic in-memory signer for tests (no filesystem access)
// ---------------------------------------------------------------------------

function buildTestSigner() {
  const secret = Buffer.from('deadbeef'.repeat(8), 'hex'); // 32 bytes
  const address = '0x' + 'ab'.repeat(32); // 64 hex chars = 32 bytes

  return {
    scheme: 'ed25519' as const,
    address,
    getPublicKey: () => new Uint8Array(32),
    signPersonalMessage: async (_bytes: Uint8Array) => ({ signature: 'sig', bytes: 'bytes' }),
    signTransaction: async (_txBytes: Uint8Array) => ({ signature: 'sig', bytes: 'bytes' }),
    deriveSymmetricKey: (salt: Uint8Array, info: Uint8Array): Uint8Array => {
      const derived = hkdfSync('sha256', secret, salt, info, 32);
      return new Uint8Array(derived);
    },
  };
}

const testSigner = buildTestSigner();

// ---------------------------------------------------------------------------
// Mock @poc/shared so we can control env flags
// ---------------------------------------------------------------------------

const mockEnv = {
  DEV_BYPASS_STORAGE: true,
  DEV_LOCAL_SIGNER: true,
  DEV_ALLOW_PLAINTEXT: false,
  USE_WALRUS_TESTNET: false,
  USE_SUI_TESTNET: false,
  WALRUS_PUBLISHER_URL: 'https://publisher.submissions-pbt.walrus.test',
  WALRUS_AGGREGATOR_URL: 'https://aggregator.submissions-pbt.walrus.test',
  SUI_RPC_URL: 'https://fullnode.testnet.sui.io:443',
  NODE_ENV: 'test' as const,
  POC_ALLOW_PROD: false,
};

vi.mock('@poc/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@poc/shared')>();
  return {
    ...actual,
    loadPocEnv: vi.fn(() => ({ ...mockEnv })),
  };
});

vi.mock('@poc/sui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@poc/sui')>();
  return {
    ...actual,
    detectLocalSigner: vi.fn(async () => ({
      signer: testSigner,
      activeNetwork: 'testnet',
      clientYamlPath: '/mock/.sui/sui_config/client.yaml',
      keystorePath: '/mock/.sui/sui_config/sui.keystore',
    })),
  };
});

// Import handlers AFTER mocking so they pick up the mock
import { POST as formsPost, GET as formsGet } from './forms';
import { POST, GET } from './submissions';
import { canonicalize } from '@poc/shared';
import { encrypt } from '@poc/seal';
import type { FormSchema, PocField } from '@poc/shared';

// ---------------------------------------------------------------------------
// In-memory blob store (MSW publisher/aggregator pair)
// ---------------------------------------------------------------------------

const PUBLISHER_URL = 'https://publisher.submissions-pbt.walrus.test';
const AGGREGATOR_URL = 'https://aggregator.submissions-pbt.walrus.test';

const blobStore = new Map<string, Uint8Array>();

function generateBlobId(bytes: Uint8Array): string {
  let hash = 0;
  for (let i = 0; i < bytes.length; i++) {
    hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
  }
  return `blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`;
}

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer(
  http.put(`${PUBLISHER_URL}/v1/blobs`, async ({ request }) => {
    const buffer = await request.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const blobId = generateBlobId(bytes);
    blobStore.set(blobId, bytes);
    return HttpResponse.json({
      newlyCreated: {
        blobObject: {
          blobId,
          size: bytes.length,
        },
      },
    });
  }),

  http.get(`${AGGREGATOR_URL}/v1/blobs/:blobId`, ({ params }) => {
    const blobId = decodeURIComponent(params.blobId as string);
    const bytes = blobStore.get(blobId);
    if (!bytes) {
      return new HttpResponse('Not Found', { status: 404 });
    }
    return new HttpResponse(bytes, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  blobStore.clear();
});
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormsPostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/poc/forms', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/poc/submissions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGetRequest(blobId: string): NextRequest {
  return new NextRequest(`http://localhost/api/poc/submissions/${blobId}`, {
    method: 'GET',
  });
}

function makeGetContext(blobId: string) {
  return { params: Promise.resolve({ blob_id: blobId }) };
}

/**
 * Upload an encrypted form blob directly into the in-memory store.
 * Returns the blob_id that can be used as form_blob_id in submissions.
 */
async function uploadEncryptedFormBlob(schema: FormSchema): Promise<string> {
  const plainBytes = canonicalize(schema);
  const encryptedBytes = await encrypt(plainBytes, testSigner, 'form');
  const blobId = generateBlobId(encryptedBytes);
  blobStore.set(blobId, encryptedBytes);
  return blobId;
}

/**
 * Build a valid answers object for a given FormSchema.
 * Fills every field with a type-appropriate value.
 */
function buildValidAnswers(schema: FormSchema): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const field of schema.fields) {
    switch (field.type) {
      case 'text':
        answers[field.label] = 'test value';
        break;
      case 'textarea':
        answers[field.label] = 'test long text';
        break;
      case 'email':
        answers[field.label] = 'test@example.com';
        break;
      case 'number':
        answers[field.label] = 42;
        break;
      case 'select':
        answers[field.label] = field.options?.[0] ?? 'option1';
        break;
      case 'checkbox':
        answers[field.label] = true;
        break;
    }
  }
  return answers;
}

// ---------------------------------------------------------------------------
// FormSchema arbitrary (reuses the same pattern as forms.pbt.test.ts)
// ---------------------------------------------------------------------------

const BANNED_KEYS = new Set([
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'prototype',
]);

function nonEmptyStringArb(maxLength: number): fc.Arbitrary<string> {
  return fc
    .stringMatching(/^[ !#-[\]-~]+$/, { maxLength })
    .filter((s) => s.length >= 1 && !BANNED_KEYS.has(s));
}

const isoDateArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

const fieldTypeArb = fc.constantFrom(
  'text' as const,
  'textarea' as const,
  'email' as const,
  'number' as const,
  'select' as const,
  'checkbox' as const,
);

const pocFieldArb: fc.Arbitrary<PocField> = fieldTypeArb.chain((type) => {
  if (type === 'select') {
    return fc
      .record({
        type: fc.constant(type as 'select'),
        label: nonEmptyStringArb(100),
        required: fc.option(fc.boolean(), { nil: undefined }),
        options: fc.option(
          fc.array(nonEmptyStringArb(50), { minLength: 1, maxLength: 10 }),
          { nil: undefined },
        ),
      })
      .map((f) => {
        const result: PocField = {
          type: f.type,
          label: f.label,
        };
        if (f.required !== undefined) result.required = f.required;
        if (f.options !== undefined) result.options = f.options;
        return result;
      });
  }

  return fc
    .record({
      type: fc.constant(type),
      label: nonEmptyStringArb(100),
      required: fc.option(fc.boolean(), { nil: undefined }),
    })
    .map((f) => {
      const result: PocField = {
        type: f.type,
        label: f.label,
      };
      if (f.required !== undefined) result.required = f.required;
      return result;
    });
});

const formSchemaArb: fc.Arbitrary<FormSchema> = fc.record({
  title: nonEmptyStringArb(200),
  fields: fc.array(pocFieldArb, { minLength: 0, maxLength: 5 }),
  version: fc.constant(1 as const),
  created_at: isoDateArb,
});

// ---------------------------------------------------------------------------
// Property: end-to-end round-trip for submissions
// ---------------------------------------------------------------------------

describe('Submissions handler PBT — end-to-end pipeline round-trip', () => {
  /**
   * **Validates: Requirements R12.3, R12.5**
   *
   * For any valid FormSchema:
   *   1. Upload the form (encrypted) → get form_blob_id
   *   2. Build valid answers for all fields
   *   3. POST submission with form_blob_id + answers → get blob_id
   *   4. GET submission by blob_id → decrypt → parse
   *   5. Assert retrieved answers deep-equal submitted answers
   *
   * This exercises the full submission pipeline:
   *   form upload → submit answers → encrypt → walrus.put
   *   → walrus.get → decrypt → parse → answers
   */
  it('Property: POST(submission) then GET returns deep-equal answers for all valid FormSchema', async () => {
    await fc.assert(
      fc.asyncProperty(formSchemaArb, async (schema) => {
        // 1. Upload form
        const formBlobId = await uploadEncryptedFormBlob(schema);

        // 2. Build valid answers (fill all fields with valid values)
        const answers = buildValidAnswers(schema);

        // 3. POST submission
        const postRes = await POST(makePostRequest({ form_blob_id: formBlobId, answers }));
        expect(postRes.status).toBe(200);
        const { blob_id } = await postRes.json();

        // 4. GET submission
        const getRes = await GET(makeGetRequest(blob_id), makeGetContext(blob_id));
        expect(getRes.status).toBe(200);
        const retrieved = await getRes.json();

        // 5. Assert answers match
        expect(retrieved.answers).toEqual(answers);
      }),
      { numRuns: 10 },
    );
  });
});
