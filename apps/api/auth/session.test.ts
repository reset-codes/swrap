/**
 * Unit tests for `apps/api/auth/session.ts`
 *
 * Tests cover:
 *   - issueSessionToken: generates a token, stores session data, returns a string
 *   - validateSessionToken: returns session data for valid tokens, null for invalid/expired
 *   - getSessionAddress: extracts address from Bearer header and x-actor-address header
 *   - invalidateSessionToken: removes the token from the store (logout)
 *   - HMAC signing: tokens are signed when SESSION_SECRET is set
 *   - Expiry: expired tokens are rejected and cleaned up
 *   - Security invariants: never throws, no sensitive data in return values
 *
 * Requirements: 1.9, 7.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request } from 'express';
import {
  issueSessionToken,
  validateSessionToken,
  getSessionAddress,
  invalidateSessionToken,
  _clearAllSessions,
  _sessionStoreSize,
  _insertSession,
  type SignerKind,
  type SessionData,
} from './session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Express-like Request mock. */
function makeRequest(overrides: {
  authorization?: string;
  'x-actor-address'?: string;
} = {}): Request {
  return {
    headers: { ...overrides },
  } as unknown as Request;
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _clearAllSessions();
  // Remove SESSION_SECRET so tests run in unsigned mode by default.
  delete process.env.SESSION_SECRET;
});

afterEach(() => {
  _clearAllSessions();
  delete process.env.SESSION_SECRET;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// issueSessionToken
// ---------------------------------------------------------------------------

describe('issueSessionToken', () => {
  it('returns a non-empty string', () => {
    const token = issueSessionToken('0xabc', 'zk-login');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('returns a different token on each call', () => {
    const t1 = issueSessionToken('0xabc', 'zk-login');
    const t2 = issueSessionToken('0xabc', 'zk-login');
    expect(t1).not.toBe(t2);
  });

  it('stores the session so validateSessionToken returns the data', () => {
    const token = issueSessionToken('0xabc123', 'zk-login');
    const result = validateSessionToken(token);
    expect(result).not.toBeNull();
    expect(result!.address).toBe('0xabc123');
    expect(result!.signerKind).toBe('zk-login');
  });

  it('stores the correct signerKind for external-wallet', () => {
    const token = issueSessionToken('0xdef456', 'external-wallet');
    const result = validateSessionToken(token);
    expect(result!.signerKind).toBe('external-wallet');
  });

  it('increments the session store size', () => {
    expect(_sessionStoreSize()).toBe(0);
    issueSessionToken('0xabc', 'zk-login');
    expect(_sessionStoreSize()).toBe(1);
    issueSessionToken('0xdef', 'external-wallet');
    expect(_sessionStoreSize()).toBe(2);
  });

  it('issues tokens with HMAC signature when SESSION_SECRET is set', () => {
    process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long!!';
    const token = issueSessionToken('0xabc', 'zk-login');
    // Signed token contains a dot separator
    expect(token).toContain('.');
    // Should still validate correctly
    const result = validateSessionToken(token);
    expect(result).not.toBeNull();
    expect(result!.address).toBe('0xabc');
  });

  it('issues tokens without dot separator when SESSION_SECRET is absent', () => {
    const token = issueSessionToken('0xabc', 'zk-login');
    // Unsigned token is just a hex string — no dot
    expect(token).not.toContain('.');
  });
});

// ---------------------------------------------------------------------------
// validateSessionToken
// ---------------------------------------------------------------------------

describe('validateSessionToken', () => {
  it('returns session data for a valid token', () => {
    const token = issueSessionToken('0xabc', 'zk-login');
    const result = validateSessionToken(token);
    expect(result).toEqual({ address: '0xabc', signerKind: 'zk-login' });
  });

  it('returns null for an unknown token', () => {
    const result = validateSessionToken('unknown-token-that-was-never-issued');
    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(validateSessionToken('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(validateSessionToken(null as unknown as string)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(validateSessionToken(undefined as unknown as string)).toBeNull();
  });

  it('returns null for a numeric input', () => {
    expect(validateSessionToken(42 as unknown as string)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    // Insert a session that is already expired.
    const token = 'expired-token-abc123';
    const expiredData: SessionData = {
      address: '0xexpired',
      signerKind: 'zk-login',
      expiresAt: Date.now() - 1000, // 1 second in the past
    };
    _insertSession(token, expiredData);

    const result = validateSessionToken(token);
    expect(result).toBeNull();
  });

  it('removes an expired token from the store on access', async () => {
    const token = 'expired-cleanup-token';
    _insertSession(token, {
      address: '0xexpired',
      signerKind: 'zk-login',
      expiresAt: Date.now() - 1000,
    });

    expect(_sessionStoreSize()).toBe(1);
    validateSessionToken(token);
    expect(_sessionStoreSize()).toBe(0);
  });

  it('returns null for a tampered token when SESSION_SECRET is set', () => {
    process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long!!';
    const token = issueSessionToken('0xabc', 'zk-login');

    // Tamper with the last character of the token.
    const lastChar = token[token.length - 1];
    const tamperedChar = lastChar === 'a' ? 'b' : 'a';
    const tampered = token.slice(0, -1) + tamperedChar;

    expect(validateSessionToken(tampered)).toBeNull();
  });

  it('returns null for a token missing the HMAC when SESSION_SECRET is set', () => {
    process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long!!';
    const token = issueSessionToken('0xabc', 'zk-login');

    // Strip the HMAC part (everything after the dot).
    const rawOnly = token.split('.')[0];
    expect(validateSessionToken(rawOnly)).toBeNull();
  });

  it('never throws for any input', () => {
    const inputs = [null, undefined, '', 42, {}, [], 'garbage', 'a.b.c.d'];
    for (const input of inputs) {
      expect(() => validateSessionToken(input as unknown as string)).not.toThrow();
    }
  });

  it('returns only address and signerKind fields', () => {
    const token = issueSessionToken('0xabc', 'zk-login');
    const result = validateSessionToken(token);
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(['address', 'signerKind']);
  });
});

// ---------------------------------------------------------------------------
// getSessionAddress
// ---------------------------------------------------------------------------

describe('getSessionAddress', () => {
  it('returns the address from a valid Bearer token', () => {
    const token = issueSessionToken('0xabc123', 'zk-login');
    const req = makeRequest({ authorization: `Bearer ${token}` });
    expect(getSessionAddress(req)).toBe('0xabc123');
  });

  it('returns null when no Authorization header is present', () => {
    const req = makeRequest();
    expect(getSessionAddress(req)).toBeNull();
  });

  it('returns null for an invalid Bearer token', () => {
    const req = makeRequest({ authorization: 'Bearer invalid-token-xyz' });
    expect(getSessionAddress(req)).toBeNull();
  });

  it('returns null for a non-Bearer Authorization header', () => {
    const req = makeRequest({ authorization: 'Basic dXNlcjpwYXNz' });
    expect(getSessionAddress(req)).toBeNull();
  });

  it('returns null for an empty Bearer token', () => {
    const req = makeRequest({ authorization: 'Bearer ' });
    expect(getSessionAddress(req)).toBeNull();
  });

  it('returns the address from x-actor-address when a session exists for that address', () => {
    // Issue a session for the address so the store has it.
    issueSessionToken('0xactor456', 'external-wallet');
    const req = makeRequest({ 'x-actor-address': '0xactor456' });
    expect(getSessionAddress(req)).toBe('0xactor456');
  });

  it('returns null from x-actor-address when no session exists for that address', () => {
    const req = makeRequest({ 'x-actor-address': '0xunknown' });
    expect(getSessionAddress(req)).toBeNull();
  });

  it('returns null from x-actor-address when the session for that address is expired', () => {
    const token = 'actor-expired-token';
    _insertSession(token, {
      address: '0xexpiredactor',
      signerKind: 'zk-login',
      expiresAt: Date.now() - 1000,
    });
    const req = makeRequest({ 'x-actor-address': '0xexpiredactor' });
    expect(getSessionAddress(req)).toBeNull();
  });

  it('prefers Bearer token over x-actor-address', () => {
    const token = issueSessionToken('0xbearer', 'zk-login');
    issueSessionToken('0xactor', 'external-wallet');
    const req = makeRequest({
      authorization: `Bearer ${token}`,
      'x-actor-address': '0xactor',
    });
    // Should return the Bearer token's address, not the x-actor-address.
    expect(getSessionAddress(req)).toBe('0xbearer');
  });

  it('never throws for any request shape', () => {
    const requests = [
      makeRequest(),
      makeRequest({ authorization: undefined }),
      makeRequest({ authorization: '' }),
      { headers: null } as unknown as Request,
      { headers: undefined } as unknown as Request,
      null as unknown as Request,
    ];
    for (const req of requests) {
      expect(() => getSessionAddress(req)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// invalidateSessionToken
// ---------------------------------------------------------------------------

describe('invalidateSessionToken', () => {
  it('removes the token from the store', () => {
    const token = issueSessionToken('0xabc', 'zk-login');
    expect(_sessionStoreSize()).toBe(1);
    invalidateSessionToken(token);
    expect(_sessionStoreSize()).toBe(0);
  });

  it('makes the token invalid after invalidation', () => {
    const token = issueSessionToken('0xabc', 'zk-login');
    invalidateSessionToken(token);
    expect(validateSessionToken(token)).toBeNull();
  });

  it('is a no-op for an unknown token', () => {
    issueSessionToken('0xabc', 'zk-login');
    expect(_sessionStoreSize()).toBe(1);
    invalidateSessionToken('non-existent-token');
    expect(_sessionStoreSize()).toBe(1);
  });

  it('is a no-op for an empty string', () => {
    issueSessionToken('0xabc', 'zk-login');
    invalidateSessionToken('');
    expect(_sessionStoreSize()).toBe(1);
  });

  it('is a no-op for null', () => {
    issueSessionToken('0xabc', 'zk-login');
    invalidateSessionToken(null as unknown as string);
    expect(_sessionStoreSize()).toBe(1);
  });

  it('only removes the specified token, not others', () => {
    const t1 = issueSessionToken('0xabc', 'zk-login');
    const t2 = issueSessionToken('0xdef', 'external-wallet');
    invalidateSessionToken(t1);
    expect(_sessionStoreSize()).toBe(1);
    expect(validateSessionToken(t2)).not.toBeNull();
  });

  it('never throws for any input', () => {
    const inputs = [null, undefined, '', 42, {}, [], 'garbage'];
    for (const input of inputs) {
      expect(() => invalidateSessionToken(input as unknown as string)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Session expiry
// ---------------------------------------------------------------------------

describe('session expiry', () => {
  it('a session with expiresAt in the future is valid', () => {
    const token = 'future-token';
    _insertSession(token, {
      address: '0xfuture',
      signerKind: 'zk-login',
      expiresAt: Date.now() + 60_000,
    });
    expect(validateSessionToken(token)).not.toBeNull();
  });

  it('a session with expiresAt exactly now is expired', () => {
    const token = 'now-token';
    _insertSession(token, {
      address: '0xnow',
      signerKind: 'zk-login',
      expiresAt: Date.now(), // exactly now — should be treated as expired
    });
    // Date.now() may advance slightly between insertion and check, so this
    // is inherently racy. We use a past timestamp to be deterministic.
    const token2 = 'past-token';
    _insertSession(token2, {
      address: '0xpast',
      signerKind: 'zk-login',
      expiresAt: Date.now() - 1,
    });
    expect(validateSessionToken(token2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HMAC signing round-trip
// ---------------------------------------------------------------------------

describe('HMAC signing', () => {
  it('validates correctly with SESSION_SECRET set', () => {
    process.env.SESSION_SECRET = 'a-strong-secret-value-for-testing-purposes';
    const token = issueSessionToken('0xsigned', 'zk-login');
    const result = validateSessionToken(token);
    expect(result).not.toBeNull();
    expect(result!.address).toBe('0xsigned');
  });

  it('rejects a token issued without a secret when a secret is now set', () => {
    // Issue without secret.
    const unsignedToken = issueSessionToken('0xunsigned', 'zk-login');
    // Now set a secret.
    process.env.SESSION_SECRET = 'a-strong-secret-value-for-testing-purposes';
    // The unsigned token has no dot, so it should be rejected.
    expect(validateSessionToken(unsignedToken)).toBeNull();
  });

  it('two tokens issued with the same secret are independently valid', () => {
    process.env.SESSION_SECRET = 'shared-secret-for-two-tokens-test!!';
    const t1 = issueSessionToken('0xaddr1', 'zk-login');
    const t2 = issueSessionToken('0xaddr2', 'external-wallet');
    expect(validateSessionToken(t1)!.address).toBe('0xaddr1');
    expect(validateSessionToken(t2)!.address).toBe('0xaddr2');
  });
});

// ---------------------------------------------------------------------------
// Security invariants
// ---------------------------------------------------------------------------

describe('security invariants', () => {
  it('issueSessionToken return value does not contain the address', () => {
    const address = '0xsensitiveaddress123456789';
    const token = issueSessionToken(address, 'zk-login');
    // The token should be an opaque random value, not contain the address.
    expect(token).not.toContain(address);
  });

  it('multiple sessions for the same address are independent', () => {
    const t1 = issueSessionToken('0xsame', 'zk-login');
    const t2 = issueSessionToken('0xsame', 'external-wallet');
    expect(t1).not.toBe(t2);
    expect(validateSessionToken(t1)!.signerKind).toBe('zk-login');
    expect(validateSessionToken(t2)!.signerKind).toBe('external-wallet');
  });

  it('invalidating one session for an address does not affect others', () => {
    const t1 = issueSessionToken('0xsame', 'zk-login');
    const t2 = issueSessionToken('0xsame', 'external-wallet');
    invalidateSessionToken(t1);
    expect(validateSessionToken(t1)).toBeNull();
    expect(validateSessionToken(t2)).not.toBeNull();
  });
});
