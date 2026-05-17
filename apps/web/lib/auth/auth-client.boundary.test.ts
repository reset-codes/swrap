// @vitest-environment jsdom

/**
 * Property-based tests for ephemeral key placement (Property 3).
 *
 * **Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4**
 *
 * Property 3: ZK ephemeral key placement
 *   For any successful Google sign-in, ephemeral private key bytes appear in
 *   `sessionStorage` only and do not appear in `localStorage`, any IndexedDB
 *   store, any network capture between Web_App and API_Server, any Postgres
 *   dump, or any captured log line.
 *
 * Test strategy:
 *   We mock the full ZK Login ceremony (Google OAuth callback, ZK prover,
 *   Sui RPC epoch fetch, API verification) and generate random ephemeral key
 *   material via fast-check. After each successful sign-in, we assert:
 *
 *   1. The ephemeral private key bytes ARE present in sessionStorage.
 *   2. The ephemeral private key bytes are NOT present in localStorage.
 *   3. The ephemeral private key bytes are NOT present in any captured
 *      network request body sent to the API server.
 *   4. No console.log/warn/error output contains the ephemeral key material.
 *
 *   The test intercepts all `fetch` calls to capture request bodies and
 *   intercepts console methods to capture log output. This provides a
 *   comprehensive boundary check without requiring a real network or database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Network capture infrastructure
// ---------------------------------------------------------------------------

/** Captured network requests sent to the API server. */
interface CapturedRequest {
  url: string;
  method: string;
  body: string | null;
}

let capturedRequests: CapturedRequest[] = [];
let capturedLogs: string[] = [];

// ---------------------------------------------------------------------------
// Storage mocks
// ---------------------------------------------------------------------------

function createStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    _getStore: () => store,
  };
}

let sessionStorageMock: ReturnType<typeof createStorageMock>;
let localStorageMock: ReturnType<typeof createStorageMock>;

// ---------------------------------------------------------------------------
// Mock @mysten/sui/keypairs/ed25519
//
// We need to control the ephemeral key material so we can verify its placement.
// The mock generates a keypair from a provided seed (injected per test run).
// ---------------------------------------------------------------------------

let _mockPrivateKeyB64: string = '';
let _mockPublicKeyBytes: Uint8Array = new Uint8Array(32);

vi.mock('@mysten/sui/keypairs/ed25519', () => {
  class MockEd25519Keypair {
    private _secretKey: string;
    private _publicKey: Uint8Array;

    constructor() {
      // Use the module-level mock values set by the test
      this._secretKey = _mockPrivateKeyB64;
      this._publicKey = new Uint8Array(_mockPublicKeyBytes);
    }

    getSecretKey(): string {
      return this._secretKey;
    }

    getPublicKey() {
      const pubBytes = this._publicKey;
      return {
        toRawBytes: () => pubBytes,
        toBase64: () => Buffer.from(pubBytes).toString('base64'),
        toSuiAddress: () => '0x' + Buffer.from(pubBytes).toString('hex').padEnd(64, '0'),
      };
    }

    static fromSecretKey(secretKey: string): MockEd25519Keypair {
      const kp = new MockEd25519Keypair();
      kp._secretKey = secretKey;
      return kp;
    }
  }

  return {
    Ed25519Keypair: MockEd25519Keypair,
  };
});

// ---------------------------------------------------------------------------
// Mock @mysten/sui/zklogin
// ---------------------------------------------------------------------------

vi.mock('@mysten/sui/zklogin', () => ({
  generateNonce: vi.fn(() => 'mock-nonce-12345'),
  generateRandomness: vi.fn(() => 'mock-randomness-67890'),
  computeZkLoginAddress: vi.fn(() => '0x' + 'ab'.repeat(32)),
  getExtendedEphemeralPublicKey: vi.fn(() => 'extended-ephemeral-pub-key-base64'),
  decodeJwt: vi.fn(() => ({
    sub: 'google-user-123',
    iss: 'https://accounts.google.com',
    aud: 'test-client-id.apps.googleusercontent.com',
  })),
}));

// ---------------------------------------------------------------------------
// Mock @mysten/sui/jsonRpc
// ---------------------------------------------------------------------------

vi.mock('@mysten/sui/jsonRpc', () => ({
  SuiJsonRpcClient: vi.fn().mockImplementation(() => ({
    getLatestSuiSystemState: vi.fn().mockResolvedValue({ epoch: '100' }),
  })),
  getJsonRpcFullnodeUrl: vi.fn(() => 'https://fullnode.testnet.sui.io:443'),
}));

// ---------------------------------------------------------------------------
// Mock React (since auth-client uses React.useState/useEffect)
// ---------------------------------------------------------------------------

vi.mock('react', () => ({
  useState: vi.fn((initial: unknown) => [initial, vi.fn()]),
  useEffect: vi.fn((fn: () => void) => fn()),
}));

// ---------------------------------------------------------------------------
// Setup: intercept fetch and console before importing auth-client
// ---------------------------------------------------------------------------

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function setupInterceptors(): void {
  capturedRequests = [];
  capturedLogs = [];

  // Intercept fetch to capture all network requests
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = init?.method ?? 'GET';
    let body: string | null = null;

    if (init?.body) {
      if (typeof init.body === 'string') {
        body = init.body;
      } else if (init.body instanceof ArrayBuffer) {
        body = Buffer.from(init.body).toString('utf-8');
      } else {
        body = String(init.body);
      }
    }

    capturedRequests.push({ url, method, body });

    // Return mock responses based on the URL
    if (url.includes('/auth/zk-verify')) {
      return new Response(
        JSON.stringify({ result: { sessionToken: 'mock-session-token-xyz' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/auth/challenge')) {
      return new Response(
        JSON.stringify({ result: { challenge: 'mock-challenge-abc' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/auth/logout')) {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ZK Prover mock
    if (url.includes('prover')) {
      return new Response(
        JSON.stringify({
          proofPoints: { a: ['1', '2'], b: [['3', '4'], ['5', '6']], c: ['7', '8'] },
          issBase64Details: { value: 'aXNz', indexMod4: 1 },
          headerBase64: 'aGVhZGVy',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Default: return 200 OK
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  // Intercept console methods to capture log output
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    capturedLogs.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    capturedLogs.push(args.map(String).join(' '));
  };
}

function teardownInterceptors(): void {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
}

// ---------------------------------------------------------------------------
// Import auth-client AFTER mocks are registered
// ---------------------------------------------------------------------------

import { handleGoogleCallback } from './auth-client';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generate random ephemeral key bytes (32 bytes for Ed25519 seed).
 * We generate the raw bytes and then base64-encode them to simulate
 * what Ed25519Keypair.getSecretKey() returns.
 */
const ephemeralKeyBytesArb: fc.Arbitrary<Uint8Array> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .filter((bytes) => {
    // Ensure the key material is non-trivial (not all zeros) and has
    // enough entropy that the base64 representation is unique enough
    // to not accidentally appear in unrelated strings.
    let nonZero = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== 0) nonZero++;
    }
    return nonZero >= 8;
  });

/**
 * Generate a mock user salt (hex string, 16-32 chars).
 */
const userSaltArb: fc.Arbitrary<string> = fc.stringMatching(/^[0-9a-f]{16,32}$/);

/**
 * Generate a mock JWT id_token (just needs to be a non-empty string
 * since we mock decodeJwt).
 */
const idTokenArb: fc.Arbitrary<string> = fc
  .string({ minLength: 10, maxLength: 100 })
  .map((s) => `eyJ${Buffer.from(s).toString('base64')}`);

// ---------------------------------------------------------------------------
// Property 3: ZK ephemeral key placement
//
// **Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4**
// ---------------------------------------------------------------------------

describe('Property 3: ZK ephemeral key placement', () => {
  beforeEach(() => {
    // Create fresh storage mocks
    sessionStorageMock = createStorageMock();
    localStorageMock = createStorageMock();

    vi.stubGlobal('sessionStorage', sessionStorageMock);
    vi.stubGlobal('localStorage', localStorageMock);

    setupInterceptors();

    // Set up environment variables needed by auth-client
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.NEXT_PUBLIC_SUI_RPC_URL = 'https://fullnode.testnet.sui.io:443';
    process.env.NEXT_PUBLIC_ZK_PROVER_URL = 'https://prover-dev.mystenlabs.com/v1';
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000/api';
  });

  afterEach(() => {
    teardownInterceptors();
    vi.unstubAllGlobals();
  });

  /**
   * Helper: set up the pending session and mock key material for a test iteration.
   * Returns the base64-encoded private key for assertion checks.
   */
  function setupIteration(keyBytes: Uint8Array): string {
    const keyB64 = Buffer.from(keyBytes).toString('base64');
    _mockPrivateKeyB64 = keyB64;
    _mockPublicKeyBytes = new Uint8Array(keyBytes.slice(0, 32));

    // Reset captures
    capturedRequests = [];
    capturedLogs = [];

    // Reset storage mocks
    sessionStorageMock.clear();
    localStorageMock.clear();

    // Simulate the pending session that signInWithGoogle() would have
    // stored before the OAuth redirect
    const pendingSession = {
      ephemeralPrivateKeyB64: keyB64,
      randomness: 'mock-randomness-67890',
      maxEpoch: 102,
    };
    sessionStorageMock.setItem(
      'swrap:zk-session@1:pending',
      JSON.stringify(pendingSession),
    );

    return keyB64;
  }

  /**
   * **Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4**
   *
   * Property 3a: After a successful ZK Login ceremony, the ephemeral private
   * key bytes ARE present in sessionStorage.
   *
   * This confirms the module correctly persists session material to
   * sessionStorage for tab-scoped session survival.
   */
  it('Property 3a: ephemeral key bytes are present in sessionStorage after sign-in', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralKeyBytesArb,
        userSaltArb,
        idTokenArb,
        async (keyBytes, userSalt, idToken) => {
          const keyB64 = setupIteration(keyBytes);

          // Complete the ZK Login ceremony
          await handleGoogleCallback(idToken, userSalt);

          // ASSERTION: ephemeral key bytes ARE in sessionStorage
          const sessionData = sessionStorageMock.getItem('swrap:zk-session@1');
          expect(sessionData).not.toBeNull();
          expect(sessionData).toContain(keyB64);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4**
   *
   * Property 3b: After a successful ZK Login ceremony, the ephemeral private
   * key bytes are NOT present in localStorage.
   *
   * localStorage persists across tabs and browser restarts — ephemeral key
   * material must never be stored there.
   */
  it('Property 3b: ephemeral key bytes are NOT in localStorage after sign-in', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralKeyBytesArb,
        userSaltArb,
        idTokenArb,
        async (keyBytes, userSalt, idToken) => {
          const keyB64 = setupIteration(keyBytes);

          // Complete the ZK Login ceremony
          await handleGoogleCallback(idToken, userSalt);

          // ASSERTION: ephemeral key bytes are NOT in localStorage
          const store = localStorageMock._getStore();
          const allLocalStorageValues = Object.values(store).join('');

          expect(allLocalStorageValues).not.toContain(keyB64);

          // Also check raw hex representation of the key bytes
          const keyHex = Buffer.from(keyBytes).toString('hex');
          expect(allLocalStorageValues).not.toContain(keyHex);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4**
   *
   * Property 3c: After a successful ZK Login ceremony, the ephemeral private
   * key bytes are NOT present in any network request body sent to the API.
   *
   * The API receives only the proof envelope and asserted address. The raw
   * ephemeral private key must never cross the trust boundary.
   */
  it('Property 3c: ephemeral key bytes are NOT in any API network request', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralKeyBytesArb,
        userSaltArb,
        idTokenArb,
        async (keyBytes, userSalt, idToken) => {
          const keyB64 = setupIteration(keyBytes);

          // Complete the ZK Login ceremony
          await handleGoogleCallback(idToken, userSalt);

          // ASSERTION: ephemeral private key bytes are NOT in any API request body
          const apiRequests = capturedRequests.filter(
            (req) =>
              req.url.includes('localhost:4000') || req.url.includes('/api/'),
          );

          for (const req of apiRequests) {
            if (req.body) {
              // The base64-encoded private key must not appear in any request body
              expect(req.body).not.toContain(keyB64);

              // The hex-encoded private key must not appear either
              const keyHex = Buffer.from(keyBytes).toString('hex');
              expect(req.body).not.toContain(keyHex);

              // The raw bytes as a comma-separated string must not appear
              const keyArrayStr = Array.from(keyBytes).join(',');
              if (keyArrayStr.length >= 8) {
                expect(req.body).not.toContain(keyArrayStr);
              }
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4**
   *
   * Property 3d: After a successful ZK Login ceremony, no log output
   * contains the ephemeral private key material.
   *
   * Structured logs must never include private key bytes in any encoding.
   * This prevents accidental exposure through log aggregation systems.
   */
  it('Property 3d: no log output contains ephemeral key material', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralKeyBytesArb,
        userSaltArb,
        idTokenArb,
        async (keyBytes, userSalt, idToken) => {
          const keyB64 = setupIteration(keyBytes);

          // Complete the ZK Login ceremony
          await handleGoogleCallback(idToken, userSalt);

          // ASSERTION: no log line contains the ephemeral private key
          const allLogs = capturedLogs.join('\n');

          // Check base64 encoding
          expect(allLogs).not.toContain(keyB64);

          // Check hex encoding
          const keyHex = Buffer.from(keyBytes).toString('hex');
          expect(allLogs).not.toContain(keyHex);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4**
   *
   * Property 3e (combined invariant): For any successful Google sign-in,
   * the ephemeral private key bytes appear ONLY in sessionStorage and
   * nowhere else — not in localStorage, not in API requests, not in logs.
   *
   * This is the full combined property that exercises all boundary checks
   * in a single pass per generated input.
   */
  it('Property 3e: combined boundary invariant — key in sessionStorage ONLY', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralKeyBytesArb,
        userSaltArb,
        idTokenArb,
        async (keyBytes, userSalt, idToken) => {
          const keyB64 = setupIteration(keyBytes);

          // Complete the ZK Login ceremony
          await handleGoogleCallback(idToken, userSalt);

          // --- POSITIVE: key IS in sessionStorage ---
          const sessionData = sessionStorageMock.getItem('swrap:zk-session@1');
          expect(sessionData).not.toBeNull();
          expect(sessionData).toContain(keyB64);

          // --- NEGATIVE: key is NOT in localStorage ---
          const store = localStorageMock._getStore();
          const allLocalStorage = Object.values(store).join('');
          expect(allLocalStorage).not.toContain(keyB64);

          // --- NEGATIVE: key is NOT in API request bodies ---
          const apiRequests = capturedRequests.filter(
            (req) =>
              req.url.includes('localhost:4000') || req.url.includes('/api/'),
          );
          for (const req of apiRequests) {
            if (req.body) {
              expect(req.body).not.toContain(keyB64);
            }
          }

          // --- NEGATIVE: key is NOT in log output ---
          const allLogs = capturedLogs.join('\n');
          expect(allLogs).not.toContain(keyB64);
        },
      ),
      { numRuns: 20 },
    );
  });
});
