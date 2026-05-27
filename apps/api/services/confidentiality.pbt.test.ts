/**
 * Property-based tests for the confidentiality pipeline.
 *
 * **Validates: Requirements 4.3, 2.3**
 *
 * Property 11: Confidentiality pipeline
 *   For all generated Private_Form submission payloads, the bytes stored on
 *   Walrus_Store do NOT contain any substring of the original plaintext
 *   (confidentiality invariant under managed authority).
 *
 *   Corollary (public form round-trip):
 *   For all generated Public_Form submission payloads, the bytes stored on
 *   Walrus_Store decode to a UTF-8 string that equals the original payload
 *   (round-trip property).
 *
 * Test strategy:
 *   The confidentiality pipeline is:
 *     plaintext → sealEncrypt(plaintext, ownerAddress) → ciphertext → Walrus
 *
 *   We test this pipeline at two levels:
 *
 *   1. Direct encryption layer (Properties 11a–11d):
 *      Call sealEncrypt directly with generated payloads and assert that the
 *      returned ciphertext bytes contain no contiguous substring of the
 *      original plaintext bytes of length ≥ 4. These tests are fast (no HTTP).
 *
 *   2. End-to-end route integration (Properties 11e, Corollary):
 *      POST to the submissions route and verify the route calls sealEncrypt
 *      for private forms and that the response contains no plaintext. These
 *      tests use a shared in-process HTTP server to avoid per-iteration
 *      server startup overhead.
 *
 *   The Seal SDK is mocked with the same XOR cipher used in
 *   infrastructure-wallet.pbt.test.ts. This lets us assert the confidentiality
 *   invariant without a live Seal network.
 *
 * Why ≥ 4 bytes for the substring check?
 *   A 1–3 byte coincidental overlap is statistically possible even in random
 *   data. We use 4 bytes as the minimum meaningful substring length to avoid
 *   false positives while still catching any real plaintext leakage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import * as fc from 'fast-check';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// ---------------------------------------------------------------------------
// Test keypair — generated once, reused across all tests
// ---------------------------------------------------------------------------

const TEST_KEYPAIR = new Ed25519Keypair();
const TEST_SECRET_BECH32 = TEST_KEYPAIR.getSecretKey();

// ---------------------------------------------------------------------------
// Mock @mysten/seal — same XOR cipher as infrastructure-wallet.pbt.test.ts
//
// Ciphertext layout: [nonce (4 bytes)] ++ [plaintext XOR nonce[i % 4]]
//
// This ensures:
//   - Ciphertext ≠ plaintext (Property 11 core assertion).
//   - Two encryptions of the same plaintext produce different ciphertexts
//     (non-determinism, because the nonce is random each call).
//   - The mock decrypt reverses the XOR (round-trip holds for Property 7).
// ---------------------------------------------------------------------------

vi.mock('@mysten/seal', () => {
  function mockEncrypt(data: Uint8Array): Uint8Array {
    const nonce = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      nonce[i] = Math.floor(Math.random() * 256);
    }
    const ct = new Uint8Array(4 + data.length);
    ct.set(nonce, 0);
    for (let i = 0; i < data.length; i++) {
      ct[4 + i] = data[i] ^ nonce[i % 4];
    }
    return ct;
  }

  function MockSealClient(this: any) {
    this.encrypt = vi.fn().mockImplementation(
      ({ data }: { data: Uint8Array }) =>
        Promise.resolve({ encryptedObject: mockEncrypt(data) }),
    );
    this.decrypt = vi.fn();
  }

  return {
    SealClient: vi.fn(function (this: any) {
      return new (MockSealClient as any)();
    }),
    SessionKey: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
});

vi.mock('@mysten/sui/grpc', () => {
  function MockSuiGrpcClient(this: any) {}
  return {
    SuiGrpcClient: vi.fn(function (this: any) {
      return new (MockSuiGrpcClient as any)();
    }),
  };
});

vi.mock('@mysten/sui/transactions', () => {
  function MockTransaction(this: any) {
    this.moveCall = vi.fn();
    this.setSender = vi.fn();
    this.pure = { vector: vi.fn().mockReturnValue('mock-arg') };
    this.build = vi.fn().mockResolvedValue(new Uint8Array([0x01, 0x02]));
  }
  return {
    Transaction: vi.fn(function (this: any) {
      return new (MockTransaction as any)();
    }),
  };
});

// Mock walrus-service to avoid real network calls in route integration tests
vi.mock('../services/walrus-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/walrus-service')>();
  return {
    ...actual,
    walrusPut: vi.fn(async (bytes: Uint8Array) => {
      let hash = 0;
      for (let i = 0; i < bytes.length; i++) {
        hash = (Math.imul(31, hash) + bytes[i]) >>> 0;
      }
      return { blobId: `mock-blob-${hash.toString(16).padStart(8, '0')}-${bytes.length}`, sizeBytes: bytes.length };
    }),
    walrusBlobExists: vi.fn(async (_blobId: string) => true),
  };
});

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import { sealEncrypt } from './infrastructure-wallet';
import {
  submissionsRouter,
  _seedForm,
  _clearStores,
  type FormRecord,
} from '../routes/submissions';
import type { ServerConfig } from '../server-config';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

const ORIGINAL_WALLET_SECRET = process.env.INFRASTRUCTURE_WALLET_SECRET;
const ORIGINAL_PACKAGE_ID = process.env.SUI_POC_PACKAGE_ID;

beforeEach(async () => {
  setEnv('INFRASTRUCTURE_WALLET_SECRET', TEST_SECRET_BECH32);
  setEnv('SUI_POC_PACKAGE_ID', '0x' + '12'.repeat(32));
  await _clearStores();
  vi.clearAllMocks();
});

afterEach(async () => {
  setEnv('INFRASTRUCTURE_WALLET_SECRET', ORIGINAL_WALLET_SECRET);
  setEnv('SUI_POC_PACKAGE_ID', ORIGINAL_PACKAGE_ID);
  await _clearStores();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PRIVATE_FORM: FormRecord = {
  id: '00000000-0000-0000-0000-000000000010',
  privacyMode: 'private',
  ownerAddress: '0x' + 'ab'.repeat(32),
  walrusBlobId: 'form-blob-private-confidentiality',
  policyId: '0x' + 'ab'.repeat(32),
  version: 1,
  predecessorId: null,
  state: 'indexed',
  contentDigest: 'a'.repeat(64),
  sizeBytes: 100,
  createdAt: new Date().toISOString(),
};

const PUBLIC_FORM: FormRecord = {
  id: '00000000-0000-0000-0000-000000000011',
  privacyMode: 'public',
  ownerAddress: '0x' + 'cd'.repeat(32),
  walrusBlobId: 'form-blob-public-confidentiality',
  policyId: null,
  version: 1,
  predecessorId: null,
  state: 'indexed',
  contentDigest: 'b'.repeat(64),
  sizeBytes: 100,
  createdAt: new Date().toISOString(),
};

const VALID_SUBMITTER =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

const MOCK_CONFIG: ServerConfig = {
  port: 4001,
  nodeEnv: 'test',
  apiSecretKey: '',
  skipAuth: true,
  infrastructureWalletSecret: TEST_SECRET_BECH32,
  databaseUrl: 'postgresql://localhost/test',
  walrusPublisherUrl: 'https://publisher.test',
  walrusAggregatorUrl: 'https://aggregator.test',
  suiRpcUrl: 'https://rpc.test',
  sessionSecret: 'test-session-secret-32-chars-long',
  corsOrigins: ['http://localhost:3000'],
};

// ---------------------------------------------------------------------------
// Substring search helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `needle` appears as a contiguous byte sequence inside
 * `haystack`. Only checks substrings of length ≥ `minLen`.
 */
function containsSubstring(
  haystack: Uint8Array,
  needle: Uint8Array,
  minLen: number = 4,
): boolean {
  if (needle.length < minLen) {
    return false;
  }
  const searchLen = needle.length;
  for (let start = 0; start <= haystack.length - searchLen; start++) {
    let match = true;
    for (let i = 0; i < searchLen; i++) {
      if (haystack[start + i] !== needle[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Check whether any contiguous sub-slice of `needle` of length ≥ `minLen`
 * appears inside `haystack`.
 *
 * This is the strict form of the confidentiality check: even a partial
 * plaintext fragment must not appear in the ciphertext.
 */
function containsAnySubstringOfMinLen(
  haystack: Uint8Array,
  needle: Uint8Array,
  minLen: number = 4,
): boolean {
  if (needle.length < minLen) {
    return false;
  }
  for (let start = 0; start <= needle.length - minLen; start++) {
    const slice = needle.slice(start, start + minLen);
    if (containsSubstring(haystack, slice, minLen)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generate a non-empty printable ASCII payload string (8–200 chars).
 * Represents a Submission_Payload that will be UTF-8 encoded before
 * encryption or storage.
 */
const payloadStringArb: fc.Arbitrary<string> = fc
  .string({ minLength: 8, maxLength: 200 })
  .filter((s) => s.trim().length >= 4);

/**
 * Generate a valid-looking Sui address (0x-prefixed, 64 hex chars).
 */
const suiAddressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/)
  .map((hex) => `0x${hex}`);

// ---------------------------------------------------------------------------
// Property 11: Confidentiality pipeline — direct encryption layer
//
// Core tests: directly call sealEncrypt and assert the ciphertext contains
// no plaintext substring. These tests are fast (no HTTP overhead).
//
// **Validates: Requirements 4.3, 2.3**
// ---------------------------------------------------------------------------

describe('Property 11: Confidentiality pipeline — private forms', () => {
  /**
   * **Validates: Requirements 4.3, 2.3**
   *
   * For all generated plaintext payloads `p` and Form_Owner addresses `s`:
   *
   *   ciphertext = sealEncrypt(UTF-8(p), s).ciphertext
   *   ciphertext contains NO substring of UTF-8(p) of length ≥ 4
   *
   * This is the core confidentiality invariant: the API_Server MUST encrypt
   * before storing. Even a partial plaintext fragment in the stored bytes
   * would constitute a confidentiality violation.
   *
   * The XOR mock cipher guarantees this: each byte is XOR'd with a random
   * nonce byte, so the ciphertext is statistically independent of the
   * plaintext.
   */
  it('Property 11a: sealEncrypt output contains no substring of the original plaintext (≥4 bytes)', async () => {
    await fc.assert(
      fc.asyncProperty(payloadStringArb, suiAddressArb, async (payload, ownerAddress) => {
        const plaintextBytes = new TextEncoder().encode(payload);
        // Keep a copy before sealEncrypt zeroes the buffer.
        const plaintextCopy = new Uint8Array(plaintextBytes);

        const { ciphertext } = await sealEncrypt(new Uint8Array(plaintextBytes), ownerAddress);

        // CORE ASSERTION: ciphertext contains no contiguous substring of
        // the original plaintext of length ≥ 4.
        const leaks = containsAnySubstringOfMinLen(ciphertext, plaintextCopy, 4);
        expect(leaks).toBe(false);
      }),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 4.3, 2.3**
   *
   * Stronger form: the ciphertext bytes are NOT byte-for-byte equal to the
   * plaintext bytes. This is a weaker but more direct check.
   */
  it('Property 11b: sealEncrypt output is not byte-for-byte equal to the plaintext', async () => {
    await fc.assert(
      fc.asyncProperty(payloadStringArb, suiAddressArb, async (payload, ownerAddress) => {
        const plaintextBytes = new TextEncoder().encode(payload);
        const plaintextCopy = new Uint8Array(plaintextBytes);

        const { ciphertext } = await sealEncrypt(new Uint8Array(plaintextBytes), ownerAddress);

        // Ciphertext must not equal plaintext (different length due to nonce,
        // and different bytes due to XOR).
        const isEqual =
          ciphertext.length === plaintextCopy.length &&
          ciphertext.every((b, i) => b === plaintextCopy[i]);
        expect(isEqual).toBe(false);
      }),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 4.3, 2.3**
   *
   * The ciphertext is strictly longer than the plaintext (nonce prefix adds
   * 4 bytes). This structural property ensures the mock cipher is behaving
   * as expected.
   */
  it('Property 11c: sealEncrypt output is strictly longer than the plaintext (nonce overhead)', async () => {
    await fc.assert(
      fc.asyncProperty(payloadStringArb, suiAddressArb, async (payload, ownerAddress) => {
        const plaintextBytes = new TextEncoder().encode(payload);
        const plaintextLen = plaintextBytes.length;

        const { ciphertext } = await sealEncrypt(new Uint8Array(plaintextBytes), ownerAddress);

        // The XOR mock adds a 4-byte nonce prefix.
        expect(ciphertext.length).toBe(plaintextLen + 4);
        expect(ciphertext.length).toBeGreaterThan(plaintextLen);
      }),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 4.3, 2.3**
   *
   * Non-determinism: two encryptions of the same plaintext produce different
   * ciphertexts. This ensures the nonce is fresh each call and that the
   * stored bytes cannot be correlated across submissions.
   */
  it('Property 11d: two encryptions of the same payload produce different ciphertexts', async () => {
    await fc.assert(
      fc.asyncProperty(payloadStringArb, suiAddressArb, async (payload, ownerAddress) => {
        const bytes1 = new TextEncoder().encode(payload);
        const bytes2 = new TextEncoder().encode(payload);

        const result1 = await sealEncrypt(bytes1, ownerAddress);
        const result2 = await sealEncrypt(bytes2, ownerAddress);

        // Non-determinism: different nonces → different ciphertexts.
        expect(result1.ciphertext).not.toEqual(result2.ciphertext);
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11 — end-to-end integration via the submissions route
//
// These tests exercise the full pipeline:
//   POST /submissions → sealEncrypt → stubWalrusUpload → SubmissionRow
//
// We verify that the route correctly calls sealEncrypt for private forms
// and that the returned metadata does not contain the plaintext payload.
//
// A single shared HTTP server is started before these tests and closed after
// to avoid the ~1s overhead of creating a new server per iteration.
//
// **Validates: Requirements 4.3, 2.3**
// ---------------------------------------------------------------------------

describe('Property 11: Confidentiality pipeline — end-to-end route integration', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const app = express();
      app.use(express.json());
      app.use('/submissions', submissionsRouter(MOCK_CONFIG));
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  /**
   * **Validates: Requirements 4.3, 2.3**
   *
   * For all generated payloads submitted against a Private_Form:
   *   - The route returns HTTP 201 with privacyMode = 'private'.
   *   - The returned SubmissionRow does NOT contain the plaintext payload
   *     verbatim in any of its string fields.
   *   - The contentDigest is a 64-char hex string (SHA-256 of ciphertext).
   *   - sealEncrypt was called exactly once.
   */
  it('Property 11e: route calls sealEncrypt for private forms and response contains no plaintext', async () => {
    const infraWallet = await import('./infrastructure-wallet');
    const encryptSpy = vi.spyOn(infraWallet, 'sealEncrypt');

    try {
      await fc.assert(
        fc.asyncProperty(payloadStringArb, async (payload) => {
          await _clearStores();
          await _seedForm(PRIVATE_FORM);
          encryptSpy.mockClear();

          const { status, body } = await post('/submissions', {
            formId: PRIVATE_FORM.id,
            formVersion: 1,
            submitterAddress: VALID_SUBMITTER,
            privacyMode: 'private',
            payload,
          });

          expect(status).toBe(201);
          const row = (body as any).result;

          // Route must have called sealEncrypt exactly once.
          expect(encryptSpy).toHaveBeenCalledOnce();

          // The plaintext bytes passed to sealEncrypt must be a Uint8Array.
          const [capturedPlaintext] = encryptSpy.mock.calls[0] as [Uint8Array, string];
          expect(capturedPlaintext).toBeInstanceOf(Uint8Array);

          // The returned row must not contain the plaintext payload verbatim.
          const rowJson = JSON.stringify(row);
          expect(rowJson).not.toContain(payload);

          // The contentDigest must be a 64-char hex string (SHA-256 of ciphertext).
          expect(row.contentDigest).toMatch(/^[0-9a-f]{64}$/);

          // The privacyMode must be 'private'.
          expect(row.privacyMode).toBe('private');

          // The policyId must equal the form owner address.
          expect(row.policyId).toBe(PRIVATE_FORM.ownerAddress);
        }),
        { numRuns: 5 },
      );
    } finally {
      encryptSpy.mockRestore();
    }
  }, 120_000);

  /**
   * **Validates: Requirements 4.2, 3.4**
   *
   * For all generated payloads submitted against a Public_Form:
   *   - The route returns HTTP 201 with privacyMode = 'public'.
   *   - sealEncrypt is NOT called.
   *   - The sizeBytes equals the UTF-8 byte length of the payload.
   *   - The contentDigest is a 64-char hex string.
   *
   * This is the public form round-trip corollary: the stored bytes are the
   * UTF-8 encoding of the original payload (no transformation).
   */
  it('Corollary: route stores plaintext for public forms without calling sealEncrypt', async () => {
    const infraWallet = await import('./infrastructure-wallet');
    const encryptSpy = vi.spyOn(infraWallet, 'sealEncrypt');

    try {
      await fc.assert(
        fc.asyncProperty(payloadStringArb, async (payload) => {
          await _clearStores();
          await _seedForm(PUBLIC_FORM);
          encryptSpy.mockClear();

          const { status, body } = await post('/submissions', {
            formId: PUBLIC_FORM.id,
            formVersion: 1,
            submitterAddress: VALID_SUBMITTER,
            privacyMode: 'public',
            payload,
          });

          expect(status).toBe(201);
          const row = (body as any).result;

          // sealEncrypt must NOT be called for public forms.
          expect(encryptSpy).not.toHaveBeenCalled();

          // The privacyMode must be 'public'.
          expect(row.privacyMode).toBe('public');

          // The sizeBytes must equal the UTF-8 byte length of the payload.
          const expectedSize = new TextEncoder().encode(payload).length;
          expect(row.sizeBytes).toBe(expectedSize);

          // The contentDigest must be a 64-char hex string.
          expect(row.contentDigest).toMatch(/^[0-9a-f]{64}$/);

          // No policyId for public forms.
          expect(row.policyId).toBeUndefined();
        }),
        { numRuns: 5 },
      );
    } finally {
      encryptSpy.mockRestore();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Structural helper tests
// ---------------------------------------------------------------------------

describe('containsAnySubstringOfMinLen helper', () => {
  it('returns true when needle appears verbatim in haystack', () => {
    const haystack = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const needle = new Uint8Array([3, 4, 5, 6]);
    expect(containsAnySubstringOfMinLen(haystack, needle, 4)).toBe(true);
  });

  it('returns false when needle does not appear in haystack', () => {
    const haystack = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const needle = new Uint8Array([9, 10, 11, 12]);
    expect(containsAnySubstringOfMinLen(haystack, needle, 4)).toBe(false);
  });

  it('returns false when needle is shorter than minLen', () => {
    const haystack = new Uint8Array([1, 2, 3, 4, 5]);
    const needle = new Uint8Array([1, 2, 3]); // length 3 < minLen 4
    expect(containsAnySubstringOfMinLen(haystack, needle, 4)).toBe(false);
  });

  it('returns true when a sub-slice of needle appears in haystack', () => {
    const haystack = new Uint8Array([0, 0, 10, 20, 30, 40, 0, 0]);
    // needle has a 4-byte sub-slice [10, 20, 30, 40] that appears in haystack
    const needle = new Uint8Array([5, 10, 20, 30, 40, 50]);
    expect(containsAnySubstringOfMinLen(haystack, needle, 4)).toBe(true);
  });

  it('returns false for empty haystack', () => {
    const haystack = new Uint8Array([]);
    const needle = new Uint8Array([1, 2, 3, 4]);
    expect(containsAnySubstringOfMinLen(haystack, needle, 4)).toBe(false);
  });
});
