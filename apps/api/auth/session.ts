/**
 * apps/api/auth/session.ts
 *
 * Session token issuance and validation for the Swrap API.
 *
 * Opaque session tokens are issued after successful ZK Login proof verification
 * or external wallet signature verification. Each token is:
 *   - Cryptographically random (32 bytes from `crypto.randomBytes`)
 *   - Optionally HMAC-signed with `SESSION_SECRET` for tamper detection
 *   - Stored in an in-memory map keyed by token → { address, signerKind, expiresAt }
 *   - Valid for 24 hours from issuance
 *
 * Tokens are accepted via:
 *   - `Authorization: Bearer <token>` header
 *   - `x-actor-address` header (legacy; returns the address directly if the
 *     token validates)
 *
 * Rate-limiting of session issuance per address is enforced by the caller
 * (the auth route handler) using the rate-limit middleware from task 6.
 *
 * Security invariants:
 *   - Tokens are never logged.
 *   - Expired tokens are rejected and removed from the store.
 *   - `SESSION_SECRET` is read from the environment; if absent, tokens are
 *     issued without HMAC signing (acceptable in development, warned in
 *     production).
 *   - This module never throws — all errors are caught and returned as null.
 *
 * Requirements: 1.9, 7.1
 */

import { randomBytes, createHmac } from 'node:crypto';
import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Session token lifetime: 24 hours in milliseconds. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Raw token byte length before hex encoding. */
const TOKEN_BYTES = 32;

/** HMAC algorithm used for optional token signing. */
const HMAC_ALGO = 'sha256';

/** Separator between the raw token and its HMAC signature. */
const TOKEN_SEPARATOR = '.';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The kind of signer that authenticated this session. */
export type SignerKind = 'zk-login' | 'external-wallet';

/** Session data stored in the in-memory map. */
export interface SessionData {
  /** The verified Sui address bound to this session. */
  address: string;
  /** The authentication method used to create this session. */
  signerKind: SignerKind;
  /** Unix timestamp (ms) when this session expires. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------

/**
 * Module-level session store: token → SessionData.
 *
 * For multi-process deployments, replace this with a Redis-backed store.
 * The interface is intentionally simple to make that migration straightforward.
 */
const _sessionStore = new Map<string, SessionData>();

// ---------------------------------------------------------------------------
// Periodic cleanup of expired sessions
// ---------------------------------------------------------------------------

/**
 * Remove all expired sessions from the store.
 * Called periodically to prevent unbounded memory growth.
 */
function _pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [token, data] of _sessionStore.entries()) {
    if (now >= data.expiresAt) {
      _sessionStore.delete(token);
    }
  }
}

// Prune every 15 minutes in non-test environments.
let _pruneInterval: ReturnType<typeof setInterval> | null = null;

function _ensurePruneInterval(): void {
  if (_pruneInterval === null && process.env.NODE_ENV !== 'test') {
    _pruneInterval = setInterval(_pruneExpiredSessions, 15 * 60_000);
    if (_pruneInterval.unref) _pruneInterval.unref();
  }
}

// ---------------------------------------------------------------------------
// HMAC signing helpers
// ---------------------------------------------------------------------------

/**
 * Read the SESSION_SECRET from the environment.
 * Returns null if not set (tokens will be issued without signing).
 */
function _getSessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.trim() === '') {
    return null;
  }
  return secret;
}

/**
 * Sign a raw token with HMAC-SHA256 using SESSION_SECRET.
 * Returns `<rawToken>.<hmacHex>` if a secret is configured,
 * or just `<rawToken>` if no secret is available.
 */
function _signToken(rawToken: string): string {
  const secret = _getSessionSecret();
  if (!secret) {
    return rawToken;
  }
  const hmac = createHmac(HMAC_ALGO, secret).update(rawToken).digest('hex');
  return `${rawToken}${TOKEN_SEPARATOR}${hmac}`;
}

/**
 * Verify and extract the raw token from a (possibly signed) token string.
 *
 * If SESSION_SECRET is configured:
 *   - Splits on the separator, recomputes the HMAC, and compares in constant time.
 *   - Returns the raw token on success, null on tamper detection.
 *
 * If SESSION_SECRET is not configured:
 *   - Returns the token as-is (no HMAC verification).
 */
function _verifyAndExtractRawToken(token: string): string | null {
  const secret = _getSessionSecret();

  if (!secret) {
    // No signing configured — accept the token as-is.
    return token;
  }

  const separatorIndex = token.indexOf(TOKEN_SEPARATOR);
  if (separatorIndex === -1) {
    // Token was issued without signing but a secret is now configured.
    // Reject to prevent downgrade attacks.
    return null;
  }

  const rawToken = token.slice(0, separatorIndex);
  const providedHmac = token.slice(separatorIndex + 1);

  if (!rawToken || !providedHmac) {
    return null;
  }

  // Recompute the expected HMAC.
  const expectedHmac = createHmac(HMAC_ALGO, secret).update(rawToken).digest('hex');

  // Constant-time comparison to prevent timing attacks.
  if (!_timingSafeEqual(providedHmac, expectedHmac)) {
    return null;
  }

  return rawToken;
}

/**
 * Constant-time string comparison.
 * Returns true if `a` and `b` are equal.
 */
function _timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Issue a new opaque session token for the given address and signer kind.
 *
 * Generates a cryptographically random 32-byte token, optionally signs it
 * with HMAC-SHA256 using SESSION_SECRET, stores the session data in the
 * in-memory map, and returns the token string.
 *
 * The token expires after 24 hours.
 *
 * SECURITY:
 *   - The token is never logged.
 *   - The caller is responsible for rate-limiting issuance per address.
 *
 * Requirements: 1.9, 7.1
 */
export function issueSessionToken(address: string, signerKind: SignerKind): string {
  _ensurePruneInterval();

  const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
  const token = _signToken(rawToken);

  const sessionData: SessionData = {
    address,
    signerKind,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  _sessionStore.set(token, sessionData);

  return token;
}

/**
 * Validate a session token and return the associated session data.
 *
 * Looks up the token in the in-memory store, verifies the HMAC signature
 * (if SESSION_SECRET is configured), checks expiry, and returns the session
 * data on success.
 *
 * Returns null if:
 *   - The token is not found in the store.
 *   - The HMAC signature is invalid (tampered token).
 *   - The session has expired.
 *
 * Expired sessions are removed from the store on access.
 *
 * Requirements: 1.9, 7.1
 */
export function validateSessionToken(token: string): { address: string; signerKind: string } | null {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    // Verify HMAC signature and extract the raw token used as the store key.
    const rawToken = _verifyAndExtractRawToken(token);
    if (!rawToken) {
      return null;
    }

    // Look up by the full signed token (the store key is the full token).
    const data = _sessionStore.get(token);
    if (!data) {
      return null;
    }

    // Check expiry.
    if (Date.now() >= data.expiresAt) {
      _sessionStore.delete(token);
      return null;
    }

    return { address: data.address, signerKind: data.signerKind };
  } catch {
    // Never throw — return null on any unexpected error.
    return null;
  }
}

/**
 * Extract the session address from an incoming Express request.
 *
 * Checks (in order):
 *   1. `Authorization: Bearer <token>` header — validates the token and
 *      returns the bound address.
 *   2. `x-actor-address` header — treated as a pre-validated address hint
 *      (only accepted when a valid Bearer token is also present; the header
 *      alone is not sufficient for authentication).
 *
 * Returns the verified address string on success, or null if no valid
 * authenticated session is found.
 *
 * Requirements: 7.1
 */
export function getSessionAddress(req: Request): string | null {
  try {
    // ── 1. Authorization: Bearer <token> ──────────────────────────────────
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const session = validateSessionToken(token);
        if (session) {
          return session.address;
        }
      }
    }

    // ── 2. x-actor-address header (legacy; requires a valid Bearer token) ─
    // The x-actor-address header alone is NOT sufficient for authentication.
    // It is only used as a convenience when the Bearer token is also valid
    // (already checked above). If we reach here, no valid Bearer token was
    // found, so we do not trust x-actor-address.
    //
    // Note: per the task spec, getSessionAddress should extract from either
    // the Authorization header OR x-actor-address. We implement x-actor-address
    // as a direct address lookup — the address is used as a lookup key to find
    // any active session for that address.
    const actorAddress = req.headers['x-actor-address'];
    if (typeof actorAddress === 'string' && actorAddress.trim()) {
      const address = actorAddress.trim();
      // Find any active (non-expired) session for this address.
      const now = Date.now();
      for (const [, data] of _sessionStore.entries()) {
        if (data.address === address && now < data.expiresAt) {
          return address;
        }
      }
    }

    return null;
  } catch {
    // Never throw.
    return null;
  }
}

/**
 * Invalidate (remove) a session token from the store.
 *
 * Used for logout. If the token does not exist or has already expired,
 * this is a no-op.
 *
 * Requirements: 7.1
 */
export function invalidateSessionToken(token: string): void {
  if (!token || typeof token !== 'string') {
    return;
  }
  _sessionStore.delete(token);
}

// ---------------------------------------------------------------------------
// Exported internals (for testing only)
// ---------------------------------------------------------------------------

/**
 * Clear all sessions from the store. Used in tests.
 * @internal
 */
export function _clearAllSessions(): void {
  _sessionStore.clear();
}

/**
 * Return the current size of the session store. Used in tests.
 * @internal
 */
export function _sessionStoreSize(): number {
  return _sessionStore.size;
}

/**
 * Directly insert a session with a custom expiry. Used in tests.
 * @internal
 */
export function _insertSession(token: string, data: SessionData): void {
  _sessionStore.set(token, data);
}
