/**
 * apps/web/lib/api/metadata-client.ts
 *
 * Single canonical metadata API client for apps/web.
 *
 * This is the ONLY module in apps/web that communicates with the API_Server
 * for metadata orchestration. All functions return typed ApiResponse<T> results.
 *
 * Security invariants:
 *   - Session token is attached as a Bearer header on every authenticated request.
 *   - Request bodies are typed via Zod schemas; only schema-declared fields are
 *     serialized — no accidental payload leakage (Requirement 11.6).
 *   - The Web_App MUST NOT invoke Seal_Service operations directly (Req 1.12).
 *     `requestDecryption` delegates decryption to the API_Server.
 *   - No plaintext payload bytes, decryption keys, or Infrastructure_Wallet
 *     credentials are ever included in outbound request bodies.
 *
 * Requirements: 7.6, 11.6
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// ApiResponse<T> typed envelope
//
// Mirrors the shape returned by the API_Server across all routes.
// The envelope carries exactly one of `result` (success) or `error` (failure),
// plus a `requestId` for tracing and an HTTP `status` mirroring the status code.
// ---------------------------------------------------------------------------

export interface ApiResponseOk<T> {
  ok: true;
  requestId: string;
  status: number;
  result: T;
}

export interface ApiResponseErr {
  ok: false;
  requestId: string;
  status: number;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiResponseOk<T> | ApiResponseErr;

/**
 * Closed enum of error codes used across the API.
 * Mirrors `ApiErrorCode` in the API server routes.
 */
export type ApiErrorCode =
  | 'BadRequest'
  | 'Unauthorized'
  | 'Forbidden'
  | 'NotFound'
  | 'Conflict'
  | 'PayloadTooLarge'
  | 'TooManyRequests'
  | 'Validation'
  | 'Internal'
  | 'PrivacyModeMismatch'
  | 'BlobNotFound'
  | 'IntegrityMismatch'
  | 'AuthExpired';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type PrivacyMode = 'public' | 'private';

export type UploadState =
  | 'pending'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'indexed'
  | 'failed';

export type ArtifactKind = 'form' | 'submission' | 'file';

// ── Form types ──────────────────────────────────────────────────────────────

export interface FormRow {
  id: string;
  ownerAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  policyId: string | null;
  version: number;
  predecessorId: string | null;
  state: UploadState;
  contentDigest: string;
  sizeBytes: number;
  createdAt: string;
}

// ── Submission types ────────────────────────────────────────────────────────

export interface SubmissionRow {
  id: string;
  formId: string;
  formVersion: number;
  submitterAddress: string;
  walrusBlobId: string;
  privacyMode: PrivacyMode;
  contentDigest: string;
  sizeBytes: number;
  state: UploadState;
  policyId?: string;
  createdAt: string;
}

// ── File types ──────────────────────────────────────────────────────────────

export interface FileRow {
  id: string;
  submissionId: string;
  walrusBlobId: string;
  contentType: string;
  sizeBytes: number;
  contentDigest: string;
  state: UploadState;
  createdAt: string;
}

// ── Upload job types ────────────────────────────────────────────────────────

export interface UploadJobRow {
  id: string;
  ownerAddress: string;
  artifactKind: ArtifactKind;
  artifactId: string | null;
  walrusBlobId: string | null;
  state: UploadState;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Activity / audit types ──────────────────────────────────────────────────

export type AuditOutcome = 'ok' | 'denied' | 'error';
export type AuthorizationResult = 'granted' | 'denied';

export interface ActivityRow {
  id: number;
  requestId: string;
  actorAddress: string;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  formId: string | null;
  submissionId: string | null;
  authorizationResult: AuthorizationResult;
  outcome: AuditOutcome;
  httpStatus: number;
  rejectionReason?: string;
  createdAt: string;
}

export interface ActivityFilter {
  actorAddress?: string;
  formId?: string;
  submissionId?: string;
  fromTime?: string;
  toTime?: string;
}

// ---------------------------------------------------------------------------
// Zod request schemas
//
// Only schema-declared fields are serialized in outbound requests.
// This prevents accidental payload leakage (Requirement 11.6).
// ---------------------------------------------------------------------------

// ── Form schemas ────────────────────────────────────────────────────────────

const CreateFormBodySchema = z.object({
  /** The Form_Definition JSON document. The API_Server uploads it to Walrus. */
  formDefinition: z.record(z.unknown()),
  privacyMode: z.enum(['public', 'private']),
  /** Required when privacyMode is "private". */
  policyId: z.string().optional(),
});

export type CreateFormRequest = z.infer<typeof CreateFormBodySchema>;

const CreateFormVersionBodySchema = z.object({
  formDefinition: z.record(z.unknown()),
  privacyMode: z.enum(['public', 'private']),
  policyId: z.string().optional(),
});

export type CreateFormVersionRequest = z.infer<typeof CreateFormVersionBodySchema>;

// ── Submission schemas ──────────────────────────────────────────────────────

const CreateSubmissionBodySchema = z.object({
  formId: z.string().uuid(),
  formVersion: z.number().int().positive(),
  submitterAddress: z.string().min(1),
  privacyMode: z.enum(['public', 'private']),
  /**
   * Plaintext JSON payload string. The API_Server handles encryption for
   * private forms via the Infrastructure_Wallet (Requirement 2.1).
   * The Web_App MUST NOT perform Seal encryption directly (Requirement 1.12).
   */
  payload: z.string().min(1),
  /** Optional: pre-uploaded Walrus blob ID (for reconciliation flows). */
  walrusBlobId: z.string().optional(),
});

export type CreateSubmissionRequest = z.infer<typeof CreateSubmissionBodySchema>;

// ── File schemas ────────────────────────────────────────────────────────────

const CreateFileBodySchema = z.object({
  submissionId: z.string().uuid(),
  walrusBlobId: z.string().min(1),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  contentDigest: z.string().min(1),
});

export type CreateFileRequest = z.infer<typeof CreateFileBodySchema>;

// ── Upload job reconcile schema ─────────────────────────────────────────────

const ReconcileUploadJobBodySchema = z.object({
  jobId: z.string().uuid(),
  artifactKind: z.enum(['form', 'submission', 'file']),
  walrusBlobId: z.string().min(1).max(256),
  formId: z.string().uuid().optional(),
  contentDigest: z.string().regex(/^[0-9a-f]{64}$/i),
  sizeBytes: z.number().int().nonnegative(),
  privacyMode: z.enum(['public', 'private']),
});

export type ReconcileUploadJobRequest = z.infer<typeof ReconcileUploadJobBodySchema>;

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

/** API base URL — reads from NEXT_PUBLIC_API_URL or defaults to /api */
function getApiBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  return '/api';
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Perform an authenticated fetch against the API_Server.
 *
 * Attaches the session token as a Bearer header when provided.
 * Serializes the body using JSON.stringify — only the fields present in the
 * passed object are sent (callers use Zod-parsed objects to prevent leakage).
 *
 * Requirements: 7.6, 11.6
 */
async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    sessionToken?: string;
    queryParams?: Record<string, string>;
  } = {},
): Promise<ApiResponse<T>> {
  const base = getApiBaseUrl();
  let url = `${base}${path}`;

  if (options.queryParams) {
    const params = new URLSearchParams(options.queryParams);
    const qs = params.toString();
    if (qs) url = `${url}?${qs}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.sessionToken) {
    headers['Authorization'] = `Bearer ${options.sessionToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkErr) {
    // Network failure — return a structured error envelope so callers always
    // receive an ApiResponse<T> regardless of transport errors.
    return {
      ok: false,
      requestId: 'network-error',
      status: 0,
      error: {
        code: 'Internal',
        message:
          networkErr instanceof Error
            ? networkErr.message
            : 'Network request failed',
      },
    };
  }

  // Parse the typed ApiResponse envelope from the server.
  // The server always returns JSON; if parsing fails, return a structured error.
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return {
      ok: false,
      requestId: 'parse-error',
      status: response.status,
      error: {
        code: 'Internal',
        message: 'Failed to parse API response as JSON',
      },
    };
  }

  // Normalize the server response into our ApiResponse<T> shape.
  // The API server uses two slightly different envelope shapes across routes;
  // we normalize both here so callers see a consistent interface.
  const envelope = data as Record<string, unknown>;

  if (envelope['ok'] === true) {
    return {
      ok: true,
      requestId: (envelope['requestId'] as string | undefined) ?? '',
      status: (envelope['status'] as number | undefined) ?? response.status,
      result: envelope['result'] as T,
    };
  }

  if (envelope['ok'] === false) {
    return {
      ok: false,
      requestId: (envelope['requestId'] as string | undefined) ?? '',
      status: (envelope['status'] as number | undefined) ?? response.status,
      error: (envelope['error'] as ApiResponseErr['error']) ?? {
        code: 'Internal',
        message: 'Unknown error',
      },
    };
  }

  // Fallback: handle the submissions/files envelope shape which uses
  // `result`/`error` without an `ok` discriminant.
  if (envelope['result'] !== undefined) {
    return {
      ok: true,
      requestId: (envelope['requestId'] as string | undefined) ?? '',
      status: (envelope['status'] as number | undefined) ?? response.status,
      result: envelope['result'] as T,
    };
  }

  if (envelope['error'] !== undefined) {
    return {
      ok: false,
      requestId: (envelope['requestId'] as string | undefined) ?? '',
      status: (envelope['status'] as number | undefined) ?? response.status,
      error: (envelope['error'] as ApiResponseErr['error']) ?? {
        code: 'Internal',
        message: 'Unknown error',
      },
    };
  }

  // Last resort: treat the entire response as the result for 2xx, error for others.
  if (response.ok) {
    return {
      ok: true,
      requestId: '',
      status: response.status,
      result: data as T,
    };
  }

  return {
    ok: false,
    requestId: '',
    status: response.status,
    error: { code: 'Internal', message: 'Unexpected API response shape' },
  };
}

// ---------------------------------------------------------------------------
// Forms API
// ---------------------------------------------------------------------------

/**
 * Create a new form.
 *
 * Submits the Form_Definition JSON to the API_Server. The API_Server handles
 * Walrus upload and Postgres metadata indexing.
 *
 * Requirements: 4.1, 7.6
 *
 * @param req  Form creation request with formDefinition and privacyMode.
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<FormRow> with state: 'indexed' on success.
 */
export async function createForm(
  req: CreateFormRequest,
  sessionToken: string,
): Promise<ApiResponse<FormRow>> {
  // Parse through schema to ensure only declared fields are serialized.
  const body = CreateFormBodySchema.parse(req);
  return apiFetch<FormRow>('/forms', {
    method: 'POST',
    body: body as Record<string, unknown>,
    sessionToken,
  });
}

/**
 * Get form metadata by ID.
 *
 * Public forms are accessible without authentication.
 * Private forms require an authenticated session with owner or viewer access.
 *
 * Requirements: 7.6
 *
 * @param id  UUID of the form.
 * @param sessionToken  Bearer token (required for private forms).
 * @returns ApiResponse<FormRow> with form metadata.
 */
export async function getForm(
  id: string,
  sessionToken?: string,
): Promise<ApiResponse<FormRow>> {
  return apiFetch<FormRow>(`/forms/${encodeURIComponent(id)}`, {
    sessionToken,
  });
}

/**
 * List forms owned by the authenticated user.
 *
 * Requirements: 5.9, 7.6
 *
 * @param filter  Optional filter parameters.
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<{ forms: FormRow[]; total: number }>.
 */
export async function listForms(
  filter: {
    ownerAddress?: string;
    state?: UploadState;
    limit?: number;
    offset?: number;
  } = {},
  sessionToken: string,
): Promise<ApiResponse<{ forms: FormRow[]; total: number }>> {
  const queryParams: Record<string, string> = {};
  if (filter.ownerAddress) queryParams['ownerAddress'] = filter.ownerAddress;
  if (filter.state) queryParams['state'] = filter.state;
  if (filter.limit !== undefined) queryParams['limit'] = String(filter.limit);
  if (filter.offset !== undefined) queryParams['offset'] = String(filter.offset);

  return apiFetch<{ forms: FormRow[]; total: number }>('/forms', {
    queryParams,
    sessionToken,
  });
}

/**
 * Create a new form version (on privacy mode change or schema update).
 *
 * A privacy mode change creates a new Form_Definition version rather than
 * mutating prior submissions (Requirement 4.7).
 *
 * Requirements: 4.7, 7.6
 *
 * @param formId  UUID of the predecessor form.
 * @param req  New form version request.
 * @param sessionToken  Bearer token from the active auth session (owner required).
 * @returns ApiResponse<FormRow> with the new version row.
 */
export async function createFormVersion(
  formId: string,
  req: CreateFormVersionRequest,
  sessionToken: string,
): Promise<ApiResponse<FormRow>> {
  const body = CreateFormVersionBodySchema.parse(req);
  return apiFetch<FormRow>(`/forms/${encodeURIComponent(formId)}/version`, {
    method: 'POST',
    body: body as Record<string, unknown>,
    sessionToken,
  });
}

// ---------------------------------------------------------------------------
// Submissions API
// ---------------------------------------------------------------------------

/**
 * Submit a form response to the API_Server.
 *
 * For public forms: sends the plaintext JSON payload. The API_Server uploads
 *   it to Walrus as plaintext bytes and indexes metadata in Postgres.
 * For private forms: sends the plaintext JSON payload. The API_Server encrypts
 *   it via the Infrastructure_Wallet Seal authority, uploads ciphertext to
 *   Walrus, and indexes metadata in Postgres.
 *
 * The Web_App MUST NOT perform Seal encryption directly (Requirement 1.12).
 *
 * Requirements: 2.1, 4.2, 6.4, 6.7, 7.6
 *
 * @param req  Submission request with plaintext payload.
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<SubmissionRow> with state: 'indexed' on success.
 */
export async function createSubmission(
  req: CreateSubmissionRequest,
  sessionToken: string,
): Promise<ApiResponse<SubmissionRow>> {
  const body = CreateSubmissionBodySchema.parse(req);
  return apiFetch<SubmissionRow>('/submissions', {
    method: 'POST',
    body: body as Record<string, unknown>,
    sessionToken,
  });
}

/**
 * Retrieve submission metadata by ID.
 *
 * Returns non-sensitive metadata: blobId, digest, privacyMode, state.
 * Does NOT return plaintext payload or ciphertext bytes.
 *
 * Requirements: 7.2, 7.6
 *
 * @param id  UUID of the submission.
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<SubmissionRow> with metadata fields.
 */
export async function getSubmission(
  id: string,
  sessionToken: string,
): Promise<ApiResponse<SubmissionRow>> {
  return apiFetch<SubmissionRow>(`/submissions/${encodeURIComponent(id)}`, {
    sessionToken,
  });
}

/**
 * List submissions with optional filters.
 *
 * Requirements: 5.9, 7.2, 7.6
 *
 * @param filter  Optional filter parameters (formId, submitterAddress, state).
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<{ submissions: SubmissionRow[]; total: number }>.
 */
export async function listSubmissions(
  filter: {
    formId?: string;
    submitterAddress?: string;
    state?: UploadState;
    limit?: number;
    offset?: number;
  } = {},
  sessionToken: string,
): Promise<ApiResponse<{ submissions: SubmissionRow[]; total: number }>> {
  const queryParams: Record<string, string> = {};
  if (filter.formId) queryParams['formId'] = filter.formId;
  if (filter.submitterAddress) queryParams['submitterAddress'] = filter.submitterAddress;
  if (filter.state) queryParams['state'] = filter.state;
  if (filter.limit !== undefined) queryParams['limit'] = String(filter.limit);
  if (filter.offset !== undefined) queryParams['offset'] = String(filter.offset);

  return apiFetch<{ submissions: SubmissionRow[]; total: number }>('/submissions', {
    queryParams,
    sessionToken,
  });
}

/**
 * Request decryption of a private submission from the API_Server.
 *
 * The API_Server performs the authorization check, fetches ciphertext from
 * Walrus, decrypts via the Infrastructure_Wallet Seal authority, and returns
 * the plaintext to the authorized requester.
 *
 * The Web_App MUST NOT invoke Seal_Service decryption directly (Req 1.12).
 * If the requester is not authorized, the API_Server returns HTTP 403 and
 * no decryption is performed (Requirement 4.6, 12.3).
 *
 * Requirements: 4.6, 7.3, 7.6, 12.3, 12.5
 *
 * @param submissionId  UUID of the submission to decrypt.
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<{ plaintext: string }> on success, or 403 if unauthorized.
 */
export async function requestDecryption(
  submissionId: string,
  sessionToken: string,
): Promise<ApiResponse<{ plaintext: string }>> {
  return apiFetch<{ plaintext: string }>(
    `/submissions/${encodeURIComponent(submissionId)}/decrypt`,
    { sessionToken },
  );
}

// ---------------------------------------------------------------------------
// Files API
// ---------------------------------------------------------------------------

/**
 * Create a file attachment metadata record.
 *
 * The file bytes must already be uploaded to Walrus before calling this
 * function. This endpoint records the metadata (blob ID, content type,
 * size, digest) in Postgres.
 *
 * Requirements: 5.3, 7.6
 *
 * @param req  File creation request.
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<FileRow> with the created record.
 */
export async function createFile(
  req: CreateFileRequest,
  sessionToken: string,
): Promise<ApiResponse<FileRow>> {
  const body = CreateFileBodySchema.parse(req);
  return apiFetch<FileRow>('/files', {
    method: 'POST',
    body: body as Record<string, unknown>,
    sessionToken,
  });
}

/**
 * Retrieve file attachment metadata by file ID.
 *
 * Requirements: 5.3, 7.6
 *
 * @param id  UUID of the file record.
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<FileRow> with file metadata.
 */
export async function getFile(
  id: string,
  sessionToken: string,
): Promise<ApiResponse<FileRow>> {
  return apiFetch<FileRow>(`/files/${encodeURIComponent(id)}`, {
    sessionToken,
  });
}

// ---------------------------------------------------------------------------
// Upload Jobs API
// ---------------------------------------------------------------------------

/**
 * Reconcile an orphaned upload job by retrying the metadata write.
 *
 * An orphan is a job that reached `uploaded` (Walrus has the blob) but never
 * reached `indexed` (no metadata row). This call is idempotent on
 * (ownerAddress, walrusBlobId) — safe to call multiple times.
 *
 * Requirements: 6.10, 6.13, 7.6
 *
 * @param req  Reconcile request with jobId, artifactKind, walrusBlobId, etc.
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<UploadJobRow> with state: 'indexed' on success.
 */
export async function reconcileUploadJob(
  req: ReconcileUploadJobRequest,
  sessionToken: string,
): Promise<ApiResponse<UploadJobRow>> {
  const body = ReconcileUploadJobBodySchema.parse(req);
  return apiFetch<UploadJobRow>('/upload-jobs/reconcile', {
    method: 'POST',
    body: body as Record<string, unknown>,
    sessionToken,
  });
}

/**
 * List upload jobs owned by the authenticated user.
 *
 * Requirements: 6.13, 7.6
 *
 * @param filter  Optional filter parameters (state, artifactKind, limit, offset).
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<{ jobs: UploadJobRow[]; pagination: { total, limit, offset, hasMore } }>.
 */
export async function listUploadJobs(
  filter: {
    state?: UploadState;
    artifactKind?: ArtifactKind;
    limit?: number;
    offset?: number;
  } = {},
  sessionToken: string,
): Promise<
  ApiResponse<{
    jobs: UploadJobRow[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }>
> {
  const queryParams: Record<string, string> = {};
  if (filter.state) queryParams['state'] = filter.state;
  if (filter.artifactKind) queryParams['artifactKind'] = filter.artifactKind;
  if (filter.limit !== undefined) queryParams['limit'] = String(filter.limit);
  if (filter.offset !== undefined) queryParams['offset'] = String(filter.offset);

  return apiFetch<{
    jobs: UploadJobRow[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }>('/upload-jobs', {
    queryParams,
    sessionToken,
  });
}

// ---------------------------------------------------------------------------
// Activity / Audit Log API
// ---------------------------------------------------------------------------

/**
 * Retrieve audit activity entries.
 *
 * Returns audit log entries filtered by the supplied criteria. Access is
 * restricted to the Form_Owner Authorization_Identity for the relevant form
 * (enforced server-side).
 *
 * Requirements: 5.5, 7.4, 7.6, 14.5
 *
 * @param filter  Optional filter parameters (actorAddress, formId, submissionId, time range).
 * @param sessionToken  Bearer token from the active auth session.
 * @returns ApiResponse<ActivityRow[]> with matching audit entries.
 */
export async function getActivity(
  filter: ActivityFilter = {},
  sessionToken: string,
): Promise<ApiResponse<ActivityRow[]>> {
  const queryParams: Record<string, string> = {};
  if (filter.actorAddress) queryParams['actorAddress'] = filter.actorAddress;
  if (filter.formId) queryParams['formId'] = filter.formId;
  if (filter.submissionId) queryParams['submissionId'] = filter.submissionId;
  if (filter.fromTime) queryParams['fromTime'] = filter.fromTime;
  if (filter.toTime) queryParams['toTime'] = filter.toTime;

  return apiFetch<ActivityRow[]>('/activity', {
    queryParams,
    sessionToken,
  });
}
