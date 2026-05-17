/**
 * Unit tests for upload-state-machine.ts
 *
 * Validates the Upload_Job lifecycle, transition enforcement, and privacy mode constraints.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */
import { describe, it, expect } from 'vitest';
import {
  createJob,
  transition,
  InvalidTransitionError,
  type UploadState,
  type UploadEvent,
} from './upload-state-machine';

describe('upload-state-machine', () => {
  describe('createJob', () => {
    it('creates a job in pending state', () => {
      const job = createJob('submission', 'form-123', 'public');
      expect(job.state).toBe('pending');
      expect(job.artifactKind).toBe('submission');
      expect(job.formId).toBe('form-123');
      expect(job.privacyMode).toBe('public');
      expect(job.id).toBeDefined();
      expect(job.createdAt).toBeGreaterThan(0);
      expect(job.updatedAt).toBe(job.createdAt);
    });

    it('creates unique IDs for each job', () => {
      const job1 = createJob('form', 'f1', 'public');
      const job2 = createJob('form', 'f2', 'private');
      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe('transition — public form happy path', () => {
    it('pending → uploading → uploaded → indexed', () => {
      let job = createJob('submission', 'form-1', 'public');
      expect(job.state).toBe('pending');

      job = transition(job, 'START_UPLOAD');
      expect(job.state).toBe('uploading');

      job = transition(job, 'UPLOAD_SUCCESS');
      expect(job.state).toBe('uploaded');

      job = transition(job, 'INDEX_SUCCESS');
      expect(job.state).toBe('indexed');
    });
  });

  describe('transition — private form happy path', () => {
    it('pending → encrypting → uploading → uploaded → indexed', () => {
      let job = createJob('submission', 'form-1', 'private');
      expect(job.state).toBe('pending');

      job = transition(job, 'START_ENCRYPT');
      expect(job.state).toBe('encrypting');

      job = transition(job, 'START_UPLOAD');
      expect(job.state).toBe('uploading');

      job = transition(job, 'UPLOAD_SUCCESS');
      expect(job.state).toBe('uploaded');

      job = transition(job, 'INDEX_SUCCESS');
      expect(job.state).toBe('indexed');
    });
  });

  describe('transition — failure and retry', () => {
    it('can fail from any active state', () => {
      const failableStates: Array<{ state: UploadState; setup: (job: ReturnType<typeof createJob>) => ReturnType<typeof createJob> }> = [
        { state: 'pending', setup: (j) => j },
        { state: 'encrypting', setup: (j) => transition(j, 'START_ENCRYPT') },
        { state: 'uploading', setup: (j) => transition(transition(j, 'START_ENCRYPT'), 'START_UPLOAD') },
        { state: 'uploaded', setup: (j) => transition(transition(transition(j, 'START_ENCRYPT'), 'START_UPLOAD'), 'UPLOAD_SUCCESS') },
      ];

      for (const { state, setup } of failableStates) {
        const job = setup(createJob('submission', 'form-1', 'private'));
        expect(job.state).toBe(state);
        const failed = transition(job, 'FAIL');
        expect(failed.state).toBe('failed');
      }
    });

    it('can retry from failed back to pending', () => {
      let job = createJob('submission', 'form-1', 'private');
      job = transition(job, 'FAIL');
      expect(job.state).toBe('failed');

      job = transition(job, 'RETRY');
      expect(job.state).toBe('pending');
    });
  });

  describe('transition — privacy mode enforcement', () => {
    it('private form MUST NOT go directly from pending to uploading', () => {
      const job = createJob('submission', 'form-1', 'private');
      expect(() => transition(job, 'START_UPLOAD')).toThrow(InvalidTransitionError);
    });

    it('public form MUST NOT go through encrypting', () => {
      const job = createJob('submission', 'form-1', 'public');
      expect(() => transition(job, 'START_ENCRYPT')).toThrow(InvalidTransitionError);
    });
  });

  describe('transition — invalid transitions throw InvalidTransitionError', () => {
    it('cannot transition from indexed (terminal state)', () => {
      let job = createJob('submission', 'form-1', 'public');
      job = transition(job, 'START_UPLOAD');
      job = transition(job, 'UPLOAD_SUCCESS');
      job = transition(job, 'INDEX_SUCCESS');
      expect(job.state).toBe('indexed');

      const events: UploadEvent[] = ['START_ENCRYPT', 'START_UPLOAD', 'UPLOAD_SUCCESS', 'INDEX_SUCCESS', 'FAIL', 'RETRY'];
      for (const event of events) {
        expect(() => transition(job, event)).toThrow(InvalidTransitionError);
      }
    });

    it('cannot apply UPLOAD_SUCCESS from pending', () => {
      const job = createJob('submission', 'form-1', 'public');
      expect(() => transition(job, 'UPLOAD_SUCCESS')).toThrow(InvalidTransitionError);
    });

    it('cannot apply INDEX_SUCCESS from uploading', () => {
      let job = createJob('submission', 'form-1', 'public');
      job = transition(job, 'START_UPLOAD');
      expect(() => transition(job, 'INDEX_SUCCESS')).toThrow(InvalidTransitionError);
    });

    it('cannot apply RETRY from non-failed state', () => {
      const job = createJob('submission', 'form-1', 'public');
      expect(() => transition(job, 'RETRY')).toThrow(InvalidTransitionError);
    });
  });

  describe('InvalidTransitionError', () => {
    it('contains useful diagnostic information', () => {
      const job = createJob('submission', 'form-1', 'public');
      try {
        transition(job, 'UPLOAD_SUCCESS');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidTransitionError);
        const err = e as InvalidTransitionError;
        expect(err.fromState).toBe('pending');
        expect(err.event).toBe('UPLOAD_SUCCESS');
        expect(err.jobId).toBe(job.id);
        expect(err.message).toContain('pending');
        expect(err.message).toContain('UPLOAD_SUCCESS');
      }
    });
  });

  describe('immutability', () => {
    it('transition returns a new object without mutating the original', () => {
      const job = createJob('submission', 'form-1', 'public');
      const next = transition(job, 'START_UPLOAD');
      expect(job.state).toBe('pending');
      expect(next.state).toBe('uploading');
      expect(job).not.toBe(next);
    });
  });
});
