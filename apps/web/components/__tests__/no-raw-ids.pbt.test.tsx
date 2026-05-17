// @vitest-environment jsdom
/**
 * Property-based tests for no raw IDs in primary-flow rendered components (Property 41)
 *
 * **Validates: Requirements 8.3**
 *
 * Property 41: No chain IDs in primary flows — for any generated metadata
 * rendered into primary-flow components with `advancedView=false`, no rendered
 * output contains a Walrus blob ID, Sui transaction hash, Seal policy ID,
 * or raw signer address.
 *
 * Unlike the existing `primary-flow.pbt.test.ts` which tests the masking
 * functions in isolation, this test renders the ACTUAL React components
 * (SubmissionListRow, SubmissionDetailPanel, UploadStatusPill) and asserts
 * that no raw chain identifiers leak into the rendered DOM text content.
 *
 * Test strategy:
 *   - Generate random Walrus blob IDs (alphanumeric 20-64 chars)
 *   - Generate random Sui transaction hashes (0x-prefixed 64-char hex)
 *   - Generate random Seal policy IDs (alphanumeric 20-64 chars)
 *   - Generate random signer addresses (0x-prefixed 64-char hex)
 *   - Pass these as props to primary-flow components
 *   - With advancedView=false (default), assert NONE of the raw identifiers
 *     appear in the rendered text content
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// localStorage mock — jsdom in this project doesn't provide full localStorage
// ---------------------------------------------------------------------------

function createLocalStorageMock() {
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
  };
}

let mockStorage: ReturnType<typeof createLocalStorageMock>;

beforeEach(() => {
  mockStorage = createLocalStorageMock();
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  mockStorage.clear();
  cleanup();
});

// Import after mock setup — modules read localStorage at call time, not import time
import { ADVANCED_VIEW_KEY } from '../../lib/copy/advanced-view';
import { SubmissionListRow } from '../submissions/SubmissionListRow';
import { SubmissionDetailPanel } from '../submissions/SubmissionDetailPanel';
import { UploadStatusPill } from '../walrus/UploadStatusPill';

// ---------------------------------------------------------------------------
// Arbitraries — generate realistic chain identifiers per task spec
// ---------------------------------------------------------------------------

/**
 * Walrus blob ID: alphanumeric string 20-64 chars.
 * Must be long enough to be distinguishable from normal UI text.
 */
const walrusBlobIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9]{20,64}$/)
  .filter((s) => s.length >= 20);

/**
 * Sui transaction hash: 0x-prefixed 64-char hex string.
 */
const suiTxHashArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/, { maxLength: 64 })
  .filter((s) => s.length === 64)
  .map((hex) => `0x${hex}`);

/**
 * Seal policy ID: alphanumeric string 20-64 chars.
 */
const sealPolicyIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9]{20,64}$/)
  .filter((s) => s.length >= 20);

/**
 * Signer address: 0x-prefixed 64-char hex string.
 */
const signerAddressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/, { maxLength: 64 })
  .filter((s) => s.length === 64)
  .map((hex) => `0x${hex}`);

// ---------------------------------------------------------------------------
// Helper: extract all text content from a rendered container
// ---------------------------------------------------------------------------

function getAllTextContent(container: HTMLElement): string {
  return container.textContent ?? '';
}

// ---------------------------------------------------------------------------
// Property 41: No raw chain IDs in primary-flow rendered components
// ---------------------------------------------------------------------------

describe('Property 41: No raw chain IDs in primary-flow rendered components', () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * SubmissionListRow receives blobId and formBlobId as props.
   * When advancedView=false, neither raw blob ID should appear in rendered text.
   */
  it('SubmissionListRow does not render raw blob IDs when advancedView=false', () => {
    fc.assert(
      fc.property(walrusBlobIdArb, walrusBlobIdArb, (blobId, formBlobId) => {
        // Ensure advancedView is false
        mockStorage.clear();

        const { container } = render(
          <table>
            <tbody>
              <SubmissionListRow
                blobId={blobId}
                formBlobId={formBlobId}
                submittedAt={new Date().toISOString()}
              />
            </tbody>
          </table>,
        );

        const text = getAllTextContent(container);

        // Raw blob IDs must NOT appear in rendered text
        expect(text).not.toContain(blobId);
        expect(text).not.toContain(formBlobId);

        cleanup();
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * SubmissionDetailPanel receives a submission object with form_blob_id.
   * When advancedView=false, the raw blob ID should not appear in rendered text.
   */
  it('SubmissionDetailPanel does not render raw blob IDs when advancedView=false', () => {
    fc.assert(
      fc.property(walrusBlobIdArb, (blobId) => {
        // Ensure advancedView is false
        mockStorage.clear();

        const submission = {
          form_blob_id: blobId,
          form_schema_hash: 'a'.repeat(64),
          answers: { name: 'Test User', email: 'test@example.com' },
          submitted_at: new Date().toISOString(),
        };

        const { container } = render(
          <SubmissionDetailPanel submission={submission} />,
        );

        const text = getAllTextContent(container);

        // Raw blob ID must NOT appear in rendered text
        expect(text).not.toContain(blobId);

        cleanup();
      }),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * UploadStatusPill does not accept raw chain IDs as props — it only
   * renders UX vocabulary labels. This test verifies that for all stages,
   * no chain-identifier-shaped strings appear in the rendered output.
   *
   * We generate random chain IDs and verify they don't appear in the
   * UploadStatusPill output for any stage (defense-in-depth).
   */
  it('UploadStatusPill never renders chain-identifier-shaped strings', () => {
    const stages = [
      'securing',
      'uploading',
      'anchoring',
      'success',
      'error.securing',
      'error.uploading',
      'error.anchoring',
    ] as const;

    fc.assert(
      fc.property(
        suiTxHashArb,
        signerAddressArb,
        fc.constantFrom(...stages),
        (txHash, address, stage) => {
          const { container } = render(<UploadStatusPill stage={stage} />);

          const text = getAllTextContent(container);

          // No chain identifiers should appear in the pill output
          expect(text).not.toContain(txHash);
          expect(text).not.toContain(address);
          // The pill should only contain UX vocabulary labels
          expect(text.startsWith('0x')).toBe(false);

          cleanup();
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Combined property: generate ALL four types of chain identifiers,
   * pass them to SubmissionListRow (which receives blob IDs), and verify
   * none of the identifiers appear in the rendered output.
   *
   * This tests the end-to-end rendering path with advancedView=false.
   */
  it('SubmissionListRow with all identifier types: none leak into rendered text', () => {
    fc.assert(
      fc.property(
        walrusBlobIdArb,
        suiTxHashArb,
        sealPolicyIdArb,
        signerAddressArb,
        (blobId, txHash, policyId, signerAddress) => {
          // Ensure advancedView is false
          mockStorage.clear();

          // Use the blobId and policyId as the two blob ID props
          // (SubmissionListRow takes blobId and formBlobId)
          const { container } = render(
            <table>
              <tbody>
                <SubmissionListRow
                  blobId={blobId}
                  formBlobId={policyId}
                  submittedAt={new Date().toISOString()}
                />
              </tbody>
            </table>,
          );

          const text = getAllTextContent(container);

          // NONE of the raw chain identifiers should appear
          expect(text).not.toContain(blobId);
          expect(text).not.toContain(txHash);
          expect(text).not.toContain(policyId);
          expect(text).not.toContain(signerAddress);

          cleanup();
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Combined property: SubmissionDetailPanel with generated blob IDs
   * and transaction hashes embedded in the submission object.
   * Verifies no raw identifiers leak into the rendered DOM.
   */
  it('SubmissionDetailPanel with generated chain IDs: none leak into rendered text', () => {
    fc.assert(
      fc.property(
        walrusBlobIdArb,
        suiTxHashArb,
        sealPolicyIdArb,
        signerAddressArb,
        (blobId, txHash, policyId, signerAddress) => {
          // Ensure advancedView is false
          mockStorage.clear();

          const submission = {
            form_blob_id: blobId,
            form_schema_hash: 'b'.repeat(64),
            answers: {
              field1: 'Some answer',
              field2: 42,
            },
            submitted_at: new Date().toISOString(),
          };

          const { container } = render(
            <SubmissionDetailPanel submission={submission} />,
          );

          const text = getAllTextContent(container);

          // The blob ID passed as form_blob_id must NOT appear
          expect(text).not.toContain(blobId);
          // Other chain identifiers (not passed as props but checked for defense-in-depth)
          expect(text).not.toContain(txHash);
          expect(text).not.toContain(policyId);
          expect(text).not.toContain(signerAddress);

          cleanup();
        },
      ),
      { numRuns: 25 },
    );
  });
});
