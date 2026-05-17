// @vitest-environment jsdom

/**
 * Property-based tests for epoch expiry (Property 6).
 *
 * **Validates: Requirements 1.7**
 *
 * Property 6: Ephemeral key expiry blocks signer operations
 *   For any auth session whose `maxEpoch < currentEpoch`, every operation
 *   requiring authorization returns `RequiresReauthError` before issuing
 *   any network request.
 *
 * Test strategy:
 *   We generate random maxEpoch and currentEpoch values using fast-check.
 *   We set up a valid ZK Login session with the generated maxEpoch, then
 *   mock the Sui RPC to return the generated currentEpoch. We intercept
 *   fetch to verify:
 *
 *   1. When currentEpoch > maxEpoch (expired), auth-required operations
 *      throw RequiresReauthError BEFORE any network request is issued
 *      (other than the epoch check itself).
 *   2. When currentEpoch <= maxEpoch (valid), operations proceed normally
 *      without throwing RequiresReauthError.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';

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

// ---------------------------------------------------------------------------
// Controlled epoch value for the Sui RPC mock
// ---------------------------------------------------------------------------

let _mockCurrentEpoch = 100;

// ---------------------------------------------------------------------------
// Mock @mysten/sui/keypairs/ed25519
// ---------------------------------------------------------------------------

vi.mock('@mysten/sui/keypairs/ed25519', () => {
  class MockEd25519Keypair {
    private _secretKey: string;

    constructor() {
      this._secretKey = Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString('base64');
    }

    getSecretKey(): string {
      return this._secretKey;
    }

    getPublicKey() {
      const pubBytes = new Uint8Array(32);
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
// Mock @mysten/sui/jsonRpc — returns controlled epoch value
// ---------------------------------------------------------------------------

vi.mock('@mysten/sui/jsonRpc', () => {
  class MockSuiJsonRpcClient {
    constructor(_opts?: unknown) {}
    async getLatestSuiSystemState() {
      return { epoch: String(_mockCurrentEpoch) };
    }
  }

  return {
    SuiJsonRpcClient: MockSuiJsonRpcClient,
    getJsonRpcFullnodeUrl: () => 'https://fullnode.testnet.sui.io:443',
  };
});

// ---------------------------------------------------------------------------
// Mock React
// ---------------------------------------------------------------------------

vi.mock('react', () => ({
  useState: vi.fn((initial: unknown) => [initial, vi.fn()]),
  useEffect: vi.fn((fn: () => void) => fn()),
}));

// ---------------------------------------------------------------------------
// Network request tracking
// ---------------------------------------------------------------------------

/**
 * Track all fetch calls to verify no network requests (other than the
 * Sui RPC epoch check) are made when the session is expired.
 */
let _fetchCalls: Array<{ url: string; method: string }> = [];

function setupFetchMock(): void {
  _fetchCalls = [];

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    const method = init?.method ?? 'GET';

    _fetchCalls.push({ url, method });

    // ZK verify endpoint
    if (url.includes('/auth/zk-verify')) {
      return new Response(
        JSON.stringify({ result: { sessionToken: 'zk-session-token-456' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Logout endpoint
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

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Import auth-client AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  handleGoogleCallback,
  assertSessionValid,
  getSessionToken,
  getEphemeralKeypair,
  getActiveAddress,
  isAuthenticated,
  RequiresReauthError,
} from './auth-client';

// ---------------------------------------------------------------------------
// Session storage key constant (must match auth-client.ts)
// ---------------------------------------------------------------------------

const SESSION_STORAGE_KEY = 'swrap:zk-session@1';

// ---------------------------------------------------------------------------
// Helper: set up a valid ZK Login session with a specific maxEpoch
// ---------------------------------------------------------------------------

async function setupZkLoginSession(maxEpoch: number): Promise<void> {
  // Set epoch to a value that makes the session valid during setup
  const originalEpoch = _mockCurrentEpoch;
  _mockCurrentEpoch = maxEpoch - 1; // Ensure session is valid during creation

  const keyB64 = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString('base64');

  // Simulate the pending session that signInWithGoogle() would have stored
  const pendingSession = {
    ephemeralPrivateKeyB64: keyB64,
    randomness: 'mock-randomness-67890',
    maxEpoch,
  };
  sessionStorageMock.setItem(
    `${SESSION_STORAGE_KEY}:pending`,
    JSON.stringify(pendingSession),
  );

  await handleGoogleCallback('mock-id-token', 'mock-salt-hex');

  // Verify session was established
  expect(isAuthenticated()).toBe(true);
  expect(getActiveAddress()).not.toBeNull();

  // Restore original epoch
  _mockCurrentEpoch = originalEpoch;

  // Clear fetch tracking from setup phase
  _fetchCalls = [];
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a maxEpoch value (reasonable range for Sui epochs). */
const maxEpochArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10000 });

/**
 * Generate a currentEpoch that is GREATER than maxEpoch (expired session).
 * currentEpoch > maxEpoch means the session has expired.
 */
const expiredEpochPairArb: fc.Arbitrary<{ maxEpoch: number; currentEpoch: number }> =
  maxEpochArb.chain((maxEpoch) =>
    fc.integer({ min: maxEpoch + 1, max: maxEpoch + 1000 }).map((currentEpoch) => ({
      maxEpoch,
      currentEpoch,
    })),
  );

/**
 * Generate a currentEpoch that is LESS THAN OR EQUAL to maxEpoch (valid session).
 * currentEpoch <= maxEpoch means the session is still valid.
 */
const validEpochPairArb: fc.Arbitrary<{ maxEpoch: number; currentEpoch: number }> =
  fc.integer({ min: 2, max: 10000 }).chain((maxEpoch) =>
    fc.integer({ min: 1, max: maxEpoch }).map((currentEpoch) => ({
      maxEpoch,
      currentEpoch,
    })),
  );

// ---------------------------------------------------------------------------
// Property 6: Ephemeral key expiry blocks signer operations
//
// **Validates: Requirements 1.7**
// ---------------------------------------------------------------------------

describe('Property 6: Ephemeral key expiry blocks signer operations', () => {
  beforeEach(() => {
    sessionStorageMock = createStorageMock();
    vi.stubGlobal('sessionStorage', sessionStorageMock);
    vi.stubGlobal('localStorage', createStorageMock());

    setupFetchMock();

    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.NEXT_PUBLIC_SUI_RPC_URL = 'https://fullnode.testnet.sui.io:443';
    process.env.NEXT_PUBLIC_ZK_PROVER_URL = 'https://prover-dev.mystenlabs.com/v1';
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000/api';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _fetchCalls = [];
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * Property 6a: When maxEpoch < currentEpoch, assertSessionValid() throws
   * RequiresReauthError before any network request is issued (other than
   * the Sui RPC epoch check itself).
   */
  it('Property 6a: expired epoch causes assertSessionValid to throw RequiresReauthError with no network requests', async () => {
    await fc.assert(
      fc.asyncProperty(expiredEpochPairArb, async ({ maxEpoch, currentEpoch }) => {
        // Reset state
        sessionStorageMock.clear();
        _fetchCalls = [];

        // Set up a valid session with the given maxEpoch
        await setupZkLoginSession(maxEpoch);

        // Now set the current epoch to the expired value
        _mockCurrentEpoch = currentEpoch;
        _fetchCalls = [];

        // assertSessionValid should throw RequiresReauthError
        await expect(assertSessionValid()).rejects.toThrow(RequiresReauthError);

        // Verify no network requests were made OTHER than the Sui RPC epoch check
        // The Sui RPC is called via the SuiJsonRpcClient mock (not via fetch),
        // so _fetchCalls should be empty — no API calls were issued.
        const nonEpochFetchCalls = _fetchCalls.filter(
          (call) => !call.url.includes('fullnode') && !call.url.includes('sui'),
        );
        expect(nonEpochFetchCalls).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * Property 6b: When maxEpoch < currentEpoch, getSessionToken() throws
   * RequiresReauthError before issuing any network request.
   */
  it('Property 6b: expired epoch causes getSessionToken to throw RequiresReauthError with no network requests', async () => {
    await fc.assert(
      fc.asyncProperty(expiredEpochPairArb, async ({ maxEpoch, currentEpoch }) => {
        // Reset state
        sessionStorageMock.clear();
        _fetchCalls = [];

        // Set up a valid session with the given maxEpoch
        await setupZkLoginSession(maxEpoch);

        // Now set the current epoch to the expired value
        _mockCurrentEpoch = currentEpoch;
        _fetchCalls = [];

        // getSessionToken should throw RequiresReauthError
        await expect(getSessionToken()).rejects.toThrow(RequiresReauthError);

        // Verify no API network requests were made
        const nonEpochFetchCalls = _fetchCalls.filter(
          (call) => !call.url.includes('fullnode') && !call.url.includes('sui'),
        );
        expect(nonEpochFetchCalls).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * Property 6c: When maxEpoch < currentEpoch, getEphemeralKeypair() throws
   * RequiresReauthError before issuing any network request.
   */
  it('Property 6c: expired epoch causes getEphemeralKeypair to throw RequiresReauthError with no network requests', async () => {
    await fc.assert(
      fc.asyncProperty(expiredEpochPairArb, async ({ maxEpoch, currentEpoch }) => {
        // Reset state
        sessionStorageMock.clear();
        _fetchCalls = [];

        // Set up a valid session with the given maxEpoch
        await setupZkLoginSession(maxEpoch);

        // Now set the current epoch to the expired value
        _mockCurrentEpoch = currentEpoch;
        _fetchCalls = [];

        // getEphemeralKeypair should throw RequiresReauthError
        await expect(getEphemeralKeypair()).rejects.toThrow(RequiresReauthError);

        // Verify no API network requests were made
        const nonEpochFetchCalls = _fetchCalls.filter(
          (call) => !call.url.includes('fullnode') && !call.url.includes('sui'),
        );
        expect(nonEpochFetchCalls).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * Property 6d: When maxEpoch >= currentEpoch (session is valid),
   * auth-required operations proceed normally without throwing
   * RequiresReauthError.
   */
  it('Property 6d: valid epoch allows auth operations to proceed without RequiresReauthError', async () => {
    await fc.assert(
      fc.asyncProperty(validEpochPairArb, async ({ maxEpoch, currentEpoch }) => {
        // Reset state
        sessionStorageMock.clear();
        _fetchCalls = [];

        // Set up a valid session with the given maxEpoch
        await setupZkLoginSession(maxEpoch);

        // Set the current epoch to a valid (non-expired) value
        _mockCurrentEpoch = currentEpoch;
        _fetchCalls = [];

        // assertSessionValid should NOT throw
        await expect(assertSessionValid()).resolves.toBeUndefined();

        // getSessionToken should return a token without throwing
        const token = await getSessionToken();
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * Property 6e: The boundary condition — when currentEpoch equals maxEpoch
   * exactly, the session is still valid (expiry is strictly greater than).
   */
  it('Property 6e: boundary — currentEpoch === maxEpoch means session is still valid', async () => {
    await fc.assert(
      fc.asyncProperty(maxEpochArb, async (maxEpoch) => {
        // Reset state
        sessionStorageMock.clear();
        _fetchCalls = [];

        // Set up a valid session with the given maxEpoch
        await setupZkLoginSession(maxEpoch);

        // Set currentEpoch exactly equal to maxEpoch
        _mockCurrentEpoch = maxEpoch;
        _fetchCalls = [];

        // Session should still be valid (expiry is currentEpoch > maxEpoch)
        await expect(assertSessionValid()).resolves.toBeUndefined();

        // getSessionToken should work
        const token = await getSessionToken();
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });
});
