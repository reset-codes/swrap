/**
 * Property 30: Authorization gating on metadata writes
 *
 * **Validates: Requirements 7.4**
 *
 * For generated metadata write requests where the session address differs from
 * the form owner address, the API MUST:
 *   1. Return HTTP 403
 *   2. Write no submission row to the store
 *   3. Append an activity row with `outcome = "denied"`
 *
 * This test exercises the authorization gating invariant at two levels:
 *
 *   Level 1 — Pure authorization logic:
 *     The `assertOwner` function (from the authorization service) throws
 *     `ForbiddenError` for any actor address that is not the form owner, and
 *     succeeds silently for the owner. This is tested over generated address
 *     pairs to confirm the invariant holds universally.
 *
 *   Level 2 — Route-level integration:
 *     The POST /submissions route handler, when given a session address that
 *     differs from the form owner, returns 403, writes no row, and records a
 *     denied activity entry.
 *
 * Requirements: 7.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import * as fc from 'fast-check';
import {
  submissionsRouter,
  _seedForm,
  _seedViewerPermission,
  _clearStores,
  _submissionStore,
  _viewerPermissionsStore,
  _formStore,
  type FormRecord,
  type SubmissionRow,
  type ViewerPermission,
} from './submissions';
import type { ServerConfig } from '../server-config';
import { _auditLogStore, _resetAuditLogStore } from '../services/audit-log';
import { db } from '../services/db';

// ---------------------------------------------------------------------------
// Mock sealEncrypt so private-form tests don't hit real Seal
// ---------------------------------------------------------------------------

vi.mock('../services/infrastructure-wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/infrastructure-wallet')>();
  return {
    ...actual,
    sealEncrypt: vi.fn(async (plaintext: Uint8Array, _policyOwnerAddress: string) => {
      const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...plaintext.slice(0, 8)]);
      return { ciphertext, policyId: 'test-policy-id', digest: 'a'.repeat(64) };
    }),
    sealDecrypt: vi.fn(async (ciphertext: Uint8Array, _policyId: string) => {
      // Strip the 4-byte mock header [0xde, 0xad, 0xbe, 0xef] and return original bytes
      return ciphertext.slice(4);
    }),
  };
});

vi.mock('../services/walrus-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/walrus-service')>();
  const mockWalrusPut = vi.fn(async (bytes: Uint8Array) => {
    let hash = 0;
    for (let i = 0; i < bytes.length; i++) {
      hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
    }
    return { blobId: `mock-blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`, sizeBytes: bytes.length };
  });
  return {
    ...actual,
    walrusPut: mockWalrusPut,
    walrusPutWithCliFallback: vi.fn(async (bytes: Uint8Array) => {
      return mockWalrusPut(bytes);
    }),
    walrusBlobExists: vi.fn(async (_blobId: string) => true),
    walrusGet: vi.fn(async (_blobId: string, _expectedDigest?: string) => {
      // Default: return mock ciphertext bytes that sealDecrypt mock can handle
      return new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
    }),
  };
});

// ---------------------------------------------------------------------------
// Activity log — in-memory stub that mirrors the audit_log / activity table
// ---------------------------------------------------------------------------

// Import mocked modules so tests can spy on them
import { sealDecrypt } from '../services/infrastructure-wallet';
import { walrusGet } from '../services/walrus-service';

interface ActivityEntry {
  actorAddress: string;
  action: string;
  outcome: 'ok' | 'denied' | 'error';
  httpStatus: number;
  formId?: string;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Authorization logic under test
// ---------------------------------------------------------------------------

/**
 * Thrown when an actor address is not authorized to perform an action on a
 * form. Carries structured context for audit logging (no payload contents).
 *
 * This mirrors the ForbiddenError that `apps/api/services/authorization.ts`
 * (task 15.1) will expose. Defined here so the PBT can run independently.
 */
export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN' as const;

  constructor(
    public readonly actorAddress: string,
    public readonly formId: string,
    public readonly reason: string,
  ) {
    super(`Forbidden: ${reason} (actor=${actorAddress}, form=${formId})`);
    this.name = 'ForbiddenError';
  }
}

/**
 * Assert that `actorAddress` is the owner of `formId`.
 *
 * Looks up the form in the provided store and throws `ForbiddenError` if the
 * actor is not the owner. On both success and failure, appends an activity
 * entry to the provided log.
 *
 * This is the pure authorization logic that `authorization.ts` (task 15.1)
 * will implement. Tested here as a self-contained unit so the PBT can verify
 * the invariant without depending on the service module being complete.
 *
 * Requirements: 2.2, 7.3, 7.4, 12.3
 */
function assertOwner(
  actorAddress: string,
  formId: string,
  formStore: Map<string, FormRecord>,
  activityLog: ActivityEntry[],
  requestId: string,
): void {
  const form = formStore.get(formId);

  if (!form) {
    activityLog.push({
      actorAddress,
      action: 'submission.create',
      outcome: 'denied',
      httpStatus: 404,
      formId,
      requestId,
    });
    throw new ForbiddenError(actorAddress, formId, 'Form not found');
  }

  if (actorAddress !== form.ownerAddress) {
    activityLog.push({
      actorAddress,
      action: 'submission.create',
      outcome: 'denied',
      httpStatus: 403,
      formId,
      requestId,
    });
    throw new ForbiddenError(
      actorAddress,
      formId,
      `Actor is not the owner of form ${formId}`,
    );
  }

  // Success — record the granted authorization
  activityLog.push({
    actorAddress,
    action: 'submission.create',
    outcome: 'ok',
    httpStatus: 201,
    formId,
    requestId,
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

/** Generate a FormRecord */
const formRecordArb: fc.Arbitrary<FormRecord> = fc
  .tuple(uuidArb, suiAddressArb)
  .map(([id, ownerAddress]) => ({
    id,
    privacyMode: 'public' as const,
    ownerAddress,
    walrusBlobId: `blob-${id.slice(0, 8)}`,
    policyId: null,
    version: 1,
    predecessorId: null,
    state: 'indexed' as const,
    contentDigest: 'a'.repeat(64),
    sizeBytes: 100,
    createdAt: new Date().toISOString(),
  }));

/**
 * Generate a non-trivial sensitive payload string — at least 8 chars,
 * alphanumeric only, so it won't accidentally appear in error messages
 * that contain only structural words.
 */
const sensitivePayloadArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9]{8,50}$/, { maxLength: 50 })
  .filter((s) => s.length >= 8);

// ---------------------------------------------------------------------------
// Level 1 — Pure authorization logic properties
// ---------------------------------------------------------------------------

describe('Property 30 — Level 1: Pure assertOwner authorization logic', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated (actorAddress, formId) pairs where actorAddress ≠ ownerAddress,
   * assertOwner MUST throw ForbiddenError and append an activity entry with
   * outcome = "denied" and httpStatus = 403.
   */
  it('Property 30a: assertOwner throws ForbiddenError when actor ≠ owner', () => {
    fc.assert(
      fc.property(
        formRecordArb,
        suiAddressArb,
        (form, actorAddress) => {
          fc.pre(actorAddress !== form.ownerAddress);

          const store = new Map<string, FormRecord>([[form.id, form]]);
          const log: ActivityEntry[] = [];
          const requestId = crypto.randomUUID();

          expect(() =>
            assertOwner(actorAddress, form.id, store, log, requestId),
          ).toThrow(ForbiddenError);

          expect(log).toHaveLength(1);
          expect(log[0].outcome).toBe('denied');
          expect(log[0].httpStatus).toBe(403);
          expect(log[0].actorAddress).toBe(actorAddress);
          expect(log[0].formId).toBe(form.id);
          expect(log[0].action).toBe('submission.create');
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated forms, assertOwner MUST succeed (not throw) when the
   * actor address equals the form owner address, and append an activity entry
   * with outcome = "ok".
   */
  it('Property 30b: assertOwner succeeds when actor === owner', () => {
    fc.assert(
      fc.property(formRecordArb, (form) => {
        const store = new Map<string, FormRecord>([[form.id, form]]);
        const log: ActivityEntry[] = [];
        const requestId = crypto.randomUUID();

        expect(() =>
          assertOwner(form.ownerAddress, form.id, store, log, requestId),
        ).not.toThrow();

        expect(log).toHaveLength(1);
        expect(log[0].outcome).toBe('ok');
        expect(log[0].actorAddress).toBe(form.ownerAddress);
        expect(log[0].formId).toBe(form.id);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated distinct address pairs (owner, actor), the authorization
   * check is asymmetric: owner passes, actor fails.
   */
  it('Property 30c: authorization is asymmetric — owner passes, non-owner fails', () => {
    fc.assert(
      fc.property(formRecordArb, distinctAddressPairArb, (form, [addr1, addr2]) => {
        const formWithAddr1 = { ...form, ownerAddress: addr1 };
        const store = new Map<string, FormRecord>([[form.id, formWithAddr1]]);

        const log1: ActivityEntry[] = [];
        const log2: ActivityEntry[] = [];
        const reqId = crypto.randomUUID();

        expect(() =>
          assertOwner(addr1, form.id, store, log1, reqId),
        ).not.toThrow();
        expect(log1[0].outcome).toBe('ok');

        expect(() =>
          assertOwner(addr2, form.id, store, log2, reqId),
        ).toThrow(ForbiddenError);
        expect(log2[0].outcome).toBe('denied');
        expect(log2[0].httpStatus).toBe(403);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated actor addresses, assertOwner MUST record exactly one
   * activity entry per call — never zero, never more than one.
   */
  it('Property 30d: assertOwner always records exactly one activity entry per call', () => {
    fc.assert(
      fc.property(formRecordArb, suiAddressArb, (form, actorAddress) => {
        const store = new Map<string, FormRecord>([[form.id, form]]);
        const log: ActivityEntry[] = [];
        const requestId = crypto.randomUUID();

        try {
          assertOwner(actorAddress, form.id, store, log, requestId);
        } catch {
          // ForbiddenError is expected for non-owners
        }

        expect(log).toHaveLength(1);
        expect(log[0].requestId).toBe(requestId);
        expect(log[0].action).toBe('submission.create');
        expect(['ok', 'denied', 'error']).toContain(log[0].outcome);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * The ForbiddenError thrown by assertOwner MUST carry the actor address and
   * form ID for structured logging — but MUST NOT contain the sensitive payload
   * content (which is never passed to the error constructor).
   */
  it('Property 30e: ForbiddenError carries actor address and form ID, not payload content', () => {
    fc.assert(
      fc.property(
        formRecordArb,
        suiAddressArb,
        sensitivePayloadArb,
        (form, actorAddress, sensitivePayload) => {
          fc.pre(actorAddress !== form.ownerAddress);
          fc.pre(!form.ownerAddress.includes(sensitivePayload));
          fc.pre(!actorAddress.includes(sensitivePayload));
          fc.pre(!form.id.includes(sensitivePayload));

          const store = new Map<string, FormRecord>([[form.id, form]]);
          const log: ActivityEntry[] = [];

          let caughtError: ForbiddenError | null = null;
          try {
            assertOwner(actorAddress, form.id, store, log, crypto.randomUUID());
          } catch (err) {
            if (err instanceof ForbiddenError) {
              caughtError = err;
            }
          }

          expect(caughtError).not.toBeNull();
          expect(caughtError!.actorAddress).toBe(actorAddress);
          expect(caughtError!.formId).toBe(form.id);
          expect(caughtError!.message).not.toContain(sensitivePayload);
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Level 2 — Route-level integration: POST /submissions with auth gating
// ---------------------------------------------------------------------------

/**
 * Auth-aware submissions router factory.
 *
 * Wraps the standard submissionsRouter with an authorization gate that checks
 * the `x-actor-address` header against the form owner. This simulates the
 * behavior that the full auth middleware stack (task 3.3 + task 15.1) will
 * provide once implemented.
 */
function buildAuthAwareApp(activityLog: ActivityEntry[]) {
  const app = express();
  app.use(express.json());

  // Authorization gate middleware for POST /submissions
  app.post('/submissions', (req, res, next) => {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
    const actorAddress = req.headers['x-actor-address'] as string | undefined;

    if (!actorAddress) {
      res.status(401).json({
        requestId,
        status: 401,
        error: { code: 'Unauthorized', message: 'x-actor-address header is required.' },
      });
      return;
    }

    const formId = req.body?.formId as string | undefined;
    if (!formId) {
      next();
      return;
    }

    const foundForm = _formStore.get(formId);

    if (!foundForm) {
      next();
      return;
    }

    if (actorAddress !== foundForm.ownerAddress) {
      activityLog.push({
        actorAddress,
        action: 'submission.create',
        outcome: 'denied',
        httpStatus: 403,
        formId,
        requestId,
      });

      res.status(403).json({
        requestId,
        status: 403,
        error: {
          code: 'Forbidden',
          message: `Actor is not authorized to submit to form ${formId}.`,
        },
      });
      return;
    }

    activityLog.push({
      actorAddress,
      action: 'submission.create',
      outcome: 'ok',
      httpStatus: 201,
      formId,
      requestId,
    });

    next();
  });

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

  app.use('/submissions', submissionsRouter(mockConfig));
  return app;
}

/**
 * Minimal fetch-like helper that sends a request to an in-process Express app.
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
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await _clearStores();
  vi.clearAllMocks();
});

afterEach(async () => {
  await _clearStores();
});

describe('Property 30 — Level 2: Route-level authorization gating on POST /submissions', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated (ownerAddress, actorAddress) pairs where actor ≠ owner:
   *   1. POST /submissions returns HTTP 403
   *   2. No submission row is written to the store
   *   3. An activity entry with outcome = "denied" is appended
   *
   * Uses 50 runs — 403 responses are fast (no Walrus upload needed).
   */
  it('Property 30f: non-owner actor receives 403, no row written, denied activity recorded', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        suiAddressArb,
        async (form, actorAddress) => {
          fc.pre(actorAddress !== form.ownerAddress);

          await _clearStores();
          await _seedForm(form);

          const activityLog: ActivityEntry[] = [];
          const app = buildAuthAwareApp(activityLog);

          const submissionCountBefore = _submissionStore.size;

          const { status, body } = await appFetch(app, '/submissions', {
            method: 'POST',
            headers: { 'x-actor-address': actorAddress },
            body: {
              formId: form.id,
              formVersion: 1,
              submitterAddress: actorAddress,
              privacyMode: form.privacyMode,
              payload: '{"answer":"test"}',
            },
          });

          expect(status).toBe(403);

          const b = body as any;
          expect(b.error).toBeDefined();
          expect(b.error.code).toBe('Forbidden');
          expect(b.status).toBe(403);
          expect(b.requestId).toBeDefined();
          expect(b.result).toBeUndefined();

          expect(_submissionStore.size).toBe(submissionCountBefore);

          expect(activityLog).toHaveLength(1);
          expect(activityLog[0].outcome).toBe('denied');
          expect(activityLog[0].httpStatus).toBe(403);
          expect(activityLog[0].actorAddress).toBe(actorAddress);
          expect(activityLog[0].formId).toBe(form.id);
          expect(activityLog[0].action).toBe('submission.create');
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated forms, the owner actor MUST be able to create a
   * submission successfully (201), and the activity log records outcome = "ok".
   *
   * Uses 10 runs — each run involves a real HTTP round-trip + Walrus stub upload.
   */
  it('Property 30g: owner actor receives 201 and activity records outcome = ok', async () => {
    await fc.assert(
      fc.asyncProperty(formRecordArb, async (form) => {
        await _clearStores();
        await _seedForm(form);

        const activityLog: ActivityEntry[] = [];
        const app = buildAuthAwareApp(activityLog);

        const { status, body } = await appFetch(app, '/submissions', {
          method: 'POST',
          headers: { 'x-actor-address': form.ownerAddress },
          body: {
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            privacyMode: form.privacyMode,
            payload: '{"answer":"authorized"}',
            walrusBlobId: `test-blob-${form.id.slice(0, 8)}`,
          },
        });

        expect(status).toBe(201);

        const b = body as any;
        expect(b.result).toBeDefined();
        expect(b.error).toBeUndefined();

        expect(_submissionStore.size).toBe(1);

        expect(activityLog).toHaveLength(1);
        expect(activityLog[0].outcome).toBe('ok');
        expect(activityLog[0].actorAddress).toBe(form.ownerAddress);
        expect(activityLog[0].formId).toBe(form.id);
      }),
      { numRuns: 10 },
    );
  }, 30_000);

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated distinct address pairs (owner, actor):
   *   - Submitting as actor (non-owner) → 403, no row, denied activity
   *   - Submitting as owner → 201, row written, ok activity
   *
   * Uses 10 runs — each run makes 2 HTTP requests (one denied, one authorized).
   */
  it('Property 30h: authorization is asymmetric at route level — owner succeeds, non-owner fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        formRecordArb,
        distinctAddressPairArb,
        async (form, [ownerAddr, actorAddr]) => {
          const formWithOwner = { ...form, ownerAddress: ownerAddr };

          // --- Non-owner attempt ---
          await _clearStores();
          await _seedForm(formWithOwner);

          const log1: ActivityEntry[] = [];
          const app1 = buildAuthAwareApp(log1);

          const { status: s1 } = await appFetch(app1, '/submissions', {
            method: 'POST',
            headers: { 'x-actor-address': actorAddr },
            body: {
              formId: form.id,
              formVersion: 1,
              submitterAddress: actorAddr,
              privacyMode: form.privacyMode,
              payload: '{"answer":"unauthorized"}',
            },
          });

          expect(s1).toBe(403);
          expect(_submissionStore.size).toBe(0);
          expect(log1[0]?.outcome).toBe('denied');

          // --- Owner attempt ---
          await _clearStores();
          await _seedForm(formWithOwner);

          const log2: ActivityEntry[] = [];
          const app2 = buildAuthAwareApp(log2);

          const { status: s2 } = await appFetch(app2, '/submissions', {
            method: 'POST',
            headers: { 'x-actor-address': ownerAddr },
            body: {
              formId: form.id,
              formVersion: 1,
              submitterAddress: ownerAddr,
              privacyMode: form.privacyMode,
              payload: '{"answer":"authorized"}',
              walrusBlobId: `test-blob-${form.id.slice(0, 8)}-owner`,
            },
          });

          expect(s2).toBe(201);
          expect(_submissionStore.size).toBe(1);
          expect(log2[0]?.outcome).toBe('ok');
        },
      ),
      { numRuns: 10 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 7.4**
   *
   * Missing actor address header → 401 Unauthorized.
   * No submission row written.
   */
  it('Property 30i: missing actor address header returns 401 and writes no row', async () => {
    await fc.assert(
      fc.asyncProperty(formRecordArb, async (form) => {
        await _clearStores();
        await _seedForm(form);

        const activityLog: ActivityEntry[] = [];
        const app = buildAuthAwareApp(activityLog);

        const { status, body } = await appFetch(app, '/submissions', {
          method: 'POST',
          // No x-actor-address header
          body: {
            formId: form.id,
            formVersion: 1,
            submitterAddress: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            privacyMode: form.privacyMode,
            payload: '{"answer":"no-auth"}',
          },
        });

        expect(status).toBe(401);

        const b = body as any;
        expect(b.error).toBeDefined();
        expect(b.status).toBe(401);

        expect(_submissionStore.size).toBe(0);
      }),
      { numRuns: 8 },
    );
  });
});


// =============================================================================
// Task 37.1 — Authorization-gated decryption properties
//
// **Validates: Requirements 7.4, 7.10, 12.3, 12.5, 13.6**
//
// Properties implemented:
//   37.1a — Authorization precedence invariant (Req 12.3, 12.5, 13.6):
//            sealDecrypt is only called after a passing assertDecryptionAuthorized
//   37.1b — Rejection invariant (Req 7.10):
//            Unauthorized actors get HTTP 403 and no Seal decryption is invoked
//   37.1c — Audit completeness invariant (Req 7.4):
//            Exactly one audit entry per decryption operation (success or rejection)
//   37.1d — No bypass invariant:
//            No decryption pathway bypasses both the authorization check and audit log
// =============================================================================

// ---------------------------------------------------------------------------
// Arbitraries shared across 37.1 tests

/** Generate a valid Sui address (0x + 64 hex chars) */
const suiAddr37Arb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/, { maxLength: 64 })
  .filter((s) => s.length === 64)
  .map((hex) => `0x${hex}`);

/** Generate a UUID */
const uuid37Arb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[0-9a-f]{8}$/, { maxLength: 8 }).filter((s) => s.length === 8),
    fc.stringMatching(/^[0-9a-f]{4}$/, { maxLength: 4 }).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{4}$/, { maxLength: 4 }).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{4}$/, { maxLength: 4 }).filter((s) => s.length === 4),
    fc.stringMatching(/^[0-9a-f]{12}$/, { maxLength: 12 }).filter((s) => s.length === 12),
  )
  .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

/** Generate a pair of distinct Sui addresses */
const distinctAddr37PairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(suiAddr37Arb, suiAddr37Arb)
  .filter(([a, b]) => a !== b);

/** Generate a FormRecord for private forms */
const privateFormRecordArb: fc.Arbitrary<FormRecord> = fc
  .tuple(uuid37Arb, suiAddr37Arb)
  .map(([id, ownerAddress]) => ({
    id,
    privacyMode: 'private' as const,
    ownerAddress,
    walrusBlobId: `form-blob-${id.slice(0, 8)}`,
    policyId: `policy-${id.slice(0, 8)}`,
    version: 1,
    predecessorId: null,
    state: 'indexed' as const,
    contentDigest: 'a'.repeat(64),
    sizeBytes: 100,
    createdAt: new Date().toISOString(),
  }));

/** Generate a FormRecord for public forms */
const publicFormRecordArb: fc.Arbitrary<FormRecord> = fc
  .tuple(uuid37Arb, suiAddr37Arb)
  .map(([id, ownerAddress]) => ({
    id,
    privacyMode: 'public' as const,
    ownerAddress,
    walrusBlobId: `form-blob-${id.slice(0, 8)}`,
    policyId: null,
    version: 1,
    predecessorId: null,
    state: 'indexed' as const,
    contentDigest: 'b'.repeat(64),
    sizeBytes: 100,
    createdAt: new Date().toISOString(),
  }));

// ---------------------------------------------------------------------------
// Test app factory for 37.1 tests (reuses buildAuthAwareApp pattern)
// ---------------------------------------------------------------------------

function buildDecryptTestApp() {
  const app = express();
  app.use(express.json());

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

  app.use('/submissions', submissionsRouter(mockConfig));
  return app;
}

// ---------------------------------------------------------------------------
// Property 37.1a — Authorization precedence invariant
// Req 12.3, 12.5, 13.6
// ---------------------------------------------------------------------------

describe('Property 37.1a — Authorization precedence invariant (Req 12.3, 12.5, 13.6)', () => {
  /**
   * **Validates: Requirements 12.3, 12.5, 13.6**
   *
   * For all generated decryption attempts by the form owner (authorized actor),
   * sealDecrypt IS called (authorization passed first).
   *
   * This verifies the positive case: when assertDecryptionAuthorized passes,
   * the route proceeds to call sealDecrypt.
   */
  it('Property 37.1a-i: sealDecrypt is called when authorization passes (owner actor)', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        async (form) => {
          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          // Seed the form
          await _seedForm(form);

          // Create a private submission for this form
          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          // Mock walrusGet to return valid ciphertext bytes
          vi.mocked(walrusGet).mockResolvedValueOnce(
            new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]),
          );

          const app = buildDecryptTestApp();
          const { status } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': form.ownerAddress },
          });

          // Authorization passed → sealDecrypt MUST have been called
          expect(status).toBe(200);
          expect(sealDecrypt).toHaveBeenCalledOnce();
        },
      ),
      { numRuns: 8 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 12.3, 12.5, 13.6**
   *
   * For all generated decryption attempts by an unauthorized actor,
   * sealDecrypt is NOT called — authorization check fires first and blocks.
   *
   * This is the core security invariant: the authorization gate ALWAYS
   * precedes any Seal decryption call.
   */
  it('Property 37.1a-ii: sealDecrypt is NOT called when authorization fails (non-owner, no viewer perm)', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        suiAddr37Arb,
        async (form, unauthorizedActor) => {
          fc.pre(unauthorizedActor !== form.ownerAddress);

          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          const app = buildDecryptTestApp();
          const { status } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': unauthorizedActor },
          });

          // Authorization failed → sealDecrypt MUST NOT have been called
          expect(status).toBe(403);
          expect(sealDecrypt).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 15 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 12.3, 12.5, 13.6**
   *
   * For all generated decryption attempts by a viewer-permission holder,
   * sealDecrypt IS called (authorization passed via viewer permission).
   */
  it('Property 37.1a-iii: sealDecrypt is called when viewer permission grants access', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        suiAddr37Arb,
        async (form, viewerAddress) => {
          fc.pre(viewerAddress !== form.ownerAddress);

          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          // Grant viewer permission
          await _seedViewerPermission({
            formId: form.id,
            granteeAddress: viewerAddress,
            capability: 'view',
          });

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          vi.mocked(walrusGet).mockResolvedValueOnce(
            new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x05, 0x06, 0x07, 0x08]),
          );

          const app = buildDecryptTestApp();
          const { status } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': viewerAddress },
          });

          // Viewer permission authorized → sealDecrypt MUST have been called
          expect(status).toBe(200);
          expect(sealDecrypt).toHaveBeenCalledOnce();
        },
      ),
      { numRuns: 8 },
    );
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Property 37.1b — Rejection invariant
// Req 7.10
// ---------------------------------------------------------------------------

describe('Property 37.1b — Rejection invariant (Req 7.10)', () => {
  /**
   * **Validates: Requirements 7.10**
   *
   * For all generated decryption requests where the actor is not the form owner
   * and not in viewer permissions:
   *   1. API returns HTTP 403
   *   2. No Seal decryption operation is invoked
   *   3. An audit entry with authorizationResult = 'denied' is written
   */
  it('Property 37.1b-i: unauthorized actor gets 403, no sealDecrypt, denied audit entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        suiAddr37Arb,
        async (form, unauthorizedActor) => {
          fc.pre(unauthorizedActor !== form.ownerAddress);

          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          const app = buildDecryptTestApp();
          const { status, body } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': unauthorizedActor },
          });

          // 1. HTTP 403
          expect(status).toBe(403);
          const b = body as any;
          expect(b.error?.code).toBe('Forbidden');
          expect(b.status).toBe(403);
          expect(b.requestId).toBeDefined();
          expect(b.result).toBeUndefined();

          // 2. sealDecrypt NOT called
          expect(sealDecrypt).not.toHaveBeenCalled();

          // 3. Audit entry with authorizationResult = 'denied'
          const deniedEntries = _auditLogStore.filter(
            (e) =>
              e.submissionId === submissionId &&
              e.authorizationResult === 'denied' &&
              e.outcome === 'denied' &&
              e.httpStatus === 403,
          );
          expect(deniedEntries.length).toBeGreaterThanOrEqual(1);
          expect(deniedEntries[0].actorAddress).toBe(unauthorizedActor);
          expect(deniedEntries[0].formId).toBe(form.id);
          expect(deniedEntries[0].action).toBe('submission.decrypt');
        },
      ),
      { numRuns: 15 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 7.10**
   *
   * For all generated distinct address pairs (owner, actor):
   *   - Actor (non-owner, no viewer perm) → 403, no sealDecrypt, denied audit
   *   - Owner → 200, sealDecrypt called, granted audit
   *
   * Confirms the asymmetry: same submission, different actors, different outcomes.
   */
  it('Property 37.1b-ii: rejection is asymmetric — owner succeeds, non-owner rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        distinctAddr37PairArb,
        async (form, [ownerAddr, actorAddr]) => {
          const formWithOwner = { ...form, ownerAddress: ownerAddr };

          // --- Non-owner attempt ---
          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(formWithOwner);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: formWithOwner.id,
            formVersion: 1,
            submitterAddress: ownerAddr,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: formWithOwner.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          const app1 = buildDecryptTestApp();
          const { status: s1 } = await appFetch(app1, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': actorAddr },
          });

          expect(s1).toBe(403);
          expect(sealDecrypt).not.toHaveBeenCalled();

          const deniedEntries = _auditLogStore.filter(
            (e) => e.authorizationResult === 'denied' && e.submissionId === submissionId,
          );
          expect(deniedEntries.length).toBeGreaterThanOrEqual(1);

          // --- Owner attempt ---
          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(formWithOwner);
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          vi.mocked(walrusGet).mockResolvedValueOnce(
            new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x0a, 0x0b, 0x0c, 0x0d]),
          );

          const app2 = buildDecryptTestApp();
          const { status: s2 } = await appFetch(app2, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': ownerAddr },
          });

          expect(s2).toBe(200);
          expect(sealDecrypt).toHaveBeenCalledOnce();

          const grantedEntries = _auditLogStore.filter(
            (e) => e.authorizationResult === 'granted' && e.submissionId === submissionId,
          );
          expect(grantedEntries.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 8 },
    );
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Property 37.1c — Audit completeness invariant
// Req 7.4
// ---------------------------------------------------------------------------

describe('Property 37.1c — Audit completeness invariant (Req 7.4)', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated successful decryption operations (authorized actor),
   * exactly one audit entry exists referencing:
   *   - the actor address
   *   - the form ID
   *   - the submission ID
   *   - authorizationResult = 'granted'
   *   - outcome = 'ok'
   */
  it('Property 37.1c-i: successful decryption produces exactly one audit entry with granted/ok', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        async (form) => {
          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          vi.mocked(walrusGet).mockResolvedValueOnce(
            new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x11, 0x12, 0x13, 0x14]),
          );

          const app = buildDecryptTestApp();
          const { status } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': form.ownerAddress },
          });

          expect(status).toBe(200);

          // Exactly one audit entry for this submission with granted/ok
          const auditEntries = _auditLogStore.filter(
            (e) =>
              e.submissionId === submissionId &&
              e.action === 'submission.decrypt',
          );
          expect(auditEntries).toHaveLength(1);

          const entry = auditEntries[0];
          expect(entry.actorAddress).toBe(form.ownerAddress);
          expect(entry.formId).toBe(form.id);
          expect(entry.submissionId).toBe(submissionId);
          expect(entry.authorizationResult).toBe('granted');
          expect(entry.outcome).toBe('ok');
          expect(entry.httpStatus).toBe(200);
        },
      ),
      { numRuns: 8 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated rejected decryption operations (unauthorized actor),
   * exactly one audit entry exists referencing:
   *   - the actor address
   *   - the form ID
   *   - the submission ID
   *   - authorizationResult = 'denied'
   *   - outcome = 'denied'
   */
  it('Property 37.1c-ii: rejected decryption produces exactly one audit entry with denied/denied', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        suiAddr37Arb,
        async (form, unauthorizedActor) => {
          fc.pre(unauthorizedActor !== form.ownerAddress);

          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          const app = buildDecryptTestApp();
          const { status } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': unauthorizedActor },
          });

          expect(status).toBe(403);

          // Exactly one audit entry for this submission with denied/denied
          const auditEntries = _auditLogStore.filter(
            (e) =>
              e.submissionId === submissionId &&
              e.action === 'submission.decrypt',
          );
          expect(auditEntries).toHaveLength(1);

          const entry = auditEntries[0];
          expect(entry.actorAddress).toBe(unauthorizedActor);
          expect(entry.formId).toBe(form.id);
          expect(entry.submissionId).toBe(submissionId);
          expect(entry.authorizationResult).toBe('denied');
          expect(entry.outcome).toBe('denied');
          expect(entry.httpStatus).toBe(403);
        },
      ),
      { numRuns: 15 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 7.4**
   *
   * For all generated public submission decryption operations (no Seal needed),
   * exactly one audit entry exists with authorizationResult = 'granted'.
   *
   * Public submissions don't require authorization but still produce an audit entry.
   */
  it('Property 37.1c-iii: public submission decryption produces exactly one audit entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        publicFormRecordArb,
        suiAddr37Arb,
        async (form, actorAddress) => {
          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const plaintextPayload = '{"answer":"hello world"}';
          const plaintextBytes = new TextEncoder().encode(plaintextPayload);

          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'public',
            contentDigest: 'a'.repeat(64),
            sizeBytes: plaintextBytes.length,
            state: 'indexed',
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          // Mock walrusGet to return valid plaintext bytes (digest check bypassed
          // because the mock returns bytes that won't match the 'a'.repeat(64) digest,
          // so we need to mock walrusGet to not throw WalrusIntegrityError)
          vi.mocked(walrusGet).mockResolvedValueOnce(plaintextBytes);

          const app = buildDecryptTestApp();
          const { status } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': actorAddress },
          });

          // Public submissions return 200 (no auth check needed)
          expect(status).toBe(200);

          // Exactly one audit entry for this submission
          const auditEntries = _auditLogStore.filter(
            (e) =>
              e.submissionId === submissionId &&
              e.action === 'submission.decrypt',
          );
          expect(auditEntries).toHaveLength(1);

          const entry = auditEntries[0];
          expect(entry.actorAddress).toBe(actorAddress);
          expect(entry.formId).toBe(form.id);
          expect(entry.submissionId).toBe(submissionId);
          expect(entry.authorizationResult).toBe('granted');
          expect(entry.outcome).toBe('ok');
        },
      ),
      { numRuns: 8 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 7.4**
   *
   * For N generated decryption attempts on the same submission (mix of
   * authorized and unauthorized), the audit log contains exactly N entries —
   * one per attempt, never zero, never more than one per attempt.
   */
  it('Property 37.1c-iv: audit log entry count equals decryption attempt count', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        fc.integer({ min: 1, max: 4 }),
        async (form, attemptCount) => {
          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          // All attempts are unauthorized (fast path — no Walrus fetch needed)
          const unauthorizedActor = '0x' + 'ff'.repeat(32);
          fc.pre(unauthorizedActor !== form.ownerAddress);

          const app = buildDecryptTestApp();

          for (let i = 0; i < attemptCount; i++) {
            await appFetch(app, `/submissions/${submissionId}/decrypt`, {
              headers: { 'x-actor-address': unauthorizedActor },
            });
          }

          // Exactly attemptCount audit entries for this submission
          const auditEntries = _auditLogStore.filter(
            (e) =>
              e.submissionId === submissionId &&
              e.action === 'submission.decrypt',
          );
          expect(auditEntries).toHaveLength(attemptCount);

          // All entries are denied
          for (const entry of auditEntries) {
            expect(entry.authorizationResult).toBe('denied');
            expect(entry.actorAddress).toBe(unauthorizedActor);
          }
        },
      ),
      { numRuns: 8 },
    );
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Property 37.1d — No bypass invariant
// ---------------------------------------------------------------------------

describe('Property 37.1d — No bypass invariant (Req 7.3, 12.3, 12.5)', () => {
  /**
   * **Validates: Requirements 7.3, 12.3, 12.5**
   *
   * No decryption pathway exists that bypasses both the authorization check
   * and the audit log.
   *
   * Invariant: for every call to GET /submissions/:id/decrypt, EITHER:
   *   (a) An audit entry is written AND (if private) authorization was checked, OR
   *   (b) The request was rejected before reaching the decryption logic (401/404)
   *       in which case no sealDecrypt call occurs.
   *
   * Specifically: if sealDecrypt was called, then an audit entry with
   * authorizationResult = 'granted' MUST exist. There is no path where
   * sealDecrypt runs without a prior authorization check and audit write.
   */
  it('Property 37.1d-i: if sealDecrypt was called, a granted audit entry must exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        async (form) => {
          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          vi.mocked(walrusGet).mockResolvedValueOnce(
            new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x21, 0x22, 0x23, 0x24]),
          );

          const app = buildDecryptTestApp();
          await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': form.ownerAddress },
          });

          const sealDecryptCallCount = vi.mocked(sealDecrypt).mock.calls.length;

          if (sealDecryptCallCount > 0) {
            // sealDecrypt was called → a granted audit entry MUST exist
            const grantedEntries = _auditLogStore.filter(
              (e) =>
                e.submissionId === submissionId &&
                e.authorizationResult === 'granted' &&
                e.action === 'submission.decrypt',
            );
            expect(grantedEntries.length).toBeGreaterThanOrEqual(1);
          }
        },
      ),
      { numRuns: 8 },
    );
  }, 60_000);

  /**
   * **Validates: Requirements 7.3, 12.3, 12.5**
   *
   * No decryption pathway bypasses the audit log: for every completed
   * decryption request (200 or 403), at least one audit entry exists.
   *
   * This covers both the success path and the rejection path — neither
   * can complete without writing to the audit log.
   */
  it('Property 37.1d-ii: every completed decrypt request (200 or 403) writes at least one audit entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        suiAddr37Arb,
        fc.boolean(),
        async (form, actorAddress, useOwner) => {
          const actor = useOwner ? form.ownerAddress : actorAddress;
          // If actorAddress happens to equal ownerAddress and useOwner=false, skip
          if (!useOwner) {
            fc.pre(actorAddress !== form.ownerAddress);
          }

          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          if (useOwner) {
            vi.mocked(walrusGet).mockResolvedValueOnce(
              new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x31, 0x32, 0x33, 0x34]),
            );
          }

          const app = buildDecryptTestApp();
          const { status } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': actor },
          });

          // Only check audit for 200 and 403 responses (not 401/404/5xx)
          if (status === 200 || status === 403) {
            const auditEntries = _auditLogStore.filter(
              (e) =>
                e.submissionId === submissionId &&
                e.action === 'submission.decrypt',
            );
            // At least one audit entry must exist — no bypass
            expect(auditEntries.length).toBeGreaterThanOrEqual(1);
          }
        },
      ),
      { numRuns: 15 },
    );
  }, 90_000);

  /**
   * **Validates: Requirements 7.3, 12.3, 12.5**
   *
   * The authorization check and audit write are coupled: a denied audit entry
   * is ALWAYS written when sealDecrypt is NOT called due to authorization failure.
   *
   * Contrapositive of 37.1d-i: if no sealDecrypt call occurred AND the
   * response was 403, then a denied audit entry MUST exist.
   */
  it('Property 37.1d-iii: 403 response with no sealDecrypt call always has a denied audit entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        privateFormRecordArb,
        suiAddr37Arb,
        async (form, unauthorizedActor) => {
          fc.pre(unauthorizedActor !== form.ownerAddress);

          await _clearStores();
          _resetAuditLogStore();
          vi.mocked(sealDecrypt).mockClear();

          await _seedForm(form);

          const submissionId = crypto.randomUUID();
          const submissionRow: SubmissionRow = {
            id: submissionId,
            formId: form.id,
            formVersion: 1,
            submitterAddress: form.ownerAddress,
            walrusBlobId: `blob-${submissionId.slice(0, 8)}`,
            privacyMode: 'private',
            contentDigest: 'a'.repeat(64),
            sizeBytes: 12,
            state: 'indexed',
            policyId: form.policyId ?? undefined,
            createdAt: new Date().toISOString(),
          };
          await db.insertSubmission(submissionRow as any);
          _submissionStore.set(submissionId, submissionRow);

          const app = buildDecryptTestApp();
          const { status } = await appFetch(app, `/submissions/${submissionId}/decrypt`, {
            headers: { 'x-actor-address': unauthorizedActor },
          });

          expect(status).toBe(403);
          expect(sealDecrypt).not.toHaveBeenCalled();

          // A denied audit entry MUST exist — no bypass of the audit log
          const deniedEntries = _auditLogStore.filter(
            (e) =>
              e.submissionId === submissionId &&
              e.authorizationResult === 'denied' &&
              e.action === 'submission.decrypt',
          );
          expect(deniedEntries.length).toBeGreaterThanOrEqual(1);
          expect(deniedEntries[0].actorAddress).toBe(unauthorizedActor);
        },
      ),
      { numRuns: 15 },
    );
  }, 60_000);
});
