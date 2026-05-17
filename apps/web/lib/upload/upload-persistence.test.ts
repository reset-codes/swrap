/**
 * Unit tests for upload-persistence.ts — IndexedDB persistence for Upload_Jobs
 *
 * Uses fake-indexeddb to simulate IndexedDB in a Node.js test environment.
 *
 * Requirements: 6.14
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  persistJob,
  resume,
  getJob,
  getCiphertextHandle,
  deleteJob,
  clearAll,
  resetDbConnection,
} from './upload-persistence';
import { createJob, transition } from './upload-state-machine';
import type { UploadJob } from './upload-state-machine';

describe('upload-persistence', () => {
  beforeEach(async () => {
    // Reset the DB connection and clear all data between tests
    resetDbConnection();
    // We need to clear after resetting connection so it opens a fresh DB
    await clearAll();
  });

  describe('persistJob and getJob', () => {
    it('persists a job and retrieves it by ID', async () => {
      const job = createJob('submission', 'form-123', 'public');
      await persistJob(job);

      const retrieved = await getJob(job.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(job.id);
      expect(retrieved!.artifactKind).toBe('submission');
      expect(retrieved!.formId).toBe('form-123');
      expect(retrieved!.privacyMode).toBe('public');
      expect(retrieved!.state).toBe('pending');
      expect(retrieved!.createdAt).toBe(job.createdAt);
      expect(retrieved!.updatedAt).toBe(job.updatedAt);
    });

    it('updates a job on re-persist (state transition)', async () => {
      let job = createJob('submission', 'form-123', 'public');
      await persistJob(job);

      job = transition(job, 'START_UPLOAD');
      await persistJob(job);

      const retrieved = await getJob(job.id);
      expect(retrieved!.state).toBe('uploading');
      expect(retrieved!.updatedAt).toBeGreaterThanOrEqual(job.createdAt);
    });

    it('returns undefined for non-existent job', async () => {
      const retrieved = await getJob('non-existent-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('resume', () => {
    it('loads all persisted jobs', async () => {
      const job1 = createJob('form', 'form-1', 'public');
      const job2 = createJob('submission', 'form-2', 'private');
      const job3 = createJob('file', 'form-3', 'public');

      await persistJob(job1);
      await persistJob(job2);
      await persistJob(job3);

      const jobs = await resume();
      expect(jobs).toHaveLength(3);

      const ids = jobs.map((j) => j.id);
      expect(ids).toContain(job1.id);
      expect(ids).toContain(job2.id);
      expect(ids).toContain(job3.id);
    });

    it('returns empty array when no jobs exist', async () => {
      const jobs = await resume();
      expect(jobs).toHaveLength(0);
    });

    it('reflects the latest state after transitions', async () => {
      let job = createJob('submission', 'form-1', 'private');
      await persistJob(job);

      job = transition(job, 'START_ENCRYPT');
      await persistJob(job);

      job = transition(job, 'START_UPLOAD');
      await persistJob(job);

      job = transition(job, 'UPLOAD_SUCCESS');
      await persistJob(job);

      const jobs = await resume();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].state).toBe('uploaded');
    });
  });

  describe('ciphertext handle persistence', () => {
    it('persists ciphertext handle in encrypting state', async () => {
      let job = createJob('submission', 'form-1', 'private');
      job = transition(job, 'START_ENCRYPT');
      await persistJob(job, 'ct-handle-abc');

      const handle = await getCiphertextHandle(job.id);
      expect(handle).toBe('ct-handle-abc');
    });

    it('persists ciphertext handle in uploading state', async () => {
      let job = createJob('submission', 'form-1', 'private');
      job = transition(job, 'START_ENCRYPT');
      job = transition(job, 'START_UPLOAD');
      await persistJob(job, 'ct-handle-xyz');

      const handle = await getCiphertextHandle(job.id);
      expect(handle).toBe('ct-handle-xyz');
    });

    it('drops ciphertext handle at uploaded state', async () => {
      let job = createJob('submission', 'form-1', 'private');
      job = transition(job, 'START_ENCRYPT');
      await persistJob(job, 'ct-handle-abc');

      job = transition(job, 'START_UPLOAD');
      await persistJob(job, 'ct-handle-abc');

      // Transition to uploaded — ciphertext handle should be dropped
      job = transition(job, 'UPLOAD_SUCCESS');
      await persistJob(job, 'ct-handle-abc'); // Even if passed, should not be stored

      const handle = await getCiphertextHandle(job.id);
      expect(handle).toBeUndefined();
    });

    it('does not persist ciphertext handle in pending state', async () => {
      const job = createJob('submission', 'form-1', 'private');
      await persistJob(job, 'ct-handle-should-not-persist');

      const handle = await getCiphertextHandle(job.id);
      expect(handle).toBeUndefined();
    });

    it('does not persist ciphertext handle in indexed state', async () => {
      let job = createJob('submission', 'form-1', 'public');
      job = transition(job, 'START_UPLOAD');
      job = transition(job, 'UPLOAD_SUCCESS');
      job = transition(job, 'INDEX_SUCCESS');
      await persistJob(job, 'ct-handle-should-not-persist');

      const handle = await getCiphertextHandle(job.id);
      expect(handle).toBeUndefined();
    });
  });

  describe('plaintext is never persisted', () => {
    it('UploadJobRecord does not contain any payload field', async () => {
      const job = createJob('submission', 'form-1', 'private');
      await persistJob(job);

      const retrieved = await getJob(job.id);
      // Verify the record has no payload/plaintext/body fields
      const keys = Object.keys(retrieved!);
      expect(keys).not.toContain('payload');
      expect(keys).not.toContain('plaintext');
      expect(keys).not.toContain('body');
      expect(keys).not.toContain('content');
    });
  });

  describe('deleteJob', () => {
    it('removes a job from IndexedDB', async () => {
      const job = createJob('submission', 'form-1', 'public');
      await persistJob(job);

      await deleteJob(job.id);
      const retrieved = await getJob(job.id);
      expect(retrieved).toBeUndefined();
    });

    it('does not throw when deleting non-existent job', async () => {
      await expect(deleteJob('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('clearAll', () => {
    it('removes all jobs from IndexedDB', async () => {
      await persistJob(createJob('form', 'f1', 'public'));
      await persistJob(createJob('submission', 'f2', 'private'));

      await clearAll();
      const jobs = await resume();
      expect(jobs).toHaveLength(0);
    });
  });

  describe('full lifecycle persistence', () => {
    it('persists every state transition for a public form upload', async () => {
      let job = createJob('submission', 'form-pub', 'public');
      await persistJob(job);

      job = transition(job, 'START_UPLOAD');
      await persistJob(job);

      job = transition(job, 'UPLOAD_SUCCESS');
      await persistJob(job);

      job = transition(job, 'INDEX_SUCCESS');
      await persistJob(job);

      const jobs = await resume();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].state).toBe('indexed');
      expect(jobs[0].formId).toBe('form-pub');
    });

    it('persists every state transition for a private form upload', async () => {
      let job = createJob('submission', 'form-priv', 'private');
      await persistJob(job);

      job = transition(job, 'START_ENCRYPT');
      await persistJob(job, 'ct-handle-1');

      job = transition(job, 'START_UPLOAD');
      await persistJob(job, 'ct-handle-1');

      job = transition(job, 'UPLOAD_SUCCESS');
      await persistJob(job); // ciphertext handle dropped

      job = transition(job, 'INDEX_SUCCESS');
      await persistJob(job);

      const jobs = await resume();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].state).toBe('indexed');
      expect(jobs[0].formId).toBe('form-priv');

      // Ciphertext handle should be gone
      const handle = await getCiphertextHandle(jobs[0].id);
      expect(handle).toBeUndefined();
    });

    it('persists failure and retry correctly', async () => {
      let job = createJob('submission', 'form-fail', 'public');
      await persistJob(job);

      job = transition(job, 'START_UPLOAD');
      await persistJob(job);

      job = transition(job, 'FAIL');
      await persistJob(job);

      let jobs = await resume();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].state).toBe('failed');

      job = transition(job, 'RETRY');
      await persistJob(job);

      jobs = await resume();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].state).toBe('pending');
    });
  });

  describe('metadata fields persistence', () => {
    it('persists blobId, digest, sizeBytes, policyId, failureReason', async () => {
      const job = createJob('submission', 'form-meta', 'private');
      // Simulate a job with metadata fields set via spread
      const jobWithMeta: UploadJob = {
        ...job,
        blobId: 'walrus-blob-123',
        digest: 'sha256-abc',
        sizeBytes: 4096,
        policyId: 'seal-policy-xyz',
        failureReason: undefined,
      };
      await persistJob(jobWithMeta);

      const retrieved = await getJob(job.id);
      expect(retrieved!.blobId).toBe('walrus-blob-123');
      expect(retrieved!.digest).toBe('sha256-abc');
      expect(retrieved!.sizeBytes).toBe(4096);
      expect(retrieved!.policyId).toBe('seal-policy-xyz');
      expect(retrieved!.failureReason).toBeUndefined();
    });

    it('persists failureReason when job fails', async () => {
      let job = createJob('submission', 'form-err', 'public');
      job = transition(job, 'FAIL');
      // Simulate setting failure reason
      const failedJob: UploadJob = {
        ...job,
        failureReason: 'Network timeout',
      };
      await persistJob(failedJob);

      const retrieved = await getJob(job.id);
      expect(retrieved!.failureReason).toBe('Network timeout');
      expect(retrieved!.state).toBe('failed');
    });
  });
});
