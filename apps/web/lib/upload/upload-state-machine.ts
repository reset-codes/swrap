/**
 * upload-state-machine.ts — Client-side Upload_Job lifecycle state machine
 *
 * Defines the Upload_State_Machine with states, transitions, and enforcement
 * of declared edges. Private form uploads MUST pass through `encrypting`
 * before reaching `uploading`.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Upload_State_Machine states as defined in the design.
 * Requirements: 6.1
 */
export type UploadState =
  | 'pending'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'indexed'
  | 'failed';

/**
 * The kind of artifact being uploaded.
 */
export type ArtifactKind = 'form' | 'submission' | 'file';

/**
 * Privacy mode for the form/submission.
 */
export type PrivacyMode = 'public' | 'private';

/**
 * Events that drive state transitions in the Upload_State_Machine.
 *
 * Each event corresponds to a specific transition edge:
 * - START_ENCRYPT: pending → encrypting (private forms only)
 * - START_UPLOAD: pending → uploading (public forms) OR encrypting → uploading
 * - UPLOAD_SUCCESS: uploading → uploaded
 * - INDEX_SUCCESS: uploaded → indexed
 * - FAIL: pending|encrypting|uploading|uploaded → failed
 * - RETRY: failed → pending
 */
export type UploadEvent =
  | 'START_ENCRYPT'
  | 'START_UPLOAD'
  | 'UPLOAD_SUCCESS'
  | 'INDEX_SUCCESS'
  | 'FAIL'
  | 'RETRY';

/**
 * Represents a single upload job with its current state and metadata.
 */
export interface UploadJob {
  readonly id: string;
  readonly artifactKind: ArtifactKind;
  readonly formId: string;
  readonly privacyMode: PrivacyMode;
  readonly state: UploadState;
  readonly blobId?: string;
  readonly digest?: string;
  readonly sizeBytes?: number;
  readonly policyId?: string;
  readonly failureReason?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a transition is attempted that is not a declared edge
 * in the Upload_State_Machine.
 */
export class InvalidTransitionError extends Error {
  public readonly fromState: UploadState;
  public readonly event: UploadEvent;
  public readonly jobId: string;

  constructor(jobId: string, fromState: UploadState, event: UploadEvent) {
    super(
      `Invalid transition: cannot apply event '${event}' in state '${fromState}' for job '${jobId}'`,
    );
    this.name = 'InvalidTransitionError';
    this.fromState = fromState;
    this.event = event;
    this.jobId = jobId;
  }
}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/**
 * Declared transition edges in the Upload_State_Machine.
 *
 * Map of (currentState, event) → nextState.
 * Only transitions listed here are valid; all others throw InvalidTransitionError.
 *
 * Transitions:
 * - pending → encrypting (START_ENCRYPT, private forms only)
 * - pending → uploading (START_UPLOAD, public forms only)
 * - pending → failed (FAIL)
 * - encrypting → uploading (START_UPLOAD)
 * - encrypting → failed (FAIL)
 * - uploading → uploaded (UPLOAD_SUCCESS)
 * - uploading → failed (FAIL)
 * - uploaded → indexed (INDEX_SUCCESS)
 * - uploaded → failed (FAIL)
 * - failed → pending (RETRY)
 */
const TRANSITION_TABLE: Record<UploadState, Partial<Record<UploadEvent, UploadState>>> = {
  pending: {
    START_ENCRYPT: 'encrypting',
    START_UPLOAD: 'uploading',
    FAIL: 'failed',
  },
  encrypting: {
    START_UPLOAD: 'uploading',
    FAIL: 'failed',
  },
  uploading: {
    UPLOAD_SUCCESS: 'uploaded',
    FAIL: 'failed',
  },
  uploaded: {
    INDEX_SUCCESS: 'indexed',
    FAIL: 'failed',
  },
  indexed: {},
  failed: {
    RETRY: 'pending',
  },
};

// ---------------------------------------------------------------------------
// Orphan detection constants
// ---------------------------------------------------------------------------

/**
 * Time in milliseconds after which an Upload_Job in `uploaded` state
 * is considered an orphan (blob exists on Walrus but metadata write never completed).
 *
 * Default: 5 minutes (300,000ms).
 *
 * Requirements: 6.13
 */
export const ORPHAN_TIMEOUT_MS = 5 * 60 * 1000; // 300000ms

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let idCounter = 0;

/**
 * Generates a unique job ID. Uses crypto.randomUUID when available,
 * falls back to a timestamp-based ID.
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  idCounter += 1;
  return `job-${Date.now()}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new Upload_Job in the `pending` state.
 *
 * Requirements: 6.2 — initial state is always `pending`.
 *
 * @param artifactKind - The kind of artifact being uploaded (form, submission, file)
 * @param formId - The form ID this upload is associated with
 * @param privacyMode - Whether the form is public or private
 * @returns A new UploadJob in the `pending` state
 */
export function createJob(
  artifactKind: ArtifactKind,
  formId: string,
  privacyMode: PrivacyMode,
): UploadJob {
  const now = Date.now();
  return {
    id: generateId(),
    artifactKind,
    formId,
    privacyMode,
    state: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies a state transition event to an Upload_Job.
 *
 * Enforces only declared edges in the transition table. Throws
 * `InvalidTransitionError` for any undeclared transition.
 *
 * Additional enforcement:
 * - Private form uploads MUST pass through `encrypting` before `uploading`.
 *   Attempting START_UPLOAD from `pending` on a private form throws InvalidTransitionError.
 * - Public form uploads MUST NOT pass through `encrypting`.
 *   Attempting START_ENCRYPT on a public form throws InvalidTransitionError.
 *
 * Requirements: 6.3, 6.4, 6.5, 6.6, 6.7
 *
 * @param job - The current Upload_Job
 * @param event - The transition event to apply
 * @returns A new UploadJob with the updated state
 * @throws InvalidTransitionError if the transition is not declared
 */
export function transition(job: UploadJob, event: UploadEvent): UploadJob {
  const allowedTransitions = TRANSITION_TABLE[job.state];
  const nextState = allowedTransitions[event];

  // Check if the transition is declared in the table
  if (nextState === undefined) {
    throw new InvalidTransitionError(job.id, job.state, event);
  }

  // Enforce privacy mode constraints on transitions from pending
  if (job.state === 'pending' && event === 'START_ENCRYPT' && job.privacyMode === 'public') {
    // Public forms MUST NOT go through encrypting
    throw new InvalidTransitionError(job.id, job.state, event);
  }

  if (job.state === 'pending' && event === 'START_UPLOAD' && job.privacyMode === 'private') {
    // Private forms MUST pass through encrypting before uploading
    throw new InvalidTransitionError(job.id, job.state, event);
  }

  return {
    ...job,
    state: nextState,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

/**
 * Determines whether an Upload_Job is an orphan.
 *
 * An orphan is a job that reached `uploaded` (Walrus has the blob) but never
 * progressed to `indexed` (no metadata row in Postgres). This can happen when
 * the API call failed, the browser closed mid-flight, or a network partition
 * occurred during indexing.
 *
 * Returns true if the job is in `uploaded` state and has been there for longer
 * than `ORPHAN_TIMEOUT_MS`.
 *
 * Requirements: 6.13
 *
 * @param job - The Upload_Job to check
 * @returns true if the job is an orphan
 */
export function isOrphan(job: UploadJob): boolean {
  return job.state === 'uploaded' && Date.now() - job.updatedAt > ORPHAN_TIMEOUT_MS;
}

/**
 * Returns the earliest non-completed step needed to make progress on a job.
 *
 * Used during retry/reconciliation to determine where to restart:
 * - If the job has a blobId (blob exists on Walrus) but hasn't been indexed,
 *   retry from `uploaded` (only the metadata write is needed).
 * - If the job is private and has no blobId, restart from `pending`
 *   (re-encrypt and re-upload).
 * - If the job is public and has no blobId, restart from `pending`
 *   (re-upload).
 *
 * Requirements: 6.11
 *
 * @param job - The Upload_Job to analyze
 * @returns The earliest UploadState from which to resume
 */
export function getRetryPoint(job: UploadJob): UploadState {
  // If we have a blob ID, the blob is on Walrus — only metadata write is needed
  if (job.blobId) {
    return 'uploaded';
  }

  // No blob ID — need to restart from the beginning
  return 'pending';
}

/**
 * Discards an orphaned job by transitioning it to `failed` locally.
 *
 * The blob remains on Walrus (immutable, has its own retention) but the job
 * is marked as terminal failure. This is used when the user chooses to discard
 * an orphan rather than reconcile it.
 *
 * Uses the existing transition function with the FAIL event from the `uploaded`
 * state, which is a declared edge in the transition table.
 *
 * Requirements: 6.13
 *
 * @param job - The Upload_Job to discard (must be in `uploaded` state)
 * @returns A new UploadJob in the `failed` state
 * @throws InvalidTransitionError if the job is not in a state that can transition to failed
 */
export function discard(job: UploadJob): UploadJob {
  return transition(job, 'FAIL');
}
