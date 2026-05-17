/**
 * Runtime field-value validators for the Canvas_Builder.
 *
 * These validate the *answer* a respondent submits for a given field — distinct
 * from schema validation (PocFieldSchema) which validates the field definition
 * itself.
 *
 * Requirements: R9.3 (url), R9.5 (wallet_address)
 */

// ---------------------------------------------------------------------------
// URL field validator
// ---------------------------------------------------------------------------

/**
 * Returns true when `value` is a well-formed URL string per the WHATWG URL
 * standard.  Relies on the platform `URL` constructor which is available in
 * all modern browsers and Node.js 10+.
 *
 * An empty string returns false.  Callers that want to allow optional fields
 * to pass with no answer should check for emptiness before calling this.
 */
export function validateUrlAnswer(value: string): boolean {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wallet address field validator (SUI)
// ---------------------------------------------------------------------------

/**
 * SUI address regex: `0x` prefix followed by exactly 64 lowercase hex digits.
 * Exported so consumers can reference or display the pattern.
 */
export const SUI_ADDRESS_REGEX = /^0x[0-9a-f]{64}$/;

/**
 * Returns true when `value` is a valid SUI wallet address in the canonical
 * `0x` + 64-hex-char format.  Uppercase hex is intentionally rejected to
 * match on-chain canonical form.
 */
export function validateWalletAddressAnswer(value: string): boolean {
  return SUI_ADDRESS_REGEX.test(value);
}
