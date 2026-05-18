/**
 * Unit tests for apps/api/services/metadata-orchestrator.ts
 *
 * Tests cover:
 *   - orchestrateFormCreate: public and private flows, idempotent reconcile,
 *     state machine transitions, error handling
 *   - orchestrateSubmissionCreate: privacy mode mismatch, form not found,
 *     public and private flows
 *   - orchestrateFileCreate: submission not found, upload and index flow
 *
 * All Walrus and Seal calls are mocked so tests run without network access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  orchestrateFormCreate,
  orchestrateSubmissionCreate,
  orchestrateFileCreate,
  PrivacyModeMismatchError,
  FormNotFoundError,
  SubmissionNotFoundError,
  BlobNotFoundError,
  OrchestrationError,
  type Db,
  type FormRecord,
  type SubmissionRecord,
  type FileRecord,
  type UploadJobRecord,
  type UploadState,
} from './metadata-orchestrator';

// ---------------------------------------------------------------------------
// Mock infrastructure-wallet and walrus-service
// ---------------------------------------------------------------------------

vi.mock('./infrastructure-wallet', () => ({
  sealEncrypt: vi.fn(),
  WalletNotConfiguredError: class WalletNotConfiguredError extends Error {
    code = 'WALLET_NOT_CONFIGURED';
    constructor(reason: string) { super(reason); this.name = 'WalletNotConfiguredError'; }
  },
  SealEncryptionError: class SealEncryptionError extends Error {
    code = 'SEAL_ENCRYPTION_FAILED';
    constructor(cause: unknown) { super(String(cause)); this.name = 'SealEncryptionError'; }
  },
}));

vi.mock('./walrus-service', () => ({
  walrusPut: vi.fn(),
  walrusBlobExists: vi.fn(),
  walrusPutWithCliFallback: vi.fn(),
  WalrusPutError: class WalrusPutError extends Error {
    code = 'WALRUS_PUT_FAILED';
    constructor(blobId: string | undefined, attempts: number, cause: unknown) {
      super(String(cause)); this.name = 'WalrusPutError';
    }
  },
  WalrusGetError: class WalrusGetError extends Error {
    code = 'WALRUS_GET_FAILED';
    constructor(blobId: string, attempts: number, cause: unknown) {
      super(String(cause)); this.name = 'WalrusGetError';
    }
  },
}));

vi.mock('./audit-log', () => ({
  writeAuditEntry: vi.fn().mockResolvedValue(undefined),
  AuditLogWriteError: class AuditLogWriteError extends Error {
    code = 'AUDIT_LOG_WRITE_FAILED';
    constructor(cause: unknown) { super(String(cause)); this.name = 'AuditLogWriteError'; }
  },
}));

import { sealEncrypt } from './infrastructure-wallet';
import { walrusPut, walrusBlobExists, walrusPutWithCliFallback } from './walrus-service';

// ---------------------------------------------------------------------------
// In-memory Db stub for tests
// ---------------------------------------------------------------------------

function makeDb(): Db & {
  forms: Map<string, FormRecord>;
  submissions: Map<string, SubmissionRecord>;
  files: Map<string, FileRecord>;
  jobs: Map<string, UploadJobRecord>;
} {
  const forms = new Map<string, FormRecord>();
  const submissions = new Map<string, SubmissionRecord>();
  const files = new Map<string, FileRecord>();
  const jobs = new Map<string, UploadJobRecord>();

  return {
    forms,
    submissions,
    files,
    jobs,
    getForm: (id) => forms.get(id),
    insertForm: (row) => { forms.set(row.id, row); return row; },
    getSubmission: (id) => submissions.get(id),
    insertSubmission: (row) => { submissions.set(row.id, row); return row; },
    getFile: (id) => files.get(id),
    insertFile: (row) => { files.set(row.id, row); return row; },
    insertUploadJob: (row) => { jobs.set(row.id, row); return row; },
    updateUploadJobState: (jobId, state, failureReason) => {
      const job = jobs.get(jobId);
      if (job) {
        job.state = state;
        job.failureReason = failureReason ?? null;
        job.updatedAt = new Date().toISOString();
      }
    },
    findFormByBlob: (ownerAddress, walrusBlobId) =>
      Array.from(forms.values()).find(
        (f) => f.ownerAddress === ownerAddress && f.walrusBlobId === walrusBlobId,
      ),
    findSubmissionByBlob: (formId, walrusBlobId) =>
      Array.from(submissions.values()).find(
        (s) => s.formId === formId && s.walrusBlobId === walrusBlobId,
      ),
  };
}

const ACTOR = '0xabc123';
const BLOB_ID = 'test-blob-id-abc';
const CIPHERTEXT = new Uint8Array([1, 2, 3, 4]);
const POLICY_ID = '0xpolicy123';

// ---------------------------------------------------------------------------
// orchestrateFormCreate
// ---------------------------------------------------------------------------

describe('orchestrateFormCreate', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
    vi.mocked(walrusPutWithCliFallback).mockResolvedValue({ blobId: BLOB_ID, sizeBytes: 42 });
    vi.mocked(walrusBlobExists).mockResolvedValue(true);
  });

  it('creates a public form and returns indexed result', async () => {
    const result = await orchestrateFormCreate(
      { formDefinition: { title: 'Test Form', fields: [] }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    expect(result.state).toBe('indexed');
    expect(result.privacyMode).toBe('public');
    expect(result.walrusBlobId).toBe(BLOB_ID);
    expect(result.policyId).toBeNull();
    expect(result.formId).toBeTruthy();
    expect(result.uploadJobId).toBeTruthy();
    expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('inserts a form record in the db for public form', async () => {
    const result = await orchestrateFormCreate(
      { formDefinition: { title: 'Test' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    const stored = db.forms.get(result.formId);
    expect(stored).toBeDefined();
    expect(stored!.state).toBe('indexed');
    expect(stored!.ownerAddress).toBe(ACTOR);
    expect(stored!.walrusBlobId).toBe(BLOB_ID);
  });

  it('transitions upload job to indexed for public form', async () => {
    const result = await orchestrateFormCreate(
      { formDefinition: { title: 'Test' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    const job = db.jobs.get(result.uploadJobId);
    expect(job).toBeDefined();
    expect(job!.state).toBe('indexed');
  });

  it('creates a private form: calls sealEncrypt and stores policyId', async () => {
    vi.mocked(sealEncrypt).mockResolvedValue({
      ciphertext: CIPHERTEXT,
      policyId: POLICY_ID,
      digest: 'aabbcc',
    });

    const result = await orchestrateFormCreate(
      {
        formDefinition: { title: 'Private Form' },
        privacyMode: 'private',
        policyId: POLICY_ID,
      },
      ACTOR,
      db,
    );

    expect(sealEncrypt).toHaveBeenCalledOnce();
    expect(result.state).toBe('indexed');
    expect(result.privacyMode).toBe('private');
    expect(result.policyId).toBe(POLICY_ID);
    expect(result.contentDigest).toBe('aabbcc');
  });

  it('transitions job through encrypting → uploading → uploaded → indexed for private form', async () => {
    vi.mocked(sealEncrypt).mockResolvedValue({
      ciphertext: CIPHERTEXT,
      policyId: POLICY_ID,
      digest: 'digest123',
    });

    const stateHistory: UploadState[] = [];
    const originalUpdate = db.updateUploadJobState.bind(db);
    db.updateUploadJobState = (jobId, state, reason) => {
      stateHistory.push(state);
      originalUpdate(jobId, state, reason);
    };

    await orchestrateFormCreate(
      { formDefinition: { title: 'P' }, privacyMode: 'private', policyId: POLICY_ID },
      ACTOR,
      db,
    );

    expect(stateHistory).toEqual(['encrypting', 'uploading', 'uploaded', 'indexed']);
  });

  it('transitions job through uploading → uploaded → indexed for public form', async () => {
    const stateHistory: UploadState[] = [];
    const originalUpdate = db.updateUploadJobState.bind(db);
    db.updateUploadJobState = (jobId, state, reason) => {
      stateHistory.push(state);
      originalUpdate(jobId, state, reason);
    };

    await orchestrateFormCreate(
      { formDefinition: { title: 'P' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    expect(stateHistory).toEqual(['uploading', 'uploaded', 'indexed']);
  });

  it('returns existing form on idempotent reconcile (same blob)', async () => {
    // First call
    const first = await orchestrateFormCreate(
      { formDefinition: { title: 'Idempotent' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    // Second call with same blob (walrusPut returns same blobId)
    const second = await orchestrateFormCreate(
      { formDefinition: { title: 'Idempotent' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    expect(second.formId).toBe(first.formId);
    expect(second.walrusBlobId).toBe(first.walrusBlobId);
    // Only one form row should exist
    expect(db.forms.size).toBe(1);
  });

  it('transitions job to failed and throws when walrusPut fails', async () => {
    vi.mocked(walrusPutWithCliFallback).mockRejectedValue(new Error('Network error'));

    await expect(
      orchestrateFormCreate(
        { formDefinition: { title: 'Fail' }, privacyMode: 'public' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow();

    // Find the job and check it's in failed state
    const jobs = Array.from(db.jobs.values());
    expect(jobs.length).toBe(1);
    expect(jobs[0].state).toBe('failed');
  });

  it('transitions job to failed when blob not found after PUT', async () => {
    vi.mocked(walrusBlobExists).mockResolvedValue(false);

    await expect(
      orchestrateFormCreate(
        { formDefinition: { title: 'Fail' }, privacyMode: 'public' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow(BlobNotFoundError);

    const jobs = Array.from(db.jobs.values());
    expect(jobs[0].state).toBe('failed');
  });

  it('transitions job to failed when sealEncrypt fails for private form', async () => {
    vi.mocked(sealEncrypt).mockRejectedValue(new Error('Seal error'));

    await expect(
      orchestrateFormCreate(
        { formDefinition: { title: 'Fail' }, privacyMode: 'private', policyId: POLICY_ID },
        ACTOR,
        db,
      ),
    ).rejects.toThrow();

    const jobs = Array.from(db.jobs.values());
    expect(jobs[0].state).toBe('failed');
  });

  it('canonicalizes JSON deterministically (sorted keys)', async () => {
    // Two calls with same content but different key order should produce same digest
    vi.mocked(walrusPutWithCliFallback).mockResolvedValueOnce({ blobId: 'blob-a', sizeBytes: 10 });
    vi.mocked(walrusPutWithCliFallback).mockResolvedValueOnce({ blobId: 'blob-b', sizeBytes: 10 });

    const result1 = await orchestrateFormCreate(
      { formDefinition: { b: 2, a: 1 }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    const result2 = await orchestrateFormCreate(
      { formDefinition: { a: 1, b: 2 }, privacyMode: 'public' },
      '0xother',
      db,
    );

    // Same content → same digest
    expect(result1.contentDigest).toBe(result2.contentDigest);
  });
});

// ---------------------------------------------------------------------------
// orchestrateSubmissionCreate
// ---------------------------------------------------------------------------

describe('orchestrateSubmissionCreate', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
    vi.mocked(walrusPutWithCliFallback).mockResolvedValue({ blobId: BLOB_ID, sizeBytes: 55 });
    vi.mocked(walrusBlobExists).mockResolvedValue(true);
  });

  function seedForm(privacyMode: 'public' | 'private' = 'public'): FormRecord {
    const form: FormRecord = {
      id: 'form-uuid-1',
      ownerAddress: ACTOR,
      walrusBlobId: 'form-blob',
      privacyMode,
      policyId: privacyMode === 'private' ? POLICY_ID : null,
      version: 1,
      predecessorId: null,
      state: 'indexed',
      contentDigest: 'abc',
      sizeBytes: 100,
      createdAt: new Date().toISOString(),
    };
    db.forms.set(form.id, form);
    return form;
  }

  it('creates a public submission and returns indexed result', async () => {
    const form = seedForm('public');

    const result = await orchestrateSubmissionCreate(
      { formId: form.id, formVersion: 1, payload: { answer: 'hello' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    expect(result.state).toBe('indexed');
    expect(result.privacyMode).toBe('public');
    expect(result.walrusBlobId).toBe(BLOB_ID);
    expect(result.policyId).toBeNull();
    expect(result.formId).toBe(form.id);
  });

  it('inserts a submission record in the db', async () => {
    const form = seedForm('public');

    const result = await orchestrateSubmissionCreate(
      { formId: form.id, formVersion: 1, payload: { q: 'a' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    const stored = db.submissions.get(result.submissionId);
    expect(stored).toBeDefined();
    expect(stored!.state).toBe('indexed');
    expect(stored!.formId).toBe(form.id);
    expect(stored!.submitterAddress).toBe(ACTOR);
  });

  it('creates a private submission: calls sealEncrypt with form owner address', async () => {
    const form = seedForm('private');
    vi.mocked(sealEncrypt).mockResolvedValue({
      ciphertext: CIPHERTEXT,
      policyId: POLICY_ID,
      digest: 'privdigest',
    });

    const result = await orchestrateSubmissionCreate(
      { formId: form.id, formVersion: 1, payload: { secret: 'data' }, privacyMode: 'private' },
      ACTOR,
      db,
    );

    expect(sealEncrypt).toHaveBeenCalledWith(expect.any(Uint8Array), form.ownerAddress);
    expect(result.policyId).toBe(POLICY_ID);
    expect(result.contentDigest).toBe('privdigest');
  });

  it('throws PrivacyModeMismatchError when declared mode differs from form mode', async () => {
    const form = seedForm('public');

    await expect(
      orchestrateSubmissionCreate(
        { formId: form.id, formVersion: 1, payload: {}, privacyMode: 'private' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow(PrivacyModeMismatchError);

    // Job should be in failed state
    const jobs = Array.from(db.jobs.values());
    expect(jobs[0].state).toBe('failed');
  });

  it('throws FormNotFoundError when form does not exist', async () => {
    await expect(
      orchestrateSubmissionCreate(
        { formId: 'nonexistent-form', formVersion: 1, payload: {}, privacyMode: 'public' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow(FormNotFoundError);

    const jobs = Array.from(db.jobs.values());
    expect(jobs[0].state).toBe('failed');
  });

  it('returns existing submission on idempotent reconcile (same blob)', async () => {
    const form = seedForm('public');

    const first = await orchestrateSubmissionCreate(
      { formId: form.id, formVersion: 1, payload: { q: 'a' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    const second = await orchestrateSubmissionCreate(
      { formId: form.id, formVersion: 1, payload: { q: 'a' }, privacyMode: 'public' },
      ACTOR,
      db,
    );

    expect(second.submissionId).toBe(first.submissionId);
    expect(db.submissions.size).toBe(1);
  });

  it('transitions job to failed when walrusPut fails', async () => {
    const form = seedForm('public');
    vi.mocked(walrusPutWithCliFallback).mockRejectedValue(new Error('PUT error'));

    await expect(
      orchestrateSubmissionCreate(
        { formId: form.id, formVersion: 1, payload: {}, privacyMode: 'public' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow();

    const jobs = Array.from(db.jobs.values());
    expect(jobs[0].state).toBe('failed');
  });

  it('throws BlobNotFoundError when blob not found after PUT', async () => {
    const form = seedForm('public');
    vi.mocked(walrusBlobExists).mockResolvedValue(false);

    await expect(
      orchestrateSubmissionCreate(
        { formId: form.id, formVersion: 1, payload: {}, privacyMode: 'public' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow(BlobNotFoundError);
  });

  it('state machine: public submission goes uploading → uploaded → indexed', async () => {
    const form = seedForm('public');
    const stateHistory: UploadState[] = [];
    const originalUpdate = db.updateUploadJobState.bind(db);
    db.updateUploadJobState = (jobId, state, reason) => {
      stateHistory.push(state);
      originalUpdate(jobId, state, reason);
    };

    await orchestrateSubmissionCreate(
      { formId: form.id, formVersion: 1, payload: {}, privacyMode: 'public' },
      ACTOR,
      db,
    );

    expect(stateHistory).toEqual(['uploading', 'uploaded', 'indexed']);
  });

  it('state machine: private submission goes encrypting → uploading → uploaded → indexed', async () => {
    const form = seedForm('private');
    vi.mocked(sealEncrypt).mockResolvedValue({
      ciphertext: CIPHERTEXT,
      policyId: POLICY_ID,
      digest: 'd',
    });

    const stateHistory: UploadState[] = [];
    const originalUpdate = db.updateUploadJobState.bind(db);
    db.updateUploadJobState = (jobId, state, reason) => {
      stateHistory.push(state);
      originalUpdate(jobId, state, reason);
    };

    await orchestrateSubmissionCreate(
      { formId: form.id, formVersion: 1, payload: {}, privacyMode: 'private' },
      ACTOR,
      db,
    );

    expect(stateHistory).toEqual(['encrypting', 'uploading', 'uploaded', 'indexed']);
  });
});

// ---------------------------------------------------------------------------
// orchestrateFileCreate
// ---------------------------------------------------------------------------

describe('orchestrateFileCreate', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
    vi.mocked(walrusPutWithCliFallback).mockResolvedValue({ blobId: BLOB_ID, sizeBytes: 200 });
    vi.mocked(walrusBlobExists).mockResolvedValue(true);
  });

  function seedSubmission(): SubmissionRecord {
    const sub: SubmissionRecord = {
      id: 'sub-uuid-1',
      formId: 'form-uuid-1',
      formVersion: 1,
      submitterAddress: ACTOR,
      walrusBlobId: 'sub-blob',
      privacyMode: 'public',
      contentDigest: 'abc',
      sizeBytes: 50,
      state: 'indexed',
      policyId: null,
      createdAt: new Date().toISOString(),
    };
    db.submissions.set(sub.id, sub);
    return sub;
  }

  it('creates a file and returns indexed result', async () => {
    const sub = seedSubmission();
    const fileBytes = new Uint8Array([10, 20, 30]);

    const result = await orchestrateFileCreate(
      { submissionId: sub.id, fileBytes, contentType: 'image/png' },
      ACTOR,
      db,
    );

    expect(result.state).toBe('indexed');
    expect(result.submissionId).toBe(sub.id);
    expect(result.walrusBlobId).toBe(BLOB_ID);
    expect(result.contentType).toBe('image/png');
    expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('inserts a file record in the db', async () => {
    const sub = seedSubmission();

    const result = await orchestrateFileCreate(
      { submissionId: sub.id, fileBytes: new Uint8Array([1, 2]), contentType: 'text/plain' },
      ACTOR,
      db,
    );

    const stored = db.files.get(result.fileId);
    expect(stored).toBeDefined();
    expect(stored!.state).toBe('indexed');
    expect(stored!.submissionId).toBe(sub.id);
  });

  it('throws SubmissionNotFoundError when submission does not exist', async () => {
    await expect(
      orchestrateFileCreate(
        { submissionId: 'nonexistent', fileBytes: new Uint8Array([1]), contentType: 'text/plain' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow(SubmissionNotFoundError);

    const jobs = Array.from(db.jobs.values());
    expect(jobs[0].state).toBe('failed');
  });

  it('transitions job to failed when walrusPut fails', async () => {
    const sub = seedSubmission();
    vi.mocked(walrusPutWithCliFallback).mockRejectedValue(new Error('PUT error'));

    await expect(
      orchestrateFileCreate(
        { submissionId: sub.id, fileBytes: new Uint8Array([1]), contentType: 'text/plain' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow();

    const jobs = Array.from(db.jobs.values());
    expect(jobs[0].state).toBe('failed');
  });

  it('throws BlobNotFoundError when blob not found after PUT', async () => {
    const sub = seedSubmission();
    vi.mocked(walrusBlobExists).mockResolvedValue(false);

    await expect(
      orchestrateFileCreate(
        { submissionId: sub.id, fileBytes: new Uint8Array([1]), contentType: 'text/plain' },
        ACTOR,
        db,
      ),
    ).rejects.toThrow(BlobNotFoundError);
  });

  it('state machine: file goes uploading → uploaded → indexed', async () => {
    const sub = seedSubmission();
    const stateHistory: UploadState[] = [];
    const originalUpdate = db.updateUploadJobState.bind(db);
    db.updateUploadJobState = (jobId, state, reason) => {
      stateHistory.push(state);
      originalUpdate(jobId, state, reason);
    };

    await orchestrateFileCreate(
      { submissionId: sub.id, fileBytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' },
      ACTOR,
      db,
    );

    expect(stateHistory).toEqual(['uploading', 'uploaded', 'indexed']);
  });

  it('computes correct SHA-256 digest for file bytes', async () => {
    const sub = seedSubmission();
    const fileBytes = new TextEncoder().encode('hello world');

    const result = await orchestrateFileCreate(
      { submissionId: sub.id, fileBytes, contentType: 'text/plain' },
      ACTOR,
      db,
    );

    // SHA-256 of "hello world"
    expect(result.contentDigest).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });
});
