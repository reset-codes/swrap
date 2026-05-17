/**
 * Property-based tests for active signer binding (Property 5)
 *
 * **Validates: Requirements 1.5, 1.6**
 *
 * Property 5: Active signer is the Form_Owner
 *
 *   For any authenticated session with active signer `s`, every newly created
 *   form's `ownerAddress` equals `s.address`.
 *
 *   This is the attribution invariant: the Authorization_Identity that is
 *   active at form-creation time MUST be recorded as the Form_Owner for that
 *   form and for any Submission_Payload created during that flow.
 *
 * Requirements:
 *   1.5 — THE ZK Login identity SHALL be used for ownership mapping, viewer
 *          permissions, authorization checks, sharing permissions, and audit
 *          attribution.
 *   1.6 — THE Web_App SHALL treat the active ZK_Login_Account or
 *          External_Wallet address as the Form_Owner Authorization_Identity
 *          for newly created forms and submissions.
 *
 * Test strategy:
 *   - Generate arbitrary Sui addresses representing authenticated signers.
 *   - Simulate the auth-client session state (both zk-login and external-wallet).
 *   - Simulate the metadata-client createForm / createSubmission calls.
 *   - Assert that the ownerAddress / submitterAddress in every outbound request
 *     equals the active signer's address.
 *   - Assert that switching signers between operations correctly re-binds the
 *     owner to the new signer.
 *   - Assert that no form or submission is created with a null, empty, or
 *     mismatched ownerAddress.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Types mirroring auth-client.ts and the metadata API contract
// ---------------------------------------------------------------------------

type SignerKind = 'zk-login' | 'external-wallet';
type PrivacyMode = 'public' | 'private';
type UploadState = 'pending' | 'encrypting' | 'uploading' | 'uploaded' | 'indexed' | 'failed';

interface SessionState {
  status: 'authenticated' | 'unauthenticated' | 'loading';
  address: string | null;
  signerKind: SignerKind | null;
  expiresAt: number | null;
}

/** Outbound create-form request body (mirrors metadata-client.createForm). */
interface CreateFormRequest {
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  policyId?: string;
  /** Injected by the metadata client from the active session address. */
  ownerAddress: string;
}

/** Outbound create-submission request body (mirrors metadata-client.createSubmission). */
interface CreateSubmissionRequest {
  formId: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  policyId?: string;
  /** Injected by the metadata client from the active session address. */
  submitterAddress: string;
}

/** Simulated API response for form creation. */
interface CreateFormResponse {
  ok: true;
  formId: string;
  ownerAddress: string;
  state: UploadState;
}

/** Simulated API response for submission creation. */
interface CreateSubmissionResponse {
  ok: true;
  submissionId: string;
  submitterAddress: string;
  state: UploadState;
}

// ---------------------------------------------------------------------------
// Metadata client under test
//
// This is a pure-logic implementation of the metadata client's owner-binding
// behaviour. It encodes the invariant from Requirements 1.5 and 1.6:
//
//   The active session address MUST be injected as ownerAddress (for forms)
//   and submitterAddress (for submissions) in every outbound request.
//
// The real metadata-client.ts (task 22) will implement the same invariant
// against the live API. These tests validate the invariant in isolation,
// without network calls, so they can run fast and cover a large input space.
// ---------------------------------------------------------------------------

/**
 * Thrown when a metadata operation is attempted without an active session.
 * Mirrors RequiresReauthError from auth-client.ts.
 */
class RequiresAuthError extends Error {
  constructor(reason: 'no_session' | 'unauthenticated') {
    super(`Authentication required: ${reason}`);
    this.name = 'RequiresAuthError';
  }
}

/**
 * Metadata client factory.
 *
 * Accepts a `getSession` function (injected dependency) so tests can control
 * the active session without importing the real auth-client module.
 *
 * Returns `createForm` and `createSubmission` functions that:
 *   1. Read the active session address via `getSession()`.
 *   2. Throw `RequiresAuthError` if no authenticated session exists.
 *   3. Inject the session address as `ownerAddress` / `submitterAddress`.
 *   4. Record the outbound request in `capturedRequests` (test spy).
 */
function makeMetadataClient(
  getSession: () => SessionState,
  capturedFormRequests: CreateFormRequest[],
  capturedSubmissionRequests: CreateSubmissionRequest[],
) {
  function getActiveAddress(): string {
    const session = getSession();
    if (session.status !== 'authenticated' || !session.address) {
      throw new RequiresAuthError('no_session');
    }
    return session.address;
  }

  function createForm(params: {
    walrusBlobId: string;
    privacyMode: PrivacyMode;
    contentDigest: string;
    sizeBytes: number;
    policyId?: string;
  }): CreateFormResponse {
    const ownerAddress = getActiveAddress();

    const request: CreateFormRequest = {
      ...params,
      ownerAddress,
    };

    // Record the outbound request (spy)
    capturedFormRequests.push(request);

    // Simulate a successful API response
    return {
      ok: true,
      formId: `form-${Math.random().toString(36).slice(2)}`,
      ownerAddress,
      state: 'indexed',
    };
  }

  function createSubmission(params: {
    formId: string;
    walrusBlobId: string;
    privacyMode: PrivacyMode;
    contentDigest: string;
    sizeBytes: number;
    policyId?: string;
  }): CreateSubmissionResponse {
    const submitterAddress = getActiveAddress();

    const request: CreateSubmissionRequest = {
      ...params,
      submitterAddress,
    };

    // Record the outbound request (spy)
    capturedSubmissionRequests.push(request);

    // Simulate a successful API response
    return {
      ok: true,
      submissionId: `sub-${Math.random().toString(36).slice(2)}`,
      submitterAddress,
      state: 'indexed',
    };
  }

  return { createForm, createSubmission };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary: a valid-looking Sui address (0x-prefixed, 64 hex chars).
 * Represents an Authorization_Identity address.
 */
const suiAddressArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9a-f]{64}$/)
  .map((hex) => `0x${hex}`);

/**
 * Arbitrary: a signer kind.
 */
const signerKindArb: fc.Arbitrary<SignerKind> = fc.constantFrom('zk-login', 'external-wallet');

/**
 * Arbitrary: an authenticated session state with a specific address.
 */
function authenticatedSessionArb(address: string, signerKind: SignerKind): SessionState {
  return {
    status: 'authenticated',
    address,
    signerKind,
    expiresAt: signerKind === 'zk-login' ? Date.now() + 24 * 60 * 60 * 1000 : null,
  };
}

/**
 * Arbitrary: a privacy mode.
 */
const privacyModeArb: fc.Arbitrary<PrivacyMode> = fc.constantFrom('public', 'private');

/**
 * Arbitrary: a Walrus blob ID (alphanumeric, 10–60 chars).
 */
const walrusBlobIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9_-]{10,60}$/)
  .filter((s) => s.length >= 10);

/**
 * Arbitrary: a SHA-256 hex digest (64 hex chars).
 */
const sha256HexArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 })
  .map((digits) => digits.map((d) => d.toString(16)).join(''));

/**
 * Arbitrary: a UUID-like form ID.
 */
const formIdArb: fc.Arbitrary<string> = fc.uuid();

/**
 * Arbitrary: create-form parameters (without ownerAddress — that is injected).
 */
const createFormParamsArb: fc.Arbitrary<{
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  policyId?: string;
}> = privacyModeArb.chain((mode) =>
  fc.record({
    walrusBlobId: walrusBlobIdArb,
    privacyMode: fc.constant(mode),
    contentDigest: sha256HexArb,
    sizeBytes: fc.integer({ min: 1, max: 10_000_000 }),
    policyId: mode === 'private' ? suiAddressArb.map((a) => a) : fc.constant(undefined),
  }),
);

/**
 * Arbitrary: create-submission parameters (without submitterAddress).
 */
const createSubmissionParamsArb: fc.Arbitrary<{
  formId: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  policyId?: string;
}> = privacyModeArb.chain((mode) =>
  fc.record({
    formId: formIdArb,
    walrusBlobId: walrusBlobIdArb,
    privacyMode: fc.constant(mode),
    contentDigest: sha256HexArb,
    sizeBytes: fc.integer({ min: 1, max: 10_000_000 }),
    policyId: mode === 'private' ? suiAddressArb.map((a) => a) : fc.constant(undefined),
  }),
);

// ---------------------------------------------------------------------------
// Property 5a: createForm injects the active signer address as ownerAddress
// ---------------------------------------------------------------------------

describe('Property 5: Active signer is the Form_Owner', () => {
  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * For any authenticated session with active signer `s` and any generated
   * form creation parameters, the outbound createForm request MUST have
   * `ownerAddress === s.address`.
   *
   * This is the core attribution invariant for form creation.
   */
  it('Property 5a: createForm sets ownerAddress to the active session address for all generated addresses and signer kinds', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        signerKindArb,
        createFormParamsArb,
        (address, signerKind, params) => {
          const session = authenticatedSessionArb(address, signerKind);
          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          const response = client.createForm(params);

          // The outbound request must carry the active signer's address
          expect(capturedFormRequests).toHaveLength(1);
          expect(capturedFormRequests[0].ownerAddress).toBe(address);

          // The response must also reflect the correct owner
          expect(response.ownerAddress).toBe(address);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * For any authenticated session with active signer `s` and any generated
   * submission creation parameters, the outbound createSubmission request
   * MUST have `submitterAddress === s.address`.
   *
   * This is the attribution invariant for submission creation.
   */
  it('Property 5b: createSubmission sets submitterAddress to the active session address for all generated addresses and signer kinds', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        signerKindArb,
        createSubmissionParamsArb,
        (address, signerKind, params) => {
          const session = authenticatedSessionArb(address, signerKind);
          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          const response = client.createSubmission(params);

          // The outbound request must carry the active signer's address
          expect(capturedSubmissionRequests).toHaveLength(1);
          expect(capturedSubmissionRequests[0].submitterAddress).toBe(address);

          // The response must also reflect the correct submitter
          expect(response.submitterAddress).toBe(address);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * For any sequence of form creation calls within the same authenticated
   * session, every outbound request carries the same ownerAddress (the
   * session address). The attribution is stable across multiple calls.
   */
  it('Property 5c: all forms created in the same session share the same ownerAddress', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        signerKindArb,
        fc.array(createFormParamsArb, { minLength: 1, maxLength: 10 }),
        (address, signerKind, paramsList) => {
          const session = authenticatedSessionArb(address, signerKind);
          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          for (const params of paramsList) {
            client.createForm(params);
          }

          // Every captured request must have the same ownerAddress
          expect(capturedFormRequests).toHaveLength(paramsList.length);
          for (const req of capturedFormRequests) {
            expect(req.ownerAddress).toBe(address);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * For any sequence of submission creation calls within the same authenticated
   * session, every outbound request carries the same submitterAddress.
   */
  it('Property 5d: all submissions created in the same session share the same submitterAddress', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        signerKindArb,
        fc.array(createSubmissionParamsArb, { minLength: 1, maxLength: 10 }),
        (address, signerKind, paramsList) => {
          const session = authenticatedSessionArb(address, signerKind);
          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          for (const params of paramsList) {
            client.createSubmission(params);
          }

          expect(capturedSubmissionRequests).toHaveLength(paramsList.length);
          for (const req of capturedSubmissionRequests) {
            expect(req.submitterAddress).toBe(address);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * When the active signer switches between two operations, the ownerAddress
   * in each request reflects the signer that was active at the time of that
   * specific call — not a stale address from a prior session.
   *
   * This is the signer-switch attribution invariant: the binding is live, not
   * captured at client construction time.
   */
  it('Property 5e: signer switch — ownerAddress reflects the signer active at call time', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        suiAddressArb,
        signerKindArb,
        signerKindArb,
        createFormParamsArb,
        createFormParamsArb,
        (addressA, addressB, kindA, kindB, paramsA, paramsB) => {
          // Precondition: the two addresses must differ so we can distinguish them
          fc.pre(addressA !== addressB);

          let currentSession: SessionState = authenticatedSessionArb(addressA, kindA);

          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => currentSession,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          // First call: signer A is active
          client.createForm(paramsA);

          // Switch to signer B
          currentSession = authenticatedSessionArb(addressB, kindB);

          // Second call: signer B is now active
          client.createForm(paramsB);

          expect(capturedFormRequests).toHaveLength(2);

          // First request must be attributed to signer A
          expect(capturedFormRequests[0].ownerAddress).toBe(addressA);

          // Second request must be attributed to signer B
          expect(capturedFormRequests[1].ownerAddress).toBe(addressB);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * The ownerAddress in every outbound request is never null, undefined, or
   * an empty string. If the session is unauthenticated, the client MUST throw
   * rather than emit a request with a missing owner.
   *
   * This guards against the failure mode where a form is created with no
   * owner attribution, which would break all downstream authorization checks.
   */
  it('Property 5f: ownerAddress is never null, undefined, or empty in any outbound request', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        signerKindArb,
        fc.array(createFormParamsArb, { minLength: 1, maxLength: 5 }),
        (address, signerKind, paramsList) => {
          const session = authenticatedSessionArb(address, signerKind);
          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          for (const params of paramsList) {
            client.createForm(params);
          }

          for (const req of capturedFormRequests) {
            expect(req.ownerAddress).toBeTruthy();
            expect(typeof req.ownerAddress).toBe('string');
            expect(req.ownerAddress.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * When the session is unauthenticated (status !== 'authenticated' or
   * address === null), createForm MUST throw RequiresAuthError and MUST NOT
   * emit any outbound request.
   *
   * This prevents form creation with a missing owner attribution.
   */
  it('Property 5g: createForm throws RequiresAuthError when session is unauthenticated — no request emitted', () => {
    const unauthenticatedSessions: SessionState[] = [
      { status: 'unauthenticated', address: null, signerKind: null, expiresAt: null },
      { status: 'loading', address: null, signerKind: null, expiresAt: null },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...unauthenticatedSessions),
        createFormParamsArb,
        (session, params) => {
          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          expect(() => client.createForm(params)).toThrow(RequiresAuthError);

          // No request must have been emitted
          expect(capturedFormRequests).toHaveLength(0);
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * When the session is unauthenticated, createSubmission MUST throw
   * RequiresAuthError and MUST NOT emit any outbound request.
   */
  it('Property 5h: createSubmission throws RequiresAuthError when session is unauthenticated — no request emitted', () => {
    const unauthenticatedSessions: SessionState[] = [
      { status: 'unauthenticated', address: null, signerKind: null, expiresAt: null },
      { status: 'loading', address: null, signerKind: null, expiresAt: null },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...unauthenticatedSessions),
        createSubmissionParamsArb,
        (session, params) => {
          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          expect(() => client.createSubmission(params)).toThrow(RequiresAuthError);

          // No request must have been emitted
          expect(capturedSubmissionRequests).toHaveLength(0);
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * The ownerAddress in the outbound request MUST equal the address returned
   * by getActiveAddress() at the time of the call. This is the round-trip
   * invariant between the session state and the request attribution.
   *
   * Concretely: if getActiveAddress() returns `addr`, then every form created
   * in that session has ownerAddress === addr.
   */
  it('Property 5i: ownerAddress in request equals getActiveAddress() at call time for all generated sessions', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        signerKindArb,
        createFormParamsArb,
        (address, signerKind, params) => {
          const session = authenticatedSessionArb(address, signerKind);

          // Simulate getActiveAddress() — returns session.address when authenticated
          const getActiveAddress = (): string | null => {
            if (session.status !== 'authenticated') return null;
            return session.address;
          };

          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          client.createForm(params);

          const activeAddress = getActiveAddress();
          expect(activeAddress).not.toBeNull();
          expect(capturedFormRequests[0].ownerAddress).toBe(activeAddress);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * For any two distinct authenticated signers A and B, forms created by A
   * MUST NOT have ownerAddress === B.address, and vice versa.
   *
   * This is the non-confusion invariant: attribution must be signer-specific
   * and must not bleed across sessions.
   */
  it('Property 5j: forms created by signer A are never attributed to signer B', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        suiAddressArb,
        signerKindArb,
        signerKindArb,
        createFormParamsArb,
        (addressA, addressB, kindA, kindB, params) => {
          fc.pre(addressA !== addressB);

          const sessionA = authenticatedSessionArb(addressA, kindA);
          const sessionB = authenticatedSessionArb(addressB, kindB);

          const capturedA: CreateFormRequest[] = [];
          const capturedB: CreateFormRequest[] = [];

          const clientA = makeMetadataClient(() => sessionA, capturedA, []);
          const clientB = makeMetadataClient(() => sessionB, capturedB, []);

          clientA.createForm(params);
          clientB.createForm(params);

          // A's form must not be attributed to B
          expect(capturedA[0].ownerAddress).not.toBe(addressB);
          expect(capturedA[0].ownerAddress).toBe(addressA);

          // B's form must not be attributed to A
          expect(capturedB[0].ownerAddress).not.toBe(addressA);
          expect(capturedB[0].ownerAddress).toBe(addressB);
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * The attribution invariant holds for both ZK Login and External_Wallet
   * signer kinds. The signer kind does not affect the ownerAddress binding.
   *
   * This ensures that the attribution mechanism is signer-kind-agnostic.
   */
  it('Property 5k: attribution invariant holds for both zk-login and external-wallet signer kinds', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        createFormParamsArb,
        (address, params) => {
          for (const signerKind of ['zk-login', 'external-wallet'] as SignerKind[]) {
            const session = authenticatedSessionArb(address, signerKind);
            const capturedFormRequests: CreateFormRequest[] = [];

            const client = makeMetadataClient(() => session, capturedFormRequests, []);
            client.createForm(params);

            expect(capturedFormRequests[0].ownerAddress).toBe(address);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6**
   *
   * Mixed flow: for any sequence of form and submission creation calls in the
   * same session, every outbound request (both form and submission) carries
   * the same active signer address.
   *
   * This is the full attribution invariant across the entire creation flow.
   */
  it('Property 5l: mixed form and submission creation — all requests attributed to the same active signer', () => {
    fc.assert(
      fc.property(
        suiAddressArb,
        signerKindArb,
        fc.array(createFormParamsArb, { minLength: 1, maxLength: 5 }),
        fc.array(createSubmissionParamsArb, { minLength: 1, maxLength: 5 }),
        (address, signerKind, formParamsList, submissionParamsList) => {
          const session = authenticatedSessionArb(address, signerKind);
          const capturedFormRequests: CreateFormRequest[] = [];
          const capturedSubmissionRequests: CreateSubmissionRequest[] = [];

          const client = makeMetadataClient(
            () => session,
            capturedFormRequests,
            capturedSubmissionRequests,
          );

          // Interleave form and submission creation
          for (let i = 0; i < Math.max(formParamsList.length, submissionParamsList.length); i++) {
            if (i < formParamsList.length) {
              client.createForm(formParamsList[i]);
            }
            if (i < submissionParamsList.length) {
              client.createSubmission(submissionParamsList[i]);
            }
          }

          // All form requests must be attributed to the active signer
          for (const req of capturedFormRequests) {
            expect(req.ownerAddress).toBe(address);
          }

          // All submission requests must be attributed to the active signer
          for (const req of capturedSubmissionRequests) {
            expect(req.submitterAddress).toBe(address);
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});
