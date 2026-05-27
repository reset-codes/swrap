/**
 * Unit tests for the decryption service.
 *
 * Tests the authorizedDecrypt function's behavior:
 *   - Submission validation (not found, public submission, missing policy ID)
 *   - Authorization check (unauthorized requester is rejected)
 *   - Successful decryption flow
 *
 * Note: This test file uses mocks for walrusGet and sealDecrypt to avoid
 * requiring real Walrus/Seal infrastructure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authorizedDecrypt,
  SubmissionNotFoundError,
  PublicSubmissionError,
  MissingPolicyIdError,
  DecryptionSystemError,
} from './decryption-service';
import {
  ForbiddenError,
  type AuthDb,
  type ViewerPermissionRecord,
} from './authorization';
import { _resetAuditLogStore, _auditLogStore } from './audit-log';
import type { FormRecord, SubmissionRecord } from './metadata-orchestrator';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock walrus-service
vi.mock('./walrus-service', () => ({
  walrusGet: vi.fn(),
  WalrusGetError: class WalrusGetError extends Error {
    readonly code = 'WALRUS_GET_FAILED' as const;
    constructor(
      public readonly blobId: string,
      public readonly attempts: number,
      cause: unknown,
    ) {
      super(`Walrus GET for blob "${blobId}" failed`);
      this.name = 'WalrusGetError';
    }
  },
  WalrusIntegrityError: class WalrusIntegrityError extends Error {
    readonly code = 'WALRUS_INTEGRITY_MISMATCH' as const;
    constructor(
      public readonly blobId: string,
      public readonly expectedDigest: string,
      public readonly actualDigest: string,
    ) {
      super(`Integrity check failed for blob "${blobId}"`);
      this.name = 'WalrusIntegrityError';
    }
  },
}));

// Mock infrastructure-wallet
vi.mock('./infrastructure-wallet', () => ({
  sealDecrypt: vi.fn(),
  WalletNotConfiguredError: class WalletNotConfiguredError extends Error {
    readonly code = 'WALLET_NOT_CONFIGURED' as const;
    constructor(reason: 'missing' | 'malformed' | 'wrong_scheme') {
      super(`Wallet not configured: ${reason}`);
      this.name = 'WalletNotConfiguredError';
    }
  },
  SealDecryptionError: class SealDecryptionError extends Error {
    readonly code = 'SEAL_DECRYPTION_FAILED' as const;
    constructor(cause: unknown) {
      super('Seal decryption failed');
      this.name = 'SealDecryptionError';
    }
  },
}));

// Import mocked modules
import { walrusGet } from './walrus-service';
import { sealDecrypt } from './infrastructure-wallet';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal AuthDb stub for testing.
 */
function createTestDb(
  forms: FormRecord[] = [],
  submissions: SubmissionRecord[] = [],
  viewerPermissions: ViewerPermissionRecord[] = [],
): AuthDb {
  const formMap = new Map(forms.map((f) => [f.id, f]));
  const submissionMap = new Map(submissions.map((s) => [s.id, s]));
  const permissionMap = new Map(
    viewerPermissions.map((p) => [`${p.formId}:${p.granteeAddress}`, p]),
  );

  return {
    getForm: (formId: string) => formMap.get(formId),
    getSubmission: (submissionId: string) => submissionMap.get(submissionId),
    getViewerPermission: (formId: string, granteeAddress: string) =>
      permissionMap.get(`${formId}:${granteeAddress}`),
  };
}

/**
 * Create a test form record.
 */
function createTestForm(overrides: Partial<FormRecord> = {}): FormRecord {
  return {
    id: 'form-1',
    ownerAddress: '0x' + 'a'.repeat(64),
    walrusBlobId: 'blob-form-1',
    privacyMode: 'private',
    policyId: '0x' + 'b'.repeat(64),
    version: 1,
    predecessorId: null,
    state: 'indexed',
    contentDigest: 'c'.repeat(64),
    sizeBytes: 100,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a test submission record.
 */
function createTestSubmission(
  overrides: Partial<SubmissionRecord> = {},
): SubmissionRecord {
  return {
    id: 'submission-1',
    formId: 'form-1',
    formVersion: 1,
    submitterAddress: '0x' + 'a'.repeat(64),
    walrusBlobId: 'blob-submission-1',
    privacyMode: 'private',
    contentDigest: 'd'.repeat(64),
    sizeBytes: 200,
    state: 'indexed',
    policyId: '0x' + 'b'.repeat(64),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  _resetAuditLogStore();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests: Submission validation
// ---------------------------------------------------------------------------

describe('authorizedDecrypt', () => {
  it('throws SubmissionNotFoundError if submission does not exist', async () => {
    const db = createTestDb([], [], []);
    const requesterAddress = '0x' + 'c'.repeat(64);

    await expect(
      authorizedDecrypt('nonexistent-submission', requesterAddress, db),
    ).rejects.toThrow(SubmissionNotFoundError);

    // Verify audit entry was written
    expect(_auditLogStore.length).toBe(1);
    expect(_auditLogStore[0].authorizationResult).toBe('denied');
    expect(_auditLogStore[0].outcome).toBe('denied');
  });

  it('throws PublicSubmissionError if submission is public', async () => {
    const form = createTestForm({ privacyMode: 'public', policyId: null });
    const submission = createTestSubmission({
      privacyMode: 'public',
      policyId: null,
    });
    const db = createTestDb([form], [submission], []);
    const requesterAddress = '0x' + 'c'.repeat(64);

    await expect(
      authorizedDecrypt('submission-1', requesterAddress, db),
    ).rejects.toThrow(PublicSubmissionError);

    // Verify audit entry was written
    expect(_auditLogStore.length).toBe(1);
    expect(_auditLogStore[0].authorizationResult).toBe('denied');
  });

  it('throws MissingPolicyIdError if private submission has no policyId', async () => {
    const form = createTestForm();
    const submission = createTestSubmission({ policyId: null });
    const db = createTestDb([form], [submission], []);
    const requesterAddress = '0x' + 'c'.repeat(64);

    await expect(
      authorizedDecrypt('submission-1', requesterAddress, db),
    ).rejects.toThrow(MissingPolicyIdError);

    // Verify audit entry was written
    expect(_auditLogStore.length).toBe(1);
    expect(_auditLogStore[0].authorizationResult).toBe('denied');
  });
});

// ---------------------------------------------------------------------------
// Tests: Authorization
// ---------------------------------------------------------------------------

describe('authorizedDecrypt: authorization', () => {
  it('throws ForbiddenError if requester is not authorized', async () => {
    const ownerAddress = '0x' + 'a'.repeat(64);
    const requesterAddress = '0x' + 'b'.repeat(64); // Different from owner
    const form = createTestForm({ ownerAddress });
    const submission = createTestSubmission({ submitterAddress: ownerAddress });
    const db = createTestDb([form], [submission], []);

    await expect(
      authorizedDecrypt('submission-1', requesterAddress, db),
    ).rejects.toThrow(ForbiddenError);

    // Verify walrusGet and sealDecrypt were NOT called
    expect(walrusGet).not.toHaveBeenCalled();
    expect(sealDecrypt).not.toHaveBeenCalled();
  });

  it('allows owner to decrypt', async () => {
    const ownerAddress = '0x' + 'a'.repeat(64);
    const form = createTestForm({ ownerAddress });
    const submission = createTestSubmission({ submitterAddress: ownerAddress });
    const db = createTestDb([form], [submission], []);

    // Mock successful Walrus fetch and Seal decryption
    const mockCiphertext = new Uint8Array([1, 2, 3, 4]);
    const mockPlaintext = new Uint8Array([5, 6, 7, 8]);
    vi.mocked(walrusGet).mockResolvedValue(mockCiphertext);
    vi.mocked(sealDecrypt).mockResolvedValue(mockPlaintext);

    const result = await authorizedDecrypt('submission-1', ownerAddress, db);

    expect(result).toEqual(mockPlaintext);
    expect(walrusGet).toHaveBeenCalledWith(
      'blob-submission-1',
      'd'.repeat(64),
    );
    expect(sealDecrypt).toHaveBeenCalledWith(mockCiphertext, '0x' + 'b'.repeat(64));
  });

  it('allows viewer with permission to decrypt', async () => {
    const ownerAddress = '0x' + 'a'.repeat(64);
    const viewerAddress = '0x' + 'b'.repeat(64);
    const form = createTestForm({ ownerAddress });
    const submission = createTestSubmission({ submitterAddress: ownerAddress });
    const viewerPermission: ViewerPermissionRecord = {
      formId: 'form-1',
      granteeAddress: viewerAddress,
      capability: 'view',
      grantedByAddress: ownerAddress,
    };
    const db = createTestDb([form], [submission], [viewerPermission]);

    // Mock successful Walrus fetch and Seal decryption
    const mockCiphertext = new Uint8Array([1, 2, 3, 4]);
    const mockPlaintext = new Uint8Array([5, 6, 7, 8]);
    vi.mocked(walrusGet).mockResolvedValue(mockCiphertext);
    vi.mocked(sealDecrypt).mockResolvedValue(mockPlaintext);

    const result = await authorizedDecrypt('submission-1', viewerAddress, db);

    expect(result).toEqual(mockPlaintext);
  });
});

// ---------------------------------------------------------------------------
// Tests: Walrus/Seal failures
// ---------------------------------------------------------------------------

describe('authorizedDecrypt: Walrus/Seal failures', () => {
  it('throws DecryptionSystemError on Walrus fetch failure', async () => {
    const ownerAddress = '0x' + 'a'.repeat(64);
    const form = createTestForm({ ownerAddress });
    const submission = createTestSubmission({ submitterAddress: ownerAddress });
    const db = createTestDb([form], [submission], []);

    // Mock Walrus fetch failure
    const walrusError = new Error('Network error');
    vi.mocked(walrusGet).mockRejectedValue(walrusError);

    await expect(
      authorizedDecrypt('submission-1', ownerAddress, db),
    ).rejects.toThrow(DecryptionSystemError);

    // Verify sealDecrypt was NOT called
    expect(sealDecrypt).not.toHaveBeenCalled();

    // Verify error audit entry was written
    const errorAuditEntries = _auditLogStore.filter(
      (e) => e.outcome === 'error',
    );
    expect(errorAuditEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('throws SealDecryptionError on Seal decryption failure', async () => {
    const ownerAddress = '0x' + 'a'.repeat(64);
    const form = createTestForm({ ownerAddress });
    const submission = createTestSubmission({ submitterAddress: ownerAddress });
    const db = createTestDb([form], [submission], []);

    // Mock successful Walrus fetch but Seal decryption failure
    const mockCiphertext = new Uint8Array([1, 2, 3, 4]);
    vi.mocked(walrusGet).mockResolvedValue(mockCiphertext);
    const sealError = new Error('Decryption failed');
    vi.mocked(sealDecrypt).mockRejectedValue(sealError);

    await expect(
      authorizedDecrypt('submission-1', ownerAddress, db),
    ).rejects.toThrow();

    // Verify error audit entry was written
    const errorAuditEntries = _auditLogStore.filter(
      (e) => e.outcome === 'error',
    );
    expect(errorAuditEntries.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Audit logging
// ---------------------------------------------------------------------------

describe('authorizedDecrypt: audit logging', () => {
  it('writes audit entry before decryption attempt', async () => {
    const ownerAddress = '0x' + 'a'.repeat(64);
    const form = createTestForm({ ownerAddress });
    const submission = createTestSubmission({ submitterAddress: ownerAddress });
    const db = createTestDb([form], [submission], []);

    // Mock successful operations
    vi.mocked(walrusGet).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(sealDecrypt).mockResolvedValue(new Uint8Array([2]));

    await authorizedDecrypt('submission-1', ownerAddress, db);

    // Verify at least one audit entry was written
    expect(_auditLogStore.length).toBeGreaterThanOrEqual(1);

    // Verify the entry has the correct action and authorization result
    const decryptEntries = _auditLogStore.filter(
      (e) => e.action === 'submission.decrypt',
    );
    expect(decryptEntries.length).toBeGreaterThanOrEqual(1);
    expect(decryptEntries[0].authorizationResult).toBe('granted');
    expect(decryptEntries[0].actorAddress).toBe(ownerAddress);
  });
});
