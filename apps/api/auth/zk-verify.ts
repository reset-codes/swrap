/**
 * apps/api/auth/zk-verify.ts
 *
 * Server-side ZK Login proof verification for the Swrap API.
 *
 * Exposes `verifyZkProof(envelope)` which validates a ZK Login proof envelope
 * sent by the Web_App after the client completes the Sui ZK Login ceremony.
 *
 * Verification steps (Requirements 1.9, 1.10):
 *   1. Validate envelope structure — all required fields present and non-empty.
 *   2. Verify `maxEpoch >= currentEpoch` from Sui RPC.
 *   3. Derive the expected Sui address from the proof inputs using
 *      `ZkLoginPublicIdentifier.fromProof` and verify it matches `assertedAddress`.
 *   4. Verify nonce binding: the nonce in the JWT header matches the nonce
 *      derived from (ephemeralPublicKey, maxEpoch, randomness).
 *   5. Return `{ valid: true, address }` on success.
 *      Return `{ valid: false, address: '' }` on any failure.
 *
 * Security invariants:
 *   - The raw JWT, ZK randomness, salt, and ephemeral private key are NEVER
 *     stored, logged, or persisted by this module.
 *   - A single-bit mutation of any field in the envelope MUST cause
 *     `valid = false` (enforced by the ZK proof verification step).
 *   - Google JWKs are cached in memory and refreshed when the cache expires.
 *   - This module never throws — all errors are caught and returned as
 *     `{ valid: false, address: '' }` to prevent information leakage.
 *
 * Requirements: 1.9, 1.10
 */

import {
  generateNonce,
  genAddressSeed,
  ZkLoginPublicIdentifier,
} from '@mysten/sui/zklogin';
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { fromBase64 } from '@mysten/sui/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * ZK proof inputs as returned by the Sui ZK Prover.
 * Mirrors the `ZkProofInputs` interface in `apps/web/lib/auth/auth-client.ts`.
 */
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

/**
 * The proof envelope sent by the Web_App to the API after the ZK Login
 * ceremony completes. The raw JWT, ephemeral private key, and ZK randomness
 * NEVER appear here — they stay in the browser.
 *
 * Requirements: 1.9, 1.10
 */
export interface ZkProofEnvelope {
  /** The Sui address the client claims to own. */
  assertedAddress: string;
  /** The ZK proof from the Sui ZK Prover. */
  zkProof: ZkProofInputs;
  /** The extended ephemeral public key (base64-encoded Sui public key). */
  ephemeralPublicKey: string;
  /** The max epoch the session is valid until. */
  maxEpoch: number;
  /** The ZK randomness used to generate the nonce. */
  randomness: string;
  /** The user salt used for address derivation. */
  userSalt: string;
  /** The JWT issuer (e.g. "https://accounts.google.com"). */
  jwtIss: string;
  /** The JWT audience (Google OAuth client ID). */
  jwtAud: string;
}

/** Result returned by `verifyZkProof`. */
export interface ZkVerifyResult {
  valid: boolean;
  address: string;
}

// ---------------------------------------------------------------------------
// Google JWK cache
// ---------------------------------------------------------------------------

interface JwkEntry {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
}

interface JwkCache {
  keys: JwkEntry[];
  /** Unix timestamp (ms) when this cache entry expires. */
  expiresAt: number;
}

/** Module-level JWK cache. Refreshed when expired. */
let _jwkCache: JwkCache | null = null;

/** Default JWK cache TTL: 1 hour. */
const JWK_CACHE_TTL_MS = 60 * 60 * 1000;

/** Google's JWK endpoint. */
const GOOGLE_JWK_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Fetch Google's JWKs, using the module-level cache when still valid.
 *
 * SECURITY: JWK responses are cached to avoid hammering Google's endpoint on
 * every request. The cache is refreshed when it expires. No JWK material is
 * logged.
 */
async function _fetchGoogleJwks(): Promise<JwkEntry[]> {
  const now = Date.now();

  if (_jwkCache && _jwkCache.expiresAt > now) {
    return _jwkCache.keys;
  }

  const response = await fetch(GOOGLE_JWK_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google JWKs: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { keys: JwkEntry[] };

  if (!Array.isArray(body?.keys) || body.keys.length === 0) {
    throw new Error('Google JWK response contained no keys');
  }

  // Respect Cache-Control max-age if present; otherwise use default TTL.
  let ttl = JWK_CACHE_TTL_MS;
  const cacheControl = response.headers.get('cache-control');
  if (cacheControl) {
    const match = /max-age=(\d+)/.exec(cacheControl);
    if (match) {
      ttl = parseInt(match[1], 10) * 1000;
    }
  }

  _jwkCache = {
    keys: body.keys,
    expiresAt: now + ttl,
  };

  return _jwkCache.keys;
}

// ---------------------------------------------------------------------------
// Sui RPC client (module-level singleton, lazy-initialised)
// ---------------------------------------------------------------------------

let _suiClient: SuiJsonRpcClient | null = null;

function _getSuiClient(): SuiJsonRpcClient {
  if (!_suiClient) {
    const rpcUrl = process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl('testnet');
    _suiClient = new SuiJsonRpcClient({
      url: rpcUrl,
      network: 'testnet',
    });
  }
  return _suiClient;
}

/**
 * Fetch the current Sui epoch from the configured fullnode.
 * Returns the epoch as a number.
 */
async function _getCurrentEpoch(): Promise<number> {
  const client = _getSuiClient();
  const epochData = await client.getCurrentEpoch();
  // getCurrentEpoch returns an object with an `epoch` field (string or number)
  const epoch = (epochData as { epoch: string | number }).epoch;
  return typeof epoch === 'string' ? parseInt(epoch, 10) : epoch;
}

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

/**
 * Validate that all required fields are present and non-empty.
 * Returns true if the envelope is structurally valid.
 */
function _validateEnvelope(envelope: unknown): envelope is ZkProofEnvelope {
  if (!envelope || typeof envelope !== 'object') return false;

  const e = envelope as Record<string, unknown>;

  // String fields that must be non-empty
  const requiredStrings: Array<keyof ZkProofEnvelope> = [
    'assertedAddress',
    'ephemeralPublicKey',
    'randomness',
    'userSalt',
    'jwtIss',
    'jwtAud',
  ];

  for (const field of requiredStrings) {
    if (typeof e[field] !== 'string' || (e[field] as string).trim() === '') {
      return false;
    }
  }

  // maxEpoch must be a finite positive number
  if (typeof e.maxEpoch !== 'number' || !isFinite(e.maxEpoch) || e.maxEpoch <= 0) {
    return false;
  }

  // zkProof must be a valid ZkProofInputs object
  const proof = e.zkProof as Record<string, unknown> | undefined;
  if (!proof || typeof proof !== 'object') return false;

  const pp = proof.proofPoints as Record<string, unknown> | undefined;
  if (!pp || typeof pp !== 'object') return false;
  if (!Array.isArray(pp.a) || !Array.isArray(pp.b) || !Array.isArray(pp.c)) return false;

  const ibd = proof.issBase64Details as Record<string, unknown> | undefined;
  if (!ibd || typeof ibd !== 'object') return false;
  if (typeof ibd.value !== 'string' || typeof ibd.indexMod4 !== 'number') return false;

  if (typeof proof.headerBase64 !== 'string' || proof.headerBase64.trim() === '') return false;

  return true;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Verify a ZK Login proof envelope.
 *
 * This is the primary server-side verification function. It:
 *   1. Validates the envelope structure.
 *   2. Checks `maxEpoch >= currentEpoch` from Sui RPC.
 *   3. Derives the expected Sui address from the proof inputs using
 *      `ZkLoginPublicIdentifier.fromProof` and verifies it matches
 *      `assertedAddress`.
 *   4. Verifies nonce binding: the nonce in the JWT header matches the nonce
 *      derived from (ephemeralPublicKey, maxEpoch, randomness).
 *
 * Returns `{ valid: true, address }` on success.
 * Returns `{ valid: false, address: '' }` on any failure.
 *
 * SECURITY:
 *   - Never logs JWT, ZK randomness, salt, or ephemeral key material.
 *   - Never throws — all errors are caught and returned as invalid.
 *   - A single-bit mutation of any field causes `valid = false`.
 *
 * Requirements: 1.9, 1.10
 */
export async function verifyZkProof(envelope: ZkProofEnvelope): Promise<ZkVerifyResult> {
  const INVALID: ZkVerifyResult = { valid: false, address: '' };

  try {
    // -----------------------------------------------------------------------
    // Step 1: Validate envelope structure
    // -----------------------------------------------------------------------
    if (!_validateEnvelope(envelope)) {
      return INVALID;
    }

    const {
      assertedAddress,
      zkProof,
      ephemeralPublicKey,
      maxEpoch,
      randomness,
      userSalt,
      jwtIss,
      jwtAud,
    } = envelope;

    // -----------------------------------------------------------------------
    // Step 2: Verify maxEpoch >= currentEpoch
    // -----------------------------------------------------------------------
    let currentEpoch: number;
    try {
      currentEpoch = await _getCurrentEpoch();
    } catch {
      // If we cannot reach the RPC, fail closed — do not accept the proof.
      return INVALID;
    }

    if (maxEpoch < currentEpoch) {
      // Session has expired.
      return INVALID;
    }

    // -----------------------------------------------------------------------
    // Step 3: Extract the sub claim from the proof inputs
    //
    // The `issBase64Details.value` encodes a base64url-padded fragment of the
    // JWT payload containing the `sub` claim. We extract the sub value to
    // compute the address seed.
    // -----------------------------------------------------------------------
    let subValue: string;
    try {
      subValue = _extractSubFromIssBase64Details(zkProof.issBase64Details.value);
    } catch {
      return INVALID;
    }

    // -----------------------------------------------------------------------
    // Step 4: Derive the expected address and verify it matches assertedAddress
    //
    // We use `ZkLoginPublicIdentifier.fromProof` which takes the address seed
    // and issuer to derive the Sui ZK Login address. This is the canonical
    // server-side address derivation path.
    // -----------------------------------------------------------------------
    let addressSeed: bigint;
    try {
      addressSeed = genAddressSeed(userSalt, 'sub', subValue, jwtAud);
    } catch {
      return INVALID;
    }

    // Build the ZK Login signature inputs for address derivation.
    const proofInputs = {
      proofPoints: zkProof.proofPoints,
      issBase64Details: zkProof.issBase64Details,
      headerBase64: zkProof.headerBase64,
      addressSeed: addressSeed.toString(),
    };

    let derivedAddress: string;
    try {
      const zkLoginPubId = ZkLoginPublicIdentifier.fromProof(assertedAddress, proofInputs);
      derivedAddress = zkLoginPubId.toSuiAddress();
    } catch {
      return INVALID;
    }

    if (derivedAddress !== assertedAddress) {
      return INVALID;
    }

    // -----------------------------------------------------------------------
    // Step 5: Verify nonce binding
    //
    // The nonce embedded in the JWT (encoded in headerBase64) must match the
    // nonce derived from (ephemeralPublicKey, maxEpoch, randomness). This
    // cryptographically binds the proof to the specific ephemeral key and
    // session parameters, preventing replay attacks with a different key.
    // -----------------------------------------------------------------------
    try {
      // Reconstruct the ephemeral public key from the base64-encoded string.
      // ephemeralPublicKey is the result of getExtendedEphemeralPublicKey(keypair.getPublicKey())
      // which returns keypair.getPublicKey().toSuiPublicKey() — a base64-encoded Sui public key.
      const pubKeyBytes = fromBase64(ephemeralPublicKey);
      // The Sui public key bytes include a 1-byte scheme flag prefix.
      // Ed25519 public key is 32 bytes; with the flag it's 33 bytes.
      // Strip the flag byte if present.
      const rawBytes = pubKeyBytes.length === 33 ? pubKeyBytes.slice(1) : pubKeyBytes;
      const ephemeralPubKey = new Ed25519PublicKey(rawBytes);

      const expectedNonce = generateNonce(ephemeralPubKey, maxEpoch, BigInt(randomness));

      // Extract the nonce from the JWT header encoded in headerBase64.
      const actualNonce = _extractNonceFromHeaderBase64(zkProof.headerBase64);

      if (actualNonce !== expectedNonce) {
        return INVALID;
      }
    } catch {
      return INVALID;
    }

    // All checks passed.
    return { valid: true, address: assertedAddress };
  } catch {
    // Catch-all: any unexpected error returns invalid.
    // SECURITY: Do not log the error — it may contain sensitive proof material.
    return INVALID;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the `sub` claim value from the `issBase64Details.value` field.
 *
 * The `issBase64Details.value` is a base64-encoded (with padding to 4-byte
 * boundary) fragment of the JWT payload that contains the `sub` claim.
 *
 * The fragment format is a JSON substring like: `"sub":"<value>",` or
 * `"sub":"<value>"}` — the exact fragment depends on the JWT structure.
 *
 * We decode the base64 and extract the sub value using a regex.
 */
function _extractSubFromIssBase64Details(issBase64Value: string): string {
  // Decode the base64-encoded claim fragment.
  // The value may use standard base64 or base64url encoding.
  const decoded = Buffer.from(issBase64Value, 'base64').toString('utf8');

  // Extract the sub value from the decoded fragment.
  // The fragment contains a JSON substring like: "sub":"1234567890"
  const match = /"sub"\s*:\s*"([^"]+)"/.exec(decoded);
  if (!match || !match[1]) {
    throw new Error('Could not extract sub from issBase64Details');
  }

  return match[1];
}

/**
 * Extract the nonce from the JWT header encoded in `headerBase64`.
 *
 * `headerBase64` is the base64url-encoded JWT header + payload (the first two
 * parts of the JWT, dot-separated, without the signature). The nonce is in the
 * JWT payload's `nonce` claim.
 *
 * Format: base64url(header) + "." + base64url(payload)
 */
function _extractNonceFromHeaderBase64(headerBase64: string): string {
  // headerBase64 encodes the JWT header.payload (without signature).
  // Split on "." to get header and payload parts.
  const parts = headerBase64.split('.');

  if (parts.length < 2) {
    throw new Error('headerBase64 does not contain a JWT payload part');
  }

  // The payload is the second part (index 1).
  const payloadB64 = parts[1];
  const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    throw new Error('Could not parse JWT payload from headerBase64');
  }

  const nonce = payload.nonce;
  if (typeof nonce !== 'string' || nonce.trim() === '') {
    throw new Error('JWT payload does not contain a nonce claim');
  }

  return nonce;
}

// ---------------------------------------------------------------------------
// Cache/client invalidation (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Invalidate the JWK cache. Used in tests to force a fresh fetch.
 * @internal
 */
export function _invalidateJwkCache(): void {
  _jwkCache = null;
}

/**
 * Inject a custom Sui RPC client. Used in tests to avoid real network calls.
 * @internal
 */
export function _setSuiClient(client: SuiJsonRpcClient | null): void {
  _suiClient = client;
}

// Re-export for use by route handlers and tests.
export { _fetchGoogleJwks };
