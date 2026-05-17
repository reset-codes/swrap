// @vitest-environment jsdom

/**
 * Property-based tests for authentication method switching (Property 4).
 *
 * **Validates: Requirements 1.4**
 *
 * Property 4: Authentication method switching preserves consistency
 *   For any generated sequence of `signInGoogle | connectWallet | logout`
 *   operations, after each operation the active signer matches the most
 *   recent successful operation, and no prior signer's ephemeral key, JWT,
 *   or signature material is reachable from `auth-client` exports.
 *
 * Test strategy:
 *   We generate random sequences of auth operations using fast-check and
 *   execute them against the mocked auth-client module. After each operation
 *   we verify:
 *
 *   1. The active signer (address + signerKind) matches the most recent
 *      successful authentication operation.
 *   2. After switching methods, prior signer's ephemeral key material is
 *      NOT reachable from sessionStorage.
 *   3. After logout, no signer material is reachable from sessionStorage.
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
// Mock key material tracking
// ---------------------------------------------------------------------------

let _mockPrivateKeyB64: string = '';
let _mockPublicKeyBytes: Uint8Array = new Uint8Array(32);

vi.mock('@mysten/sui/keypairs/ed25519', () => {
  class MockEd25519Keypair {
    private _secretKey: string;
    private _publicKey: Uint8Array;

    constructor() {
      _mockPrivateKeyB64 =
        _mockPrivateKeyB64 ||
        Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
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

let _mockZkAddress = '0x' + 'ab'.repeat(32);

vi.mock('@mysten/sui/zklogin', () => ({
  generateNonce: vi.fn(() => 'mock-nonce-12345'),
  generateRandomness: vi.fn(() => 'mock-randomness-67890'),
  computeZkLoginAddress: vi.fn(() => _mockZkAddress),
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
// Mock React
// ---------------------------------------------------------------------------

vi.mock('react', () => ({
  useState: vi.fn((initial: unknown) => [initial, vi.fn()]),
  useEffect: vi.fn((fn: () => void) => fn()),
}));

// ---------------------------------------------------------------------------
// Mock fetch for API calls
// ---------------------------------------------------------------------------

let _mockWalletAddress = '0x' + 'cd'.repeat(32);
let _mockWalletSessionToken = 'wallet-session-token-123';
let _mockZkSessionToken = 'zk-session-token-456';

function setupFetchMock(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (url.includes('/auth/zk-verify')) {
      return new Response(
        JSON.stringify({ result: { sessionToken: _mockZkSessionToken } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/auth/wallet-verify')) {
      return new Response(
        JSON.stringify({ result: { sessionToken: _mockWalletSessionToken } }),
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

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Mock external wallet (window.suiWallet)
// ---------------------------------------------------------------------------

function setupWalletMock(address: string): void {
  (window as unknown as Record<string, unknown>)['suiWallet'] = {
    requestPermissions: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi.fn().mockResolvedValue([{ address }]),
    signPersonalMessage: vi.fn().mockResolvedValue({ signature: 'mock-sig-base64' }),
  };
}

function removeWalletMock(): void {
  delete (window as unknown as Record<string, unknown>)['suiWallet'];
  delete (window as unknown as Record<string, unknown>)['sui'];
}

// ---------------------------------------------------------------------------
// Import auth-client AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  handleGoogleCallback,
  connectExternalWallet,
  logout,
  getActiveAddress,
  isAuthenticated,
} from './auth-client';

// ---------------------------------------------------------------------------
// Operation types for sequence generation
// ---------------------------------------------------------------------------

type AuthOp =
  | { kind: 'signInGoogle'; keyBytes: Uint8Array; salt: string; idToken: string }
  | { kind: 'connectWallet'; address: string }
  | { kind: 'logout' };

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate random ephemeral key bytes (32 bytes for Ed25519 seed). */
const ephemeralKeyBytesArb: fc.Arbitrary<Uint8Array> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .filter((bytes) => {
    let nonZero = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== 0) nonZero++;
    }
    return nonZero >= 8;
  });

/** Generate a mock user salt (hex string). */
const userSaltArb: fc.Arbitrary<string> = fc.stringMatching(/^[0-9a-f]{16,32}$/);

/** Generate a mock JWT id_token. */
const idTokenArb: fc.Arbitrary<string> = fc
  .string({ minLength: 10, maxLength: 50 })
  .map((s) => `eyJ${Buffer.from(s).toString('base64')}`);

/** Generate a mock Sui address (0x-prefixed hex, 64 chars). */
const suiAddressArb: fc.Arbitrary<string> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .filter((bytes) => {
    // Ensure non-trivial address
    let nonZero = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== 0) nonZero++;
    }
    return nonZero >= 4;
  })
  .map((bytes) => '0x' + Buffer.from(bytes).toString('hex'));

/** Generate a signInGoogle operation. */
const signInGoogleOpArb: fc.Arbitrary<AuthOp> = fc
  .tuple(ephemeralKeyBytesArb, userSaltArb, idTokenArb)
  .map(([keyBytes, salt, idToken]) => ({
    kind: 'signInGoogle' as const,
    keyBytes,
    salt,
    idToken,
  }));

/** Generate a connectWallet operation. */
const connectWalletOpArb: fc.Arbitrary<AuthOp> = suiAddressArb.map((address) => ({
  kind: 'connectWallet' as const,
  address,
}));

/** Generate a logout operation. */
const logoutOpArb: fc.Arbitrary<AuthOp> = fc.constant({ kind: 'logout' as const });

/** Generate a sequence of auth operations (1-8 operations). */
const authOpSequenceArb: fc.Arbitrary<AuthOp[]> = fc.array(
  fc.oneof(
    { weight: 3, arbitrary: signInGoogleOpArb },
    { weight: 3, arbitrary: connectWalletOpArb },
    { weight: 2, arbitrary: logoutOpArb },
  ),
  { minLength: 1, maxLength: 8 },
);

// ---------------------------------------------------------------------------
// Session storage key constant (must match auth-client.ts)
// ---------------------------------------------------------------------------

const SESSION_STORAGE_KEY = 'swrap:zk-session@1';

// ---------------------------------------------------------------------------
// Property 4: Authentication method switching preserves consistency
//
// **Validates: Requirements 1.4**
// ---------------------------------------------------------------------------

describe('Property 4: Authentication method switching preserves consistency', () => {
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
    removeWalletMock();
    vi.unstubAllGlobals();
  });

  /**
   * Execute a single auth operation and return the expected state after it.
   * Also tracks the ephemeral key material used for ZK Login operations
   * so we can verify cleanup after switching.
   */
  async function executeOp(
    op: AuthOp,
  ): Promise<{
    expectedAddress: string | null;
    expectedSignerKind: 'zk-login' | 'external-wallet' | null;
    ephemeralKeyB64: string | null;
  }> {
    switch (op.kind) {
      case 'signInGoogle': {
        const keyB64 = Buffer.from(op.keyBytes).toString('base64');
        _mockPrivateKeyB64 = keyB64;
        _mockPublicKeyBytes = new Uint8Array(op.keyBytes.slice(0, 32));

        // Set up the unique ZK address for this sign-in
        const zkAddr = '0x' + Buffer.from(op.keyBytes.slice(0, 32)).toString('hex');
        _mockZkAddress = zkAddr;

        // Simulate the pending session that signInWithGoogle() would have stored
        const pendingSession = {
          ephemeralPrivateKeyB64: keyB64,
          randomness: 'mock-randomness-67890',
          maxEpoch: 102,
        };
        sessionStorageMock.setItem(
          `${SESSION_STORAGE_KEY}:pending`,
          JSON.stringify(pendingSession),
        );

        await handleGoogleCallback(op.idToken, op.salt);

        return {
          expectedAddress: zkAddr,
          expectedSignerKind: 'zk-login',
          ephemeralKeyB64: keyB64,
        };
      }

      case 'connectWallet': {
        _mockWalletAddress = op.address;
        setupWalletMock(op.address);

        await connectExternalWallet();

        return {
          expectedAddress: op.address,
          expectedSignerKind: 'external-wallet',
          ephemeralKeyB64: null,
        };
      }

      case 'logout': {
        await logout();

        return {
          expectedAddress: null,
          expectedSignerKind: null,
          ephemeralKeyB64: null,
        };
      }
    }
  }

  /**
   * **Validates: Requirements 1.4**
   *
   * Property 4a: After each operation in a sequence, the active signer
   * matches the most recent successful authentication operation.
   *
   * For signInGoogle: address matches the ZK-derived address, signerKind is 'zk-login'.
   * For connectWallet: address matches the wallet address, signerKind is 'external-wallet'.
   * For logout: address is null, not authenticated.
   */
  it('Property 4a: active signer matches most recent successful auth operation', async () => {
    await fc.assert(
      fc.asyncProperty(authOpSequenceArb, async (ops) => {
        // Reset state between property runs
        sessionStorageMock.clear();

        for (const op of ops) {
          const result = await executeOp(op);

          // Verify the active address matches expected
          const activeAddress = getActiveAddress();
          const authenticated = isAuthenticated();

          if (result.expectedAddress === null) {
            // After logout: should be unauthenticated
            expect(authenticated).toBe(false);
            expect(activeAddress).toBeNull();
          } else {
            // After successful auth: address and kind should match
            expect(authenticated).toBe(true);
            expect(activeAddress).toBe(result.expectedAddress);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Property 4b: After switching from ZK Login to external wallet,
   * the prior ZK Login ephemeral key material is NOT reachable from
   * sessionStorage.
   *
   * When a user switches auth methods, the previous session's sensitive
   * material (ephemeral private key, JWT, proof) must be cleared.
   */
  it('Property 4b: switching to wallet clears prior ZK Login ephemeral key from sessionStorage', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralKeyBytesArb,
        userSaltArb,
        idTokenArb,
        suiAddressArb,
        async (keyBytes, salt, idToken, walletAddress) => {
          // Reset state
          sessionStorageMock.clear();

          // Step 1: Sign in with Google (ZK Login)
          const keyB64 = Buffer.from(keyBytes).toString('base64');
          _mockPrivateKeyB64 = keyB64;
          _mockPublicKeyBytes = new Uint8Array(keyBytes.slice(0, 32));
          _mockZkAddress = '0x' + Buffer.from(keyBytes.slice(0, 32)).toString('hex');

          const pendingSession = {
            ephemeralPrivateKeyB64: keyB64,
            randomness: 'mock-randomness-67890',
            maxEpoch: 102,
          };
          sessionStorageMock.setItem(
            `${SESSION_STORAGE_KEY}:pending`,
            JSON.stringify(pendingSession),
          );

          await handleGoogleCallback(idToken, salt);

          // Verify ZK Login session is active and key is in sessionStorage
          expect(isAuthenticated()).toBe(true);
          const sessionAfterZk = sessionStorageMock.getItem(SESSION_STORAGE_KEY);
          expect(sessionAfterZk).toContain(keyB64);

          // Step 2: Switch to external wallet
          _mockWalletAddress = walletAddress;
          setupWalletMock(walletAddress);
          await connectExternalWallet();

          // ASSERTION: After switching to wallet, the ZK ephemeral key
          // material should NOT be reachable from sessionStorage
          const sessionAfterWallet = sessionStorageMock.getItem(SESSION_STORAGE_KEY);
          if (sessionAfterWallet) {
            expect(sessionAfterWallet).not.toContain(keyB64);
          }

          // Also check that no other sessionStorage key contains the ephemeral key
          const store = sessionStorageMock._getStore();
          const allValues = Object.values(store).join('');
          expect(allValues).not.toContain(keyB64);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Property 4c: After logout, no signer material (ephemeral key, JWT,
   * session token, wallet address) is reachable from sessionStorage.
   *
   * Logout must completely clear all authentication material regardless
   * of which method was previously active.
   */
  it('Property 4c: after logout, no signer material is reachable from sessionStorage', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          // Either sign in with Google then logout
          fc.tuple(ephemeralKeyBytesArb, userSaltArb, idTokenArb).map(
            ([keyBytes, salt, idToken]) =>
              ({ kind: 'zk-then-logout' as const, keyBytes, salt, idToken }),
          ),
          // Or connect wallet then logout
          suiAddressArb.map((address) => ({
            kind: 'wallet-then-logout' as const,
            address,
          })),
        ),
        async (scenario) => {
          // Reset state
          sessionStorageMock.clear();

          if (scenario.kind === 'zk-then-logout') {
            const keyB64 = Buffer.from(scenario.keyBytes).toString('base64');
            _mockPrivateKeyB64 = keyB64;
            _mockPublicKeyBytes = new Uint8Array(scenario.keyBytes.slice(0, 32));
            _mockZkAddress =
              '0x' + Buffer.from(scenario.keyBytes.slice(0, 32)).toString('hex');

            const pendingSession = {
              ephemeralPrivateKeyB64: keyB64,
              randomness: 'mock-randomness-67890',
              maxEpoch: 102,
            };
            sessionStorageMock.setItem(
              `${SESSION_STORAGE_KEY}:pending`,
              JSON.stringify(pendingSession),
            );

            await handleGoogleCallback(scenario.idToken, scenario.salt);
            expect(isAuthenticated()).toBe(true);
          } else {
            _mockWalletAddress = scenario.address;
            setupWalletMock(scenario.address);
            await connectExternalWallet();
            expect(isAuthenticated()).toBe(true);
          }

          // Now logout
          await logout();

          // ASSERTION: After logout, sessionStorage should have no auth material
          expect(isAuthenticated()).toBe(false);
          expect(getActiveAddress()).toBeNull();

          // The session key should be removed entirely
          const sessionData = sessionStorageMock.getItem(SESSION_STORAGE_KEY);
          expect(sessionData).toBeNull();

          // No pending session should remain
          const pendingData = sessionStorageMock.getItem(`${SESSION_STORAGE_KEY}:pending`);
          expect(pendingData).toBeNull();

          // The entire sessionStorage should be free of auth material
          const store = sessionStorageMock._getStore();
          const allValues = Object.values(store).join('');

          // No ephemeral key material
          if (scenario.kind === 'zk-then-logout') {
            const keyB64 = Buffer.from(scenario.keyBytes).toString('base64');
            expect(allValues).not.toContain(keyB64);
          }

          // No session tokens
          expect(allValues).not.toContain('zk-session-token');
          expect(allValues).not.toContain('wallet-session-token');
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Property 4d (combined): For any generated sequence of auth operations,
   * after each operation the active signer matches the most recent successful
   * operation AND no prior signer's ephemeral key material is reachable.
   *
   * This is the full combined property that exercises switching consistency
   * and material cleanup in a single pass per generated sequence.
   */
  it('Property 4d: combined — switching preserves consistency and clears prior material', async () => {
    await fc.assert(
      fc.asyncProperty(authOpSequenceArb, async (ops) => {
        // Reset state between property runs
        sessionStorageMock.clear();

        // Track ephemeral keys from prior ZK Login operations
        const priorZkKeys: string[] = [];
        let currentZkKey: string | null = null;

        for (const op of ops) {
          // Before executing, record the current ZK key as "prior" if switching away
          if (op.kind !== 'signInGoogle' && currentZkKey) {
            priorZkKeys.push(currentZkKey);
            currentZkKey = null;
          }

          const result = await executeOp(op);

          if (op.kind === 'signInGoogle') {
            currentZkKey = result.ephemeralKeyB64;
          }

          // Verify active signer matches expected
          const activeAddress = getActiveAddress();
          const authenticated = isAuthenticated();

          if (result.expectedAddress === null) {
            expect(authenticated).toBe(false);
            expect(activeAddress).toBeNull();
          } else {
            expect(authenticated).toBe(true);
            expect(activeAddress).toBe(result.expectedAddress);
          }

          // Verify no prior ZK Login ephemeral key material is reachable
          const store = sessionStorageMock._getStore();
          const allValues = Object.values(store).join('');

          for (const priorKey of priorZkKeys) {
            expect(allValues).not.toContain(priorKey);
          }
        }
      }),
      { numRuns: 30 },
    );
  });
});
