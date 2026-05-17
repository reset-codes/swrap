/**
 * Property-based tests for primary-flow UI chain identifier masking (Property 41)
 *
 * **Validates: Requirements 8.3**
 *
 * Property 41: Primary-flow UI does not display raw chain identifiers
 *
 *   For any rendered primary-flow component with `advancedView = false`,
 *   the rendered text MUST NOT contain any string matching:
 *     - Walrus blob ID format (base58-like alphanumeric strings, 32–64 chars)
 *     - Sui transaction hash format (0x-prefixed 64-char hex)
 *     - Seal policy ID format (0x-prefixed hex or base58-like alphanumeric)
 *     - Raw signer address format (0x-prefixed 64-char hex)
 *
 *   When `advancedView = true`, these identifiers MAY be exposed.
 *
 * Test strategy:
 *   - Generate realistic-looking chain identifiers using fast-check.
 *   - Feed them into the masking functions from advanced-view.ts.
 *   - Assert that when advancedView=false, the raw identifier does NOT appear
 *     in the output string.
 *   - Assert that when advancedView=true, the raw identifier DOES appear.
 *   - Simulate a primary-flow render function that assembles a text output
 *     from multiple chain identifiers and verify the full output is clean.
 *
 * This test does not require React rendering — it validates the pure masking
 * logic that all primary-flow components MUST use before displaying any
 * chain identifier. The masking functions are the single enforcement point
 * for Requirement 8.3.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  maskBlobId,
  maskTxHash,
  maskPolicyId,
  maskSignerAddress,
} from '../../lib/copy/advanced-view';

// ---------------------------------------------------------------------------
// Regex patterns for chain identifier formats
//
// These patterns define what constitutes a "raw chain identifier" that MUST
// NOT appear in primary-flow rendered output when advancedView = false.
// ---------------------------------------------------------------------------

/**
 * Walrus blob ID format: base58-like alphanumeric string, 32–64 characters.
 * Walrus blob IDs are typically base58-encoded and do not contain 0x prefix.
 * They consist of alphanumeric characters (no special chars except possibly
 * underscores or hyphens in some encodings).
 *
 * We use a conservative pattern: 32+ alphanumeric chars without 0x prefix.
 */
const WALRUS_BLOB_ID_PATTERN = /^[A-Za-z0-9]{32,64}$/;

/**
 * Sui transaction hash format: 0x-prefixed 64-char lowercase hex string.
 * Example: 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
 */
const SUI_TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/;

/**
 * Seal policy ID format: 0x-prefixed hex string (variable length, 32–128 chars).
 * Policy IDs are derived from Seal's key derivation and are hex-encoded.
 */
const SEAL_POLICY_ID_PATTERN = /^0x[0-9a-f]{32,128}$/;

/**
 * Raw signer address format: 0x-prefixed 64-char lowercase hex string.
 * Sui addresses are 32 bytes = 64 hex chars, 0x-prefixed.
 * Example: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
 */
const SUI_ADDRESS_PATTERN = /^0x[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Arbitraries — generate realistic-looking chain identifiers
// ---------------------------------------------------------------------------

/**
 * Generates a realistic Walrus blob ID: base58-like alphanumeric, 32–64 chars.
 * Uses the base58 character set (alphanumeric minus 0, O, I, l).
 */
const walrusBlobIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-HJ-NP-Za-km-z1-9]{32,64}$/)
  .filter((s) => WALRUS_BLOB_ID_PATTERN.test(s));

/**
 * Generates a realistic Sui transaction hash: 0x + 64 lowercase hex chars.
 */
const suiTxHashArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 })
  .map((digits) => '0x' + digits.map((d) => d.toString(16)).join(''));

/**
 * Generates a realistic Seal policy ID: 0x + 32–64 lowercase hex chars.
 */
const sealPolicyIdArb: fc.Arbitrary<string> = fc
  .integer({ min: 32, max: 64 })
  .chain((len) =>
    fc
      .array(fc.integer({ min: 0, max: 15 }), { minLength: len, maxLength: len })
      .map((digits) => '0x' + digits.map((d) => d.toString(16)).join('')),
  );

/**
 * Generates a realistic Sui signer address: 0x + 64 lowercase hex chars.
 * Same format as tx hash but semantically different (an address, not a hash).
 */
const suiSignerAddressArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 })
  .map((digits) => '0x' + digits.map((d) => d.toString(16)).join(''));

// ---------------------------------------------------------------------------
// Helper: check that a rendered output does not contain a raw chain identifier
// ---------------------------------------------------------------------------

/**
 * Returns true if the rendered text contains the raw identifier as a substring.
 * This is the core check: if the raw identifier appears anywhere in the
 * rendered output, the masking has failed.
 */
function renderedTextContainsIdentifier(renderedText: string, rawIdentifier: string): boolean {
  return renderedText.includes(rawIdentifier);
}

// ---------------------------------------------------------------------------
// Simulated primary-flow render function
//
// This simulates what a primary-flow component does: it takes metadata
// (which may contain raw chain identifiers) and produces a text output
// using the masking functions. The test verifies the output is clean.
// ---------------------------------------------------------------------------

interface PrimaryFlowMetadata {
  formTitle: string;
  privacyLabel: string;
  uploadPhaseLabel: string;
  walrusBlobId: string;
  txHash: string;
  policyId: string;
  signerAddress: string;
}

/**
 * Simulates a primary-flow component rendering metadata to a text string.
 *
 * This is the pure logic that all primary-flow components MUST implement:
 * pass chain identifiers through the masking functions before including
 * them in any rendered output.
 *
 * When advancedView = false: raw chain identifiers are replaced with
 * placeholder strings that do not contain the raw values.
 *
 * When advancedView = true: raw chain identifiers are included as-is.
 */
function renderPrimaryFlowText(
  metadata: PrimaryFlowMetadata,
  advancedView: boolean,
): string {
  const displayBlobId = maskBlobId(metadata.walrusBlobId, advancedView);
  const displayTxHash = maskTxHash(metadata.txHash, advancedView);
  const displayPolicyId = maskPolicyId(metadata.policyId, advancedView);
  const displaySigner = maskSignerAddress(metadata.signerAddress, advancedView);

  // Assemble the rendered text as a primary-flow component would.
  // This mirrors what a React component would render as its text content.
  return [
    `Form: ${metadata.formTitle}`,
    `Privacy: ${metadata.privacyLabel}`,
    `Status: ${metadata.uploadPhaseLabel}`,
    `Storage: ${displayBlobId}`,
    `Transaction: ${displayTxHash}`,
    `Policy: ${displayPolicyId}`,
    `Owner: ${displaySigner}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Property 41a: maskBlobId hides raw blob ID when advancedView = false
// ---------------------------------------------------------------------------

describe('Property 41: Primary-flow UI does not display raw chain identifiers', () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * For any generated Walrus blob ID, maskBlobId(blobId, false) MUST NOT
   * return a string containing the raw blob ID.
   *
   * This ensures that primary-flow components using maskBlobId will never
   * accidentally expose raw Walrus blob identifiers to users.
   */
  it('Property 41a: maskBlobId hides raw blob ID when advancedView = false', () => {
    fc.assert(
      fc.property(walrusBlobIdArb, (blobId) => {
        const displayed = maskBlobId(blobId, false);
        expect(renderedTextContainsIdentifier(displayed, blobId)).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3, 8.5**
   *
   * For any generated Walrus blob ID, maskBlobId(blobId, true) MUST return
   * a string containing the raw blob ID (advanced view exposes it).
   */
  it('Property 41a: maskBlobId exposes raw blob ID when advancedView = true', () => {
    fc.assert(
      fc.property(walrusBlobIdArb, (blobId) => {
        const displayed = maskBlobId(blobId, true);
        expect(renderedTextContainsIdentifier(displayed, blobId)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 41b: maskTxHash hides raw tx hash when advancedView = false
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 8.3**
   *
   * For any generated Sui transaction hash, maskTxHash(txHash, false) MUST NOT
   * return a string containing the raw transaction hash.
   */
  it('Property 41b: maskTxHash hides raw tx hash when advancedView = false', () => {
    fc.assert(
      fc.property(suiTxHashArb, (txHash) => {
        const displayed = maskTxHash(txHash, false);
        expect(renderedTextContainsIdentifier(displayed, txHash)).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3, 8.5**
   *
   * For any generated Sui transaction hash, maskTxHash(txHash, true) MUST
   * return a string containing the raw transaction hash.
   */
  it('Property 41b: maskTxHash exposes raw tx hash when advancedView = true', () => {
    fc.assert(
      fc.property(suiTxHashArb, (txHash) => {
        const displayed = maskTxHash(txHash, true);
        expect(renderedTextContainsIdentifier(displayed, txHash)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 41c: maskPolicyId hides raw policy ID when advancedView = false
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 8.3**
   *
   * For any generated Seal policy ID, maskPolicyId(policyId, false) MUST NOT
   * return a string containing the raw policy ID.
   */
  it('Property 41c: maskPolicyId hides raw policy ID when advancedView = false', () => {
    fc.assert(
      fc.property(sealPolicyIdArb, (policyId) => {
        const displayed = maskPolicyId(policyId, false);
        expect(renderedTextContainsIdentifier(displayed, policyId)).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3, 8.5**
   *
   * For any generated Seal policy ID, maskPolicyId(policyId, true) MUST
   * return a string containing the raw policy ID.
   */
  it('Property 41c: maskPolicyId exposes raw policy ID when advancedView = true', () => {
    fc.assert(
      fc.property(sealPolicyIdArb, (policyId) => {
        const displayed = maskPolicyId(policyId, true);
        expect(renderedTextContainsIdentifier(displayed, policyId)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 41d: maskSignerAddress hides raw signer address when advancedView = false
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 8.3, 8.4, 8.6**
   *
   * For any generated Sui signer address, maskSignerAddress(address, false)
   * MUST NOT return a string containing the raw address.
   *
   * Instead it MUST return "your account" (the UX_Vocabulary label).
   */
  it('Property 41d: maskSignerAddress hides raw signer address when advancedView = false', () => {
    fc.assert(
      fc.property(suiSignerAddressArb, (address) => {
        const displayed = maskSignerAddress(address, false);
        expect(renderedTextContainsIdentifier(displayed, address)).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.4, 8.6**
   *
   * When advancedView = false, maskSignerAddress MUST return "your account"
   * (the UX_Vocabulary label for the auth entity).
   */
  it('Property 41d: maskSignerAddress returns "your account" when advancedView = false', () => {
    fc.assert(
      fc.property(suiSignerAddressArb, (address) => {
        const displayed = maskSignerAddress(address, false);
        expect(displayed).toBe('your account');
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3, 8.5**
   *
   * For any generated Sui signer address, maskSignerAddress(address, true)
   * MUST return a string containing the raw address.
   */
  it('Property 41d: maskSignerAddress exposes raw signer address when advancedView = true', () => {
    fc.assert(
      fc.property(suiSignerAddressArb, (address) => {
        const displayed = maskSignerAddress(address, true);
        expect(renderedTextContainsIdentifier(displayed, address)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 41e: Full primary-flow render contains no raw chain identifiers
  //               when advancedView = false
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 8.3**
   *
   * For any combination of generated chain identifiers (blob ID, tx hash,
   * policy ID, signer address), the full primary-flow rendered text MUST NOT
   * contain any of the raw identifiers when advancedView = false.
   *
   * This is the end-to-end property: even when all four identifier types are
   * present in the metadata, none of them should appear in the rendered output.
   */
  it('Property 41e: full primary-flow render contains no raw chain identifiers when advancedView = false', () => {
    fc.assert(
      fc.property(
        walrusBlobIdArb,
        suiTxHashArb,
        sealPolicyIdArb,
        suiSignerAddressArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (blobId, txHash, policyId, signerAddress, formTitle) => {
          const metadata: PrimaryFlowMetadata = {
            formTitle,
            privacyLabel: 'Private',
            uploadPhaseLabel: 'Saved',
            walrusBlobId: blobId,
            txHash,
            policyId,
            signerAddress,
          };

          const rendered = renderPrimaryFlowText(metadata, false);

          // None of the raw chain identifiers should appear in the rendered text
          expect(renderedTextContainsIdentifier(rendered, blobId)).toBe(false);
          expect(renderedTextContainsIdentifier(rendered, txHash)).toBe(false);
          expect(renderedTextContainsIdentifier(rendered, policyId)).toBe(false);
          expect(renderedTextContainsIdentifier(rendered, signerAddress)).toBe(false);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3, 8.5**
   *
   * For any combination of generated chain identifiers, the full primary-flow
   * rendered text MUST contain all raw identifiers when advancedView = true.
   *
   * This verifies that the advanced view correctly exposes the identifiers
   * for diagnostic purposes.
   */
  it('Property 41e: full primary-flow render exposes all raw chain identifiers when advancedView = true', () => {
    fc.assert(
      fc.property(
        walrusBlobIdArb,
        suiTxHashArb,
        sealPolicyIdArb,
        suiSignerAddressArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (blobId, txHash, policyId, signerAddress, formTitle) => {
          const metadata: PrimaryFlowMetadata = {
            formTitle,
            privacyLabel: 'Private',
            uploadPhaseLabel: 'Saved',
            walrusBlobId: blobId,
            txHash,
            policyId,
            signerAddress,
          };

          const rendered = renderPrimaryFlowText(metadata, true);

          // All raw chain identifiers should appear in the rendered text
          expect(renderedTextContainsIdentifier(rendered, blobId)).toBe(true);
          expect(renderedTextContainsIdentifier(rendered, txHash)).toBe(true);
          expect(renderedTextContainsIdentifier(rendered, policyId)).toBe(true);
          expect(renderedTextContainsIdentifier(rendered, signerAddress)).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 41f: Masking is deterministic — same input always produces same output
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 8.3**
   *
   * The masking functions are pure and deterministic: calling them twice with
   * the same inputs always produces the same output. This ensures that the
   * masking behavior is predictable and cannot be bypassed by repeated calls.
   */
  it('Property 41f: masking functions are deterministic — same input always produces same output', () => {
    fc.assert(
      fc.property(
        walrusBlobIdArb,
        suiTxHashArb,
        sealPolicyIdArb,
        suiSignerAddressArb,
        fc.boolean(),
        (blobId, txHash, policyId, signerAddress, advancedView) => {
          // Call each masking function twice and verify the outputs are identical
          expect(maskBlobId(blobId, advancedView)).toBe(maskBlobId(blobId, advancedView));
          expect(maskTxHash(txHash, advancedView)).toBe(maskTxHash(txHash, advancedView));
          expect(maskPolicyId(policyId, advancedView)).toBe(maskPolicyId(policyId, advancedView));
          expect(maskSignerAddress(signerAddress, advancedView)).toBe(
            maskSignerAddress(signerAddress, advancedView),
          );
        },
      ),
      { numRuns: 25 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 41g: Masking output never contains 0x-prefixed hex when advancedView = false
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 8.3**
   *
   * When advancedView = false, none of the masking functions should return
   * a string that looks like a raw chain identifier (0x-prefixed hex or
   * long alphanumeric string). This is a defense-in-depth check that the
   * placeholder values themselves are not accidentally chain-identifier-shaped.
   */
  it('Property 41g: masking output does not look like a chain identifier when advancedView = false', () => {
    fc.assert(
      fc.property(
        walrusBlobIdArb,
        suiTxHashArb,
        sealPolicyIdArb,
        suiSignerAddressArb,
        (blobId, txHash, policyId, signerAddress) => {
          const maskedBlobId = maskBlobId(blobId, false);
          const maskedTxHash = maskTxHash(txHash, false);
          const maskedPolicyId = maskPolicyId(policyId, false);
          const maskedSigner = maskSignerAddress(signerAddress, false);

          // Masked outputs should not match chain identifier patterns
          expect(WALRUS_BLOB_ID_PATTERN.test(maskedBlobId)).toBe(false);
          expect(SUI_TX_HASH_PATTERN.test(maskedTxHash)).toBe(false);
          expect(SEAL_POLICY_ID_PATTERN.test(maskedPolicyId)).toBe(false);
          expect(SUI_ADDRESS_PATTERN.test(maskedSigner)).toBe(false);
        },
      ),
      { numRuns: 25 },
    );
  });

  // ---------------------------------------------------------------------------
  // Exhaustive spot checks — concrete examples from the spec
  // ---------------------------------------------------------------------------

  it('Property 41 spot check: realistic Walrus blob ID is hidden when advancedView = false', () => {
    // A realistic-looking Walrus blob ID (base58-like)
    const blobId = 'BzFLs9pp8XVm2KnDFUzvougtYmVHVG8tbSyNLZHERGS';
    expect(maskBlobId(blobId, false)).not.toContain(blobId);
    expect(maskBlobId(blobId, true)).toContain(blobId);
  });

  it('Property 41 spot check: realistic Sui tx hash is hidden when advancedView = false', () => {
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
    expect(maskTxHash(txHash, false)).not.toContain(txHash);
    expect(maskTxHash(txHash, true)).toContain(txHash);
  });

  it('Property 41 spot check: realistic Seal policy ID is hidden when advancedView = false', () => {
    const policyId = '0x9b9972cd09e905eeb0ac627a4f99294c736f5dc71a743fac5cf254b6dd5e1138';
    expect(maskPolicyId(policyId, false)).not.toContain(policyId);
    expect(maskPolicyId(policyId, true)).toContain(policyId);
  });

  it('Property 41 spot check: realistic signer address is hidden when advancedView = false', () => {
    const address = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12';
    expect(maskSignerAddress(address, false)).not.toContain(address);
    expect(maskSignerAddress(address, false)).toBe('your account');
    expect(maskSignerAddress(address, true)).toContain(address);
  });
});
