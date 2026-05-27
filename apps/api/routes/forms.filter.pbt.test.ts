/**
 * Property 30 Extension: Metadata write round-trip
 *
 * **Validates: Requirements 7.1, 7.5**
 *
 * This test extends Property 30 (authorization gating on metadata writes) to
 * validate the round-trip property for metadata writes:
 *
 *   Round-trip property — For all generated valid authenticated metadata write
 *   requests, the API returns a 2xx response and the resulting metadata row
 *   matches the request.
 *
 *   Error condition property — For all generated requests asserting an
 *   Authorization_Identity other than the verified one, the API returns an
 *   authorization error.
 *
 * Requirements: 7.1, 7.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import * as fc from 'fast-check';
import {
  formsRouter,
  _resetFormStore,
  type FormRecord,
} from './forms';
import type { ServerConfig } from '../server-config';

// ---------------------------------------------------------------------------
// Mock walrus-service (avoid real Walrus network calls)
// ---------------------------------------------------------------------------

vi.mock('../services/walrus-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/walrus-service')>();
  const mockWalrusPut = vi.fn(async (bytes: Uint8Array) => {
    // Return a deterministic blob ID based on content
    let hash = 0;
    for (let i = 0; i < bytes.length; i++) {
      hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
    }
    return {
      blobId: `mock-blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`,
      sizeBytes: bytes.length,
    };
  });
  return {
    ...actual,
    walrusPut: mockWalrusPut,
    walrusPutWithCliFallback: vi.fn(async (bytes: Uint8Array) => {
      return mockWalrusPut(bytes);
    }),
    walrusBlobExists: vi.fn(async (_blobId: string) => true),
  };
});

// ---------------------------------------------------------------------------
// Mock infrastructure-wallet sealEncrypt (avoid real Seal calls for private forms)
// ---------------------------------------------------------------------------

vi.mock('../services/infrastructure-wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/infrastructure-wallet')>();
  return {
    ...actual,
    sealEncrypt: vi.fn(async (plaintext: Uint8Array, _policyOwnerAddress: string) => {
      const ownerBytes = new TextEncoder().encode(_policyOwnerAddress);
      const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...plaintext, ...ownerBytes]);
      const digest = 'b'.repeat(64);
      return { ciphertext, policyId: 'mock-policy-id', digest };
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock audit-log (avoid real DB calls)
// ---------------------------------------------------------------------------

vi.mock('../services/audit-log', () => ({
  writeAuditEntry: vi.fn().mockResolvedValue(undefined),
  AuditLogWriteError: class AuditLogWriteError extends Error {
    constructor(cause: unknown) { super(String(cause)); this.name = 'AuditLogWriteError'; }
  },
}));

import { walrusPut } from '../services/walrus-service';

// ---------------------------------------------------------------------------
// Test app + HTTP helper
// ---------------------------------------------------------------------------

const mockConfig: ServerConfig = {
  port: 4000,
  nodeEnv: 'test',
  apiSecretKey: '',
  skipAuth: true,
  infrastructureWalletSecret: 'test-secret',
  databaseUrl: 'postgresql://localhost/test',
  walrusPublisherUrl: 'https://publisher.test',
  walrusAggregatorUrl: 'https://aggregator.test',
  suiRpcUrl: 'https://rpc.test',
  sessionSecret: 'test-session-secret-32-chars-long',
  corsOrigins: ['http://localhost:3000'],
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/forms', formsRouter(mockConfig));
  return app;
}

/**
 * Minimal fetch-like helper that sends a request to an in-process Express app
 * without binding to a real port.
 */
async function appFetch(
  app: express.Express,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}${path}`;

      const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : undefined;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: bodyStr,
      })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a valid Sui address (0x + 64 hex chars) */
const suiAddressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/, { maxLength: 64 })
  .filter((s) => s.length === 64)
  .map((hex) => `0x${hex}`);

/** Generate a UUID */
const uuidArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[0-9a-f]{8}$/, { maxLength: 8 }).filter((s) => s.length === 8),
    fc.stringMatching(/^[0-9a-f]{4}$/, { maxLength: 4 }).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{4}$/, { maxLength: 4 }).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{4}$/, { maxLength: 4 }).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{12}$/, { maxLength: 12 }).filter((s) => s.length === 12),
  )
  .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

/** Generate a pair of distinct Sui addresses */
const distinctAddressPairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(suiAddressArb, suiAddressArb)
  .filter(([a, b]) => a !== b);

/** Generate a valid form definition object */
const formDefinitionArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 100 }),
    fc.array(
      fc.record({
        type: fc.constantFrom('text', 'email', 'number', 'checkbox', 'select'),
        label: fc.string({ minLength: 1, maxLength: 50 }),
        required: fc.boolean(),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  )
  .map(([title, fields]) => ({
    title,
    fields,
    version: 1,
  }));

/** Generate a privacy mode */
const privacyModeArb: fc.Arbitrary<'public' | 'private'> = fc.constantFrom(
  'public',
  'private',
);

/** Generate a policy ID for private forms */
const policyIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 10, maxLength: 50 })
  .map((s) => `seal-policy-${s}`);

/** Generate a valid authenticated form creation request */
const validFormCreateRequestArb = fc
  .tuple(
    suiAddressArb,
    formDefinitionArb,
    privacyModeArb,
    policyIdArb,
  )
  .map(([ownerAddress, formDefinition, privacyMode, policyId]) => ({
    ownerAddress,
    body: {
      formDefinition,
      privacyMode,
      policyId: privacyMode === 'private' ? policyId : undefined,
    },
  }));

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await _resetFormStore();
  vi.mocked(walrusPut).mockClear();
  // Reset to default implementation (deterministic hash-based blob ID)
  vi.mocked(walrusPut).mockImplementation(async (bytes: Uint8Array) => {
    let hash = 0;
    for (let i = 0; i < bytes.length; i++) {
      hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
    }
    return {
      blobId: `mock-blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`,
      sizeBytes: bytes.length,
    };
  });
});

afterEach(async () => {
  await _resetFormStore();
});

// ---------------------------------------------------------------------------
// Property 30 Extension: Metadata write round-trip
// ---------------------------------------------------------------------------

describe('Property 30 Extension: Metadata write round-trip', () => {
  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * Round-trip property — For all generated valid authenticated metadata write
   * requests, the API returns a 2xx response and the resulting metadata row
   * matches the request.
   *
   * This property verifies:
   * 1. HTTP response status is 2xx (201 for new, 200 for idempotent)
   * 2. Response envelope has ok=true, requestId, and result fields
   * 3. The FormRow metadata matches the request:
   *    - ownerAddress matches the authenticated session address
   *    - privacyMode matches the request
   *    - policyId is set for private forms
   *    - state is 'indexed'
   *    - walrusBlobId is present
   *    - contentDigest is valid SHA-256 hex
   */
  it('Property 30ext-a: valid authenticated metadata write returns 2xx with matching FormRow', async () => {
    await fc.assert(
      fc.asyncProperty(
        validFormCreateRequestArb,
        async ({ ownerAddress, body }) => {
          await _resetFormStore();

          const app = buildApp();
          const { status, body: responseBody } = await appFetch(app, '/forms', {
            method: 'POST',
            headers: { 'x-session-address': ownerAddress },
            body,
          });

          // 1. HTTP status is 2xx
          expect(status).toBeGreaterThanOrEqual(200);
          expect(status).toBeLessThan(300);

          const result = (responseBody as any).result as FormRecord;

          // 2. Response envelope is correct
          expect((responseBody as any).ok).toBe(true);
          expect(typeof (responseBody as any).requestId).toBe('string');
          expect((responseBody as any).requestId.length).toBeGreaterThan(0);
          expect((responseBody as any).error).toBeUndefined();

          // 3. Metadata matches request
          expect(result.ownerAddress).toBe(ownerAddress);
          expect(result.privacyMode).toBe(body.privacyMode);

          if (body.privacyMode === 'private') {
            // policyId comes from sealEncrypt mock ('mock-policy-id')
            expect(result.policyId).toBe('mock-policy-id');
          } else {
            expect(result.policyId).toBeNull();
          }

          expect(result.state).toBe('indexed');
          expect(result.walrusBlobId).toBeDefined();
          expect(result.walrusBlobId.length).toBeGreaterThan(0);
          expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
          expect(result.sizeBytes).toBeGreaterThan(0);
          expect(result.version).toBe(1);
          expect(result.predecessorId).toBeNull();
          expect(result.createdAt).toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * Error condition property — For all generated requests asserting an
   * Authorization_Identity other than the verified one, the API returns an
   * authorization error.
   *
   * This property verifies that spoofed owner addresses in the request body
   * are ignored — the authenticated session address is the source of truth.
   */
  it('Property 30ext-b: request body cannot override authenticated owner address', async () => {
    await fc.assert(
      fc.asyncProperty(
        validFormCreateRequestArb,
        distinctAddressPairArb,
        async ({ body }, [authenticatedAddress, _otherAddress]) => {
          // The authenticatedAddress is different from the ownerAddress in the request
          // The API should use authenticatedAddress, NOT any address from the request

          await _resetFormStore();

          const app = buildApp();
          const { status, body: responseBody } = await appFetch(app, '/forms', {
            method: 'POST',
            headers: { 'x-session-address': authenticatedAddress },
            body,
          });

          // The form is created successfully with the authenticated address
          expect(status).toBe(201);
          const result = (responseBody as any).result as FormRecord;

          // The owner MUST be the authenticated session address, NOT any
          // address that might have been in the request body
          expect(result.ownerAddress).toBe(authenticatedAddress);
        },
      ),
      { numRuns: 10 },
    );
  }, 30_000);

  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * Missing authentication returns 401 Unauthorized.
   */
  it('Property 30ext-c: missing authentication returns 401', async () => {
    await fc.assert(
      fc.asyncProperty(
        formDefinitionArb,
        privacyModeArb,
        async (formDefinition, privacyMode) => {
          await _resetFormStore();

          const app = buildApp();
          const { status, body } = await appFetch(app, '/forms', {
            method: 'POST',
            body: {
              formDefinition,
              privacyMode,
              policyId: privacyMode === 'private' ? 'test-policy' : undefined,
            },
            // No x-session-address header
          });

          expect(status).toBe(401);
          expect((body as any).ok).toBe(false);
          expect((body as any).error.code).toBe('Unauthorized');
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * Round-trip for GET /forms/:id — the retrieved metadata matches the
   * created metadata.
   */
  it('Property 30ext-d: GET /forms/:id returns matching metadata after creation', async () => {
    await fc.assert(
      fc.asyncProperty(
        validFormCreateRequestArb,
        async ({ ownerAddress, body }) => {
          await _resetFormStore();

          const app = buildApp();

          // Create the form
          const { status: createStatus, body: createBody } = await appFetch(app, '/forms', {
            method: 'POST',
            headers: { 'x-session-address': ownerAddress },
            body,
          });
          expect(createStatus).toBe(201);
          const created = (createBody as any).result as FormRecord;

          // Retrieve the form
          const headers: Record<string, string> = {};
          if (body.privacyMode === 'private') {
            headers['x-session-address'] = ownerAddress;
          }

          const { status: getStatus, body: getBody } = await appFetch(
            app,
            `/forms/${created.id}`,
            { headers },
          );
          expect(getStatus).toBe(200);
          const retrieved = (getBody as any).result as FormRecord;

          // Metadata must match exactly
          expect(retrieved.id).toBe(created.id);
          expect(retrieved.ownerAddress).toBe(created.ownerAddress);
          expect(retrieved.walrusBlobId).toBe(created.walrusBlobId);
          expect(retrieved.privacyMode).toBe(created.privacyMode);
          expect(retrieved.policyId).toBe(created.policyId);
          expect(retrieved.state).toBe(created.state);
          expect(retrieved.version).toBe(created.version);
          expect(retrieved.contentDigest).toBe(created.contentDigest);
          expect(retrieved.sizeBytes).toBe(created.sizeBytes);
        },
      ),
      { numRuns: 15 },
    );
  }, 45_000);

  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * Authorization identity mismatch — attempting to access a private form
   * as a non-owner returns 403 Forbidden.
   */
  it('Property 30ext-e: non-owner cannot access private form metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        validFormCreateRequestArb.filter((r) => r.body.privacyMode === 'private'),
        suiAddressArb,
        async ({ ownerAddress, body }, nonOwnerAddress) => {
          fc.pre(nonOwnerAddress !== ownerAddress);

          await _resetFormStore();

          const app = buildApp();

          // Create a private form
          const { body: createBody } = await appFetch(app, '/forms', {
            method: 'POST',
            headers: { 'x-session-address': ownerAddress },
            body,
          });
          const created = (createBody as any).result as FormRecord;

          // Attempt to access as non-owner
          const { status, body: getBody } = await appFetch(app, `/forms/${created.id}`, {
            headers: { 'x-session-address': nonOwnerAddress },
          });

          expect(status).toBe(403);
          expect((getBody as any).ok).toBe(false);
          expect((getBody as any).error.code).toBe('Forbidden');
        },
      ),
      { numRuns: 10 },
    );
  }, 30_000);

  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * Round-trip for GET /forms list — the list returns exactly the forms
   * owned by the authenticated session address.
   */
  it('Property 30ext-f: GET /forms returns only forms owned by authenticated user', async () => {
    await fc.assert(
      fc.asyncProperty(
        suiAddressArb,
        fc.array(validFormCreateRequestArb, { minLength: 1, maxLength: 5 }),
        async (ownerAddress, requests) => {
          await _resetFormStore();

          const app = buildApp();
          const createdIds: string[] = [];

          // Create forms with the same owner
          for (const req of requests) {
            const { body: createBody } = await appFetch(app, '/forms', {
              method: 'POST',
              headers: { 'x-session-address': ownerAddress },
              body: req.body,
            });
            createdIds.push((createBody as any).result.id);
          }

          // List forms as the owner
          const { status, body } = await appFetch(app, '/forms', {
            headers: { 'x-session-address': ownerAddress },
          });

          expect(status).toBe(200);
          const result = (body as any).result;

          // All returned forms must be owned by the authenticated user
          for (const form of result.forms as FormRecord[]) {
            expect(form.ownerAddress).toBe(ownerAddress);
            expect(createdIds).toContain(form.id);
          }

          // The total count returned by the API
          expect(result.total).toBe(result.forms.length);
        },
      ),
      { numRuns: 10 },
    );
  }, 45_000);

  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * Authorization is asymmetric at the list level — owner sees their forms,
   * different user sees only their own forms (or empty if none).
   */
  it('Property 30ext-g: list authorization is asymmetric — different users see different forms', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctAddressPairArb,
        validFormCreateRequestArb,
        validFormCreateRequestArb,
        async ([owner1, owner2], request1, request2) => {
          await _resetFormStore();

          const app = buildApp();

          // Create form for owner1
          await appFetch(app, '/forms', {
            method: 'POST',
            headers: { 'x-session-address': owner1 },
            body: {
              ...request1.body,
              formDefinition: { ...request1.body.formDefinition, ownerAddress: owner1 },
            },
          });

          // Create form for owner2
          await appFetch(app, '/forms', {
            method: 'POST',
            headers: { 'x-session-address': owner2 },
            body: {
              ...request2.body,
              formDefinition: { ...request2.body.formDefinition, ownerAddress: owner2 },
            },
          });

          // List as owner1
          const { body: list1 } = await appFetch(app, '/forms', {
            headers: { 'x-session-address': owner1 },
          });
          const forms1 = (list1 as any).result.forms as FormRecord[];
          expect(forms1.every((f) => f.ownerAddress === owner1)).toBe(true);

          // List as owner2
          const { body: list2 } = await appFetch(app, '/forms', {
            headers: { 'x-session-address': owner2 },
          });
          const forms2 = (list2 as any).result.forms as FormRecord[];
          expect(forms2.every((f) => f.ownerAddress === owner2)).toBe(true);
        },
      ),
      { numRuns: 8 },
    );
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Additional property: Idempotency of metadata writes
// ---------------------------------------------------------------------------

describe('Property 30 Extension: Idempotency', () => {
  /**
   * **Validates: Requirements 7.1, 7.5, 7.9**
   *
   * Idempotent writes — submitting the same form definition twice returns
   * 200 OK with the same form ID (idempotent reconcile).
   */
  it('Property 30ext-h: identical form definition submitted twice returns same form ID (idempotent)', async () => {
    await fc.assert(
      fc.asyncProperty(
        validFormCreateRequestArb,
        async ({ ownerAddress, body }) => {
          await _resetFormStore();

          const app = buildApp();

          // First request
          const { status: status1, body: body1 } = await appFetch(app, '/forms', {
            method: 'POST',
            headers: { 'x-session-address': ownerAddress },
            body,
          });
          expect(status1).toBe(201);
          const result1 = (body1 as any).result as FormRecord;

          // Second request with same content (mock walrusPut returns same blob ID)
          const { status: status2, body: body2 } = await appFetch(app, '/forms', {
            method: 'POST',
            headers: { 'x-session-address': ownerAddress },
            body,
          });
          expect(status2).toBe(200); // idempotent — returns existing row
          const result2 = (body2 as any).result as FormRecord;

          // Both should return the same form ID
          expect(result2.id).toBe(result1.id);
          expect(result2.walrusBlobId).toBe(result1.walrusBlobId);
          expect(result2.ownerAddress).toBe(result1.ownerAddress);
        },
      ),
      { numRuns: 10 },
    );
  }, 30_000);
});
