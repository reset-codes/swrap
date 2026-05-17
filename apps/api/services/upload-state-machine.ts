/**
 * apps/api/services/upload-state-machine.ts
 *
 * Server-side Upload_Job state machine.
 *
 * Defines the typed state graph for upload jobs and exposes atomic DB
 * transition helpers. The state machine enforces that only declared edges
 * are traversable; any other transition throws `InvalidTransitionError`.
 *
 * State graph:
 *   pending → encrypting (private artifacts)
 *   pending → uploading  (public artifacts)
 *   encrypting → uploading
 *   encrypting → failed
 *   uploading → uploaded
 *   uploading → failed
 *   uploaded → indexed
 *   uploaded → failed
 *   failed → pending    (retry)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 6.11
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadState =
  | 'pending'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'indexed'
  | 'failed';

export type ArtifactKind = 'form' | 'submission' | 'file';
export type PrivacyMode = 'public' | 'private';

export interface UploadJobRow {
  id: string;
  ownerAddress: string;
  artifactKind: ArtifactKind;
  privacyMode: PrivacyMode;
  state: UploadState;
  blobId?: string;
  digest?: string;
  sizeBytes?: number;
  policyId?: string;
  failureReason?: string;
  isOrphan: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Minimal DB interface
// ---------------------------------------------------------------------------

export interface UploadJobDb {
  createUploadJob(row: Omit<UploadJobRow, 'createdAt' | 'updatedAt'>): Promise<UploadJobRow>;
  getUploadJob(jobId: string): Promise<UploadJobRow | undefined>;
  updateUploadJobState(
    jobId: string,
    from: UploadState,
    to: UploadState,
    updates?: Partial<Pick<UploadJobRow, 'blobId' | 'digest' | 'sizeBytes' | 'policyId' | 'failureReason' | 'isOrphan'>>,
  ): Promise<UploadJobRow>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION' as const;
  readonly jobId: string;
  readonly from: UploadState;
  readonly to: UploadState;

  constructor(jobId: string, from: UploadState, to: UploadState) {
    super(`Invalid transition for job '${jobId}': ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.jobId = jobId;
    this.from = from;
    this.to = to;
  }
}

export class UploadJobNotFoundError extends Error {
  readonly code = 'UPLOAD_JOB_NOT_FOUND' as const;
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Upload job '${jobId}' not found.`);
    this.name = 'UploadJobNotFoundError';
    this.jobId = jobId;
  }
}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/**
 * Declared edges in the Upload_State_Machine.
 * Only transitions listed here are valid.
 */
const VALID_TRANSITIONS: ReadonlySet<string> = new Set([
  'pending→encrypting',
  'pending→uploading',
  'pending→failed',
  'encrypting→uploading',
  'encrypting→failed',
  'uploading→uploaded',
  'uploading→failed',
  'uploaded→indexed',
  'uploaded→failed',
  'failed→pending',
]);

function isValidTransition(from: UploadState, to: UploadState): boolean {
  return VALID_TRANSITIONS.has(`${from}→${to}`);
}

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

/** Default orphan timeout: 5 minutes */
export const ORPHAN_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _counter = 0;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  _counter += 1;
  return `job-${Date.now()}-${_counter}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new upload job in `pending` state.
 *
 * Requirements: 6.2 — initial state is always `pending`.
 */
export async function createJob(
  ownerAddress: string,
  artifactKind: ArtifactKind,
  privacyMode: PrivacyMode,
  db: UploadJobDb,
): Promise<UploadJobRow> {
  return db.createUploadJob({
    id: generateId(),
    ownerAddress,
    artifactKind,
    privacyMode,
    state: 'pending',
    isOrphan: false,
  });
}

/**
 * Atomically transitions an upload job from `from` to `to`.
 *
 * Throws `InvalidTransitionError` if the transition is not a declared edge.
 * Throws `UploadJobNotFoundError` if the job does not exist.
 *
 * Requirements: 6.3–6.7
 */
export async function transitionState(
  jobId: string,
  from: UploadState,
  to: UploadState,
  db: UploadJobDb,
  updates?: Partial<Pick<UploadJobRow, 'blobId' | 'digest' | 'sizeBytes' | 'policyId' | 'failureReason'>>,
): Promise<UploadJobRow> {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(jobId, from, to);
  }

  const job = await db.getUploadJob(jobId);
  if (!job) {
    throw new UploadJobNotFoundError(jobId);
  }

  if (job.state !== from) {
    throw new InvalidTransitionError(jobId, job.state, to);
  }

  return db.updateUploadJobState(jobId, from, to, updates);
}

/**
 * Returns the earliest non-completed step from which to retry a job.
 *
 * - If the job has a blobId (blob exists on Walrus) but is not indexed,
 *   retry from `uploaded` (only the metadata write is needed).
 * - Otherwise restart from `pending`.
 *
 * Requirements: 6.8, 6.11
 */
export function getRetryPoint(job: UploadJobRow): UploadState {
  if (job.blobId) {
    return 'uploaded';
  }
  return 'pending';
}

/**
 * Marks a job as an orphan candidate.
 *
 * Sets `isOrphan = true` for jobs in `uploaded` state that have been there
 * longer than `ORPHAN_TIMEOUT_MS`.
 *
 * Requirements: 6.10
 */
export async function flagOrphan(
  jobId: string,
  db: UploadJobDb,
): Promise<UploadJobRow> {
  const job = await db.getUploadJob(jobId);
  if (!job) {
    throw new UploadJobNotFoundError(jobId);
  }

  if (job.state !== 'uploaded') {
    return job; // Only flag jobs stuck in uploaded
  }

  const updatedAt = new Date(job.updatedAt).getTime();
  if (Date.now() - updatedAt <= ORPHAN_TIMEOUT_MS) {
    return job; // Not yet orphaned
  }

  return db.updateUploadJobState(jobId, 'uploaded', 'uploaded', { isOrphan: true } as Parameters<typeof db.updateUploadJobState>[3]);
}

/**
 * Checks whether a job is an orphan based on its current state and age.
 *
 * Requirements: 6.10
 */
export function isOrphan(job: UploadJobRow): boolean {
  if (job.state !== 'uploaded') return false;
  const updatedAt = new Date(job.updatedAt).getTime();
  return Date.now() - updatedAt > ORPHAN_TIMEOUT_MS;
}
