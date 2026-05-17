/**
 * upload-persistence.ts — IndexedDB persistence for Upload_Jobs
 *
 * Persists every UploadJob to IndexedDB at every state transition.
 * Implements resume() to reload all jobs on page reload.
 *
 * Security invariants:
 * - Plaintext payload is NEVER persisted
 * - Ciphertext handle is persisted only between `encrypting` and `uploading`; dropped at `uploaded`
 *
 * Requirements: 6.14
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { UploadJob } from './upload-state-machine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The persisted record schema for IndexedDB.
 * Matches the task specification exactly.
 */
export interface UploadJobRecord {
  id: string;
  artifactKind: 'form' | 'submission' | 'file';
  formId: string;
  privacyMode: 'public' | 'private';
  state: string;
  blobId?: string;
  digest?: string;
  sizeBytes?: number;
  policyId?: string;
  failureReason?: string;
  ciphertextHandle?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'swrap-upload-jobs';
const DB_VERSION = 1;
const STORE_NAME = 'jobs';

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Returns a singleton promise for the IndexedDB database connection.
 * Creates the object store on first open.
 */
function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('state', 'state', { unique: false });
          store.createIndex('formId', 'formId', { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Converts an UploadJob to an UploadJobRecord for persistence.
 *
 * Security: plaintext payload is never included.
 * Ciphertext handle is only included between `encrypting` and `uploading`.
 */
function jobToRecord(job: UploadJob, ciphertextHandle?: string): UploadJobRecord {
  const record: UploadJobRecord = {
    id: job.id,
    artifactKind: job.artifactKind,
    formId: job.formId,
    privacyMode: job.privacyMode,
    state: job.state,
    blobId: job.blobId,
    digest: job.digest,
    sizeBytes: job.sizeBytes,
    policyId: job.policyId,
    failureReason: job.failureReason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };

  // Ciphertext handle is only persisted between encrypting and uploading
  if (
    ciphertextHandle &&
    (job.state === 'encrypting' || job.state === 'uploading')
  ) {
    record.ciphertextHandle = ciphertextHandle;
  }

  return record;
}

/**
 * Converts an UploadJobRecord back to an UploadJob.
 */
function recordToJob(record: UploadJobRecord): UploadJob {
  return {
    id: record.id,
    artifactKind: record.artifactKind as UploadJob['artifactKind'],
    formId: record.formId,
    privacyMode: record.privacyMode as UploadJob['privacyMode'],
    state: record.state as UploadJob['state'],
    blobId: record.blobId,
    digest: record.digest,
    sizeBytes: record.sizeBytes,
    policyId: record.policyId,
    failureReason: record.failureReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persists an UploadJob to IndexedDB. Called at every state transition.
 *
 * @param job - The UploadJob to persist
 * @param ciphertextHandle - Optional opaque reference to ciphertext blob;
 *   only persisted between `encrypting` and `uploading` states, dropped at `uploaded`
 */
export async function persistJob(job: UploadJob, ciphertextHandle?: string): Promise<void> {
  const db = await getDb();
  const record = jobToRecord(job, ciphertextHandle);
  await db.put(STORE_NAME, record);
}

/**
 * Loads all persisted UploadJobs from IndexedDB.
 * Used on page reload to resume the state machine.
 *
 * Requirements: 6.14
 */
export async function resume(): Promise<UploadJob[]> {
  const db = await getDb();
  const records: UploadJobRecord[] = await db.getAll(STORE_NAME);
  return records.map(recordToJob);
}

/**
 * Retrieves a single UploadJob by ID from IndexedDB.
 * Returns undefined if not found.
 */
export async function getJob(id: string): Promise<UploadJob | undefined> {
  const db = await getDb();
  const record: UploadJobRecord | undefined = await db.get(STORE_NAME, id);
  if (!record) return undefined;
  return recordToJob(record);
}

/**
 * Retrieves the ciphertext handle for a job, if persisted.
 * Only available for jobs in `encrypting` or `uploading` state.
 */
export async function getCiphertextHandle(id: string): Promise<string | undefined> {
  const db = await getDb();
  const record: UploadJobRecord | undefined = await db.get(STORE_NAME, id);
  return record?.ciphertextHandle;
}

/**
 * Removes a job from IndexedDB.
 */
export async function deleteJob(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

/**
 * Clears all jobs from IndexedDB.
 * Primarily useful for testing.
 */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}

/**
 * Resets the database connection. Used in tests to ensure a fresh state.
 */
export function resetDbConnection(): void {
  dbPromise = null;
}
