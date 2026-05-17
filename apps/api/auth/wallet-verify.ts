/**
 * apps/api/auth/wallet-verify.ts
 *
 * Server-side external wallet signature verification for the Swrap API.
 *
 * Exposes `verifyWalletSignature(address, challenge, signature)` which
 * validates a Sui personal message signature produced by an External_Wallet
 * (e.g. a browser extension wallet) over an auth challenge string.
 *
 * Verification steps (Requirements 1.3):
 *   1. Validate that address, challenge, and signature are all non-empty strings.
 *   2. Verify the signature against the challenge using Sui's personal message
 *      signature verification (`verifyPersonalMessageSignature`).
 *   3. Verify that the recovered public key's Sui address matches the provided
 *      address.
 *   4. Return `{ valid: true }` on success.
 *      Return `{ valid: false }` on any failure.
 *
 * Security invariants:
 *   - This module never throws — all errors are caught and returned as
 *     `{ valid: false }` to prevent information leakage.
 *   - The signature is treated as opaque bytes; no sensitive material is logged.
 *   - Address comparison is exact (no case-folding) to prevent spoofing.
 *
 * Requirements: 1.3
 */

import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result returned by `verifyWalletSignature`. */
export interface WalletVerifyResult {
  valid: boolean;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Verify an external wallet's personal message signature.
 *
 * The Web_App signs an auth challenge with the user's External_Wallet and
 * sends `(address, challenge, signature)` to the API. This function verifies:
 *   1. All inputs are non-empty strings.
 *   2. The signature is a valid Sui personal message signature over the
 *      UTF-8 bytes of `challenge`.
 *   3. The Sui address recovered from the signature matches `address`.
 *
 * Returns `{ valid: true }` on success.
 * Returns `{ valid: false }` on any failure — including malformed inputs,
 * invalid signatures, and address mismatches.
 *
 * SECURITY:
 *   - Never throws — all errors are caught and returned as `{ valid: false }`.
 *   - Never logs the signature or any key material.
 *
 * Requirements: 1.3
 */
export async function verifyWalletSignature(
  address: string,
  challenge: string,
  signature: string,
): Promise<WalletVerifyResult> {
  const INVALID: WalletVerifyResult = { valid: false };

  try {
    // -----------------------------------------------------------------------
    // Step 1: Validate inputs — all must be non-empty strings
    // -----------------------------------------------------------------------
    if (
      typeof address !== 'string' || address.trim() === '' ||
      typeof challenge !== 'string' || challenge.trim() === '' ||
      typeof signature !== 'string' || signature.trim() === ''
    ) {
      return INVALID;
    }

    // -----------------------------------------------------------------------
    // Step 2: Verify the signature against the challenge
    //
    // `verifyPersonalMessageSignature` takes the raw message bytes, the
    // base64-encoded Sui personal message signature, and an optional address
    // hint. It returns the recovered public key on success and throws on
    // failure (invalid signature, wrong key, etc.).
    //
    // The challenge is encoded as UTF-8 bytes — this matches the standard
    // Sui wallet personal message signing convention.
    // -----------------------------------------------------------------------
    const messageBytes = new TextEncoder().encode(challenge);

    let recoveredPublicKey: Awaited<ReturnType<typeof verifyPersonalMessageSignature>>;
    try {
      recoveredPublicKey = await verifyPersonalMessageSignature(messageBytes, signature);
    } catch {
      // Signature is malformed or cryptographically invalid.
      return INVALID;
    }

    // -----------------------------------------------------------------------
    // Step 3: Verify the recovered address matches the provided address
    //
    // `toSuiAddress()` derives the canonical 0x-prefixed Sui address from the
    // recovered public key. We compare it exactly against the asserted address.
    // -----------------------------------------------------------------------
    const recoveredAddress = recoveredPublicKey.toSuiAddress();

    if (recoveredAddress !== address) {
      return INVALID;
    }

    // All checks passed.
    return { valid: true };
  } catch {
    // Catch-all: any unexpected error returns invalid.
    // SECURITY: Do not log the error — it may contain sensitive material.
    return INVALID;
  }
}
