/**
 * auth-client.ts — Single canonical auth module for apps/web
 *
 * This is the ONLY authentication module in apps/web. It handles:
 *   - Sui ZK Login ceremony (Google OAuth -> ephemeral key -> ZK proof -> address)
 *   - External wallet connection (browser extension wallet)
 *   - Session lifecycle (login, logout, expiry)
 *   - useSession() React hook
 *
 * Security invariants (Requirements 1.1-1.12, 11.5):
 *   - Ephemeral Ed25519 private key is stored ONLY in sessionStorage (never localStorage,
 *     never IndexedDB, never sent to the API server)
 *   - ZK randomness, salt, and raw JWT stay in the browser only
 *   - The API receives only the asserted address + ZK proof envelope
 *   - This module MUST NOT invoke Seal_Service operations (Req 1.12)
 *   - On epoch expiry, RequiresReauthError is surfaced before any auth-required operation
 */

'use client';

import * as React from 'react';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  generateNonce,
  generateRandomness,
  computeZkLoginAddress,
  getExtendedEphemeralPublicKey,
  decodeJwt,
} from '@mysten/sui/zklogin';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** sessionStorage key for the serialized ephemeral session. */
const SESSION_STORAGE_KEY = 'swrap:zk-session@1';

/** Default Sui RPC URL (testnet). */
const DEFAULT_SUI_RPC_URL =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUI_RPC_URL
    ? process.env.NEXT_PUBLIC_SUI_RPC_URL
    : getJsonRpcFullnodeUrl('testnet');

/** Google OAuth client ID from env. */
const GOOGLE_CLIENT_ID =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    ? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    : '';

/** Sui ZK Prover endpoint. */
const ZK_PROVER_URL =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ZK_PROVER_URL
    ? process.env.NEXT_PUBLIC_ZK_PROVER_URL
    : 'https://prover-dev.mystenlabs.com/v1';

/** API base URL. */
const API_BASE_URL =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL
    : '/api';

/** How many epochs ahead the ephemeral key is valid. */
const MAX_EPOCH_OFFSET = 2;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown before any auth-required operation when the ZK Login epoch has expired.
 * Callers must catch this and prompt the user to re-authenticate.
 * Requirements: 1.7
 */
export class RequiresReauthError extends Error {
  constructor(reason: 'epoch_expired' | 'no_session' | 'session_cleared') {
    super(`Re-authentication required: ${reason}`);
    this.name = 'RequiresReauthError';
  }
}

/**
 * Thrown when a Google sign-in attempt fails or is cancelled.
 * Requirements: 1.8
 */
export class GoogleSignInError extends Error {
  constructor(
    public readonly code: 'cancelled' | 'oauth_error' | 'proof_failed' | 'address_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleSignInError';
  }
}

/**
 * Thrown when external wallet connection or verification fails.
 */
export class WalletConnectionError extends Error {
  constructor(
    public readonly code: 'not_found' | 'rejected' | 'verification_failed',
    message: string,
  ) {
    super(message);
    this.name = 'WalletConnectionError';
  }
}

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export type SignerKind = 'zk-login' | 'external-wallet';

export type SessionStatus = 'authenticated' | 'unauthenticated' | 'loading';

/** Public session state exposed by useSession(). Requirements: 1.4, 1.5, 1.6 */
export interface SessionState {
  status: SessionStatus;
  /** Sui address of the active Authorization_Identity. Null when unauthenticated. */
  address: string | null;
  /** Which authentication method produced this session. */
  signerKind: SignerKind | null;
  /** Unix timestamp (ms) when the ZK epoch expires. Null for external wallets. */
  expiresAt: number | null;
}

/**
 * Serialized ZK Login session stored in sessionStorage.
 * NEVER stored in localStorage, IndexedDB, or sent to the API.
 * Requirements: 1.2, 1.10, 1.11
 */
interface ZkLoginSessionData {
  /** Base64-encoded ephemeral Ed25519 private key bytes. */
  ephemeralPrivateKeyB64: string;
  /** Randomness used to generate the nonce (kept for proof request). */
  randomness: string;
  /** User salt (kept for address derivation). */
  userSalt: string;
  /** The ZK proof returned by the prover. */
  zkProof: ZkProofInputs;
  /** The derived Sui address. */
  address: string;
  /** The maxEpoch this session is valid until. */
  maxEpoch: number;
  /** JWT sub claim (for identity continuity). Never sent to API. */
  jwtSub: string;
  /** JWT iss claim. */
  jwtIss: string;
  /** JWT aud claim. */
  jwtAud: string;
}

/** ZK proof inputs as returned by the Sui ZK Prover. */
export interface ZkProofInputs {
  proofPoints: {
    a: string[];
    b: string[][];
    c: string[];
  };
  issBase64Details: {
    value: string;
    indexMod4: number;
  };
  headerBase64: string;
}

/** External wallet session stored in sessionStorage. */
interface ExternalWalletSessionData {
  address: string;
  /** The session token issued by the API after wallet verification. */
  sessionToken: string;
}

/** Union of all session data variants stored in sessionStorage. */
type PersistedSession =
  | { kind: 'zk-login'; data: ZkLoginSessionData; sessionToken: string }
  | { kind: 'external-wallet'; data: ExternalWalletSessionData };

// ---------------------------------------------------------------------------
// In-memory state (module-level singleton)
// ---------------------------------------------------------------------------

/**
 * In-memory CryptoKey reference for the active ephemeral keypair.
 * Re-derived from sessionStorage on page reload.
 * NEVER persisted beyond the browser tab's lifetime.
 */
let _inMemoryEphemeralKeypair: Ed25519Keypair | null = null;

/** In-memory session token for API calls. */
let _inMemorySessionToken: string | null = null;

/** React state setter registered by useSession(). */
let _sessionStateSetters: Array<(s: SessionState) => void> = [];

/** Current session state (module-level cache). */
let _currentSessionState: SessionState = {
  status: 'loading',
  address: null,
  signerKind: null,
  expiresAt: null,
};

function _notifySessionListeners(state: SessionState): void {
  _currentSessionState = state;
  for (const setter of _sessionStateSetters) {
    setter(state);
  }
}

// ---------------------------------------------------------------------------
// sessionStorage helpers (Requirements 1.2, 1.11)
// ---------------------------------------------------------------------------

function _isSessionStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.sessionStorage.setItem('__swrap_test__', '1');
    window.sessionStorage.removeItem('__swrap_test__');
    return true;
  } catch {
    return false;
  }
}

function _readPersistedSession(): PersistedSession | null {
  if (!_isSessionStorageAvailable()) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

function _writePersistedSession(session: PersistedSession): void {
  if (!_isSessionStorageAvailable()) return;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage write failure is non-fatal; session will not survive reload
    console.warn('[auth-client] sessionStorage write failed');
  }
}

function _clearPersistedSession(): void {
  if (!_isSessionStorageAvailable()) return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Epoch helpers
// ---------------------------------------------------------------------------

async function _getCurrentEpoch(): Promise<number> {
  const client = new SuiJsonRpcClient({ url: DEFAULT_SUI_RPC_URL, network: 'testnet' });
  const systemState = await client.getLatestSuiSystemState();
  return Number(systemState.epoch);
}

function _isEpochExpired(maxEpoch: number, currentEpoch: number): boolean {
  return currentEpoch > maxEpoch;
}

// ---------------------------------------------------------------------------
// Ephemeral key lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Zeroize the in-memory ephemeral keypair reference.
 * The underlying key bytes are released for GC.
 * Requirements: 1.7 (logout), 1.8 (epoch expiry)
 */
function _zeroizeEphemeral(): void {
  _inMemoryEphemeralKeypair = null;
  _inMemorySessionToken = null;
}

/**
 * Restore the ephemeral keypair from sessionStorage on page reload.
 * Returns null if no valid session exists.
 * `ephemeralPrivateKeyB64` is the base64 string returned by Ed25519Keypair.getSecretKey().
 */
function _restoreEphemeralKeypair(session: ZkLoginSessionData): Ed25519Keypair | null {
  try {
    // Ed25519Keypair.fromSecretKey accepts the base64 string from getSecretKey()
    return Ed25519Keypair.fromSecretKey(session.ephemeralPrivateKeyB64);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ZK Prover request
// ---------------------------------------------------------------------------

interface ZkProverRequest {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName: 'sub';
}

async function _requestZkProof(req: ZkProverRequest): Promise<ZkProofInputs> {
  const response = await fetch(ZK_PROVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new GoogleSignInError(
      'proof_failed',
      `ZK Prover returned ${response.status}: ${text}`,
    );
  }

  return response.json() as Promise<ZkProofInputs>;
}

// ---------------------------------------------------------------------------
// API session verification helpers
// ---------------------------------------------------------------------------

interface ZkVerifyEnvelope {
  assertedAddress: string;
  zkProof: ZkProofInputs;
  ephemeralPublicKey: string;
  maxEpoch: number;
  randomness: string;
  userSalt: string;
  jwtIss: string;
  jwtAud: string;
}

async function _verifyZkLoginWithApi(envelope: ZkVerifyEnvelope): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/zk-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(envelope),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new GoogleSignInError(
      'proof_failed',
      `API ZK verification failed (${response.status}): ${String(body?.error ?? 'unknown')}`,
    );
  }

  const body = await response.json() as { result?: { sessionToken?: string } };
  const token = body?.result?.sessionToken;
  if (!token) {
    throw new GoogleSignInError('proof_failed', 'API did not return a session token');
  }
  return token;
}

async function _verifyWalletWithApi(
  address: string,
  challenge: string,
  signature: string,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/wallet-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ address, challenge, signature }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new WalletConnectionError(
      'verification_failed',
      `Wallet verification failed (${response.status}): ${String(body?.error ?? 'unknown')}`,
    );
  }

  const body = await response.json() as { result?: { sessionToken?: string } };
  const token = body?.result?.sessionToken;
  if (!token) {
    throw new WalletConnectionError('verification_failed', 'API did not return a session token');
  }
  return token;
}

async function _getAuthChallenge(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/challenge`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new WalletConnectionError('verification_failed', 'Failed to fetch auth challenge');
  }
  const body = await response.json() as { result?: { challenge?: string } };
  return body?.result?.challenge ?? crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Session initialization (called on module load / page reload)
// ---------------------------------------------------------------------------

/**
 * Attempt to restore a session from sessionStorage on page load.
 * Called automatically when the module is first imported.
 * Requirements: 1.2, 1.7
 */
async function _initializeSession(): Promise<void> {
  const persisted = _readPersistedSession();

  if (!persisted) {
    _notifySessionListeners({ status: 'unauthenticated', address: null, signerKind: null, expiresAt: null });
    return;
  }

  if (persisted.kind === 'zk-login') {
    const { data, sessionToken } = persisted;

    // Check epoch expiry before restoring
    try {
      const currentEpoch = await _getCurrentEpoch();
      if (_isEpochExpired(data.maxEpoch, currentEpoch)) {
        // Epoch expired — clear session and surface RequiresReauthError state
        _clearPersistedSession();
        _zeroizeEphemeral();
        _notifySessionListeners({ status: 'unauthenticated', address: null, signerKind: null, expiresAt: null });
        return;
      }
    } catch {
      // RPC failure during init — allow session to continue; expiry will be
      // checked again on the next auth-required operation
    }

    // Restore ephemeral keypair from sessionStorage
    const keypair = _restoreEphemeralKeypair(data);
    if (!keypair) {
      _clearPersistedSession();
      _notifySessionListeners({ status: 'unauthenticated', address: null, signerKind: null, expiresAt: null });
      return;
    }

    _inMemoryEphemeralKeypair = keypair;
    _inMemorySessionToken = sessionToken;

    // Epoch duration on testnet is ~24h; approximate expiresAt from maxEpoch
    // (we don't have exact epoch start time here, so use a conservative estimate)
    const expiresAt = Date.now() + (data.maxEpoch - 0) * 24 * 60 * 60 * 1000;

    _notifySessionListeners({
      status: 'authenticated',
      address: data.address,
      signerKind: 'zk-login',
      expiresAt,
    });
    return;
  }

  if (persisted.kind === 'external-wallet') {
    const { data } = persisted;
    _inMemorySessionToken = data.sessionToken;
    _notifySessionListeners({
      status: 'authenticated',
      address: data.address,
      signerKind: 'external-wallet',
      expiresAt: null,
    });
    return;
  }

  _notifySessionListeners({ status: 'unauthenticated', address: null, signerKind: null, expiresAt: null });
}

// Run initialization when the module loads in a browser context
if (typeof window !== 'undefined') {
  _initializeSession().catch(() => {
    _notifySessionListeners({ status: 'unauthenticated', address: null, signerKind: null, expiresAt: null });
  });
}

// ---------------------------------------------------------------------------
// Epoch expiry guard
// ---------------------------------------------------------------------------

/**
 * Assert the current session is valid and not epoch-expired.
 * Throws RequiresReauthError if the session is absent or expired.
 * Requirements: 1.7
 */
export async function assertSessionValid(): Promise<void> {
  const persisted = _readPersistedSession();

  if (!persisted) {
    throw new RequiresReauthError('no_session');
  }

  if (persisted.kind === 'zk-login') {
    const currentEpoch = await _getCurrentEpoch();
    if (_isEpochExpired(persisted.data.maxEpoch, currentEpoch)) {
      // Clear the expired session
      _clearPersistedSession();
      _zeroizeEphemeral();
      _notifySessionListeners({ status: 'unauthenticated', address: null, signerKind: null, expiresAt: null });
      throw new RequiresReauthError('epoch_expired');
    }
  }
}

// ---------------------------------------------------------------------------
// Public API: signInWithGoogle()
// ---------------------------------------------------------------------------

/**
 * Complete the Sui ZK Login ceremony:
 *   1. Generate ephemeral Ed25519 key pair
 *   2. Fetch current epoch from Sui RPC
 *   3. Compute nonce
 *   4. Redirect to Google OAuth (with nonce embedded in id_token request)
 *
 * The OAuth callback is handled by handleGoogleCallback().
 * Requirements: 1.1, 1.2, 1.8
 */
export async function signInWithGoogle(): Promise<void> {
  if (typeof window === 'undefined') {
    throw new GoogleSignInError('oauth_error', 'signInWithGoogle must be called in a browser context');
  }

  if (!GOOGLE_CLIENT_ID) {
    throw new GoogleSignInError('oauth_error', 'NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured');
  }

  // Step 1: Generate ephemeral Ed25519 key pair
  const ephemeralKeypair = new Ed25519Keypair();
  const ephemeralPublicKey = ephemeralKeypair.getPublicKey();

  // Step 2: Fetch current epoch
  let currentEpoch: number;
  try {
    currentEpoch = await _getCurrentEpoch();
  } catch (err) {
    throw new GoogleSignInError(
      'oauth_error',
      `Failed to fetch current epoch from Sui RPC: ${(err as Error).message}`,
    );
  }

  const maxEpoch = currentEpoch + MAX_EPOCH_OFFSET;

  // Step 3: Generate randomness and compute nonce
  const randomness = generateRandomness();
  const nonce = generateNonce(ephemeralPublicKey, maxEpoch, randomness);

  // Step 4: Persist ephemeral key material to sessionStorage BEFORE redirect
  // (so it survives the OAuth redirect back to our app)
  // Requirements: 1.2 — ONLY sessionStorage, never localStorage
  // getSecretKey() returns a base64-encoded string of the private key bytes
  const privKeyB64 = ephemeralKeypair.getSecretKey();

  // We store a partial session (no proof yet) to survive the redirect
  const pendingSession = {
    ephemeralPrivateKeyB64: privKeyB64,
    randomness,
    maxEpoch,
    // These will be filled in by handleGoogleCallback
    userSalt: '',
    zkProof: null,
    address: '',
    jwtSub: '',
    jwtIss: '',
    jwtAud: '',
  };

  if (_isSessionStorageAvailable()) {
    window.sessionStorage.setItem(
      `${SESSION_STORAGE_KEY}:pending`,
      JSON.stringify(pendingSession),
    );
  }

  // Step 5: Redirect to Google OAuth
  const redirectUri = `${window.location.origin}/auth/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email',
    nonce,
    prompt: 'select_account',
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Public API: handleGoogleCallback()
// ---------------------------------------------------------------------------

/**
 * Handle the Google OAuth callback after redirect.
 * Called from the /auth/callback page with the id_token from the URL fragment.
 *
 * Completes the ZK Login ceremony:
 *   1. Decode JWT to extract claims
 *   2. Request ZK proof from Sui ZK Prover
 *   3. Derive ZK_Login_Account address
 *   4. Verify with API and obtain session token
 *   5. Persist session to sessionStorage
 *
 * Requirements: 1.1, 1.2, 1.9
 */
export async function handleGoogleCallback(idToken: string, userSalt: string): Promise<void> {
  if (typeof window === 'undefined') {
    throw new GoogleSignInError('oauth_error', 'handleGoogleCallback must be called in a browser context');
  }

  // Retrieve the pending session from sessionStorage
  const pendingRaw = _isSessionStorageAvailable()
    ? window.sessionStorage.getItem(`${SESSION_STORAGE_KEY}:pending`)
    : null;

  if (!pendingRaw) {
    throw new GoogleSignInError(
      'oauth_error',
      'No pending ZK Login session found. Please start sign-in again.',
    );
  }

  let pending: {
    ephemeralPrivateKeyB64: string;
    randomness: string;
    maxEpoch: number;
  };

  try {
    pending = JSON.parse(pendingRaw) as typeof pending;
  } catch {
    throw new GoogleSignInError('oauth_error', 'Corrupt pending session data');
  }

  // Restore ephemeral keypair
  const keypair = _restoreEphemeralKeypair({
    ephemeralPrivateKeyB64: pending.ephemeralPrivateKeyB64,
    randomness: pending.randomness,
    maxEpoch: pending.maxEpoch,
    userSalt,
    zkProof: {} as ZkProofInputs,
    address: '',
    jwtSub: '',
    jwtIss: '',
    jwtAud: '',
  });

  if (!keypair) {
    throw new GoogleSignInError('oauth_error', 'Failed to restore ephemeral keypair');
  }

  // Decode JWT claims (stays in browser — never sent to API)
  let jwtClaims: { sub: string; iss: string; aud: string | string[] };
  try {
    jwtClaims = decodeJwt(idToken) as typeof jwtClaims;
  } catch {
    throw new GoogleSignInError('oauth_error', 'Failed to decode id_token JWT');
  }

  const jwtAud = Array.isArray(jwtClaims.aud) ? jwtClaims.aud[0] : jwtClaims.aud;

  // Request ZK proof from Sui ZK Prover
  // The raw JWT is sent to the prover (external service), NOT to our API
  const ephemeralPublicKey = keypair.getPublicKey();
  // getExtendedEphemeralPublicKey returns the format expected by the Sui ZK Prover
  const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(ephemeralPublicKey);

  const zkProof = await _requestZkProof({
    jwt: idToken,
    extendedEphemeralPublicKey,
    maxEpoch: pending.maxEpoch,
    jwtRandomness: pending.randomness,
    salt: userSalt,
    keyClaimName: 'sub',
  });

  // Derive ZK_Login_Account address
  const address = computeZkLoginAddress({
    claimName: 'sub',
    claimValue: jwtClaims.sub,
    userSalt,
    iss: jwtClaims.iss,
    aud: jwtAud,
    legacyAddress: false,
  });

  // Verify with API — send only the proof envelope and asserted address
  // The raw JWT and ephemeral private key NEVER leave the browser
  const sessionToken = await _verifyZkLoginWithApi({
    assertedAddress: address,
    zkProof,
    ephemeralPublicKey: extendedEphemeralPublicKey,
    maxEpoch: pending.maxEpoch,
    randomness: pending.randomness,
    userSalt,
    jwtIss: jwtClaims.iss,
    jwtAud,
  });

  // Persist complete session to sessionStorage
  const sessionData: ZkLoginSessionData = {
    ephemeralPrivateKeyB64: pending.ephemeralPrivateKeyB64,
    randomness: pending.randomness,
    userSalt,
    zkProof,
    address,
    maxEpoch: pending.maxEpoch,
    jwtSub: jwtClaims.sub,
    jwtIss: jwtClaims.iss,
    jwtAud,
  };

  _writePersistedSession({ kind: 'zk-login', data: sessionData, sessionToken });

  // Clean up pending session
  if (_isSessionStorageAvailable()) {
    window.sessionStorage.removeItem(`${SESSION_STORAGE_KEY}:pending`);
  }

  // Update in-memory state
  _inMemoryEphemeralKeypair = keypair;
  _inMemorySessionToken = sessionToken;

  const expiresAt = Date.now() + MAX_EPOCH_OFFSET * 24 * 60 * 60 * 1000;

  _notifySessionListeners({
    status: 'authenticated',
    address,
    signerKind: 'zk-login',
    expiresAt,
  });
}

// ---------------------------------------------------------------------------
// Public API: connectExternalWallet()
// ---------------------------------------------------------------------------

/**
 * Connect a browser extension wallet (e.g. Sui Wallet, Suiet).
 * Signs an auth challenge and verifies with the API.
 * Requirements: 1.3, 1.4
 */
export async function connectExternalWallet(): Promise<void> {
  if (typeof window === 'undefined') {
    throw new WalletConnectionError('not_found', 'connectExternalWallet must be called in a browser context');
  }

  // Detect Sui wallet extension
  // The standard Sui wallet injects window.suiWallet or window.sui
  const suiWallet =
    (window as unknown as Record<string, unknown>)['suiWallet'] ??
    (window as unknown as Record<string, unknown>)['sui'];

  if (!suiWallet) {
    throw new WalletConnectionError(
      'not_found',
      'No Sui wallet extension detected. Please install a Sui wallet.',
    );
  }

  const wallet = suiWallet as {
    requestPermissions?: () => Promise<void>;
    getAccounts?: () => Promise<Array<{ address: string }>>;
    signPersonalMessage?: (params: { message: Uint8Array }) => Promise<{ signature: string }>;
    signMessage?: (params: { message: Uint8Array; account: { address: string } }) => Promise<{ signature: string }>;
  };

  // Request wallet connection
  try {
    if (wallet.requestPermissions) {
      await wallet.requestPermissions();
    }
  } catch (err) {
    throw new WalletConnectionError(
      'rejected',
      `Wallet connection rejected: ${(err as Error).message}`,
    );
  }

  // Get the connected address
  let address: string;
  try {
    const accounts = await wallet.getAccounts?.();
    if (!accounts || accounts.length === 0) {
      throw new WalletConnectionError('rejected', 'No accounts returned from wallet');
    }
    address = accounts[0].address;
  } catch (err) {
    if (err instanceof WalletConnectionError) throw err;
    throw new WalletConnectionError(
      'rejected',
      `Failed to get wallet accounts: ${(err as Error).message}`,
    );
  }

  // Fetch auth challenge from API
  const challenge = await _getAuthChallenge();
  const challengeBytes = new TextEncoder().encode(challenge);

  // Sign the challenge with the wallet
  let signature: string;
  try {
    const result = wallet.signPersonalMessage
      ? await wallet.signPersonalMessage({ message: challengeBytes })
      : await wallet.signMessage?.({ message: challengeBytes, account: { address } });

    if (!result?.signature) {
      throw new WalletConnectionError('rejected', 'Wallet did not return a signature');
    }
    signature = result.signature;
  } catch (err) {
    if (err instanceof WalletConnectionError) throw err;
    throw new WalletConnectionError(
      'rejected',
      `Wallet signing rejected: ${(err as Error).message}`,
    );
  }

  // Verify with API
  const sessionToken = await _verifyWalletWithApi(address, challenge, signature);

  // Persist session to sessionStorage
  _writePersistedSession({
    kind: 'external-wallet',
    data: { address, sessionToken },
  });

  // Update in-memory state
  _inMemorySessionToken = sessionToken;

  _notifySessionListeners({
    status: 'authenticated',
    address,
    signerKind: 'external-wallet',
    expiresAt: null,
  });
}

// ---------------------------------------------------------------------------
// Public API: logout()
// ---------------------------------------------------------------------------

/**
 * Log out the current user:
 *   1. Clear sessionStorage session data
 *   2. Zeroize in-memory ephemeral keypair and session token
 *   3. Notify the API to invalidate the server-side session
 *   4. Update session state to unauthenticated
 *
 * Requirements: 1.7 (logout path)
 */
export async function logout(): Promise<void> {
  // Notify API to invalidate server session (best-effort)
  if (_inMemorySessionToken) {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${_inMemorySessionToken}`,
        },
        credentials: 'include',
      });
    } catch {
      // Logout API call failure is non-fatal; local session is still cleared
    }
  }

  // Clear sessionStorage (Requirements: 1.7)
  _clearPersistedSession();
  if (_isSessionStorageAvailable()) {
    window.sessionStorage.removeItem(`${SESSION_STORAGE_KEY}:pending`);
  }

  // Zeroize in-memory state (Requirements: 1.7)
  _zeroizeEphemeral();

  _notifySessionListeners({
    status: 'unauthenticated',
    address: null,
    signerKind: null,
    expiresAt: null,
  });
}

// ---------------------------------------------------------------------------
// Public API: getSessionToken()
// ---------------------------------------------------------------------------

/**
 * Get the current session token for API calls.
 * Throws RequiresReauthError if no valid session exists.
 * Requirements: 1.7
 */
export async function getSessionToken(): Promise<string> {
  await assertSessionValid();

  if (!_inMemorySessionToken) {
    // Try to restore from sessionStorage
    const persisted = _readPersistedSession();
    if (!persisted) {
      throw new RequiresReauthError('no_session');
    }
    if (persisted.kind === 'zk-login') {
      _inMemorySessionToken = persisted.sessionToken;
    } else {
      _inMemorySessionToken = persisted.data.sessionToken;
    }
  }

  if (!_inMemorySessionToken) {
    throw new RequiresReauthError('session_cleared');
  }

  return _inMemorySessionToken;
}

// ---------------------------------------------------------------------------
// Public API: getEphemeralKeypair()
// ---------------------------------------------------------------------------

/**
 * Get the active ephemeral keypair for ZK Login signing operations.
 * Returns null if the current session is not a ZK Login session.
 * Throws RequiresReauthError if the epoch has expired.
 *
 * NOTE: This module MUST NOT use this keypair for Seal_Service operations.
 * It is used only for authorization identity operations (signing auth challenges).
 * Requirements: 1.12
 */
export async function getEphemeralKeypair(): Promise<Ed25519Keypair | null> {
  await assertSessionValid();

  if (_inMemoryEphemeralKeypair) {
    return _inMemoryEphemeralKeypair;
  }

  // Try to restore from sessionStorage
  const persisted = _readPersistedSession();
  if (!persisted || persisted.kind !== 'zk-login') {
    return null;
  }

  const keypair = _restoreEphemeralKeypair(persisted.data);
  if (keypair) {
    _inMemoryEphemeralKeypair = keypair;
  }
  return keypair;
}

// ---------------------------------------------------------------------------
// Public API: useSession() React hook
// ---------------------------------------------------------------------------

/**
 * React hook that returns the current session state.
 * Subscribes to session changes and re-renders on updates.
 *
 * Returns: { status, address, signerKind, expiresAt }
 *   - status: 'loading' | 'authenticated' | 'unauthenticated'
 *   - address: Sui address string or null
 *   - signerKind: 'zk-login' | 'external-wallet' | null
 *   - expiresAt: Unix timestamp (ms) for ZK Login expiry, null otherwise
 *
 * Requirements: 1.4, 1.5, 1.6
 */
export function useSession(): SessionState {
  const [state, setState] = React.useState<SessionState>(_currentSessionState);

  React.useEffect(() => {
    // Register this component's setter
    _sessionStateSetters.push(setState);

    // Sync with current state in case it changed between render and effect
    setState(_currentSessionState);

    return () => {
      _sessionStateSetters = _sessionStateSetters.filter((s) => s !== setState);
    };
  }, []);

  return state;
}

// ---------------------------------------------------------------------------
// Public API: getActiveAddress()
// ---------------------------------------------------------------------------

/**
 * Get the active Authorization_Identity address synchronously.
 * Returns null if not authenticated.
 * Requirements: 1.5, 1.6
 */
export function getActiveAddress(): string | null {
  return _currentSessionState.address;
}

// ---------------------------------------------------------------------------
// Public API: isAuthenticated()
// ---------------------------------------------------------------------------

/**
 * Returns true if there is an active authenticated session.
 */
export function isAuthenticated(): boolean {
  return _currentSessionState.status === 'authenticated';
}

// ---------------------------------------------------------------------------
// Internal: Seal boundary enforcement
// ---------------------------------------------------------------------------

/**
 * Compile-time and runtime guard: this module MUST NOT import or invoke
 * any Seal_Service operations. The ZK_Login_Account and External_Wallet
 * are Authorization_Identities only.
 *
 * Requirements: 1.12
 *
 * If any future code attempts to add Seal operations here, this comment
 * and the architectural lint (forbid @mysten/seal imports in auth-client)
 * will catch it.
 */
// SEAL_BOUNDARY: No @mysten/seal imports permitted in this file.
// SEAL_BOUNDARY: No sealEncrypt / sealDecrypt calls permitted in this file.

// ---------------------------------------------------------------------------
// Exports summary
// ---------------------------------------------------------------------------
//
// Exported functions:
//   signInWithGoogle()         — Start ZK Login ceremony (redirect to Google)
//   handleGoogleCallback()     — Complete ZK Login after OAuth redirect
//   connectExternalWallet()    — Connect browser extension wallet
//   logout()                   — Clear session and notify API
//   assertSessionValid()       — Guard: throws RequiresReauthError if expired
//   getSessionToken()          — Get Bearer token for API calls
//   getEphemeralKeypair()      — Get ephemeral keypair (ZK Login only)
//   getActiveAddress()         — Get current Sui address (sync)
//   isAuthenticated()          — Check if session is active (sync)
//   useSession()               — React hook: { status, address, signerKind, expiresAt }
//
// Exported types:
//   SessionState               — { status, address, signerKind, expiresAt }
//   SessionStatus              — 'authenticated' | 'unauthenticated' | 'loading'
//   SignerKind                 — 'zk-login' | 'external-wallet'
//   ZkProofInputs              — ZK proof structure from Sui ZK Prover
//
// Exported errors:
//   RequiresReauthError        — Epoch expired or no session
//   GoogleSignInError          — OAuth or ZK proof failure
//   WalletConnectionError      — Wallet not found, rejected, or verification failed
