/**
 * apps/api/routes/auth.ts
 *
 * Authentication routes for the Swrap API server.
 *
 * Endpoints:
 *   POST /auth/zk-verify      — Verify a ZK Login proof; issue session token on success
 *   POST /auth/wallet-verify  — Verify an external wallet signature; issue session token on success
 *   POST /auth/logout         — Invalidate the current session token
 *   GET  /auth/challenge      — Return a random challenge string for wallet signature verification
 *   GET  /me                  — Return { address, signerKind } for the authenticated session
 *
 * All responses use the typed ApiResponse<T> envelope:
 *   { ok: true,  requestId, result: T }
 *   { ok: false, requestId, error: { code, message } }
 *
 * Requirements: 7.1, 7.6
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { verifyZkProof, type ZkProofEnvelope } from '../auth/zk-verify';
import { verifyWalletSignature } from '../auth/wallet-verify';
import {
  issueSessionToken,
  invalidateSessionToken,
  getSessionAddress,
  validateSessionToken,
} from '../auth/session';
import {
  ok as apiOk,
  err as apiErr,
  type ApiResponse,
  type ApiErrorCode,
  type ApiResponseOk,
  type ApiResponseErr,
} from '../error-envelope';

// Re-export the canonical envelope types so existing consumers of this module
// continue to compile without changes.
export type { ApiResponse, ApiErrorCode, ApiResponseOk, ApiResponseErr };

// ---------------------------------------------------------------------------
// Route-local response helpers (thin wrappers that write to Express Response)
// ---------------------------------------------------------------------------

function ok<T>(result: T, res: Response, requestId: string, status = 200): void {
  res.status(status).json(apiOk(result, requestId, status));
}

function err(
  code: ApiErrorCode,
  message: string,
  res: Response,
  requestId: string,
  status: number,
  details?: Record<string, unknown>,
): void {
  res.status(status).json(apiErr(code, message, status, requestId, details));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequestId(req: Request): string {
  return (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

/**
 * ZkProofInputs sub-schema — mirrors the ZkProofInputs interface in zk-verify.ts.
 */
const ZkProofInputsSchema = z.object({
  proofPoints: z.object({
    a: z.array(z.string()),
    b: z.array(z.array(z.string())),
    c: z.array(z.string()),
  }),
  issBase64Details: z.object({
    value: z.string().min(1),
    indexMod4: z.number().int(),
  }),
  headerBase64: z.string().min(1),
});

/**
 * ZkProofEnvelope body schema for POST /auth/zk-verify.
 */
const ZkVerifyBodySchema = z.object({
  assertedAddress: z.string().min(1, 'assertedAddress is required'),
  zkProof: ZkProofInputsSchema,
  ephemeralPublicKey: z.string().min(1, 'ephemeralPublicKey is required'),
  maxEpoch: z.number().int().positive('maxEpoch must be a positive integer'),
  randomness: z.string().min(1, 'randomness is required'),
  userSalt: z.string().min(1, 'userSalt is required'),
  jwtIss: z.string().min(1, 'jwtIss is required'),
  jwtAud: z.string().min(1, 'jwtAud is required'),
});

/**
 * Wallet verify body schema for POST /auth/wallet-verify.
 */
const WalletVerifyBodySchema = z.object({
  address: z
    .string()
    .min(1, 'address is required')
    .regex(/^0x[0-9a-fA-F]{1,64}$/, 'address must be a valid Sui address'),
  challenge: z.string().min(1, 'challenge is required'),
  signature: z.string().min(1, 'signature is required'),
});

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function authRouter(): Router {
  const router = Router();

  // ── GET /auth/challenge ───────────────────────────────────────────────────
  /**
   * Return a random challenge string for wallet signature verification.
   *
   * No authentication required. The challenge is a 32-byte hex string that
   * the client signs with their External_Wallet and submits to
   * POST /auth/wallet-verify.
   *
   * Requirements: 7.1
   */
  router.get('/challenge', (_req: Request, res: Response) => {
    const requestId = getRequestId(_req);
    const challenge = randomBytes(32).toString('hex');
    ok({ challenge }, res, requestId);
  });

  // ── POST /auth/zk-verify ──────────────────────────────────────────────────
  /**
   * Verify a ZK Login proof envelope and issue a session token on success.
   *
   * Flow:
   *   1. Parse and validate the request body as a ZkProofEnvelope.
   *   2. Call verifyZkProof(envelope) from apps/api/auth/zk-verify.ts.
   *   3. If valid: call issueSessionToken(address, 'zk-login') and return
   *      ApiResponse<{ sessionToken, address, signerKind }>.
   *   4. If invalid: return 401 Unauthorized.
   *
   * SECURITY:
   *   - The raw JWT, ZK randomness, salt, and ephemeral private key are never
   *     stored, logged, or persisted by this route.
   *   - The session token is returned in the response body only; the caller
   *     is responsible for storing it securely (e.g. HttpOnly cookie).
   *
   * Requirements: 7.1, 7.6
   */
  router.post('/zk-verify', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      // 1. Validate request body
      const parseResult = ZkVerifyBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        err(
          'Validation',
          `Request body validation failed: ${issues.join('; ')}`,
          res,
          requestId,
          400,
        );
        return;
      }

      const envelope = parseResult.data as ZkProofEnvelope;

      // 2. Verify the ZK proof
      const result = await verifyZkProof(envelope);

      // 3. If invalid: return 401
      if (!result.valid || !result.address) {
        err('Unauthorized', 'ZK Login proof verification failed.', res, requestId, 401);
        return;
      }

      // 4. Issue session token
      const sessionToken = issueSessionToken(result.address, 'zk-login');

      // SECURITY: never log the session token or proof material
      console.log(
        JSON.stringify({
          event: 'zk_login_session_issued',
          address: result.address,
          signerKind: 'zk-login',
          requestId,
          timestamp: new Date().toISOString(),
        }),
      );

      ok<{ sessionToken: string; address: string; signerKind: string }>(
        { sessionToken, address: result.address, signerKind: 'zk-login' },
        res,
        requestId,
        201,
      );
    } catch (error) {
      next(error);
    }
  });

  // ── POST /auth/wallet-verify ──────────────────────────────────────────────
  /**
   * Verify an external wallet signature and issue a session token on success.
   *
   * Flow:
   *   1. Parse and validate the request body as { address, challenge, signature }.
   *   2. Call verifyWalletSignature(address, challenge, signature) from
   *      apps/api/auth/wallet-verify.ts.
   *   3. If valid: call issueSessionToken(address, 'external-wallet') and return
   *      ApiResponse<{ sessionToken, address, signerKind }>.
   *   4. If invalid: return 401 Unauthorized.
   *
   * Requirements: 7.1, 7.6
   */
  router.post('/wallet-verify', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      // 1. Validate request body
      const parseResult = WalletVerifyBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        err(
          'Validation',
          `Request body validation failed: ${issues.join('; ')}`,
          res,
          requestId,
          400,
        );
        return;
      }

      const { address, challenge, signature } = parseResult.data;

      // 2. Verify the wallet signature
      const result = await verifyWalletSignature(address, challenge, signature);

      // 3. If invalid: return 401
      if (!result.valid) {
        err('Unauthorized', 'Wallet signature verification failed.', res, requestId, 401);
        return;
      }

      // 4. Issue session token
      const sessionToken = issueSessionToken(address, 'external-wallet');

      // SECURITY: never log the session token or signature material
      console.log(
        JSON.stringify({
          event: 'wallet_session_issued',
          address,
          signerKind: 'external-wallet',
          requestId,
          timestamp: new Date().toISOString(),
        }),
      );

      ok<{ sessionToken: string; address: string; signerKind: string }>(
        { sessionToken, address, signerKind: 'external-wallet' },
        res,
        requestId,
        201,
      );
    } catch (error) {
      next(error);
    }
  });

  // ── POST /auth/logout ─────────────────────────────────────────────────────
  /**
   * Invalidate the current session token.
   *
   * Extracts the Bearer token from the Authorization header and calls
   * invalidateSessionToken(token). Returns 200 OK regardless of whether the
   * token existed (idempotent logout).
   *
   * Requirements: 7.1
   */
  router.post('/logout', (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      const authHeader = req.headers['authorization'];
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) {
          invalidateSessionToken(token);
        }
      }

      // Idempotent — always return 200 OK
      ok<{ message: string }>({ message: 'Logged out successfully.' }, res, requestId, 200);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// /me route factory (mounted at root level, not under /auth)
// ---------------------------------------------------------------------------

/**
 * GET /me — Return { address, signerKind } for the authenticated session.
 *
 * Reads the session from the Authorization: Bearer header via
 * getSessionAddress() from apps/api/auth/session.ts.
 *
 * Returns 401 if no valid session is found.
 *
 * Requirements: 7.1, 7.6
 */
export function meRouter(): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);

    try {
      // Extract the session address from the Authorization: Bearer header
      const address = getSessionAddress(req);

      if (!address) {
        err('Unauthorized', 'Authentication required.', res, requestId, 401);
        return;
      }

      // Retrieve the full session data (signerKind) by re-validating the token
      const authHeader = req.headers['authorization'];
      let signerKind: string = 'unknown';

      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) {
          const session = validateSessionToken(token);
          if (session) {
            signerKind = session.signerKind;
          }
        }
      }

      ok<{ address: string; signerKind: string }>({ address, signerKind }, res, requestId, 200);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
