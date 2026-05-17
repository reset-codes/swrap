# Implementation Plan: Walrus-Native ZK Login Architecture

## Overview

This plan migrates Swrap from a POC with client-side encryption and bypass-auth paths to a production-grade **Managed Encryption Authority** platform. The Infrastructure_Wallet on the API_Server owns all Seal encryption and decryption authority. ZK Login and external wallets are Authorization Identities only. Migration is incremental — each task leaves `main` deployable and legacy flows coexist until the cleanup pass.

The implementation follows the architecture note in `requirements.md`: upload flow is Web_App → API_Server (validates authorization) → API_Server encrypts via Seal using Infrastructure_Wallet → API_Server uploads to Walrus → API_Server indexes metadata in Postgres.

---

## Tasks

- [x] 1. Database schema and migration tooling
  - [x] 1.1 Install and configure `node-pg-migrate` as the versioned migration tool
    - Add `node-pg-migrate` to `apps/api` dependencies (pinned version)
    - Create `db/migrations/` directory and add `pnpm migrate up` / `pnpm migrate down` scripts to `apps/api/package.json`
    - Configure migration tool to use `DATABASE_URL` from environment; commit migration history table (`pgmigrations`) to repo
    - _Requirements: 5.10_

  - [x] 1.2 Write migration 0001: core schema (users, forms, submissions, files, upload_jobs, activity, permissions)
    - Create `db/migrations/0001_core_schema.sql` with all seven tables exactly as specified in design.md
    - Include all CHECK constraints, UNIQUE constraints, foreign keys (submissions→forms, files→submissions, permissions→forms), and indexes
    - Enforce: no `bytea`/`jsonb_body` columns; only `walrus_blob_id` references for content
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 1.3 Write property tests for schema constraints (Properties 21, 22, 23)
    - **Property 21: Postgres metadata schema contains no payload bodies** — assert no column type is `bytea`, no column name matches `body|plaintext|cipher|private_key`
    - **Property 22: Walrus blob ID uniqueness per table** — for any generated blob ID, second insertion into same table fails with unique-constraint violation
    - **Property 23: Foreign keys enforce referential integrity** — submissions insert with unknown `form_id` fails with FK violation
    - **Validates: Requirements 5.5, 5.6, 3.4**
    - Test file: `db/schema.pbt.test.ts` using `fast-check` + `@testcontainers/postgresql`

  - [x] 1.4 Write schema lint: `db/lint/forbidden-columns.sql`
    - SQL assertion that runs in CI: no column in any table has type `bytea` or a name matching `body`, `plaintext`, `cipher`, `private_key`
    - Wire into `pnpm lint` via a `db:lint` script
    - _Requirements: 5.6_


- [x] 2. Infrastructure_Wallet and Seal authority on the API_Server
  - [x] 2.1 Implement `apps/api/services/infrastructure-wallet.ts` — wallet loader and Seal authority module
    - Load Infrastructure_Wallet keypair exclusively from `INFRASTRUCTURE_WALLET_SECRET` environment variable (never from source-controlled files)
    - Expose `getInfrastructureWallet(): SuiKeypair` — throws `WalletNotConfiguredError` if env var is absent or malformed
    - Expose `sealEncrypt(plaintext: Uint8Array, policyOwnerAddress: string): Promise<{ ciphertext: Uint8Array; policyId: string; digest: string }>` — encrypts via Seal SDK using Infrastructure_Wallet
    - Expose `sealDecrypt(ciphertext: Uint8Array, policyId: string): Promise<Uint8Array>` — decrypts via Seal SDK using Infrastructure_Wallet; MUST only be called after authorization check passes
    - Hold plaintext bytes ephemerally; release references on completion or failure
    - Never log wallet credentials, Seal session secrets, or decryption keys at any log level
    - _Requirements: 2.2, 2.3, 2.4, 2.7, 9.3, 9.4, 12.2, 13.1, 13.2, 13.5_

  - [x] 2.2 Write property tests for Seal encryption round-trip (Properties 7, 8, 9, 10)
    - **Property 7: Seal encryption round-trip** — `sealDecrypt(sealEncrypt(p, policy(s)), infra_wallet)` deep-equals `p`
    - **Property 8: Seal encryption is non-deterministic but functionally invariant** — two encryptions of same payload produce different ciphertexts, both decrypt correctly
    - **Property 9: Seal encryption output structure and digest correctness** — returned tuple has non-empty ciphertext, non-empty policyId, and `digest == SHA-256(ciphertext)`
    - **Property 10: Seal_Policy authorizes the Form_Owner** — policyId resolves to a policy whose authorized signer set contains the form owner address
    - **Validates: Requirements 2.2, 2.3, 4.3**
    - Test file: `apps/api/services/infrastructure-wallet.pbt.test.ts`

  - [x] 2.3 Update `apps/api/server-config.ts` — add `INFRASTRUCTURE_WALLET_SECRET` to required env vars
    - Add `INFRASTRUCTURE_WALLET_SECRET` to the Zod env schema as a required string
    - Add `WALRUS_PUBLISHER_URL`, `WALRUS_AGGREGATOR_URL`, `SUI_RPC_URL`, `SESSION_SECRET`, `API_CORS_ORIGINS` as required
    - Mark `DEV_BYPASS_STORAGE`, `DEV_LOCAL_SIGNER`, `DEV_ALLOW_PLAINTEXT`, `INFRA_WALLET_PRIVATE_KEY` as **forbidden** (presence causes startup failure)
    - Fail fast with a descriptive error listing all missing/forbidden keys
    - _Requirements: 9.3, 9.8, 13.1_

  - [x] 2.4 Write property tests for env validator (Property 36)
    - **Property 36: Env validator** — for all generated valid env objects, startup succeeds; for all generated env objects missing any required key or containing any forbidden key, startup throws with a descriptive error
    - **Validates: Requirements 9.8**
    - Test file: `apps/api/server-config.pbt.test.ts`


---

## Phase 4 — Audit Log and Authorization Service

- [x] 14. Implement Audit_Log write service
  - Create `apps/api/services/audit-log.ts` that exposes:
    - `writeAuditEntry(entry: AuditLogEntry): Promise<void>` — inserts an append-only row into `audit_log`
    - `AuditLogEntry` type: `{ requestId, actorAddress, action, targetKind, targetId, formId, submissionId, authorizationResult: 'granted' | 'denied', outcome: 'ok' | 'denied' | 'error', httpStatus, rejectionReason? }`
    - MUST NOT include plaintext payload bytes, decryption keys, or Infrastructure_Wallet credentials in any field
    - If the INSERT fails: throw `AuditLogWriteError` — callers MUST roll back any associated decryption response and return a structured server error (never emit plaintext on audit failure)
  - Expose `queryAuditLog(filter: { actorAddress?, formId?, submissionId?, fromTime?, toTime? }): Promise<AuditLogRow[]>` — used by the audit query endpoint
  - _Requirements: 5.5, 7.4, 12.4, 14.1, 14.2, 14.3, 14.4, 14.6, 14.7_

  - [x] 14.1 Implement audit-log.ts with write and query functions
    - Write `writeAuditEntry`, `queryAuditLog`, `AuditLogWriteError`, and no-sensitive-data enforcement
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 14.2 Write property test for audit completeness (Properties from Req 14)
    - **Audit completeness invariant** — for generated decryption operations, count of `audit_log` entries equals count of decryption attempts
    - **Attribution invariant** — for generated successful decryptions, the audit entry references the same `actorAddress`, `formId`, and `submissionId` as the operation
    - **Rejection-audit invariant** — for generated failed authorization attempts, an audit entry exists with `authorizationResult = 'denied'` and `httpStatus` 401 or 403
    - **Validates: Requirements 14.1, 14.2, 14.3**

- [x] 15. Implement authorization service
  - Create `apps/api/services/authorization.ts` that exposes:
    - `assertOwner(actorAddress: string, formId: string, db: Db): Promise<void>` — looks up `forms.owner_address` and throws `ForbiddenError` if `actorAddress !== owner_address`
    - `assertViewerOrOwner(actorAddress: string, formId: string, submissionId: string | null, db: Db): Promise<void>` — checks ownership OR `viewer_permissions` grant; throws `ForbiddenError` if neither
    - `assertDecryptionAuthorized(actorAddress: string, formId: string, submissionId: string, db: Db): Promise<void>` — checks ownership OR viewer permission with `capability = 'view'`; throws `ForbiddenError` if unauthorized; this function MUST be called before any `seal-orchestrator.decryptPayload` invocation
    - All functions write an `activity` row via `audit-log.ts` on both success and failure
    - `ForbiddenError` carries `{ actorAddress, formId, submissionId?, reason }` for structured logging (no payload contents)
  - _Requirements: 2.2, 4.6, 7.3, 7.9, 12.3, 12.5, 13.3, 13.6_

  - [x] 15.1 Implement authorization.ts with assertOwner, assertViewerOrOwner, assertDecryptionAuthorized
    - Write all three assertion functions with audit-log writes on success and failure
    - _Requirements: 2.2, 7.3, 12.3, 12.5_

  - [x] 15.2 Write property test for authorization gating on metadata writes (Property 30)
    - **Property 30: Authorization gating on metadata writes**
    - For generated metadata write requests where session address differs from form owner, assert API returns 403, no row is written, and an `activity` row with `outcome = "denied"` is appended
    - **Validates: Requirements 7.4**

  - [x] 15.3 Write property test for authorization-gated decryption invariant (Properties from Req 12)
    - **Authorization precedence invariant** — for generated decryption attempts, `seal-orchestrator.decryptPayload` is only called after a passing `assertDecryptionAuthorized` check
    - **Rejection invariant** — for generated unauthorized Authorization_Identity requests, API returns HTTP 403 and no Seal decryption operation is invoked
    - **Validates: Requirements 12.3, 12.5, 13.6**

- [x] 16. Checkpoint — Audit and authorization services complete
  - Verify `assertDecryptionAuthorized` is called before every `decryptPayload` invocation in the codebase
  - Verify `writeAuditEntry` is called for every decryption endpoint invocation
  - Ensure all tests pass, ask the user if questions arise.


- [x] 3. ZK Login server-side verification
  - [x] 3.1 Implement `apps/api/auth/zk-verify.ts` — ZK Login proof verification
    - Implement `verifyZkProof(envelope: ZkProofEnvelope): Promise<{ valid: boolean; address: string }>` using `@mysten/zklogin` server bindings
    - Verify: JWT signature against Google JWKs (cached, refreshed by validity window), nonce binding, ZK proof validity, `maxEpoch >= currentEpoch` from Sui RPC, address derivation matches asserted address
    - Return `{ valid: false }` for any single-bit mutation of any field in the envelope
    - Never store ephemeral private key material; never log JWT, ZK randomness, or salt
    - _Requirements: 1.9, 1.10_

  - [x] 3.2 Implement `apps/api/auth/wallet-verify.ts` — external wallet signature verification
    - Implement `verifyWalletSignature(address: string, challenge: string, signature: string): Promise<{ valid: boolean }>` using Sui signature verification
    - _Requirements: 1.3_

  - [x] 3.3 Implement `apps/api/auth/session.ts` — session token issuance and validation
    - Issue opaque session tokens (HttpOnly cookie + Bearer) after successful ZK or wallet verification
    - Bind session token to the verified address and signer kind
    - Expose `getSessionAddress(req): string | null` for use by route handlers
    - Rate-limit session issuance per address (integrate with rate limiter in task 6)
    - _Requirements: 1.9, 7.1_

  - [x] 3.4 Write property tests for ZK proof verification (Properties 1, 2)
    - **Property 1: ZK Login proof round-trip preserves address** — for any generated valid (JWT, ephemeral key pair, salt, nonce, maxEpoch), client-derived address equals API-returned address
    - **Property 2: ZK Login proof tampering is rejected** — for any valid proof envelope and any single-bit mutation, `verifyZkProof` returns `{ valid: false }`
    - **Validates: Requirements 1.1, 1.9**
    - Test file: `apps/api/auth/zk-verify.pbt.test.ts`

  - [x] 3.5 Add auth routes to `apps/api/routes/index.ts`
    - `POST /auth/zk-verify` — calls `verifyZkProof`, issues session token on success
    - `POST /auth/wallet-verify` — calls `verifyWalletSignature`, issues session token on success
    - `POST /auth/logout` — invalidates session token
    - `GET /me` — returns `{ address, signerKind }` for authenticated session
    - Return typed `ApiResponse<T>` envelope for all responses
    - _Requirements: 7.1, 7.6_


---

## Phase 3: Frontend — Auth Module, API Client, Upload State Machine, UX

- [ ] 21. Implement Web_App auth module (single canonical module)
  - Create `apps/web/lib/auth/auth-client.ts` — the ONLY auth module in `apps/web`
  - Export `signInWithGoogle()`: complete Sui ZK Login ceremony; generate ephemeral Ed25519 key pair; compute nonce; redirect to Google OAuth; receive id_token; request ZK proof from Sui ZK Prover; derive ZK_Login_Account address; persist ephemeral key in `sessionStorage` only (never `localStorage`, never IndexedDB, never sent to API)
  - Export `connectExternalWallet()`: connect browser extension wallet; sign auth challenge; verify with API
  - Export `logout()`: clear sessionStorage, in-memory CryptoKey, and session token
  - Export `useSession()` hook returning `{ status, address, signerKind, expiresAt }`
  - On epoch expiry: surface `RequiresReauthError` before any further auth-required operation
  - The ZK_Login_Account and External_Wallet are authorization identities ONLY — this module MUST NOT invoke Seal_Service operations
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.11, 1.12, 11.5_

  - [ ] 21.1 Write property tests for auth client (Properties 3, 4, 5, 6)
    - **Property 3: ZK ephemeral key placement** — Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4
    - **Property 4: Authentication method switching preserves consistency** — Validates: Requirements 1.4
    - **Property 5: Active signer is the Form_Owner** — Validates: Requirements 1.5, 1.6
    - **Property 6: Ephemeral key expiry blocks signer operations** — Validates: Requirements 1.7
    - Use `fast-check` + jsdom + sessionStorage/localStorage spies + network capture
    - Files: `apps/web/lib/auth/auth-client.boundary.test.ts`, `apps/web/lib/auth/auth-client.switch.pbt.test.ts`, `apps/web/lib/auth/auth-client.epoch.pbt.test.ts`

- [ ] 22. Implement Web_App metadata API client (single canonical module)
  - Create `apps/web/lib/api/metadata-client.ts` — the ONLY metadata API client in `apps/web`
  - Export typed functions for every API endpoint: `createForm`, `getForm`, `listForms`, `createFormVersion`, `createSubmission`, `getSubmission`, `listSubmissions`, `requestDecryption`, `createFile`, `getFile`, `reconcileUploadJob`, `listUploadJobs`, `getActivity`
  - All functions return `ApiResponse<T>` typed results
  - Attach session token (Bearer) to every authenticated request
  - Request body schemas are typed via Zod; only schema fields serialize (no accidental payload leakage)
  - _Requirements: 7.6, 11.6_

- [ ] 23. Implement Web_App Walrus client (for public form retrieval)
  - Create `apps/web/lib/walrus/walrus-client.ts`
  - Export `walrusFetch(blobId: string) → Uint8Array` with bounded exponential backoff (default 5 attempts)
  - Export `verifyDigest(bytes: Uint8Array, recordedDigest: string) → boolean`
  - On digest mismatch: throw `IntegrityError` and produce no rendered output
  - Used by the Web_App to fetch public form schemas and public submission payloads from Walrus directly
  - _Requirements: 3.8, 3.9_

  - [ ] 23.1 Write property tests for Web_App Walrus client (Properties 15, 16, 17)
    - **Property 15: Walrus storage round-trip** — Validates: Requirements 3.6
    - **Property 16: Walrus integrity verification rejects digest mismatches** — Validates: Requirements 3.7
    - **Property 17: Walrus fetch retry is bounded** — Validates: Requirements 3.8
    - File: `apps/web/lib/walrus/walrus-client.pbt.test.ts`

- [ ] 24. Implement UX vocabulary copy module
  - Create `apps/web/lib/copy/ux-copy.ts`
  - Export `uploadPhase(state: UploadState) → string` mapping: `pending → "Preparing"`, `encrypting → "Securing"`, `uploading → "Uploading"`, `uploaded → "Saving"`, `indexed → "Saved"`, `failed → "Couldn't save — retry"`
  - Export `privacyModeLabel(mode: 'public' | 'private') → string` mapping: `public → "Shared"`, `private → "Private"`
  - Export `authEntityLabel() → "your account"`
  - This is the ONLY place internal state names cross into UI strings
  - _Requirements: 8.1, 8.2, 8.4, 8.6, 8.8_

  - [x] 24.1 Write property test for UX vocabulary mapping (Property 29)
    - **Property 29: Upload phase UX mapping**
    - **Validates: Requirements 6.9, 8.6**
    - Assert `uploadPhase(s)` returns the documented string for every state `s` and that no internal state name appears in rendered progress UI
    - File: `apps/web/lib/copy/ux-copy.pbt.test.ts`

- [ ] 25. Implement client-side Upload_Job state machine and IndexedDB persistence
  - Create `apps/web/lib/upload/upload-state-machine.ts`
  - Implement `UploadJob` interface and `UploadState` type matching the design data models
  - Persist every state transition to IndexedDB (never persist plaintext payload; ciphertext handle only between encrypting/uploading)
  - Export `createJob(artifactKind, formId, privacyMode) → UploadJob`
  - Export `transition(job, nextState, updates?) → UploadJob`
  - Export `resume() → UploadJob[]`: reload all jobs from IndexedDB on page load
  - Export `isOrphan(job) → boolean`: true if in `uploaded` for longer than `ORPHAN_TIMEOUT_MS`
  - Export `retryJob(job) → UploadJob`: restart from earliest non-completed step
  - _Requirements: 6.1, 6.11, 6.12, 6.13, 6.14_

  - [ ] 25.1 Write property tests for client upload state machine (Properties 25, 26, 27, 28)
    - **Property 25: Upload state machine transition validity and initial state** — Validates: Requirements 6.1–6.7
    - **Property 26: Retry from failed is idempotent** — Validates: Requirements 6.8
    - **Property 27: Upload_Job state persistence round-trip** — Validates: Requirements 6.11
    - **Property 28: Orphan detection after timeout** — Validates: Requirements 6.10
    - File: `apps/web/lib/upload/upload-state-machine.pbt.test.ts`

- [ ] 26. Implement form creation UI with privacy mode selector
  - Update `apps/web/components/forms/` to include a privacy mode selector using UX_Vocabulary labels ("Private" / "Shared")
  - On form creation: call `metadata-client.createForm` which submits the Form_Definition to the API_Server for Walrus storage and metadata indexing
  - Display Upload_Job progress using `ux-copy.uploadPhase()` labels
  - On success: navigate to the form management view
  - On failure: surface actionable error with retry affordance
  - _Requirements: 4.1, 8.1, 8.2, 8.7_

- [ ] 27. Implement submission flow (submits to backend orchestration API)
  - Update `apps/web/components/submissions/SubmissionFillFields.tsx` and related components
  - On submit: call `metadata-client.createSubmission` with the payload; the API_Server handles encryption (for private forms) and Walrus storage
  - Display Upload_Job progress using `ux-copy.uploadPhase()` labels
  - On `indexed`: show success state ("Saved")
  - On `failed`: show retry affordance ("Couldn't save — retry")
  - MUST NOT invoke Seal_Service directly from the Web_App
  - _Requirements: 2.1, 6.9, 6.12, 8.6, 8.8_

- [ ] 28. Implement submission viewer (requests decryption from backend)
  - Update `apps/web/components/submissions/SubmissionDetailPanel.tsx`
  - For public submissions: fetch blob from Walrus via `walrus-client`, verify digest, render JSON
  - For private submissions: call `metadata-client.requestDecryption` to request decryption from the API_Server; render the returned plaintext
  - On integrity mismatch: display "We can't trust this content" and do not render
  - On 403: display "You don't have access to that"
  - MUST NOT invoke Seal_Service directly from the Web_App
  - _Requirements: 3.8, 3.9, 4.6, 8.1_

- [ ] 29. Implement UX abstraction — advanced view toggle
  - Add `advancedView: boolean` setting persisted in `localStorage` per device
  - When `advancedView = false` (default): hide Walrus blob IDs, Sui transaction hashes, Seal policy IDs, raw signer addresses from all primary-flow components
  - When `advancedView = true`: expose blob ID (with copy affordance), transaction hash, policy ID, raw signer address in metadata views
  - Add toggle control in settings or account panel
  - _Requirements: 8.3, 8.5_

  - [x] 29.1 Write property test for primary-flow UI (Property 41)
    - **Property 41: Primary-flow UI does not display raw chain identifiers**
    - **Validates: Requirements 8.3**
    - Assert rendered text of primary-flow components contains no string matching Walrus blob ID format, Sui tx hash format, Seal policy ID format, or raw signer address when `advancedView = false`
    - File: `apps/web/components/ui/primary-flow.pbt.test.ts`

- [ ] 30. Implement wallet-required action explanation panel
  - Create a plain-language explanation panel component for flows that require an External_Wallet
  - Display a one-paragraph plain-language summary of what an external wallet is on first appearance
  - Present a single CTA before exposing the technical action
  - _Requirements: 8.9_

- [ ] 31. Implement upload orphan reconciliation UI
  - On page load, call `upload-state-machine.resume()` and check for orphaned jobs
  - For any orphaned job (in `uploaded` beyond `ORPHAN_TIMEOUT_MS`): surface "Reconcile?" UI with "Reconcile" and "Discard" affordances
  - "Reconcile": call `metadata-client.reconcileUploadJob` (idempotent); on success transition job to `indexed`
  - "Discard": mark job `failed` locally
  - _Requirements: 6.10, 6.13_

- [ ] 32. Checkpoint — Frontend complete
  - Ensure auth flows work end-to-end, form creation and submission flows work, decryption requests succeed for authorized users, UX vocabulary is applied consistently
  - Ask the user if questions arise before proceeding to Phase 4


- [x] 4. Typed response envelope and API middleware hardening
  - [x] 4.1 Refactor `apps/api/error-envelope.ts` into the full typed `ApiResponse<T>` contract
    - Define `ApiResponse<T>`, `ApiError`, and the closed `code` enum (`BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `PayloadTooLarge`, `TooManyRequests`, `Validation`, `Internal`, `PrivacyModeMismatch`, `BlobNotFound`, `IntegrityMismatch`, `AuthExpired`)
    - Export `ok<T>(result: T, status?: number, requestId: string): ApiResponse<T>` and `err(code, message, status, requestId): ApiResponse<never>`
    - Every existing route handler must return this envelope (update existing routes in this task)
    - _Requirements: 7.6_

  - [x] 4.2 Write property tests for typed response envelope (Property 31)
    - **Property 31: Typed response envelope shape** — for any request to any registered API route, response body conforms to `ApiResponse<T>` with `requestId`, `status` matching HTTP status, and exactly one of `result` or `error`
    - **Validates: Requirements 7.6**
    - Test file: `apps/api/error-envelope.pbt.test.ts` (extends existing)

  - [x] 4.3 Implement security middleware: `apps/api/middleware/security-headers.ts`
    - Set `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
    - Set `X-Content-Type-Options: nosniff`
    - Set `Referrer-Policy: no-referrer`
    - Set `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
    - _Requirements: 9.10_

  - [x] 4.4 Implement `apps/api/middleware/payload-limit.ts` — strict payload size enforcement
    - Replace existing `express.json({ limit: '1mb' })` with `express.json({ limit: '64kb' })` (configurable via `PAYLOAD_LIMIT_BYTES` env var)
    - Reject every request body exceeding the limit with HTTP 413 `PayloadTooLarge`; zero tolerance — even one byte over the limit is rejected
    - _Requirements: 9.6_

  - [x] 4.5 Write property tests for payload limit (Property 34)
    - **Property 34: Payload limit** — for all generated request bodies whose size exceeds `PAYLOAD_LIMIT_BYTES`, the API_Server returns 413
    - **Validates: Requirements 9.6**
    - Test file: `apps/api/middleware/payload-limit.pbt.test.ts`

  - [x] 4.6 Implement `apps/api/middleware/rate-limit.ts` — per-identity and per-IP rate limiting
    - Token-bucket rate limiter: default 120 req/min per asserted address and per source IP
    - Return 429 with `Retry-After` header when quota exceeded
    - Apply to all authenticated endpoints including encryption and decryption endpoints
    - _Requirements: 9.7, 9.12_

  - [x] 4.7 Write property tests for rate limiter (Property 35)
    - **Property 35: Rate limiter window** — for all generated request rates above threshold across a sliding window, API returns 429 once threshold is crossed and resumes 2xx after window resets
    - **Validates: Requirements 9.7, 9.12**
    - Test file: `apps/api/middleware/rate-limit.pbt.test.ts`

  - [x] 4.8 Harden `apps/api/middleware/cors.ts` — strict allowlist from env
    - Read allowed origins from `API_CORS_ORIGINS` env var (comma-separated); reject wildcards
    - _Requirements: 9.9_

  - [x] 4.9 Write property tests for CORS allowlist (Property 37)
    - **Property 37: CORS allow-list** — for all generated origins not in `API_CORS_ORIGINS`, the API returns a CORS rejection; for all origins in the list, the request proceeds
    - **Validates: Requirements 9.9**
    - Test file: `apps/api/middleware/cors.pbt.test.ts`

  - [x] 4.10 Write property tests for security headers (Property 38)
    - **Property 38: Security headers** — for any request to any route, response includes all four required security headers with correct values
    - **Validates: Requirements 9.10**
    - Test file: `apps/api/middleware/security-headers.pbt.test.ts`

  - [x] 4.11 Update `apps/api/middleware/request-logger.ts` — structured logging with secret redaction
    - Emit one JSON line per request: `{ ts, level, event, requestId, method, path, actor, status, durationMs, outcome }`
    - Implement `serializeFields()` allow-list: exclude request body, response body, JWTs, ZK proofs, signatures, ciphertext, plaintext, Infrastructure_Wallet credentials
    - _Requirements: 7.7, 9.4, 9.11_

  - [x] 4.12 Write property tests for structured logging redaction (Property 39)
    - **Property 39: Structured logging redaction** — for all generated log records emitted by the API_Server, no record contains substrings of Infrastructure_Wallet credentials, decryption keys, or Seal session secrets
    - **Validates: Requirements 9.4, 9.11**
    - Test file: `apps/api/middleware/request-logger.pbt.test.ts`

  - [x] 4.13 Update `apps/api/app.ts` — wire full middleware stack in correct order
    - Order: `request-id → request-logger → cors → security-headers → rate-limit → payload-limit → auth-verify → router → error-handler`
    - Remove existing `express.json({ limit: '1mb' })` (replaced by payload-limit middleware)
    - _Requirements: 9.1, 9.6, 9.7, 9.9, 9.10_


---

## Phase 5 — Upload State Machine and Metadata Orchestration

- [ ] 17. Implement Upload State Machine on the API_Server
  - Create `apps/api/services/upload-state-machine.ts` that:
    - Defines `UploadState` transitions as a typed state graph: `pending → encrypting | uploading`, `encrypting → uploading | failed`, `uploading → uploaded | failed`, `uploaded → indexed | failed`, `failed → pending` (retry)
    - Exposes `transitionState(jobId: string, from: UploadState, to: UploadState, db: Db): Promise<void>` — atomically updates `upload_jobs.state` and `upload_jobs.updated_at`; throws `InvalidTransitionError` if `(from, to)` is not a declared edge
    - Exposes `createJob(ownerAddress: string, artifactKind: ArtifactKind, db: Db): Promise<string>` — inserts a new `upload_jobs` row with `state = 'pending'`
    - Exposes `getRetryPoint(job: UploadJobRow): UploadState` — returns the earliest non-completed step: if `blobId` exists but no metadata row → retry from `uploaded`; if no `blobId` but `artifactKind = 'submission'` and `privacyMode = 'private'` → retry from `pending` (re-encrypt); if no `blobId` and `privacyMode = 'public'` → retry from `pending`
    - Exposes `flagOrphan(jobId: string, db: Db): Promise<void>` — sets a `is_orphan` flag or records in `upload_jobs.failure_reason` for jobs in `uploaded` beyond `ORPHAN_TIMEOUT_MS`
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 6.11_

  - [ ] 17.1 Implement upload-state-machine.ts with transition graph, createJob, transitionState, getRetryPoint, flagOrphan
    - Write all functions with atomic DB updates and `InvalidTransitionError` on illegal transitions
    - _Requirements: 6.1–6.8, 6.10_

  - [ ] 17.2 Write property test for state machine transition validity (Property 25)
    - **Property 25: Upload state machine transition validity and initial state**
    - Generate arbitrary operation sequences; assert every reached state is in the declared set, every transition matches a declared edge, and every new job starts in `pending`
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**

  - [ ] 17.3 Write property test for retry idempotence (Property 26)
    - **Property 26: Retry from failed is idempotent**
    - For generated failed jobs and k ≥ 1 retries from the same recovery point, assert final state, blob ID, and side effects equal those of exactly one retry
    - **Validates: Requirements 6.8**

- [ ] 18. Implement metadata orchestration service
  - Create `apps/api/services/metadata-orchestrator.ts` as the single upload orchestration module:
    - Exposes `orchestrateFormCreate(req: CreateFormRequest, actorAddress: string, db: Db): Promise<CreateFormResult>`:
      1. Create upload job (`pending`)
      2. Canonicalize form definition JSON
      3. If `privacyMode = 'private'`: transition to `encrypting`, call `seal-orchestrator.encryptPayload`, transition to `uploading`; if `public`: transition directly to `uploading`
      4. Call `walrus-client.putBlob` with the bytes (plaintext JSON for public, ciphertext for private)
      5. Transition to `uploaded`
      6. Verify blob exists via `walrus-client.blobExists`
      7. Insert `forms` row atomically with `state = 'indexed'`; transition job to `indexed`
      8. Write `activity` row
      9. Return `CreateFormResult`
    - Exposes `orchestrateSubmissionCreate(req: CreateSubmissionRequest, actorAddress: string, db: Db): Promise<CreateSubmissionResult>`:
      - Same flow as form create but for submissions; validates `privacyMode` matches `forms.privacy_mode` (reject with `PrivacyModeMismatch` if not)
      - For private submissions: encrypt via `seal-orchestrator.encryptPayload` using form owner address and viewer permissions from `viewer_permissions` table
      - Zeroize plaintext bytes after encryption
    - Exposes `orchestrateFileCreate(req: CreateFileRequest, actorAddress: string, db: Db): Promise<CreateFileResult>`:
      - Validates submitter owns the parent submission; stores file bytes on Walrus; indexes metadata
    - On any step failure: transition job to `failed`, record `failureReason`, write audit entry, return structured error
    - MUST NOT persist payload bodies in Postgres at any point
  - _Requirements: 2.2, 2.3, 2.5, 2.7, 2.8, 3.3, 3.4, 3.5, 6.3–6.7, 7.2, 7.8, 11.2, 11.3_

  - [x] 18.1 Implement metadata-orchestrator.ts with orchestrateFormCreate, orchestrateSubmissionCreate, orchestrateFileCreate
    - Write all three orchestration functions with full state machine transitions, Seal encryption, Walrus storage, and Postgres indexing
    - _Requirements: 2.2, 2.3, 2.7, 3.3, 6.3–6.7, 7.2, 11.2_

  - [ ] 18.2 Write property test for confidentiality across upload pipeline (Property 11)
    - **Property 11: Confidentiality across the upload pipeline**
    - Generate Private_Form payloads with distinctive random substrings; run full orchestration against a captured-bytes API double; assert no substring of plaintext appears in captured API boundary bytes, Postgres rows, or log lines
    - **Validates: Requirements 2.1, 2.7, 4.6, 12.2, 12.3, 12.4, 12.6**

  - [ ] 18.3 Write property test for Walrus put precedes API post (Property 14)
    - **Property 14: Walrus put precedes API post; failed put aborts API call**
    - For generated artifact creation flows, assert Walrus PUT timestamp precedes API POST timestamp; assert if Walrus PUT fails, no Postgres INSERT occurs
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ] 18.4 Write property test for atomic validation (Property 33)
    - **Property 33: Atomic validation: invalid writes persist nothing**
    - For requests failing schema, authorization, privacy mode, or blob existence checks, assert typed error response and row count of every metadata table unchanged
    - **Validates: Requirements 7.8**

- [ ] 19. Implement Web_App upload state machine client (browser-side state tracking)
  - Create `apps/web/lib/upload/upload-state-machine.ts` that:
    - Persists `UploadJob` records to IndexedDB at every state transition (using `idb` or equivalent)
    - Exposes `createJob(artifactKind, formId, privacyMode): UploadJob`
    - Exposes `transition(jobId, to: UploadState): void` — updates IndexedDB record
    - Exposes `resume(): UploadJob[]` — on page load, reads all jobs from IndexedDB; for jobs in `uploaded` older than `ORPHAN_TIMEOUT_MS`, marks them as orphan candidates
    - Exposes `isOrphan(job: UploadJob): boolean`
    - Exposes `reconcile(job: UploadJob): Promise<void>` — retries the metadata write via `metadata-client`
    - Exposes `discard(job: UploadJob): void` — marks job `failed` locally
    - MUST NOT persist plaintext payload bytes to IndexedDB; only `blobId`, `digest`, `policyId`, `state`, and metadata
  - _Requirements: 6.1, 6.9, 6.11, 6.12, 6.13, 6.14_

  - [ ] 19.1 Implement web upload-state-machine.ts with IndexedDB persistence, resume, orphan detection, reconcile, discard
    - Write all functions with IndexedDB persistence at every transition
    - _Requirements: 6.11, 6.12, 6.13, 6.14_

  - [ ] 19.2 Write property test for upload job state persistence round-trip (Property 27)
    - **Property 27: Upload_Job state persistence round-trip**
    - For generated transition sequences, persist to IndexedDB and reload; assert state, blobId, digest, policyId equal originals; assert resume continues from persisted state
    - **Validates: Requirements 6.11**

  - [ ] 19.3 Write property test for orphan detection (Property 28)
    - **Property 28: Orphan detection after timeout**
    - For jobs in `uploaded` longer than `ORPHAN_TIMEOUT_MS`, assert `isOrphan(job) === true` and UI exposes both `reconcile` and `discard` affordances
    - **Validates: Requirements 6.10, 6.13**

- [ ] 20. Checkpoint — Upload State Machine and Orchestration complete
  - Verify `metadata-orchestrator.ts` is the only module in `apps/api` that implements upload orchestration logic
  - Verify no Postgres INSERT of payload bodies occurs anywhere in the codebase
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 4: Security Hardening

- [ ] 33. Implement key rotation strategy documentation and dual-key transition support
  - Create `docs/operations/key-rotation.md` documenting: rotation cadence, dual-key transition handling for in-flight encryptions, verification steps post-rotation
  - Update `infra-wallet.ts` to support loading a secondary (outgoing) key alongside the primary (incoming) key during rotation windows
  - _Requirements: 9.5_

- [ ] 34. Implement telemetry allow-list enforcement
  - Create `apps/web/test-support/telemetry-allow-list.test.ts`
  - Scan every `console.*` and `logger.*` call site in both `apps/api` and `apps/web` against an allow-list of permitted fields
  - Assert no call site can emit: request body, response body, JWT, ZK proof, signature, ciphertext, plaintext, Infrastructure_Wallet credentials, decryption keys, Seal session secrets
  - _Requirements: 9.4, 9.11, 12.8_

- [ ] 35. Implement trust boundary property-based pipeline test
  - Create `apps/web/lib/upload/upload-pipeline.boundary.pbt.test.ts`
  - Generate Private_Form Submission_Payloads with random distinctive plaintext substrings
  - Run the full upload pipeline against a capture proxy that records every byte sent to the API and every Postgres write
  - Assert no substring of plaintext, ZK ephemeral key material, or Seal session key appears in any captured byte sequence
  - _Requirements: 12.2, 12.3, 12.6_

  - [ ] 35.1 Property test: confidentiality pipeline (Property 11)
    - **Property 11: Confidentiality across the upload pipeline**
    - **Validates: Requirements 2.1, 2.7, 4.6, 12.2, 12.3, 12.4, 12.6**
    - Run ≥ 200 iterations per the design's PBT configuration
    - File: `apps/web/lib/upload/upload-pipeline.boundary.pbt.test.ts`

- [ ] 36. Implement public submission round-trip integration test
  - Create `apps/web/e2e/public-submission.pbt.test.ts`
  - For any Public_Form and generated Submission_Payload: after upload pipeline completes, fetch blob from Walrus via API-returned blob ID, JSON-parse, assert deep-equal to original payload
  - Use mock Walrus in CI-PR; real testnet publisher in CI-nightly
  - _Requirements: 3.6, 4.2_

  - [ ] 36.1 Property test: public submission round-trip (Property 18)
    - **Property 18: Public submission round-trip**
    - **Validates: Requirements 3.6, 4.2**
    - File: `apps/web/e2e/public-submission.pbt.test.ts`

- [ ] 37. Implement authorization-gated decryption invariant tests
  - Create `apps/api/routes/submissions.decrypt.pbt.test.ts`
  - For all generated decryption requests: assert every successful decryption is preceded by a passing authorization check and writes an Audit_Log entry; every rejected decryption returns HTTP 403 and writes an Audit_Log entry; no decryption pathway bypasses both checks
  - _Requirements: 7.3, 7.10, 12.3, 12.4, 13.6, 13.7_

  - [x] 37.1 Property tests: authorization-gated decryption (from Req 7, 12, 13 properties)
    - **Authorization precedence invariant** — API_Server invokes Seal decryption only after passing auth check — Validates: Requirements 12.3
    - **Audit invariant** — Exactly one Audit_Log entry per decryption attempt — Validates: Requirements 12.4
    - **Rejection invariant** — Unauthorized requests return HTTP 403, no Seal call issued — Validates: Requirements 12.5
    - **Managed-authority invariant** — Every Walrus/Seal operation executed by Infrastructure_Wallet after passing auth check — Validates: Requirements 13.1, 13.2
    - File: `apps/api/routes/submissions.decrypt.pbt.test.ts`

- [ ] 38. Checkpoint — Security hardening complete
  - Ensure all property tests pass, telemetry allow-list scan passes, trust boundary tests pass
  - Ask the user if questions arise before proceeding to Phase 5


- [x] 5. Checkpoint — API foundation
  - Ensure all tests pass for tasks 1–4. Run `pnpm test` in `apps/api`. Ask the user if questions arise.

- [x] 6. Audit log and authorization boundary
  - [x] 6.1 Implement `apps/api/services/audit-log.ts` — append-only audit log writer
    - Implement `writeAuditEntry(entry: AuditEntry): Promise<void>` that inserts into the `activity` table
    - `AuditEntry` fields: `requestId`, `actorAddress`, `action`, `targetKind`, `targetId`, `outcome` (`ok|denied|error`), `httpStatus`
    - MUST NOT include plaintext payload bytes, decryption keys, or Infrastructure_Wallet credentials in any entry
    - Expose `writeDecryptionAudit(...)` and `writeAuthRejectionAudit(...)` as typed helpers
    - _Requirements: 2.5, 7.4, 12.4, 14.1, 14.2, 14.3, 14.4_

  - [x] 6.2 Implement `apps/api/services/authorization.ts` — ownership and viewer-permission checks
    - Implement `assertOwner(sessionAddress: string, formId: string, db): Promise<void>` — throws `ForbiddenError` if session address ≠ form owner; writes denied audit entry on rejection
    - Implement `assertViewerOrOwner(sessionAddress: string, formId: string, db): Promise<void>` — checks ownership OR viewer_permissions table
    - If the authorization check itself fails due to a system error, treat as rejection (HTTP 403), never as pass-through
    - _Requirements: 7.3, 7.5, 12.3, 12.5, 13.6_

  - [x] 6.3 Write property tests for authorization gating (Properties 30, 12.1, 12.2, 12.3)
    - **Property 30: Authorization gating on metadata writes** — for any metadata write request whose session address differs from form owner, API returns 403, no row is written, activity row with `outcome=denied` is appended
    - **Validates: Requirements 7.4, 12.3, 12.5**
    - Test file: `apps/api/routes/auth.guard.pbt.test.ts`

  - [x] 6.4 Implement `apps/api/routes/activity.ts` — audit log query endpoint
    - `GET /activity` — returns audit log entries filtered by `actorAddress`, `formId`, and time range
    - Available only to the Form_Owner Authorization_Identity for their own forms (enforced via `assertOwner`)
    - Return typed `ApiResponse<T>` envelope
    - _Requirements: 14.5_

  - [x] 6.5 Write property tests for audit completeness (Properties from Req 14)
    - **Audit completeness invariant** — for all generated decryption operations, count of Audit_Log entries equals count of decryption attempts
    - **Attribution invariant** — for all generated successful decryption operations, Audit_Log entry references same requester address, form ID, and submission ID
    - **Rejection-audit invariant** — for all generated failed authorization attempts, Audit_Log entry exists with `outcome=denied` and HTTP status 401 or 403
    - **Validates: Requirements 14.1, 14.2, 14.6**
    - Test file: `apps/api/services/audit-log.pbt.test.ts`


---

## Phase 5: Deployment

- [ ] 39. Write production Dockerfiles
  - [ ] 39.1 Write `apps/web/Dockerfile` for Next.js production build
    - Multi-stage: build stage installs deps and runs `next build`; runtime stage copies only `.next/standalone` and static assets
    - Runtime image MUST NOT include build toolchains (node_modules, TypeScript compiler, etc.)
    - Zero baked-in secrets at build time
    - _Requirements: 10.7_

  - [ ] 39.2 Write `apps/api/Dockerfile` for Express production build
    - Multi-stage: build stage compiles TypeScript; runtime stage copies only compiled JS and production node_modules
    - Zero baked-in secrets at build time
    - Emit structured JSON logs to stdout
    - _Requirements: 10.8_

- [ ] 40. Write Docker Compose production stack
  - Create `docker-compose.prod.yml` at repo root
  - Services: `web` (512M limit), `api` (384M limit), `postgres` (512M limit), `nginx` (128M limit)
  - Total memory budget: 1.536 GB ≤ 1.6 GB target
  - All services: `restart: unless-stopped`
  - `api` depends on `postgres` with `condition: service_healthy`
  - `nginx` depends on `web` and `api`
  - Load env from `env_file: [.env.deploy]`; no secrets baked into images
  - `postgres` uses named volume `pgdata` for persistent data
  - Healthcheck for each service as specified in design
  - _Requirements: 10.1, 10.4, 10.5, 10.6, 10.9, 10.10, 15.2_

- [ ] 41. Write Nginx TLS configuration
  - Create `nginx/conf.d/swrap.conf`
  - Terminate TLS at Nginx using Let's Encrypt certificates mounted from host
  - Forward `/api/*` to `api` container over private Docker network (plain HTTP)
  - Forward `/` to `web` container over private Docker network (plain HTTP)
  - Configure HTTP → HTTPS redirect
  - _Requirements: 10.2_

- [ ] 42. Write operational runbooks
  - Create `docs/operations/infra-wallet-rotation.md`: Infrastructure_Wallet credential rotation steps
  - Create `docs/operations/audit-log-review.md`: how to query and review Audit_Log entries
  - Create `docs/operations/orphan-reconciliation.md`: Walrus blob orphan reconciliation procedure
  - Create `docs/operations/db-migration-rollback.md`: database migration rollback procedure
  - _Requirements: 15.4_

- [ ] 43. Write deployment smoke tests
  - Create `tests/smoke/compose-memory-budget.test.ts`: parse `docker-compose.prod.yml` and assert total memory limits ≤ 1.6 GB
  - Create `tests/smoke/image-audit.test.ts`: assert no image contains baked-in secrets (scan for known secret patterns in image layers)
  - Create `tests/smoke/migration-tool.test.ts`: assert `pnpm migrate up` command is registered and migration files exist
  - _Requirements: 10.4, 10.6_

- [ ] 44. Checkpoint — Deployment complete
  - Ensure Docker Compose stack starts cleanly, health checks pass, Nginx routes correctly, migrations run at deploy time
  - Ask the user if questions arise before proceeding to Phase 6


- [x] 7. Backend-orchestrated encryption and Walrus storage service
  - [x] 7.1 Implement `apps/api/services/walrus-service.ts` — server-side Walrus client
    - Implement `walrusPut(bytes: Uint8Array): Promise<{ blobId: string; sizeBytes: number }>` using `WALRUS_PUBLISHER_URL`
    - Implement `walrusGet(blobId: string): Promise<Uint8Array>` using `WALRUS_AGGREGATOR_URL` with bounded exponential backoff (default 5 attempts, `min(2^n * 100ms + jitter, 10s)`)
    - Implement `walrusExists(blobId: string): Promise<boolean>` — HEAD request for existence check before `indexed` transition
    - Retry on 5xx, 429, network errors; do not retry on 404 or integrity mismatch
    - _Requirements: 3.3, 3.4, 3.5, 3.8, 7.8_

  - [x] 7.2 Write property tests for Walrus storage (Properties 15, 16, 17)
    - **Property 15: Walrus storage round-trip** — `digest(walrusGet(walrusPut(b))) == digest(b)` and returned bytes deep-equal `b`
    - **Property 16: Walrus integrity verification rejects digest mismatches** — for any `(recordedDigest, fetchedBytes)` where SHA-256(fetchedBytes) ≠ recordedDigest, throws `IntegrityError`
    - **Property 17: Walrus fetch retry is bounded** — for N transient failures followed by success with N ≤ MAX-1, client issues exactly N+1 calls; for N ≥ MAX, issues exactly MAX calls and returns `WalrusFetchError`
    - **Validates: Requirements 3.6, 3.7, 3.8**
    - Test file: `apps/api/services/walrus-service.pbt.test.ts`

  - [x] 7.3 Implement `apps/api/services/metadata-orchestrator.ts` — single encryption orchestration module
    - Implement `orchestrateFormCreate(payload, ownerAddress, privacyMode, db): Promise<FormRow>`:
      1. Validate authorization (ownerAddress matches session)
      2. For private: call `sealEncrypt(bytes, ownerAddress)` → get `{ ciphertext, policyId, digest }`
      3. For public: compute SHA-256 digest of plaintext bytes
      4. Call `walrusPut(bytes)` → get `{ blobId, sizeBytes }`
      5. Verify `walrusExists(blobId)` before inserting
      6. Insert `forms` row with `state='indexed'` atomically
      7. Write audit entry
    - Implement `orchestrateSubmissionCreate(payload, formId, submitterAddress, db): Promise<SubmissionRow>` — same pattern, branches on form's `privacyMode`
    - Implement `orchestrateFileCreate(fileBytes, submissionId, ownerAddress, db): Promise<FileRow>`
    - Hold plaintext bytes ephemerally; release on completion or failure
    - This is the ONLY module in `apps/api` that invokes `sealEncrypt` or `walrusPut`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.7, 3.3, 3.4, 3.5, 4.3, 7.2, 11.2, 11.3, 13.2_

  - [x] 7.4 Implement `apps/api/services/decryption-service.ts` — authorization-gated decryption
    - Implement `authorizedDecrypt(submissionId, requesterAddress, db): Promise<Uint8Array>`:
      1. Look up submission row; fetch `privacyMode`, `formId`, `walrusBlobId`, `policyId`
      2. Call `assertViewerOrOwner(requesterAddress, formId, db)` — throws `ForbiddenError` on failure
      3. Write audit entry BEFORE issuing decryption call (within same transaction)
      4. Call `walrusGet(walrusBlobId)` → get ciphertext bytes
      5. Call `sealDecrypt(ciphertext, policyId)` → get plaintext
      6. Update audit entry with outcome
      7. Return plaintext bytes ephemerally; caller must not persist
    - If authorization check fails due to system error, treat as rejection (HTTP 403)
    - If audit log write fails, roll back decryption response and return 500
    - _Requirements: 2.2, 2.9, 7.3, 7.10, 12.3, 12.7, 13.6, 13.7, 14.6, 14.7_

  - [x] 7.5 Write property tests for authorization-gated decryption (Properties 11, 13, from Req 2, 7, 12, 13)
    - **Property 11: Confidentiality across the upload pipeline** — bytes captured at API boundary, in Postgres, and in any log line contain no substring of the original plaintext payload
    - **Property 13: Unauthorized decryption issues no network request** — for any (ciphertext, policyId, signer) where signer is not in policy, decryption throws before any Seal network call
    - **Authorization-gated decryption invariant** — every successful decryption is preceded by a passing authorization check and writes an Audit_Log entry; every rejected decryption returns HTTP 403 and writes an Audit_Log entry
    - **Validates: Requirements 2.2, 2.9, 7.3, 7.10, 12.3, 13.6**
    - Test file: `apps/api/services/decryption-service.pbt.test.ts`


---

## Phase 6 — API Routes: Full Endpoint Catalog

- [ ] 21. Implement API middleware stack
  - Update `apps/api/middleware/index.ts` to export and apply middleware in the correct order:
    `request-id → request-logger → cors → security-headers → rate-limit → payload-limit → auth-verify → router → error-handler`
  - Update `apps/api/middleware/cors.ts`: read `API_CORS_ORIGINS` from env (comma-separated), build strict allowlist, reject wildcards, return 403 on preflight for unlisted origins
  - Create `apps/api/middleware/security-headers.ts`: set `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
  - Create `apps/api/middleware/rate-limit.ts`: token-bucket per `(actorAddress, sourceIP)`, default 120 req/min; return `429 TooManyRequests` with `Retry-After` header on excess
  - Create `apps/api/middleware/payload-limit.ts`: `express.json({ limit: process.env.PAYLOAD_LIMIT_BYTES ?? '65536' })`; return `413 PayloadTooLarge` on excess (strict: reject even 1 byte over limit)
  - Update `apps/api/middleware/request-logger.ts`: emit one JSON line per request with `{ ts, level, event, requestId, method, path, actor, status, durationMs, outcome }`; implement `serializeFields()` allow-list that excludes request body, response body, JWTs, ZK proofs, signatures, ciphertext, plaintext, Infrastructure_Wallet credentials
  - Update `apps/api/middleware/error-handler.ts`: catch all errors, map to `ApiResponse<never>` envelope with correct `ApiErrorCode`, never leak stack traces or payload contents
  - _Requirements: 7.5, 7.6, 9.1, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12_

  - [x] 21.1 Implement and wire all middleware: cors, security-headers, rate-limit, payload-limit, request-logger, error-handler
    - Write all middleware modules and register them in the correct order in `apps/api/app.ts`
    - _Requirements: 9.6, 9.7, 9.8, 9.9, 9.10_

  - [ ] 21.2 Write property test for payload limit enforcement (Property 34)
    - **Property 34: Payload limit enforcement**
    - For generated request bodies exceeding `Payload_Limit`, assert 413; for bodies within limit, assert request proceeds to route handler
    - **Validates: Requirements 9.6**

  - [ ] 21.3 Write property test for rate limiter sliding window (Property 35)
    - **Property 35: Rate limiter sliding window**
    - For generated request rates exceeding threshold from single (address, IP), assert 429 with `Retry-After`; after window reset, assert 2xx resumes
    - **Validates: Requirements 9.7, 9.12**

  - [ ] 21.4 Write property test for CORS allow-list exactness (Property 37)
    - **Property 37: CORS allow-list is exact**
    - For origins in allow-list, assert `Access-Control-Allow-Origin` header present; for origins not in list, assert header absent and preflight returns 403
    - **Validates: Requirements 9.9**

  - [ ] 21.5 Write property test for security headers on every response (Property 38)
    - **Property 38: Security headers are present on every response**
    - For any request to any registered route, assert all four security headers present with declared values
    - **Validates: Requirements 9.8**

  - [ ] 21.6 Write property test for structured logging contains no payload bodies (Property 39)
    - **Property 39: Structured logging contains no payload bodies**
    - For requests to any registered route, assert every emitted log line contains no request body, response body, JWT, ZK proof, signature, ciphertext, or plaintext
    - **Validates: Requirements 7.6, 9.11, 12.6**

- [ ] 22. Implement forms, submissions, files, and upload-jobs routes
  - Update `apps/api/routes/forms.ts`:
    - `POST /forms`: requires `authVerify`; validates `CreateFormRequest` via Zod; calls `assertOwner`; calls `metadata-orchestrator.orchestrateFormCreate`; returns `ApiResponse<CreateFormResult>`
    - `GET /forms/:id`: public if `privacy_mode = 'public'`; requires `authVerify` + `assertViewerOrOwner` if private; fetches metadata from Postgres; fetches blob from Walrus; verifies digest; returns `ApiResponse<FormMetadata>`
    - `GET /forms`: requires `authVerify`; filters by `owner_address = req.actor.address`; supports `?state=` filter; returns `ApiResponse<FormMetadata[]>`
    - `POST /forms/:id/version`: requires `authVerify` + `assertOwner`; creates new form version with new `predecessor_id`; returns `ApiResponse<CreateFormResult>`
  - Update `apps/api/routes/submissions.ts`:
    - `POST /submissions`: requires `authVerify`; validates `CreateSubmissionRequest`; calls `assertOwner` for the referenced form; validates `privacyMode` matches `forms.privacy_mode` (return `400 PrivacyModeMismatch` if not); calls `metadata-orchestrator.orchestrateSubmissionCreate`; returns `ApiResponse<CreateSubmissionResult>`
    - `GET /submissions/:id`: requires `authVerify` + `assertViewerOrOwner`; for private submissions: calls `assertDecryptionAuthorized`, calls `seal-orchestrator.decryptPayload`, writes audit entry, returns decrypted bytes; for public: fetches from Walrus, verifies digest, returns bytes
    - `GET /submissions`: requires `authVerify`; filters by `form_id` and/or `submitter_address = req.actor.address`
  - Create `apps/api/routes/files.ts`:
    - `POST /files`: requires `authVerify`; validates `CreateFileRequest`; calls `assertOwner` for parent submission's form; calls `metadata-orchestrator.orchestrateFileCreate`
    - `GET /files/:id`: requires `authVerify` + visibility check per parent submission
  - Update `apps/api/routes/upload-jobs.ts` (or create if not exists):
    - `POST /upload-jobs/reconcile`: requires `authVerify`; idempotent reconcile of an `uploaded` orphan job; calls `walrus-client.blobExists`; upserts metadata row; transitions job to `indexed`
    - `GET /upload-jobs`: requires `authVerify`; filters by `owner_address = req.actor.address` and optional `?state=`
  - Create `apps/api/routes/audit.ts`:
    - `GET /audit`: requires `authVerify`; calls `audit-log.queryAuditLog` filtered to forms owned by `req.actor.address`; returns `ApiResponse<AuditLogRow[]>`
  - Register all routes in `apps/api/routes/index.ts`
  - _Requirements: 2.2, 2.6, 2.9, 3.7, 3.8, 4.5, 4.6, 4.8, 5.7, 5.8, 7.1, 7.2, 7.3, 7.4, 7.7, 7.8, 7.9, 12.3, 14.5_

  - [ ] 22.1 Implement forms routes (POST /forms, GET /forms/:id, GET /forms, POST /forms/:id/version)
    - Write all four handlers with Zod validation, authorization, orchestration delegation, and typed responses
    - _Requirements: 2.2, 3.7, 4.5, 7.1, 7.7_

  - [ ] 22.2 Implement submissions routes (POST /submissions, GET /submissions/:id, GET /submissions)
    - Write all three handlers; ensure `GET /submissions/:id` for private forms calls `assertDecryptionAuthorized` before `decryptPayload` and writes audit entry
    - _Requirements: 2.2, 2.6, 4.5, 4.6, 7.3, 7.9, 12.3, 14.1_

  - [ ] 22.3 Implement files routes (POST /files, GET /files/:id)
    - Write both handlers with authorization and orchestration delegation
    - _Requirements: 3.5, 7.1_

  - [ ] 22.4 Implement upload-jobs routes (POST /upload-jobs/reconcile, GET /upload-jobs)
    - Write reconcile handler with idempotent upsert and blob existence check
    - _Requirements: 6.10, 6.11, 7.1_

  - [ ] 22.5 Implement audit route (GET /audit)
    - Write audit query handler restricted to form owner
    - _Requirements: 14.5_

  - [ ] 22.6 Write property test for valid metadata write round-trip (Property from Req 7)
    - **Round-trip property between request and stored metadata** — for generated valid authenticated metadata write requests, assert 2xx response and resulting metadata row matches request
    - **Validates: Requirements 7.1, 7.8**

  - [ ] 22.7 Write property test for privacy mode mismatch rejection (Property 19)
    - **Property 19: Privacy mode mismatch is rejected**
    - For forms with recorded privacy mode M and submission requests asserting M' ≠ M, assert 400 with `code = "PrivacyModeMismatch"` and no row written
    - **Validates: Requirements 4.5**

  - [ ] 22.8 Write property test for Walrus blob existence before indexed (Property 32)
    - **Property 32: Walrus blob existence is verified before `indexed`**
    - For metadata writes referencing a blob ID not present on Walrus, assert 404 `BlobNotFound` and no row in state `indexed`
    - **Validates: Requirements 7.7**

  - [ ] 22.9 Write property test for filter queries return exactly matching rows (Property 24)
    - **Property 24: Filter queries return exactly matching rows**
    - For generated metadata rows and filter combinations over `(owner_address, form_id, state)`, assert response contains exactly matching rows and no others
    - **Validates: Requirements 5.7**

- [ ] 23. Update health check endpoint
  - Update `apps/api/routes/health.ts` to return `{ ok: true, ready: boolean, db: boolean, infraWallet: boolean, version: string }`:
    - `db`: result of a lightweight Postgres connectivity check (e.g., `SELECT 1`)
    - `infraWallet`: result of `isWalletLoaded()` from `infrastructure-wallet.ts`
    - `ready`: `db && infraWallet`
    - Liveness: always HTTP 200; readiness: HTTP 200 only when `ready = true`
  - _Requirements: 10.3_

  - [x] 23.1 Update health.ts with db connectivity check and infraWallet availability
    - Write updated health handler with all three readiness signals
    - _Requirements: 10.3_

- [x] 24. Checkpoint — Full API route catalog complete
  - Verify every route in the endpoint catalog is registered and returns `ApiResponse<T>` envelope
  - Verify `GET /submissions/:id` for private forms always calls `assertDecryptionAuthorized` before `decryptPayload`
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 6: Codebase Cleanup and Single Production Path

- [ ] 45. Record pre-cleanup lint and warning baseline
  - Run `pnpm lint` and record the warning count to `docs/migration/lint-baseline.txt`
  - Run `pnpm typecheck` and confirm current error count
  - This baseline is used to verify cleanup does not regress lint quality
  - _Requirements: 11.9_

- [ ] 46. Remove legacy POC routes and bypass-auth code paths
  - Delete all route handlers not belonging to the single production-authoritative path per concern
  - Remove all `Bypass_Auth` environment flags (`DEV_BYPASS_STORAGE`, `DEV_LOCAL_SIGNER`, `DEV_ALLOW_PLAINTEXT`) from all source files and configuration
  - Remove any `POC_Decrypt_Route` or server-side decryption handlers that predate the new `encryption-orchestrator`
  - Remove `INFRA_WALLET_PRIVATE_KEY` references from any legacy location (the new canonical location is `infra-wallet.ts`)
  - _Requirements: 9.1, 9.2, 9.3, 11.1, 11.2_

- [x] 47. Consolidate duplicate modules to single canonical paths
  - [x] 47.1 Consolidate auth: ensure `apps/web/lib/auth/auth-client.ts` is the only auth module; remove all other auth helpers and `useWallet` implementations in components
    - _Requirements: 11.5_

  - [x] 47.2 Consolidate metadata API client: ensure `apps/web/lib/api/metadata-client.ts` is the only metadata API client; remove all per-page `fetch` calls and ad-hoc API hooks
    - _Requirements: 11.6_

  - [x] 47.3 Consolidate upload orchestration: ensure `apps/api/services/metadata-orchestrator.ts` is the only upload orchestration module; remove duplicate upload routes
    - _Requirements: 11.2_

  - [x] 47.4 Consolidate encryption: ensure `apps/api/services/encryption-orchestrator.ts` is the only module invoking Seal_Service; remove any other Seal invocation sites in `apps/api`
    - _Requirements: 11.3_

- [x] 48. Write migration note file
  - Create `docs/migration/walrus-native-migration.md`
  - List every removed module path and its replacement module path (or `(none)` if deleted without replacement)
  - _Requirements: 11.8_

- [x] 49. Run static analysis verification pass
  - Run `pnpm lint` and assert zero errors and warning count ≤ baseline from task 45
  - Run `pnpm typecheck` and assert zero errors
  - Run `knip` (or equivalent dead-code tool) and assert zero unused exports, zero unreferenced React components, zero unregistered route handlers
  - Run removed-import resolver: assert no source file imports a module path that was removed during cleanup
  - Run `db/lint/forbidden-columns.sql` and assert it passes
  - _Requirements: 11.7, 11.9, 11.10, 11.11_

- [ ] 50. Final checkpoint — Cleanup complete
  - Ensure `pnpm lint` passes with zero errors, `pnpm typecheck` passes with zero errors, dead-code scan passes, all tests pass
  - Ask the user if questions arise

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but are strongly recommended for production readiness
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at phase boundaries
- Property tests validate universal correctness properties using `fast-check` (≥ 100 iterations per property; ≥ 200 for trust-boundary substring scans)
- Unit and integration tests validate specific scenarios, error conditions, and schema constraints
- **Architecture authority**: requirements.md is the authoritative source. The Infrastructure_Wallet (server-managed) owns all Seal encryption and decryption authority. ZK Login wallets and external wallets are authorization identities only.
- The migration is incremental — legacy and new flows may coexist during transition phases 1–5; Phase 6 removes all legacy paths


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["2.1", "4", "5"]
    },
    {
      "id": 1,
      "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7"]
    },
    {
      "id": 2,
      "tasks": ["2.8", "3", "5.1"]
    },
    {
      "id": 3,
      "tasks": ["7", "8.1", "8.2", "8.3", "8.4", "8.5", "8.6"]
    },
    {
      "id": 4,
      "tasks": ["7.1", "8.7", "9.1", "10", "11"]
    },
    {
      "id": 5,
      "tasks": ["9.2", "9.3", "11.1", "12", "13", "16", "17"]
    },
    {
      "id": 6,
      "tasks": ["12.1", "13.1", "14", "15.1", "15.2", "15.4", "15.5", "15.6", "16.1"]
    },
    {
      "id": 7,
      "tasks": ["14.1", "15.3", "15.7", "18", "19"]
    },
    {
      "id": 8,
      "tasks": ["18.1", "21", "22", "23", "24", "25"]
    },
    {
      "id": 9,
      "tasks": ["21.1", "23.1", "24.1", "25.1", "26", "27", "28", "29", "30", "31"]
    },
    {
      "id": 10,
      "tasks": ["29.1", "33", "34", "35", "36"]
    },
    {
      "id": 11,
      "tasks": ["35.1", "36.1", "37", "37.1"]
    },
    {
      "id": 12,
      "tasks": ["39.1", "39.2", "41", "42"]
    },
    {
      "id": 13,
      "tasks": ["40", "43"]
    },
    {
      "id": 14,
      "tasks": ["45", "46", "47.1", "47.2", "47.3", "47.4"]
    },
    {
      "id": 15,
      "tasks": ["48", "49"]
    }
  ]
}
```

- [x] 8. API routes: forms, submissions, files, upload-jobs
  - [x] 8.1 Implement `apps/api/routes/forms.ts` — production forms routes
    - `POST /forms` — create form: validate input (Zod), call `orchestrateFormCreate`, return `ApiResponse<FormRow>`
    - `GET /forms/:id` — read form metadata: public forms open, private forms require auth + owner-or-viewer
    - `GET /forms` — list/search by owner, state; requires auth
    - `POST /forms/:id/version` — create new version on privacy mode change; requires auth + owner; creates new `forms` row with `predecessor_id`
    - Enforce: `ownerAddress` in request MUST equal session address; mismatch → 403
    - _Requirements: 4.1, 4.4, 4.7, 7.1, 7.5_

  - [x] 8.2 Write property tests for privacy mode mismatch and versioning (Properties 19, 20)
    - **Property 19: Privacy mode mismatch is rejected** — for any form with recorded privacy mode M and any submission request asserting M' ≠ M, API returns 400 `PrivacyModeMismatch` and writes no row
    - **Property 20: Privacy mode change creates a new version and preserves prior submissions** — after privacy mode change, all prior submission rows remain bytewise identical, form version increments, new forms row has `predecessor_id = f.id`
    - **Validates: Requirements 4.5, 4.7**
    - Test file: `apps/api/routes/forms.version.pbt.test.ts`

  - [x] 8.3 Implement `apps/api/routes/submissions.ts` — production submissions routes
    - `POST /submissions` — create submission: validate input (Zod), verify `privacyMode` matches form's recorded mode, call `orchestrateSubmissionCreate`, return `ApiResponse<SubmissionRow>`
    - `GET /submissions/:id` — read submission metadata; auth + owner-or-submitter required
    - `GET /submissions` — list by form, submitter, state; auth required
    - `GET /submissions/:id/decrypt` — authorization-gated decryption: call `authorizedDecrypt`, return plaintext bytes; write audit entry within same transaction
    - Idempotent on `(formId, walrusBlobId)` unique constraint for reconcile retries
    - _Requirements: 2.1, 2.2, 2.6, 4.5, 7.1, 7.3_

  - [x] 8.4 Write property tests for filter queries (Property 24)
    - **Property 24: Filter queries return exactly matching rows** — for any generated set of metadata rows and any filter combination over `(owner_address, form_id, state)`, API response contains exactly the rows satisfying the filter and no others
    - **Validates: Requirements 5.9**
    - Test file: `apps/api/routes/submissions.filter.pbt.test.ts`

  - [x] 8.5 Implement `apps/api/routes/files.ts` — file attachment routes
    - `POST /files` — create file metadata under a submission; requires auth + submission owner; calls `orchestrateFileCreate`
    - `GET /files/:id` — read file metadata; auth + visibility per parent submission
    - _Requirements: 3.5, 7.1_

  - [x] 8.6 Implement `apps/api/routes/upload-jobs.ts` — upload job reconciliation routes
    - `POST /upload-jobs/reconcile` — idempotent reconcile of an `uploaded` orphan; requires auth; upserts by `(formId, walrusBlobId)`
    - `GET /upload-jobs` — list jobs by owner and state; requires auth
    - _Requirements: 6.11, 7.1_

  - [x] 8.7 Write property tests for Walrus blob existence pre-check and atomic validation (Properties 32, 33)
    - **Property 32: Walrus blob existence is verified before `indexed`** — for any metadata write referencing a `walrus_blob_id` not present on Walrus_Store, API returns 404 `BlobNotFound` and writes no row in state `indexed`
    - **Property 33: Atomic validation** — for any request that fails server-side validation, no partial row is observable in Postgres_Store
    - **Validates: Requirements 7.8, 7.9**
    - Test file: `apps/api/services/walrus-existence.pbt.test.ts` and `apps/api/routes/atomicity.pbt.test.ts`

  - [x] 8.8 Write property tests for metadata write round-trip (Property 30 extension)
    - **Round-trip property** — for all generated valid authenticated metadata write requests, API returns 2xx and the resulting metadata row matches the request
    - **Error condition property** — for all generated requests asserting an Authorization_Identity other than the verified one, API returns an authorization error
    - **Validates: Requirements 7.1, 7.5**
    - Test file: `apps/api/routes/forms.filter.pbt.test.ts`


---

## Phase 7 — Web_App: Metadata Client, Walrus Client, and UX Layer

- [ ] 25. Implement Web_App metadata API client
  - Create `apps/web/lib/api/metadata-client.ts` as the single metadata API client for the Web_App:
    - Exposes typed functions for every API endpoint: `createForm`, `getForm`, `listForms`, `createFormVersion`, `createSubmission`, `getSubmission`, `listSubmissions`, `createFile`, `getFile`, `reconcileJob`, `listJobs`, `getAuditLog`, `zkVerify`, `walletVerify`, `logout`, `getMe`
    - Every function returns `ApiResponse<T>` and throws `ApiClientError` on network failure
    - Request bodies are typed via the shared request types from `apps/api/types`
    - Reads `NEXT_PUBLIC_API_URL` for the base URL
    - Includes the session token in every authenticated request (cookie is automatic; also sets `Authorization: Bearer` header)
    - MUST NOT implement any metadata API calls outside this module (enforced by cleanup in Phase 9)
  - _Requirements: 7.1, 11.6_

  - [x] 25.1 Implement metadata-client.ts with all typed API functions
    - Write all functions with typed request/response, error handling, and session token inclusion
    - _Requirements: 7.1, 11.6_

- [ ] 26. Implement Web_App Walrus client
  - Create `apps/web/lib/walrus/walrus-client.ts`:
    - Exposes `fetchBlob(blobId: string): Promise<{ bytes: Uint8Array; digest: string }>` — GET from `NEXT_PUBLIC_WALRUS_AGGREGATOR_URL` with exponential backoff (5 attempts, same strategy as API-side)
    - Verifies `SHA-256(bytes) == recordedDigest` passed by caller; throws `IntegrityError` on mismatch
    - Throws `WalrusFetchError` after exhaustion
    - Used by the Web_App to fetch public form definitions and public submission payloads for rendering
    - Note: the Web_App does NOT upload to Walrus directly — uploads go through the API_Server
  - _Requirements: 3.8_

  - [ ] 26.1 Implement web walrus-client.ts with fetchBlob, integrity check, and retry logic
    - Write `fetchBlob`, digest verification, backoff, and error types
    - _Requirements: 3.8_

- [ ] 27. Implement UX vocabulary module and upload progress UI
  - Create `apps/web/lib/copy/ux-copy.ts`:
    - Exposes `uploadPhase(state: UploadState): string` mapping: `pending → "Preparing"`, `encrypting → "Securing"`, `uploading → "Uploading"`, `uploaded → "Saving"`, `indexed → "Saved"`, `failed → "Couldn't save — retry"`
    - Exposes `privacyLabel(mode: PrivacyMode): string` mapping: `public → "Shared"`, `private → "Private"`
    - Exposes `authEntityLabel(): string` returning `"your account"` (never "wallet" or "signer")
    - Exposes `errorPhrase(code: ApiErrorCode): string` mapping each error code to a user-facing phrase
    - This is the ONLY place internal state names cross into UI strings
  - Update upload progress components to use `ux-copy.uploadPhase(state)` exclusively — never render raw state names
  - Update privacy mode labels across all components to use `ux-copy.privacyLabel(mode)`
  - Update all references to the authenticated user to use `"your account"` language
  - Add `advancedView` toggle: persist `advancedView: boolean` in `localStorage`; when `false`, hide Walrus blob IDs, Sui tx hashes, Seal policy IDs, and raw signer addresses in all primary-flow components; when `true`, reveal them with copy affordances
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ] 27.1 Implement ux-copy.ts with all vocabulary mapping functions
    - Write `uploadPhase`, `privacyLabel`, `authEntityLabel`, `errorPhrase`
    - _Requirements: 8.2, 8.6_

  - [ ] 27.2 Update all primary-flow UI components to use ux-copy functions and hide raw chain identifiers
    - Replace all raw state name renders with `uploadPhase(state)`; replace privacy mode labels; replace wallet/signer references with "your account"; implement `advancedView` toggle
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.8_

  - [ ] 27.3 Write property test for upload phase UX mapping (Property 29)
    - **Property 29: Upload phase UX mapping**
    - For every state in `UploadState`, assert `ux-copy.uploadPhase(s)` returns the documented phrase; assert rendered progress UI for a job in state `s` displays exactly that string and no internal state name
    - **Validates: Requirements 6.9, 8.6**

  - [ ] 27.4 Write property test for primary-flow UI hides raw chain identifiers (Property 41)
    - **Property 41: Primary-flow UI does not display raw chain identifiers**
    - For any rendered primary-flow component with `advancedView = false`, assert rendered text contains no string matching Walrus blob ID format, Sui tx hash format, Seal policy ID format, or raw signer address
    - **Validates: Requirements 8.2, 8.3**

- [ ] 28. Implement form creation and submission UI flows
  - Update `apps/web/components/forms` to:
    - Require privacy mode selection (Public/Private) at form creation time before enabling submit
    - Submit form definition to `metadata-client.createForm` (not directly to Walrus)
    - Display upload progress using `ux-copy.uploadPhase` and the web upload state machine
    - Handle `PrivacyModeMismatch` error with user-facing message from `ux-copy.errorPhrase`
  - Update `apps/web/components/submissions` to:
    - Submit submission payload to `metadata-client.createSubmission` (API_Server handles encryption)
    - Display upload progress using `ux-copy.uploadPhase`
    - For private form submissions: display "Securing" phase while API encrypts
    - For viewing private submissions: call `metadata-client.getSubmission` which triggers server-side decryption; render returned plaintext
    - Remove `EncryptedSubmissionIndicator` client-side encryption references; replace with server-managed encryption status
  - _Requirements: 2.1, 4.1, 4.2, 4.3, 6.9, 6.12, 8.7_

  - [ ] 28.1 Update form creation UI to require privacy mode selection and submit via metadata-client
    - Update form creation flow to call `metadata-client.createForm` and display progress via ux-copy
    - _Requirements: 4.1, 6.9, 6.12_

  - [ ] 28.2 Update submission UI to submit via metadata-client and render server-decrypted content
    - Update submission fill and view flows; remove client-side Seal encryption references
    - _Requirements: 2.1, 4.2, 4.3, 8.7_

- [x] 29. Checkpoint — Web_App client layer complete
  - Verify `metadata-client.ts` is the only module in `apps/web` that makes API calls
  - Verify no component renders raw state names, blob IDs, or wallet addresses in primary flows
  - Ensure all tests pass, ask the user if questions arise.


- [x] 9. Checkpoint — API services and routes
  - Ensure all tests pass for tasks 6–8. Run `pnpm test` in `apps/api`. Verify no plaintext appears in any log output. Ask the user if questions arise.

- [x] 10. Upload State Machine
  - [x] 10.1 Implement `apps/web/lib/upload/upload-state-machine.ts` — client-side Upload_Job lifecycle
    - Define `UploadState = 'pending' | 'encrypting' | 'uploading' | 'uploaded' | 'indexed' | 'failed'`
    - Implement `createJob(artifactKind, formId, privacyMode): UploadJob` — initial state `pending`
    - Implement `transition(job, event): UploadJob` — enforces only declared edges; throws `InvalidTransitionError` for undeclared transitions
    - Transitions: `pending→encrypting` (private), `pending→uploading` (public), `encrypting→uploading`, `encrypting→failed`, `uploading→uploaded`, `uploading→failed`, `uploaded→indexed`, `uploaded→failed`, `failed→pending` (retry)
    - Private form upload MUST pass through `encrypting` before `uploading`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 10.2 Write property tests for state machine validity and retry idempotence (Properties 25, 26)
    - **Property 25: Upload state machine transition validity and initial state** — for any generated sequence of operations, every reached state belongs to the declared set, every transition matches a declared edge, every new job starts in `pending`
    - **Property 26: Retry from failed is idempotent** — for any failed Upload_Job and any k ≥ 1 retries from the same recovery point, final state, blob ID, and side effects equal those of exactly one retry
    - **Validates: Requirements 6.1–6.8**
    - Test file: `apps/web/lib/upload/state-machine.pbt.test.ts`

  - [x] 10.3 Implement `apps/web/lib/upload/upload-persistence.ts` — IndexedDB persistence for Upload_Jobs
    - Persist every `UploadJob` to IndexedDB at every state transition using `fake-indexeddb` in tests
    - `UploadJobRecord` schema: `{ id, artifactKind, formId, privacyMode, state, blobId, digest, sizeBytes, policyId, failureReason, createdAt, updatedAt }`
    - Plaintext payload is NEVER persisted; ciphertext handle persisted only between `encrypting` and `uploading`; dropped at `uploaded`
    - Implement `resume(): UploadJob[]` — loads all jobs from IndexedDB on page reload
    - _Requirements: 6.14_

  - [x] 10.4 Write property tests for state persistence round-trip (Property 27)
    - **Property 27: Upload_Job state persistence round-trip** — for any generated sequence of state machine transitions, persisting every transition to IndexedDB and reloading produces a state machine whose state, blob ID, digest, and policy ID equal the originals
    - **Validates: Requirements 6.14**
    - Test file: `apps/web/lib/upload/state-machine.persist.pbt.test.ts`

  - [x] 10.5 Implement orphan detection in `apps/web/lib/upload/upload-state-machine.ts`
    - Implement `isOrphan(job: UploadJob): boolean` — returns true if job is in `uploaded` for longer than `ORPHAN_TIMEOUT_MS` (default 5 minutes)
    - On `resume()`, surface orphan jobs with `reconcile` and `discard` affordances
    - `reconcile`: retry the metadata write (idempotent on `(formId, blobId)`)
    - `discard`: transition to `failed` locally
    - _Requirements: 6.13_

  - [x] 10.6 Write property tests for orphan detection (Property 28)
    - **Property 28: Orphan detection after timeout** — for any Upload_Job in state `uploaded` continuously for longer than `ORPHAN_TIMEOUT_MS`, `isOrphan(job)` is true and UI exposes both `reconcile` and `discard` affordances
    - **Validates: Requirements 6.13**
    - Test file: `apps/web/lib/upload/orphan.pbt.test.ts`

    
- [x] 11. Web_App authentication module (ZK Login + External Wallet)
  - [x] 11.1 Implement `apps/web/lib/auth/auth-client.ts` — single canonical auth module
    - Expose `signInWithGoogle(): Promise<SessionState>` — completes ZK Login ceremony: generate ephemeral Ed25519 key, compute nonce, OAuth redirect, receive JWT, request ZK proof from Sui prover, derive address, persist `{ ephemeralKey, proof, jwt }` to `sessionStorage` ONLY (never `localStorage`, never IndexedDB, never API)
    - Expose `connectWallet(): Promise<SessionState>` — external wallet connection and signature-based auth
    - Expose `logout(): Promise<void>` — clears sessionStorage, in-memory keys, invalidates server session
    - Expose `useSession(): SessionState` — React hook returning `{ status, address, signerKind, expiresAt }`
    - Expose `zeroizeEphemeral(): void` — overwrites ephemeral key bytes and drops references
    - On epoch expiry: set `status = 'expired'`, prompt re-auth before any further authorized operation
    - Web_App MUST NOT use ZK_Login_Account or External_Wallet to directly invoke Seal decryption
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 1.10, 1.11, 1.12, 11.5_

  - [x] 11.2 Write property tests for ephemeral key placement (Property 3)
    - **Property 3: ZK ephemeral key placement** — for any successful Google sign-in, ephemeral private key bytes appear in `sessionStorage` only and do not appear in `localStorage`, any IndexedDB store, any network capture between Web_App and API_Server, any Postgres dump, or any captured log line
    - **Validates: Requirements 1.2, 1.10, 12.2, 12.3, 12.4**
    - Test file: `apps/web/lib/auth/auth-client.boundary.test.ts`

  - [x] 11.3 Write property tests for authentication method switching (Property 4)
    - **Property 4: Authentication method switching preserves consistency** — for any generated sequence of `signInGoogle | connectWallet | logout` operations, after each operation the active signer matches the most recent successful operation, and no prior signer's ephemeral key, JWT, or signature material is reachable from `auth-client` exports
    - **Validates: Requirements 1.4**
    - Test file: `apps/web/lib/auth/auth-client.switch.pbt.test.ts`

  - [x] 11.4 Write property tests for epoch expiry (Property 6)
    - **Property 6: Ephemeral key expiry blocks signer operations** — for any auth session whose `maxEpoch < currentEpoch`, every operation requiring authorization returns `RequiresReauthError` before issuing any network request
    - **Validates: Requirements 1.7**
    - Test file: `apps/web/lib/auth/auth-client.epoch.pbt.test.ts`


---

## Phase 8 — Security Hardening and Legacy Detection

- [ ] 30. Implement startup legacy detector
  - Create `apps/api/legacy-detector.ts` that:
    - Walks the registered Express router and checks for routes matching `/decrypt`, `/poc-decrypt`, `/bypass`
    - Scans the on-disk module graph (using `require.resolve` or static import analysis) for exports named `bypassAuth`, `pocDecrypt`, `serverDecrypt`
    - Checks `process.env` for presence of `INFRA_WALLET_PRIVATE_KEY`, `DEV_BYPASS_STORAGE`, `DEV_LOCAL_SIGNER`, `DEV_ALLOW_PLAINTEXT`
    - If any found: log `{ event: "legacy_detected", artifacts: [...] }` at critical level and call `process.exit(1)`
    - If clean: log `{ event: "legacy_check_passed" }` at info level
  - Call `runLegacyDetector(app)` in `apps/api/index.ts` after route registration, before the server starts listening
  - _Requirements: 9.1, 9.2, 9.13_

  - [ ] 30.1 Implement legacy-detector.ts and wire into startup
    - Write router walk, module graph scan, env key check, and exit-non-zero on detection
    - _Requirements: 9.1, 9.2, 9.13_

  - [ ] 30.2 Write property test for legacy detector (Property 40)
    - **Property 40: Legacy detector triggers exit on disallowed code paths**
    - For injected legacy artifacts (route at `/decrypt`, export named `bypassAuth`, env key `DEV_BYPASS_STORAGE`), assert startup logs `legacy_detected` and exits non-zero; for clean state, assert startup proceeds
    - **Validates: Requirements 9.1, 9.2, 9.13**

- [ ] 31. Add ESLint boundary rules for authorization-validated decryption call sites
  - Add ESLint plugin `eslint-plugin-boundaries` (or equivalent) to `apps/api`
  - Configure rule: `no-direct-seal-decrypt` — forbids calling `seal-orchestrator.decryptPayload` from any file that is not `apps/api/routes/submissions.ts` or `apps/api/services/metadata-orchestrator.ts`
  - Configure rule: `no-localstorage-for-ephemeral-keys` in `apps/web` — forbids `localStorage.setItem(...)` with keys matching `/zk_eph|seal_session|private_key/i`
  - Configure rule: `no-server-import-of-seal-plaintext` — forbids `apps/api/**` from importing `apps/web/lib/seal/**` or any module that handles plaintext payloads
  - Add `telemetry-allow-list.test.ts` in `apps/api` that scans every `console.*` and `logger.*` call site against an allow-list of permitted fields; fails if any call site logs a field not in the allow-list
  - Run `pnpm lint` and fix any violations
  - _Requirements: 11.4, 12.6_

  - [ ] 31.1 Configure ESLint boundary rules and telemetry allow-list test
    - Add plugin, configure all three rules, write `telemetry-allow-list.test.ts`, fix any violations
    - _Requirements: 11.4, 12.6_

- [ ] 32. Write key rotation runbook
  - Create `docs/runbooks/infrastructure-wallet-rotation.md` documenting:
    - Rotation cadence recommendation (e.g., every 90 days or on suspected compromise)
    - Step-by-step dual-key transition: generate new keypair, deploy with both old and new keys active, re-encrypt any in-flight submissions using new key, verify new key works, remove old key
    - Verification steps post-rotation: health check `infraWallet: true`, smoke test encryption/decryption round-trip, verify audit log entries reference new key's address
    - Rollback procedure if new key fails
  - Create `docs/runbooks/audit-log-review.md` documenting how to query the audit log endpoint and interpret entries
  - Create `docs/runbooks/orphan-reconciliation.md` documenting how to identify and reconcile orphaned blobs via `POST /upload-jobs/reconcile`
  - Create `docs/runbooks/database-migration-rollback.md` documenting `pnpm migrate down` procedure and data integrity checks
  - _Requirements: 9.5, 15.4_

  - [ ] 32.1 Write all four operational runbooks
    - Write `infrastructure-wallet-rotation.md`, `audit-log-review.md`, `orphan-reconciliation.md`, `database-migration-rollback.md`
    - _Requirements: 9.5, 15.4_

- [ ] 33. Write authorization boundary architecture note
  - Create `docs/architecture/authorization-boundary.md` that:
    - Names every component (Web_App, API_Server, Postgres_Store, Walrus_Store, Seal_Service, Infrastructure_Wallet, ZK_Login_Account, External_Wallet)
    - Identifies which side of the Authorization_Boundary each component sits on
    - Describes which materials the API_Server is authorized to hold (Infrastructure_Wallet keypair, ephemeral plaintext during orchestration, Audit_Log data)
    - Describes which materials the API_Server MUST NOT hold (ZK Login ephemeral private keys, Seal session keys, raw JWT contents)
    - States the honest threat model: Infrastructure_Wallet is trusted; a compromised credential can decrypt; mitigations are authorization gating, audit logging, and secret management
  - _Requirements: 12.9, 15.5_

  - [ ] 33.1 Write authorization-boundary.md architecture note
    - Write the complete boundary document with all components, sides, authorized materials, and threat model
    - _Requirements: 12.9, 15.5_

- [x] 34. Checkpoint — Security hardening complete
  - Run `pnpm lint` with zero errors
  - Verify legacy detector exits non-zero when a test legacy route is injected
  - Verify ESLint boundary rules catch a test violation of `no-direct-seal-decrypt`
  - Ensure all tests pass, ask the user if questions arise.


- [x] 12. Web_App metadata API client and Walrus client
  - [x] 12.1 Implement `apps/web/lib/api/metadata-client.ts` — single typed API client
    - Typed wrappers for all API endpoints: `createForm`, `getForm`, `listForms`, `createFormVersion`, `createSubmission`, `getSubmission`, `listSubmissions`, `decryptSubmission`, `createFile`, `getFile`, `reconcileUploadJob`, `listUploadJobs`, `getActivity`
    - All methods return `ApiResponse<T>` and throw typed errors on non-2xx
    - Request body schemas are typed (Zod); only schema fields serialize — no accidental payload leakage
    - Attach session Bearer token to every authenticated request
    - This is the ONLY module in `apps/web` that makes API calls; no other module implements metadata API calls
    - _Requirements: 7.1, 11.6_

  - [x] 12.2 Implement `apps/web/lib/walrus/walrus-client.ts` — canonical Walrus client for Web_App
    - `walrusPut(bytes: Uint8Array): Promise<{ blobId: string; sizeBytes: number }>` — direct PUT to Walrus publisher
    - `walrusGet(blobId: string): Promise<Uint8Array>` — GET from Walrus aggregator with bounded exponential backoff (5 attempts, same strategy as server-side)
    - `verifyIntegrity(bytes: Uint8Array, recordedDigest: string): boolean` — SHA-256 comparison; throws `IntegrityError` on mismatch
    - This is the ONLY module in `apps/web` that makes direct Walrus calls
    - _Requirements: 3.8, 3.9_

  - [x] 12.3 Write property tests for Walrus round-trip and integrity (Properties 14, 15, 16, 17, 18)
    - **Property 14: Walrus put precedes API post** — for any artifact creation flow, Walrus PUT timestamp precedes API POST timestamp; if Walrus PUT fails, no API POST occurs
    - **Property 15: Walrus storage round-trip** — `digest(walrusGet(walrusPut(b))) == digest(b)`
    - **Property 16: Walrus integrity verification rejects digest mismatches** — for any `(recordedDigest, fetchedBytes)` where SHA-256(fetchedBytes) ≠ recordedDigest, throws `IntegrityError`
    - **Property 17: Walrus fetch retry is bounded** — N transient failures followed by success: exactly N+1 calls; N ≥ MAX: exactly MAX calls and `WalrusFetchError`
    - **Property 18: Public submission round-trip** — after upload pipeline completes, bytes fetched from Walrus via API-returned blob ID, when JSON-parsed, deep-equal the original submission payload
    - **Validates: Requirements 3.6, 3.7, 3.8, 4.2**
    - Test file: `apps/web/lib/walrus/walrus-client.pbt.test.ts`


---

## Phase 9 — Codebase Cleanup and Static Verification

- [ ] 35. Consolidate and remove duplicate POC modules
  - Audit the codebase for all modules that duplicate the concerns now owned by canonical modules:
    - Auth: any `useWallet` hooks, auth helpers, or sign-in flows outside `apps/web/lib/auth/auth-client.ts`
    - Seal: any `seal-poc-*` files, in-component encryption helpers, or client-side Seal invocations
    - Metadata API: any per-page `fetch` calls or ad-hoc API hooks outside `apps/web/lib/api/metadata-client.ts`
    - Upload orchestration: any duplicate upload routes or legacy POC routes outside `apps/api/routes/{forms,submissions,files,upload-jobs}.ts` and `apps/api/services/metadata-orchestrator.ts`
    - Walrus: any inline publisher fetches or POC walrus helpers outside `apps/web/lib/walrus/walrus-client.ts` and `apps/api/services/walrus-client.ts`
  - Delete all identified duplicate modules
  - Update all import sites to use the canonical modules
  - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x] 35.1 Audit and delete all duplicate auth, Seal, metadata, upload, and Walrus modules
    - Identify all duplicates, delete them, and update all import sites
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_

- [ ] 36. Write migration note file and run static verification
  - Create `docs/migration/walrus-native-migration.md` listing every removed module path and its replacement (or `(none)` if removed without replacement)
  - Record the pre-cleanup lint warning count in `docs/migration/lint-baseline.txt`
  - Install and configure `knip` (or equivalent dead-code detector) in the monorepo root
  - Run `pnpm lint` — assert zero errors and warning count ≤ baseline
  - Run `pnpm typecheck` — assert zero errors
  - Run `knip` — assert zero unused exports, zero unreferenced React components, zero unregistered route handlers
  - Add a CI step that runs `knip` and fails the build on any new dead code
  - _Requirements: 11.7, 11.8, 11.9, 11.10, 11.11_

  - [x] 36.1 Write migration note file, configure knip, and run all static verification passes
    - Write `walrus-native-migration.md`, configure knip, run lint/typecheck/knip, fix any issues
    - _Requirements: 11.7, 11.8, 11.9, 11.10, 11.11_

- [x] 37. Checkpoint — Codebase cleanup complete
  - Verify `pnpm lint` passes with zero errors
  - Verify `pnpm typecheck` passes with zero errors
  - Verify `knip` reports zero unused exports and zero unreferenced components
  - Verify migration note file exists and lists all removed modules
  - Ensure all tests pass, ask the user if questions arise.


- [x] 13. UX abstraction layer and upload progress UI
  - [x] 13.1 Implement `apps/web/lib/copy/ux-copy.ts` — UX vocabulary mapping module
    - `uploadPhase(state: UploadState): string` — maps internal state names to human-readable phases: `pending→"Preparing"`, `encrypting→"Securing"`, `uploading→"Uploading"`, `uploaded→"Saving"`, `indexed→"Saved"`, `failed→"Couldn't save — retry"`
    - `privacyModeLabel(mode: 'public' | 'private'): string` — maps to `"Shared"` / `"Private"`
    - `authEntityLabel(): string` — returns `"your account"` (never "wallet" or "signer")
    - This is the ONLY place state names cross into UI strings
    - _Requirements: 8.2, 8.6, 8.8_

  - [x] 13.2 Write property tests for UX phase mapping (Property 29)
    - **Property 29: Upload phase UX mapping** — for any state `s` in the Upload_State_Machine, `ux-copy.uploadPhase(s)` returns the documented phase string and the rendered progress UI for a job in state `s` displays exactly that string (and no internal state name)
    - **Validates: Requirements 6.12, 8.8**
    - Test file: `apps/web/lib/copy/ux-copy.pbt.test.ts`

  - [x] 13.3 Implement `apps/web/components/upload/UploadProgress.tsx` — upload progress component
    - Renders Upload_Job state using `ux-copy.uploadPhase(state)` — never renders internal state names
    - Shows retry affordance when `state === 'failed'`
    - Shows reconcile/discard affordances when `isOrphan(job)` is true
    - _Requirements: 6.12, 6.11, 8.8_

  - [x] 13.4 Implement advanced view toggle in `apps/web/lib/copy/advanced-view.ts`
    - `advancedView: boolean` persisted in `localStorage` per device (not in user metadata)
    - When off: primary flows display only UX_Vocabulary terms; blob IDs, tx hashes, policy IDs are hidden
    - When on: metadata views expose Walrus blob ID (with copy affordance), Sui tx hash, Seal policy ID, raw signer address
    - _Requirements: 8.3, 8.5_

  - [x] 13.5 Update primary-flow UI components to use UX vocabulary
    - Replace all occurrences of "wallet", "signer", "blob ID", "policy ID", "transaction hash" in primary user-visible surfaces with UX_Vocabulary terms
    - Replace privacy mode labels with `"Private"` / `"Shared"` (reserve `"Protected"` and `"Secure"` for future modes)
    - Refer to active auth entity as `"your account"` in all primary flows
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7_

  - [x] 13.6 Write property tests for no raw IDs in primary flows (Property 41)
    - **Property 41: No chain IDs in primary flows** — for any generated metadata rendered into primary-flow components with `advancedView=false`, no rendered output contains a Walrus blob ID, Sui transaction hash, Seal policy ID, or raw signer address
    - **Validates: Requirements 8.3**
    - Test file: `apps/web/components/__tests__/no-raw-ids.pbt.test.tsx`


---

## Phase 10 — VPS Deployment: Docker Compose, Nginx, and Health Checks

- [ ] 38. Write production Dockerfiles for web and api containers
  - Update `apps/api/Dockerfile`:
    - Multi-stage build: `builder` stage installs deps and compiles TypeScript; `runtime` stage copies only compiled output and `node_modules` (no build toolchain)
    - Runtime image: `node:20-alpine`
    - `CMD ["node", "dist/index.js"]`
    - No baked-in secrets; all config via env at runtime
    - Memory limit compatible with 384M budget
  - Create `apps/web/Dockerfile`:
    - Multi-stage build: `builder` stage runs `next build`; `runtime` stage copies `.next/standalone` output (Next.js standalone mode)
    - Runtime image: `node:20-alpine`
    - `CMD ["node", "server.js"]`
    - No baked-in secrets
    - Memory limit compatible with 512M budget
  - _Requirements: 10.6, 10.7_

  - [ ] 38.1 Write production Dockerfile for apps/api (multi-stage, no secrets, 384M compatible)
    - Write multi-stage Dockerfile with builder and runtime stages
    - _Requirements: 10.6, 10.7_

  - [ ] 38.2 Write production Dockerfile for apps/web (multi-stage, Next.js standalone, no secrets, 512M compatible)
    - Write multi-stage Dockerfile with Next.js standalone output
    - _Requirements: 10.6, 10.7_

- [ ] 39. Write production Docker Compose stack
  - Create `docker-compose.prod.yml` at the monorepo root with:
    - `web` service: `image: swrap/web:${TAG}`, `restart: unless-stopped`, `env_file: [.env.deploy]`, memory limit 512M, healthcheck `wget -qO- http://localhost:3000/_health`, interval 30s, timeout 5s, retries 3
    - `api` service: `image: swrap/api:${TAG}`, `restart: unless-stopped`, `env_file: [.env.deploy]`, `depends_on: { postgres: { condition: service_healthy } }`, memory limit 384M, healthcheck `wget -qO- http://localhost:4000/health?ready=1`, interval 15s, timeout 5s, retries 3
    - `postgres` service: `image: postgres:16-alpine`, `restart: unless-stopped`, `env_file: [.env.deploy]`, volume `pgdata:/var/lib/postgresql/data`, memory limit 512M, healthcheck `pg_isready -U $$POSTGRES_USER`, interval 10s, timeout 3s, retries 5
    - `nginx` service: `image: nginx:1.27-alpine`, `restart: unless-stopped`, ports `80:80` and `443:443`, volumes for `nginx/conf.d` and `/etc/letsencrypt`, memory limit 128M, `depends_on: [web, api]`
    - Named volume `pgdata`
    - Total memory budget: 512 + 384 + 512 + 128 = 1536M ≤ 1600M
  - Create `.env.deploy.example` listing all required env vars with placeholder values and comments; no actual secrets
  - _Requirements: 10.1, 10.4, 10.5, 10.6, 10.9, 10.10, 15.2_

  - [x] 39.1 Write docker-compose.prod.yml with all four services, memory limits, healthchecks, and restart policies
    - Write complete Compose file with all services, volumes, memory budgets, and health checks
    - _Requirements: 10.1, 10.4, 10.5, 10.9, 10.10_

  - [x] 39.2 Write .env.deploy.example with all required env vars documented
    - List all required vars with placeholder values and comments explaining each
    - _Requirements: 10.6_

- [ ] 40. Write Nginx configuration for TLS termination and reverse proxy
  - Create `nginx/conf.d/swrap.conf`:
    - HTTP (port 80): redirect all traffic to HTTPS
    - HTTPS (port 443): terminate TLS using Let's Encrypt certs at `/etc/letsencrypt/live/{domain}/`
    - `location /api/` → proxy to `http://api:4000/` (strip `/api` prefix or pass through depending on Express mount)
    - `location /` → proxy to `http://web:3000/`
    - Set `proxy_set_header Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`
    - TLS: `ssl_protocols TLSv1.2 TLSv1.3`; `ssl_ciphers` ECDHE-only suite; `ssl_prefer_server_ciphers on`
    - `client_max_body_size 1m` (generous for Nginx; API enforces its own payload limit)
    - Gzip compression for JSON responses
  - Create `nginx/conf.d/README.md` explaining cert renewal and Nginx reload procedure
  - _Requirements: 10.2_

  - [ ] 40.1 Write nginx/conf.d/swrap.conf with TLS termination, HTTP redirect, and reverse proxy rules
    - Write complete Nginx config with TLS, proxy rules, and security settings
    - _Requirements: 10.2_

- [ ] 41. Add `/_health` endpoint to Web_App
  - Create `apps/web/app/_health/route.ts` (Next.js App Router route handler) that returns `{ ok: true }` with HTTP 200
  - This is used by the Docker Compose healthcheck for the `web` container
  - _Requirements: 10.3_

  - [ ] 41.1 Implement /_health route in Next.js App Router
    - Write the route handler returning `{ ok: true }`
    - _Requirements: 10.3_

- [x] 42. Checkpoint — Deployment artifacts complete
  - Verify `docker-compose.prod.yml` memory budget sums to ≤ 1536M
  - Verify both Dockerfiles build successfully with `docker build`
  - Verify Nginx config is valid with `nginx -t`
  - Ensure all tests pass, ask the user if questions arise.


- [x] 14. Checkpoint — Web_App modules
  - Ensure all tests pass for tasks 10–13. Run `pnpm test` in `apps/web`. Verify no internal state names appear in rendered UI. Ask the user if questions arise.

- [x] 15. End-to-end upload pipeline wiring
  - [x] 15.1 Wire public form submission flow end-to-end
    - Web_App form fill → `metadata-client.createSubmission` (with `privacyMode='public'`) → API_Server validates auth → `orchestrateSubmissionCreate` → `walrusPut(plaintext)` → `walrusExists` check → INSERT `submissions` row `state='indexed'` → return `ApiResponse<SubmissionRow>`
    - Web_App receives response → `upload-state-machine.transition(job, 'indexed')` → persist to IndexedDB
    - _Requirements: 2.1, 3.4, 4.2, 6.4, 6.6, 6.7_

  - [x] 15.2 Wire private form submission flow end-to-end
    - Web_App form fill → `metadata-client.createSubmission` (with `privacyMode='private'`) → API_Server validates auth → `orchestrateSubmissionCreate` → `sealEncrypt(plaintext, ownerAddress)` → `walrusPut(ciphertext)` → `walrusExists` check → INSERT `submissions` row `state='indexed'` → return `ApiResponse<SubmissionRow>`
    - Upload_Job transitions: `pending→encrypting→uploading→uploaded→indexed`
    - Plaintext bytes released after encryption; ciphertext handle dropped after `uploaded`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 4.3, 6.3, 6.5, 6.6, 6.7_

  - [x] 15.3 Wire form creation flow end-to-end
    - Web_App form builder → privacy mode selection (Public/Private) → `metadata-client.createForm` → API_Server `orchestrateFormCreate` → Walrus PUT → metadata INSERT → return `ApiResponse<FormRow>`
    - _Requirements: 4.1, 4.4, 3.3_

  - [x] 15.4 Wire decryption retrieval flow end-to-end
    - Web_App opens submission → `metadata-client.decryptSubmission(submissionId)` → API_Server `authorizedDecrypt` → authorization check → audit log write → `walrusGet(blobId)` → `sealDecrypt(ciphertext)` → return plaintext bytes → Web_App renders
    - For public submissions: `metadata-client.getSubmission` → `walrusGet(blobId)` → `verifyIntegrity` → JSON.parse → render
    - _Requirements: 2.2, 3.8, 3.9, 7.3, 12.3, 14.1_

  - [x] 15.5 Write property tests for confidentiality pipeline (Property 11)
    - **Property 11: Confidentiality across the upload pipeline** — for any generated Private_Form Submission_Payload `p` (with sufficiently long random distinctive substring), bytes captured at API_Server boundary, bytes persisted in Postgres_Store, and bytes captured in any log line during the upload pipeline contain no substring of `p` and no bytes of any Seal session key or ZK Login ephemeral private key
    - **Validates: Requirements 2.1, 2.7, 4.6, 12.2, 12.3, 12.4, 12.6**
    - Test file: `apps/web/lib/upload/upload-pipeline.boundary.pbt.test.ts`

  - [x] 15.6 Write property tests for active signer binding (Properties 5)
    - **Property 5: Active signer is the Form_Owner** — for any authenticated session with active signer `s`, every newly created form's `ownerAddress` equals `s.address`
    - **Validates: Requirements 1.5, 1.6**
    - Test file: `apps/web/lib/api/metadata-client.owner.pbt.test.ts`


---

## Phase 11 — Integration Wiring and Final Verification

- [ ] 43. Wire all components together in apps/api/index.ts and apps/api/app.ts
  - `apps/api/index.ts` startup sequence (in order):
    1. `validateEnv()` — fail fast on misconfiguration
    2. `getInfrastructureWallet()` — fail fast on missing credentials
    3. Initialize Postgres connection pool
    4. `runLegacyDetector(app)` — fail fast on legacy artifacts
    5. Apply middleware stack
    6. Register all routes
    7. Start listening
  - `apps/api/app.ts`: export the configured Express app (for testing without starting the server)
  - Verify `apps/api/server.ts` and `apps/api/server-config.ts` are updated or removed as appropriate
  - _Requirements: 9.3, 9.8, 9.13, 11.1_

  - [ ] 43.1 Update apps/api/index.ts with correct startup sequence and all wiring
    - Write the complete startup sequence with all five steps in order
    - _Requirements: 9.3, 9.8, 9.13_

- [ ] 44. Wire Web_App pages to use canonical modules
  - Audit all Next.js pages and components in `apps/web`:
    - Replace any direct `fetch` calls with `metadata-client` functions
    - Replace any auth logic with `auth-client` hooks
    - Replace any upload logic with the web `upload-state-machine`
    - Replace any Walrus fetch calls with `walrus-client.fetchBlob`
    - Replace any privacy mode labels with `ux-copy.privacyLabel`
    - Replace any upload state displays with `ux-copy.uploadPhase`
  - Verify the `PocHeader`, `PocSidebar` layout components are updated or removed if they reference POC-era concepts
  - _Requirements: 11.1, 11.5, 11.6_

  - [ ] 44.1 Audit and update all Web_App pages and components to use canonical modules
    - Replace all direct fetch calls, auth logic, upload logic, and Walrus calls with canonical module imports
    - _Requirements: 11.1, 11.5, 11.6_

- [ ] 45. Run full static analysis and fix all issues
  - Run `pnpm typecheck` — fix all TypeScript errors
  - Run `pnpm lint` — fix all ESLint errors; verify warning count ≤ baseline
  - Run `knip` — fix all unused exports and unreferenced components
  - Run the telemetry allow-list test — fix any call sites logging disallowed fields
  - Verify the legacy detector passes on the clean codebase
  - _Requirements: 11.4, 11.7, 11.9, 11.10_

  - [ ] 45.1 Run all static analysis tools and fix every reported issue
    - Run typecheck, lint, knip, telemetry allow-list test, and legacy detector; fix all issues
    - _Requirements: 11.4, 11.7, 11.9, 11.10_

- [x] 46. Final checkpoint — All tests pass, system is deployable
  - Run the full test suite: `pnpm test --run`
  - Verify all property-based tests pass
  - Verify `pnpm typecheck` passes with zero errors
  - Verify `pnpm lint` passes with zero errors
  - Verify `knip` reports zero dead code
  - Verify `docker-compose.prod.yml` is valid
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but are strongly recommended for production correctness guarantees
- Each task references specific requirements for traceability
- Checkpoints ensure the system remains deployable after each phase
- Property tests validate universal correctness properties across generated input spaces
- The architecture invariant is enforced at three levels: static (ESLint rules), runtime (legacy detector, authorization service), and test (property-based tests)
- The design.md's client-side Seal encryption module, browser-only Trust Boundary, and "backend cannot decrypt" invariants are superseded by requirements.md; no tasks implement client-side Seal encryption or browser-owned decryption
- Infrastructure_Wallet credentials must never appear in source-controlled files, logs, or container images


- [ ] 16. Security hardening and legacy removal
  - [x] 16.1 Implement `apps/api/middleware/legacy-detector.ts` — startup legacy detection
    - Walk the registered Express router and on-disk module graph for: paths matching `/decrypt`, `/poc-decrypt`, `/bypass`; imports of `INFRA_WALLET_PRIVATE_KEY`; exports named `bypassAuth`, `pocDecrypt`, `serverDecrypt`
    - If any found: log `{ event: "legacy_detected" }` and `process.exit(1)`
    - Run at startup before any route is registered
    - _Requirements: 9.1, 9.2, 9.13_

  - [ ] 16.2 Write property tests for legacy detector (Property 40)
    - **Property 40: Legacy detector** — for any generated synthetic legacy artifact (forbidden route path, forbidden export name, forbidden env var), the legacy detector identifies it and exits non-zero; for any generated clean module graph, the detector passes
    - **Validates: Requirements 9.1, 9.2, 9.13**
    - Test file: `apps/api/legacy-detector.pbt.test.ts`

  - [ ] 16.3 Remove all Bypass_Auth code paths from `apps/api`
    - Delete or neutralize: `DEV_BYPASS_STORAGE`, `DEV_LOCAL_SIGNER`, `DEV_ALLOW_PLAINTEXT` env flags and all code branches that read them
    - Remove `detectLocalSigner` usage from API routes (it was the POC signer; replaced by Infrastructure_Wallet)
    - Remove `anchorMetadata` / `SUI_POC_PACKAGE_ID` calls from API routes (POC on-chain anchoring; replaced by Walrus + Postgres)
    - _Requirements: 9.1, 9.2_

  - [ ] 16.4 Remove Legacy_POC_Routes from `apps/api`
    - Remove or replace `apps/api/forms.ts` and `apps/api/submissions.ts` POC handlers (the Next.js-style handlers that do client-side decrypt/encrypt)
    - Remove any route registrations for `/api/poc/*`
    - Ensure `apps/api/routes/forms.ts` and `apps/api/routes/submissions.ts` (from tasks 8.1, 8.3) are the sole handlers
    - _Requirements: 9.2, 11.2_

  - [ ] 16.5 Document key rotation strategy for Infrastructure_Wallet credentials
    - Create `docs/operations/key-rotation.md` documenting: rotation cadence, dual-key transition handling for in-flight encryptions, verification steps post-rotation
    - _Requirements: 9.5_


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "2.1", "3.1"]
    },
    {
      "id": 1,
      "tasks": ["1.2", "2.2", "3.2", "5.1"]
    },
    {
      "id": 2,
      "tasks": ["6.1", "7.1", "9.1", "9.2", "10.1"]
    },
    {
      "id": 3,
      "tasks": ["6.2", "6.3", "7.2", "9.3", "10.2", "14.1", "15.1"]
    },
    {
      "id": 4,
      "tasks": ["11.1", "14.2", "15.2", "15.3", "17.1"]
    },
    {
      "id": 5,
      "tasks": ["12.1", "17.2", "17.3", "18.1"]
    },
    {
      "id": 6,
      "tasks": ["12.2", "12.3", "18.2", "18.3", "18.4", "19.1"]
    },
    {
      "id": 7,
      "tasks": ["19.2", "19.3", "21.1", "25.1", "26.1", "27.1"]
    },
    {
      "id": 8,
      "tasks": ["21.2", "21.3", "21.4", "21.5", "21.6", "22.1", "22.5", "27.2"]
    },
    {
      "id": 9,
      "tasks": ["22.2", "22.3", "22.4", "22.6", "22.7", "22.8", "22.9", "27.3", "27.4", "28.1"]
    },
    {
      "id": 10,
      "tasks": ["23.1", "28.2", "30.1", "31.1"]
    },
    {
      "id": 11,
      "tasks": ["30.2", "32.1", "33.1", "35.1"]
    },
    {
      "id": 12,
      "tasks": ["36.1", "38.1", "38.2"]
    },
    {
      "id": 13,
      "tasks": ["39.1", "39.2", "40.1", "41.1"]
    },
    {
      "id": 14,
      "tasks": ["43.1", "44.1"]
    },
    {
      "id": 15,
      "tasks": ["45.1"]
    }
  ]
}
```

- [ ] 17. Codebase cleanup and single production path enforcement
  - [ ] 17.1 Consolidate duplicate auth helpers into `apps/web/lib/auth/auth-client.ts`
    - Remove all other auth helpers and `useWallet` implementations in components that bypass `auth-client`
    - Every component that needs auth state imports from `auth-client` only
    - _Requirements: 11.1, 11.5_

  - [ ] 17.2 Consolidate duplicate Walrus helpers into `apps/web/lib/walrus/walrus-client.ts`
    - Remove inline publisher fetches in `apps/web/components/walrus/*` and any POC walrus helpers
    - _Requirements: 11.1_

  - [ ] 17.3 Consolidate duplicate metadata API calls into `apps/web/lib/api/metadata-client.ts`
    - Remove per-page `fetch` calls and ad-hoc API hooks; all metadata calls go through `metadata-client`
    - _Requirements: 11.1, 11.6_

  - [ ] 17.4 Write `docs/migration/walrus-native-migration.md` — migration note file
    - List every removed module path and its replacement path (or `(none)` if deleted without replacement)
    - Include entries for: POC forms/submissions handlers, `detectLocalSigner`, `anchorMetadata`, `DEV_*` env flags, any duplicate Seal/Walrus/auth helpers
    - _Requirements: 11.8_

  - [ ] 17.5 Run static analysis and enforce single-module-per-concern
    - Run `pnpm lint` — must pass with zero errors and warning count ≤ pre-cleanup baseline (record baseline in `docs/migration/lint-baseline.txt`)
    - Run `pnpm typecheck` — must pass with zero errors
    - Run `knip` (or equivalent dead-code tool) — must report zero unused exports, zero unreferenced React components, zero unregistered route handlers
    - Run AST module-count checks: exactly one auth module, one Seal authority module, one metadata client, one upload handler
    - _Requirements: 11.7, 11.9, 11.10_

  - [ ] 17.6 Write `docs/architecture/authorization-boundary.md` — authorization boundary architecture note
    - Name every component, identify which side of the boundary it sits on, describe which materials the API_Server is authorized to hold
    - _Requirements: 12.9_


- [ ] 18. Checkpoint — hardening and cleanup
  - Ensure all tests pass. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` across the monorepo. Verify legacy detector exits non-zero when injected with a synthetic legacy artifact. Ask the user if questions arise.

- [ ] 19. Health check and VPS deployment
  - [ ] 19.1 Implement production `GET /health` endpoint in `apps/api/routes/health.ts`
    - Return `{ ok: true, ready: boolean, db: boolean, version: string }` — liveness is HTTP 200; readiness requires `db: true` and Infrastructure_Wallet credential availability
    - Check DB connectivity by issuing a lightweight query (`SELECT 1`)
    - Check Infrastructure_Wallet availability by calling `getInfrastructureWallet()` without logging credentials
    - _Requirements: 10.3_

  - [ ] 19.2 Write `apps/api/Dockerfile` — production API container image
    - Multi-stage build: build stage compiles TypeScript; runtime stage copies only compiled output and `node_modules` (no `tsc`, `webpack`, or dev dependencies in runtime layer)
    - Zero baked-in secrets at build time (no `COPY .env*` in Dockerfile)
    - Emit structured JSON logs to stdout
    - _Requirements: 10.7, 10.8, 10.6_

  - [ ] 19.3 Write `apps/web/Dockerfile` — production Web_App container image
    - Multi-stage build: build stage runs `next build`; runtime stage serves only static and server-rendered output
    - No build toolchains in runtime image
    - _Requirements: 10.7_

  - [ ] 19.4 Write `docker-compose.yml` at repo root — production Docker Compose stack
    - Services: `web` (512M limit), `api` (384M limit), `postgres` (512M limit), `nginx` (128M limit) — total ≤ 1.536 GB
    - All services: `restart: unless-stopped`
    - `postgres` service: named volume `pgdata` for persistent data; `healthcheck` using `pg_isready`
    - `api` service: `depends_on: { postgres: { condition: service_healthy } }`
    - Load env from `.env.deploy` (deploy-managed, not committed); zero baked-in secrets
    - _Requirements: 10.1, 10.4, 10.5, 10.6, 10.10_

  - [ ] 19.5 Write `nginx/conf.d/swrap.conf` — Nginx reverse proxy configuration
    - TLS termination at Nginx; forward `/` to `web` container, `/api/*` to `api` container over private Docker network
    - Mount Let's Encrypt certificates from host volume
    - _Requirements: 10.2_

  - [ ] 19.6 Write smoke tests for Docker Compose configuration
    - `infra/compose-audit.test.ts`: parse `docker-compose.yml`, sum declared memory limits (assert ≤ 1.6 GB), assert `restart: unless-stopped` on every service, assert named volume `pgdata` is declared
    - `infra/image-audit.test.ts`: assert runtime web image contains no build toolchains
    - `db/migrations/__tests__/presence.test.ts`: assert at least one migration file exists, each has an `up` SQL block, migration tool is configured
    - _Requirements: 10.4, 10.5, 10.10_

  - [ ] 19.7 Write operational runbooks
    - `docs/operations/key-rotation.md` — Infrastructure_Wallet credential rotation (already started in 16.5; finalize)
    - `docs/operations/audit-log-review.md` — how to query and review the Audit_Log
    - `docs/operations/orphan-reconciliation.md` — Walrus blob orphan reconciliation procedure
    - `docs/operations/db-migration-rollback.md` — database migration rollback procedure
    - _Requirements: 15.4_

- [ ] 20. Final checkpoint — full test suite
  - Run `pnpm test` across the entire monorepo. Run `pnpm lint` and `pnpm typecheck`. Verify all 41 correctness properties have at least one tagged PBT test. Verify Docker Compose memory budget ≤ 1.6 GB. Ask the user if questions arise.


---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but every correctness property in the design document has a corresponding `*` sub-task — skipping them means the property is unverified
- The architecture note in `requirements.md` takes precedence over `design.md` wherever they conflict: Seal encryption/decryption authority is owned by the Infrastructure_Wallet on the API_Server; ZK Login and external wallets are Authorization Identities only
- Migration is incremental — each task leaves `main` deployable; legacy POC flows coexist until task 16 removes them
- The `*` sub-tasks for property-based tests use `fast-check` (already present in the codebase: see `apps/api/forms.pbt.test.ts`)
- Every PBT test file MUST carry a comment of the form: `// Feature: walrus-native-zk-login-architecture, Property N: <title>`
- Shared test generators live in `apps/web/test-support/generators.ts` (create this file in task 10.1 or 11.1 as a prerequisite for PBT tasks)
- The `INFRASTRUCTURE_WALLET_SECRET` env var is the only permitted way to load the Infrastructure_Wallet; it must never appear in source-controlled files or log output
- HTTP 403 is reserved exclusively for authorization rejections; use 400 for malformed requests, 404 for missing records, 500 for server errors (Requirement 13.8)

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.3"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "2.4", "3.1", "3.2"] },
    { "id": 3, "tasks": ["3.3", "4.1", "4.3", "4.4", "4.6", "4.8"] },
    { "id": 4, "tasks": ["3.4", "3.5", "4.2", "4.5", "4.7", "4.9", "4.10", "4.11"] },
    { "id": 5, "tasks": ["4.12", "4.13", "6.1", "6.2"] },
    { "id": 6, "tasks": ["4.3", "6.3", "6.4", "6.5", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3"] },
    { "id": 8, "tasks": ["7.4", "7.5", "8.1", "8.3", "8.5", "8.6"] },
    { "id": 9, "tasks": ["8.2", "8.4", "8.7", "8.8", "10.1"] },
    { "id": 10, "tasks": ["10.2", "10.3", "11.1", "12.1", "12.2"] },
    { "id": 11, "tasks": ["10.4", "10.5", "11.2", "11.3", "11.4", "12.3", "13.1"] },
    { "id": 12, "tasks": ["10.6", "13.2", "13.3", "13.4", "13.5"] },
    { "id": 13, "tasks": ["13.6", "15.1", "15.2", "15.3"] },
    { "id": 14, "tasks": ["15.4", "15.5", "15.6", "16.1", "16.3", "16.4"] },
    { "id": 15, "tasks": ["16.2", "16.5", "17.1", "17.2", "17.3"] },
    { "id": 16, "tasks": ["17.4", "17.5", "17.6"] },
    { "id": 17, "tasks": ["19.1", "19.2", "19.3"] },
    { "id": 18, "tasks": ["19.4", "19.5", "19.6"] },
    { "id": 19, "tasks": ["19.7"] }
  ]
}
```
