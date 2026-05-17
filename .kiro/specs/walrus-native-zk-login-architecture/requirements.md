# Requirements Document

## Introduction

This feature evolves Swrap into a **managed encrypted SaaS platform** powered by Walrus and programmable access control, with Web2-grade UX and invisible Web3. Form schemas, submission payloads, uploaded files, and encrypted records become canonical data on Walrus; PostgreSQL holds only metadata, indexes, query acceleration data, and audit records. Users authenticate primarily through Google + Sui ZK Login (an invisible wallet) and optionally through external Sui wallets; in both cases the user wallet is an **authorization identity only** — it is used for ownership mapping, viewer permissions, authorization checks, sharing, and audit attribution.

Seal encryption authority and decryption authority are owned by an **Infrastructure_Wallet** held by the Backend. The Backend coordinates Seal encryption and Walrus storage on behalf of authenticated users after authorization checks pass, and it performs decryption operations only after authorization checks succeed; every decryption operation is logged and audited. ZK Login wallets and external wallets do **not** own encryption keys and do **not** directly perform Seal decryption. This is the **Managed Encryption Authority** architecture.

The system also covers an upload state machine with progress and retries, a UX layer that hides Web3 vocabulary behind Private/Protected/Shared/Secure, security hardening (removing bypass auth, removing legacy POC routes, and managing the Infrastructure_Wallet credentials through a secure deploy-managed configuration), VPS deployment on a 2 GB DigitalOcean Ubuntu host with Docker Compose, and a codebase cleanup that consolidates duplicate POC flows into a single production-authoritative path per concern.

### Threat Model (Honest Statement)

This system is described as **"managed encrypted infrastructure with authorization-controlled access"** — it is **NOT** "trustless encryption" and not "fully trustless decentralized storage". Concretely:

- The Infrastructure_Wallet is trusted to hold Seal authority and to enforce authorization correctly.
- A compromised Infrastructure_Wallet credential or compromised Backend can decrypt encrypted records.
- Users trust the Backend to apply the documented authorization rules (ownership, viewer permissions) before decrypting.
- Walrus remains canonical storage for content; PostgreSQL is metadata, indexing, query acceleration, and activity tracking only.

Mitigations: secrets are loaded from secure deploy-managed configuration, every decrypt is authorization-gated and audit-logged, infrastructure credentials are never logged, and the API surface is minimized to a single production-authoritative path per concern. The architecture prioritizes operational simplicity, deployment reliability, and maintainability over premature decentralization complexity.

The migration is incremental and must not require a full rewrite. The Express API (`apps/api`) and the Next.js frontend (`apps/web`) coexist throughout the transition.

## Glossary

- **Swrap**: The application being built, consisting of `apps/web` (Next.js) and `apps/api` (Express) inside a monorepo.
- **Web_App**: The Next.js frontend in `apps/web`. The orchestration UI: it captures form definitions and submission payloads, submits them to the API_Server, and renders results returned by the API_Server. The Web_App does not hold Seal encryption or decryption authority.
- **API_Server**: The Express service in `apps/api`. It is the encryption + authorization + indexing + audit-logging service. It holds the Infrastructure_Wallet credentials, orchestrates Seal encryption and Walrus storage, performs authorization checks, executes decryption only after authorization succeeds, and records audit entries.
- **Postgres_Store**: The PostgreSQL database used by the API_Server. Functions only as the metadata layer, indexing layer, query acceleration layer, and activity/audit tracking layer. It does not store canonical content bodies, ciphertext bodies, or file bytes.
- **Walrus_Store**: The Walrus decentralized storage network. Canonical source of truth for Form schemas, Submission payloads (plaintext or encrypted), uploaded files, and encrypted records.
- **Walrus_Blob**: An immutable object stored on Walrus_Store, identified by a Walrus blob identifier.
- **Seal_Service**: The Seal encryption library and policy network used to encrypt and decrypt records under a defined access policy.
- **Infrastructure_Wallet**: A server-managed Sui keypair held by the API_Server. Owns Seal encryption authority and Seal decryption authority for encrypted Forms and Submissions, and executes Walrus and Seal operations on behalf of authenticated users after authorization checks succeed. Loaded from secure deploy-managed configuration only and never logged.
- **Managed_Encryption_Authority**: The architectural property that Seal encryption and decryption authority are centralized under the Infrastructure_Wallet, with all decryption operations gated by Backend-enforced authorization checks against ownership and viewer permission rules and recorded in the Audit_Log.
- **Authorization_Identity**: A user-facing Sui address (a ZK_Login_Account or an External_Wallet) used for ownership mapping, viewer permissions, authorization checks, sharing permissions, and audit attribution. An Authorization_Identity does not own encryption keys and does not directly perform Seal decryption.
- **ZK_Login_Account**: A Sui address derived from Google OAuth via Sui ZK Login, used as the user's invisible Authorization_Identity.
- **External_Wallet**: A user-controlled Sui wallet (for example a browser extension wallet) used as an Authorization_Identity in advanced mode.
- **Form_Owner**: The Authorization_Identity address that created a Form_Definition; recorded as the owner in metadata and used for ownership checks.
- **Viewer_Permission**: A grant in metadata that authorizes an Authorization_Identity (other than the Form_Owner) to view a specific form or submission, used during decryption authorization.
- **Form_Definition**: A JSON document describing a form's schema, fields, and privacy mode, stored as a Walrus_Blob.
- **Submission_Payload**: The JSON document containing user-submitted answers for a Form_Definition.
- **Public_Form**: A Form_Definition whose Submission_Payload is stored as plaintext JSON on Walrus_Store.
- **Private_Form**: A Form_Definition whose Submission_Payload is encrypted by the API_Server using the Infrastructure_Wallet via Seal_Service and stored as ciphertext on Walrus_Store.
- **Submission_Record**: A Postgres_Store row that indexes a single submission by Walrus blob identifier, owner, form identifier, privacy mode, and upload state.
- **Upload_Job**: A unit of work that moves a single payload through the Upload_State_Machine, coordinated by the API_Server with progress reflected to the Web_App.
- **Upload_State_Machine**: The state model with states `pending`, `encrypting`, `uploading`, `uploaded`, `indexed`, and `failed`.
- **Authorization_Boundary**: The runtime boundary at which the API_Server enforces ownership and viewer-permission checks before invoking Seal decryption or returning canonical content. Trust is rooted in authenticated Authorization_Identities and the Infrastructure_Wallet's controlled execution.
- **Audit_Log**: An append-only record stored in Postgres_Store that captures, for every decryption operation: requester Authorization_Identity, timestamp, form identifier, submission identifier, authorization result, and outcome. Also captures failed authorization attempts.
- **UX_Vocabulary**: The user-facing terminology set `Private`, `Protected`, `Shared`, `Secure`, used in place of blob ID, transaction hash, policy ID, and signer.
- **Bypass_Auth**: Any code path or environment flag that allows requests to skip authentication or authorization checks. Forbidden in production builds.
- **Legacy_POC_Route**: Any legacy proof-of-concept endpoint or duplicate flow retained from earlier iterations that does not belong to the single production-authoritative path for its concern.
- **Env_Validator**: The startup module that validates required environment variables and fails fast on misconfiguration.
- **Rate_Limiter**: The middleware that bounds request rates per identity and per IP on the API_Server.
- **Payload_Limit**: The maximum accepted size for a single request body or upload to the API_Server.
- **Health_Check**: An HTTP endpoint exposed by the API_Server reporting liveness and readiness for orchestration tools.
- **VPS_Host**: The DigitalOcean Ubuntu droplet (2 GB RAM target) that runs Swrap via Docker Compose behind Nginx.
- **Property_Test**: An automated test that asserts a correctness property over a generated input space.

## Requirements

### Requirement 1: ZK Login Authorization Identity

**User Story:** As a Swrap user, I want to sign in with my Google account and have a persistent Sui ZK Login identity, so that the system can map ownership, permissions, sharing, and audit attribution to me without exposing wallet complexity.

#### Acceptance Criteria

1. THE Web_App SHALL provide a Google sign-in entry point that completes a Sui ZK Login ceremony and yields a ZK_Login_Account.
2. THE System SHALL create or restore a persistent Sui ZK Login identity for each authenticated Google user across sessions.
3. THE Web_App SHALL also provide an External_Wallet connection entry point alongside Google sign-in.
4. WHERE both authentication methods are configured, THE Web_App SHALL allow each method to coexist without forcing the user to choose one for the entire account lifetime.
5. THE ZK Login identity SHALL be used for ownership mapping, viewer permissions, authorization checks, sharing permissions, and audit attribution.
6. THE Web_App SHALL treat the active ZK_Login_Account or External_Wallet address as the Form_Owner Authorization_Identity for newly created forms and submissions.
7. WHEN the ZK_Login_Account session material expires, THE Web_App SHALL prompt the user to re-authenticate before issuing further authorization-required operations.
8. IF a Google sign-in attempt fails or is cancelled, THEN THE Web_App SHALL display an actionable error and SHALL NOT create a partial ZK_Login_Account record.
9. THE API_Server SHALL verify ZK Login proofs server-side before accepting any authenticated request that asserts a ZK_Login_Account address.
10. THE API_Server SHALL NOT store ZK Login ephemeral private key material at any time.
11. WHERE ZK Login ephemeral private key material is required for client-side authentication operations, THE Web_App MAY store it in browser-only storage scoped to the active session, while the API_Server prohibition in clause 10 remains in effect.
12. THE Web_App SHALL NOT use the ZK_Login_Account or any External_Wallet to directly invoke Seal_Service decryption operations.

**Correctness properties for property-based testing**

- For all valid ZK Login proofs over generated nonces and Google identity tokens, the API_Server's verification function returns `valid` and exposes the same Sui address as the client-derived ZK_Login_Account (round-trip property between client derivation and server verification).
- For all tampered proofs (single-bit mutations of a valid proof), the API_Server's verification function returns `invalid` (error condition property).
- For all generated authentication flows, the resulting Authorization_Identity is recorded as the owner Authorization_Identity for any Form_Definition or Submission_Payload created during that flow (attribution invariant).

### Requirement 2: Backend-Orchestrated Encryption

**User Story:** As a form owner, I want my private form submissions to be encrypted under a managed encryption authority and stored on Walrus, so that only authorized viewers can decrypt while the system retains operational reliability and auditability.

#### Acceptance Criteria

1. WHEN a Submission_Payload is created against a Private_Form, THE Web_App SHALL submit the payload to the API_Server through the orchestration API rather than performing client-side Seal encryption.
2. WHEN the API_Server receives a Private_Form Submission_Payload, THE API_Server SHALL validate request authorization against the asserted Authorization_Identity before invoking Seal_Service.
3. WHEN authorization for a Private_Form Submission_Payload succeeds, THE API_Server SHALL encrypt the canonical payload via Seal_Service using the Infrastructure_Wallet under a Seal policy that authorizes the Form_Owner Authorization_Identity and recorded Viewer_Permissions.
4. WHEN encryption of a Private_Form Submission_Payload completes, THE API_Server SHALL produce a ciphertext blob, a Seal policy reference, and an integrity digest over the ciphertext bytes.
5. WHEN encryption completes, THE API_Server SHALL upload the ciphertext to Walrus_Store using the Infrastructure_Wallet and SHALL record an Audit_Log entry attributing the operation to the requesting Authorization_Identity.
6. WHEN the API_Server returns a response to the Web_App for a Private_Form submission, THE API_Server SHALL include only non-sensitive metadata (Walrus blob identifier, integrity digest, privacy mode, state) and SHALL NOT include plaintext payload bodies, decryption keys, or Seal session secrets.
7. WHEN the API_Server holds plaintext Submission_Payload bytes during orchestration, THE API_Server SHALL hold them ephemerally for the duration of the encryption operation and SHALL release plaintext memory references upon completion or failure.
8. IF Seal encryption fails for a Submission_Payload, THEN THE API_Server SHALL transition the corresponding Upload_Job to `failed`, SHALL NOT upload any ciphertext bytes for that submission, SHALL record an Audit_Log entry, and SHALL surface a structured error response to the Web_App.
9. IF an unauthenticated or unauthorized request attempts to encrypt or store a Submission_Payload for a Form_Definition, THEN THE API_Server SHALL reject the request with HTTP 403 and SHALL record a failed-authorization Audit_Log entry.

**Correctness properties for property-based testing**

- For all generated plaintext payloads `p` and all generated authorized Authorization_Identity addresses `a`, `seal_decrypt(seal_encrypt(p, policy_for(a)), Infrastructure_Wallet) == p` after a passing authorization check that includes `a` (round-trip property under managed authority).
- For all generated plaintext payloads `p` and all generated unauthorized Authorization_Identity addresses `a'` not in `policy_for(a)`, the API_Server rejects the decryption request with HTTP 403 and records an Audit_Log entry; no Seal_Service decryption call is issued (authorization-gated decryption invariant).
- For all generated successful encryption flows, every encryption operation is preceded by a passing authorization check and produces an Audit_Log entry referencing the requesting Authorization_Identity (audit invariant).

### Requirement 3: Walrus-Native Canonical Storage

**User Story:** As a system designer, I want all canonical content to live on Walrus, so that Postgres remains a metadata and indexing plane and the canonical record is decentralized.

#### Acceptance Criteria

1. THE Walrus_Store SHALL remain the canonical source of truth for Form_Definition bodies, Submission_Payload bodies (plaintext or ciphertext), uploaded file bytes, and encrypted records.
2. THE Postgres_Store SHALL function only as the metadata layer, indexing layer, query acceleration layer, and activity/audit tracking layer.
3. THE API_Server SHALL store every Form_Definition as a Walrus_Blob on Walrus_Store before recording its existence in Postgres_Store.
4. THE API_Server SHALL store every Submission_Payload, whether plaintext for Public_Form or ciphertext for Private_Form, as a Walrus_Blob on Walrus_Store.
5. THE API_Server SHALL store every uploaded file attachment as a Walrus_Blob on Walrus_Store.
6. THE Postgres_Store SHALL NOT contain Form_Definition bodies, Submission_Payload bodies, plaintext fields, ciphertext bodies, or file bytes in any column.
7. THE Postgres_Store SHALL store only the Walrus blob identifier, content type tag, size, owner Authorization_Identity, form identifier, integrity digest, and Upload_State_Machine state for each canonical artifact.
8. WHEN a client retrieves a Form_Definition or a public Submission_Payload, THE API_Server SHALL fetch the canonical bytes from Walrus_Store using the recorded blob identifier and SHALL return them to the Web_App.
9. IF a Walrus_Store fetch returns content whose digest does not match the digest recorded in Postgres_Store at upload time, THEN THE API_Server SHALL surface an integrity error and SHALL NOT return the artifact as authentic.
10. THE API_Server SHALL retry Walrus_Store fetches with bounded exponential backoff up to a configured maximum attempt count before reporting failure.

**Correctness properties for property-based testing**

- For all generated Form_Definition objects `f`, `walrus_fetch(walrus_put(f)) == f` (round-trip property).
- For all generated byte payloads `b`, `digest(walrus_fetch(walrus_put(b))) == digest(b)` (integrity invariant).
- For all generated metadata write flows, no Postgres_Store row contains canonical body bytes or ciphertext bytes for the artifact it indexes (canonicality invariant).

### Requirement 4: Form Privacy Architecture

**User Story:** As a form owner, I want to choose between a public form and a private form when I create it, so that I control whether responses are readable by anyone or only by authorized viewers.

#### Acceptance Criteria

1. THE Web_App SHALL require the Form_Owner to select either Public_Form mode or Private_Form mode at form creation time.
2. WHEN a Form_Owner selects Public_Form mode, THE API_Server SHALL store Submission_Payload values as plaintext JSON Walrus_Blobs.
3. WHEN a Form_Owner selects Private_Form mode, THE API_Server SHALL store Submission_Payload values as Seal_Service ciphertext Walrus_Blobs encrypted under a Seal policy that authorizes the Form_Owner Authorization_Identity and recorded Viewer_Permissions, using the Infrastructure_Wallet.
4. THE API_Server SHALL record the privacy mode of every Form_Definition in metadata so that submission flows branch deterministically.
5. THE API_Server SHALL reject submission metadata records whose declared privacy mode does not match the privacy mode recorded for the referenced Form_Definition; matching privacy modes are a necessary condition and SHALL NOT be treated as sufficient on their own.
6. WHILE a Private_Form is active, THE API_Server SHALL NOT return decrypted Submission_Payload bytes to any requester whose Authorization_Identity does not satisfy the form's ownership and viewer-permission rules.
7. WHERE a Form_Owner changes privacy mode for an existing Form_Definition, THE API_Server SHALL create a new Form_Definition version rather than mutating prior submissions.
8. IF a submission is attempted against a Private_Form by an unauthenticated requester, THEN THE API_Server SHALL reject the request with HTTP 401 or 403 and SHALL prompt the Web_App to re-authenticate.

**Correctness properties for property-based testing**

- For all generated Form_Definition objects in Private_Form mode and all generated Submission_Payload values, the bytes recorded on Walrus_Store SHALL NOT contain any substring of the original plaintext (confidentiality invariant under managed authority).
- For all generated Form_Definition objects in Public_Form mode and all generated Submission_Payload values, the bytes recorded on Walrus_Store decode to a JSON value structurally equal to the original Submission_Payload (round-trip property).
- For all generated requesters whose Authorization_Identity is not the Form_Owner and not in recorded Viewer_Permissions, decryption requests against the form's submissions return HTTP 403 and produce an Audit_Log entry (authorization invariant).

### Requirement 5: Postgres Metadata Schema

**User Story:** As an operator, I want Postgres to hold only metadata, indexes, and audit, so that the database remains small, replaceable, and free of canonical user content.

#### Acceptance Criteria

1. THE Postgres_Store SHALL contain a forms table that records form identifier, Form_Owner Authorization_Identity, Walrus blob identifier of the Form_Definition, privacy mode, created-at timestamp, and current Upload_State_Machine state.
2. THE Postgres_Store SHALL contain a submissions table that records submission identifier, referenced form identifier, submitter Authorization_Identity, Walrus blob identifier of the Submission_Payload, privacy mode, content digest, size in bytes, and current Upload_State_Machine state.
3. THE Postgres_Store SHALL contain a files table that records file identifier, owning submission identifier, Walrus blob identifier, content type, size in bytes, and current Upload_State_Machine state.
4. THE Postgres_Store SHALL contain a viewer_permissions table that records form identifier, grantee Authorization_Identity, capability, and grantor Authorization_Identity.
5. THE Postgres_Store SHALL contain an Audit_Log table that records, for every decryption operation, the requester Authorization_Identity, timestamp, form identifier, submission identifier, authorization result, and outcome; and records every failed authorization attempt for encrypted Submission access.
6. THE Postgres_Store SHALL NOT contain columns that store Form_Definition bodies, Submission_Payload bodies, plaintext fields, ciphertext bodies, or file bytes.
7. THE Postgres_Store SHALL enforce a unique constraint on Walrus blob identifier within each table that records one.
8. THE Postgres_Store SHALL enforce foreign key relationships from submissions to forms, from files to submissions, and from viewer_permissions to forms together as a single complete set; partial enforcement of only some of these relationships SHALL be rejected at migration time.
9. THE API_Server SHALL expose query endpoints that filter by Form_Owner Authorization_Identity, by form identifier, and by Upload_State_Machine state.
10. THE API_Server SHALL apply database migrations through a versioned migration tool whose history is committed to the repository.

**Correctness properties for property-based testing**

- For all generated sequences of valid metadata insertions and queries, no query returns rows containing payload bodies or ciphertext (schema invariant).
- For all generated insert-then-query pairs, the queried row's blob identifier equals the inserted row's blob identifier (round-trip property between write and read).
- For all generated decryption operations, exactly one Audit_Log entry exists in Postgres_Store referencing the requesting Authorization_Identity, the form identifier, the submission identifier, the timestamp, and the authorization result (audit completeness invariant).

### Requirement 6: Upload State Machine

**User Story:** As a user, I want clear progress and reliable retries when I submit a form, so that I am not left wondering whether my submission was saved.

#### Acceptance Criteria

1. THE System SHALL model every upload as an Upload_Job whose state is one of `pending`, `encrypting`, `uploading`, `uploaded`, `indexed`, or `failed`.
2. WHEN an Upload_Job is created, THE API_Server SHALL set the initial state to `pending`.
3. WHEN encryption begins for a Private_Form Upload_Job, THE API_Server SHALL transition the state to `encrypting`.
4. WHEN bytes begin streaming to Walrus_Store for a Public_Form Upload_Job, THE API_Server SHALL transition the state from `pending` to `uploading`.
5. WHEN bytes begin streaming to Walrus_Store for a Private_Form Upload_Job, THE API_Server SHALL require the job to have already passed through the `encrypting` state and SHALL transition the state from `encrypting` to `uploading`.
6. WHEN Walrus_Store confirms persistence and returns a blob identifier, THE API_Server SHALL transition the state to `uploaded`.
7. WHEN the API_Server finishes writing the metadata record for the blob identifier, THE API_Server SHALL transition the state to `indexed`.
8. THE API_Server SHALL coordinate Seal encryption and Walrus storage operations using the Infrastructure_Wallet after validating request authorization.
9. THE System SHALL not expose a canonical Submission_Record to retrieval endpoints until both Walrus storage and Postgres metadata indexing complete successfully.
10. IF any transition out of `pending`, `encrypting`, `uploading`, or `uploaded` raises an error, THEN THE API_Server SHALL transition the state to `failed`, record the failure reason, and emit an Audit_Log entry where the error occurred during a decryption-relevant step.
11. WHILE an Upload_Job is in `failed`, THE Web_App SHALL allow the user to retry the job, and THE API_Server SHALL restart from the earliest non-completed step required to make progress.
12. THE Web_App SHALL display progress for each Upload_Job using the UX_Vocabulary terms rather than internal state names.
13. WHEN an Upload_Job reaches `uploaded` but does not reach `indexed` within a configured orphan timeout, THE API_Server SHALL flag the blob identifier as a potential orphan and SHALL surface an action to reconcile or discard it.
14. THE Web_App SHALL persist Upload_Job state references in browser storage so that interrupted sessions can resume the state machine on reload.

**Correctness properties for property-based testing**

- For all generated transition sequences over the Upload_State_Machine, only declared transitions occur and no state is reached that is not in the declared state set (invariant).
- For all generated retry sequences from `failed`, repeated retries from the same intermediate state are idempotent: calling the retry transition twice from the same state is equivalent to calling it once (idempotence).
- For all generated successful sequences `pending → encrypting → uploading → uploaded → indexed`, the Walrus blob identifier observed at `uploaded` equals the blob identifier recorded at `indexed` (consistency invariant).
- For all generated upload flows, no canonical Submission_Record is exposed by retrieval endpoints before both the Walrus_Store write and the Postgres_Store metadata write complete successfully (canonical-exposure invariant).

### Requirement 7: API for Orchestration, Authorization, Encryption, Decryption, and Metadata

**User Story:** As a backend maintainer, I want the API to legitimately handle encryption orchestration, authorization-gated decryption, and metadata indexing through a single production-authoritative path per concern, so that the trust surface is small and the service stays deployable on modest infrastructure.

#### Acceptance Criteria

1. THE API_Server SHALL expose endpoints for: authentication verification, encryption orchestration (form/submission/file create flows), authorization-gated decryption, metadata read and update operations, listing, search, and Upload_State_Machine reconciliation.
2. THE API_Server SHALL accept canonical Submission_Payload and file bytes only through the encryption orchestration endpoints, and SHALL pass them through Seal_Service encryption (for Private_Form) or direct Walrus storage (for Public_Form) without persisting bodies in Postgres_Store.
3. THE API_Server SHALL gate every decryption endpoint behind an authorization check that validates the requester's Authorization_Identity against ownership and Viewer_Permission rules for the target Form_Definition and Submission_Payload; IF the authorization check itself fails to execute due to a system error, THEN THE API_Server SHALL treat the failure as an authorization rejection and SHALL block the decryption.
4. THE API_Server SHALL record an Audit_Log entry for every decryption endpoint invocation, including successful decryptions and rejected attempts.
5. THE API_Server SHALL verify that the asserted Authorization_Identity controls the Form_Owner address before accepting metadata writes for a given form or submission.
6. THE API_Server SHALL respond to every endpoint with a typed response envelope that includes a status code, a result, and an error structure when applicable.
7. THE API_Server SHALL log structured records for every request including endpoint, asserted Authorization_Identity, request identifier, and outcome, without logging payload bodies, decryption keys, or Infrastructure_Wallet credentials.
8. WHEN a metadata write references a Walrus blob identifier, THE API_Server SHALL verify that the blob identifier exists on Walrus_Store before transitioning the record to `indexed`.
9. IF a metadata write fails server-side validation, THEN THE API_Server SHALL return a typed error response and SHALL NOT persist a partial record; even when validation succeeds, THE API_Server SHALL persist metadata records atomically so that no partial record is ever observable in Postgres_Store.
10. IF a decryption request is received for an unauthorized Authorization_Identity, THEN THE API_Server SHALL return HTTP 403, SHALL NOT invoke Seal_Service, and SHALL record a failed-authorization Audit_Log entry.

**Correctness properties for property-based testing**

- For all generated valid authenticated metadata write requests, the API_Server returns a 2xx response and the resulting metadata row matches the request (round-trip property between request and stored metadata).
- For all generated requests asserting an Authorization_Identity other than the verified one, the API_Server returns an authorization error (error condition property).
- For all generated decryption requests, every successful decryption is preceded by a passing authorization check and writes an Audit_Log entry; every rejected decryption returns HTTP 403 and writes an Audit_Log entry; no decryption pathway exists that bypasses both checks (authorization-gated decryption invariant).

### Requirement 8: UX Abstraction Over Web3 Concepts

**User Story:** As an end user, I want the app to use plain language for privacy and sharing, so that I do not need to understand wallets, blob IDs, or policy IDs to use it.

#### Acceptance Criteria

1. THE Frontend SHALL abstract blockchain and signer terminology from end users in primary user-visible flows.
2. THE Web_App SHALL refer to form privacy modes using the UX_Vocabulary terms `Private`, `Protected`, `Shared`, and `Secure` in user-visible surfaces.
3. THE Web_App SHALL NOT display Walrus blob identifiers, Sui transaction hashes, Seal policy identifiers, Infrastructure_Wallet addresses, or raw signer addresses in primary user-visible flows.
4. ZK Login users SHALL experience authentication and authorization flows using generic identity-confirmation language rather than wallet-specific terminology.
5. WHERE an advanced view is enabled, THE Web_App SHALL allow the user to reveal underlying Walrus blob identifiers, transaction hashes, and Seal policy identifiers for diagnostic purposes.
6. THE Web_App SHALL refer to the active authentication entity as "your account" rather than "wallet" or "signer" in primary flows.
7. WHEN a user-visible action requires authorization confirmation, THE Web_App SHALL describe the action using the UX_Vocabulary and SHALL NOT expose Sui transaction internals to the primary flow.
8. THE Web_App SHALL display Upload_Job progress using human-readable phases mapped from the Upload_State_Machine rather than the internal state names.
9. IF an action cannot be completed without an advanced concept (for example switching to an External_Wallet), THEN THE Web_App SHALL present a guided explanation in plain language before exposing the technical action.

### Requirement 9: Security Hardening

**User Story:** As a security-conscious operator, I want legacy bypass and POC code paths removed and the API hardened with disciplined secret management, so that the production deployment has a small, known attack surface and the Infrastructure_Wallet credentials remain protected.

#### Acceptance Criteria

1. THE API_Server SHALL NOT contain Bypass_Auth code paths or environment flags that disable authentication or authorization in production builds.
2. THE API_Server SHALL NOT contain Legacy_POC_Routes or duplicate handlers outside the single production-authoritative path for each concern.
3. THE API_Server SHALL load Infrastructure_Wallet credentials only from secure deploy-managed configuration (for example a secrets manager or deploy-time environment injection), and SHALL NOT load them from source-controlled files.
4. THE API_Server SHALL NOT log Infrastructure_Wallet credentials, Seal session secrets, decryption keys, or any value derived from those credentials at any log level.
5. THE System SHALL define and document a key rotation strategy for Infrastructure_Wallet credentials that includes rotation cadence, dual-key transition handling for in-flight encryptions, and verification steps post-rotation.
6. THE API_Server SHALL enforce the Payload_Limit strictly with no tolerance, rejecting every request body whose size is greater than the configured Payload_Limit by even a single byte with a 413 response.
7. THE API_Server SHALL apply a Rate_Limiter per asserted Authorization_Identity and per source IP on every authenticated endpoint, including encryption and decryption endpoints.
8. THE API_Server SHALL run the Env_Validator at startup and SHALL refuse to start if any required environment variable, including Infrastructure_Wallet credential references, is missing or malformed.
9. THE API_Server SHALL configure CORS to allow only the Web_App origins listed in environment configuration.
10. THE API_Server SHALL set HTTP security headers including `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, and `Content-Security-Policy` appropriate to an API service.
11. THE API_Server SHALL redact secrets from log output and SHALL NOT log request bodies for endpoints that may contain user identifiers, payload digests, or Infrastructure_Wallet credentials.
12. WHEN a request exceeds the Rate_Limiter quota, THE API_Server SHALL return a 429 response with a retry-after value.
13. IF startup detects any disallowed legacy code path at runtime (for example a registered Legacy_POC_Route or a Bypass_Auth flag enabled), THEN THE API_Server SHALL log a critical error and exit non-zero.

**Correctness properties for property-based testing**

- For all generated request bodies whose size exceeds Payload_Limit, the API_Server returns 413 (error condition property).
- For all generated request rates above the Rate_Limiter threshold across a sliding window, the API_Server returns 429 once the threshold is crossed and resumes 2xx responses after the window resets (rate limiter invariant).
- For all generated log records emitted by the API_Server, no record contains substrings of Infrastructure_Wallet credentials, decryption keys, or Seal session secrets (secret-redaction invariant).

### Requirement 10: VPS Deployment

**User Story:** As an operator, I want Swrap to deploy reliably on a 2 GB DigitalOcean Ubuntu droplet using Docker Compose, so that I can run the production stack with predictable cost and footprint.

#### Acceptance Criteria

1. THE VPS_Host SHALL run Swrap as a Docker Compose stack composed of the Web_App container, the API_Server container, the Postgres_Store container, and the Nginx reverse proxy container.
2. THE VPS_Host SHALL terminate TLS at the Nginx container and SHALL forward decrypted traffic to the Web_App and API_Server containers over a private Docker network.
3. THE API_Server SHALL expose a Health_Check endpoint that reports liveness and readiness, including database connectivity status and Infrastructure_Wallet credential availability.
4. THE Docker Compose stack SHALL define container memory limits whose sum does not exceed 1.6 GB on the VPS_Host so that operating system overhead fits within 2 GB total RAM.
5. THE Docker Compose stack SHALL define container restart policies of `unless-stopped` for every service.
6. THE Docker Compose stack SHALL load environment variables, including Infrastructure_Wallet credential references, from a deploy-managed env file or a deploy-managed secrets manager (either alone is acceptable, both together are acceptable), and SHALL produce container images that contain zero baked-in secrets at build time, including in any base image layer.
7. THE Web_App container SHALL serve only static and server-rendered output and SHALL NOT include build toolchains in the runtime image.
8. THE API_Server container SHALL produce structured JSON logs to stdout for collection by the host log driver, with secrets redacted.
9. WHEN the Health_Check reports unhealthy for longer than a configured grace period, THE Docker Compose stack SHALL restart the affected container.
10. IF the VPS_Host runs out of memory, THEN THE Docker Compose stack SHALL preserve Postgres_Store data integrity by relying on persistent volumes rather than ephemeral container storage.

### Requirement 11: Codebase Cleanup and Single Production Path

**User Story:** As a maintainer, I want duplicate POC flows and dead code removed and each concern consolidated into one production-authoritative code path, so that the repository accurately reflects the new architecture and onboarding is straightforward.

#### Acceptance Criteria

1. THE System SHALL consolidate upload, encryption, metadata, and authentication concerns into one production-authoritative code path per concern after migration completion.
2. WHEN the cleanup task completes, THE API_Server SHALL expose exactly one upload orchestration handler that delegates to a single metadata orchestration module, and no other modules in the API_Server SHALL implement upload orchestration logic.
3. WHEN the cleanup task completes, THE API_Server SHALL expose exactly one encryption orchestration module that wraps Seal_Service operations under the Infrastructure_Wallet, and no other modules in the API_Server SHALL invoke Seal_Service encryption or decryption.
4. WHEN the cleanup task completes, THE API_Server SHALL verify through static analysis that all Backend decryption call sites are reachable only through authorization-validated workflows.
5. WHEN the cleanup task completes, THE Web_App SHALL expose exactly one authentication module that handles both ZK_Login_Account and External_Wallet sign-in paths, and no other modules in the Web_App SHALL implement authentication flows.
6. WHEN the cleanup task completes, THE Web_App SHALL expose exactly one metadata API client module that every metadata read and write call site imports, and no other modules in the Web_App SHALL implement metadata API calls.
7. WHEN the cleanup task completes, THE Swrap repository SHALL contain zero unused exports, zero unreferenced React components, and zero unregistered route handlers, as verified by a repository-wide static analysis pass.
8. WHEN the cleanup task completes, THE Swrap repository SHALL contain a single migration note file at a documented location that lists, for every module removed during cleanup, both the removed module path and its replacement module path.
9. WHEN the cleanup task completes, THE Swrap repository SHALL pass the project's linting command with zero errors and with a warning count not exceeding the warning count recorded immediately before the cleanup task started.
10. WHEN the cleanup task completes, THE Swrap repository SHALL pass the project's type-checking command with zero errors.
11. IF any source file in the Swrap repository imports a module path that was removed during cleanup, THEN THE build process SHALL fail with an error identifying the importing file path and the removed module path.

### Requirement 12: Authorization Boundary (Cross-Cutting)

**User Story:** As a privacy-focused user, I want the system to enforce a clear authorization boundary so that decryption only happens after my identity has been verified and authorization rules have been applied.

#### Acceptance Criteria

1. THE System SHALL root trust in authenticated Authorization_Identities (ZK_Login_Account or External_Wallet) and the Infrastructure_Wallet's controlled execution within the API_Server.
2. THE API_Server MAY hold Seal decryption authority via the Infrastructure_Wallet, ephemeral plaintext Submission_Payload bytes during orchestration, and Audit_Log data describing decryption operations.
3. THE API_Server SHALL enforce ownership and Viewer_Permission authorization checks before invoking Seal_Service decryption for any Private_Form artifact; performing the authorization check SHALL NOT require subsequent invocation of Seal_Service decryption, and the API_Server MAY complete authorization checks for read or audit flows without issuing a decryption call.
4. THE API_Server SHALL record an Audit_Log entry for every decryption operation, whether successful or rejected.
5. THE API_Server SHALL reject decryption requests for unauthorized Authorization_Identities with HTTP 403 responses.
6. THE System SHALL store encrypted submissions on Walrus_Store and SHALL restrict decryption operations to authorized workflows validated through ownership and Viewer_Permission checks.
7. THE API_Server SHALL hold ephemeral plaintext Submission_Payload bytes only for the duration of an active orchestration operation and SHALL release plaintext memory references upon completion or failure.
8. WHERE diagnostic telemetry is emitted from the API_Server or Web_App, THE emitter SHALL include only non-sensitive identifiers (Walrus blob identifiers, Upload_State_Machine state names, request identifiers, Authorization_Identity addresses) and SHALL exclude payload contents, Infrastructure_Wallet credentials, decryption keys, and Seal session secrets.
9. THE Swrap repository SHALL document the Authorization_Boundary in a single architecture note that names every component, identifies which side of the boundary it sits on, and describes which materials the API_Server is authorized to hold.

**Correctness properties for property-based testing**

- For all generated decryption attempts, the API_Server invokes Seal_Service decryption only after a passing authorization check against the requester's Authorization_Identity (authorization precedence invariant).
- For all generated decryption attempts, exactly one Audit_Log entry is written referencing the requester Authorization_Identity, the form identifier, the submission identifier, the timestamp, and the authorization result (audit invariant).
- For all generated requests asserting an unauthorized Authorization_Identity, the API_Server returns HTTP 403 and no Seal_Service decryption operation is invoked (rejection invariant).

### Requirement 13: Managed Encryption Architecture

**User Story:** As a system designer, I want Seal encryption and decryption authority centralized under the Infrastructure_Wallet, so that the platform behaves as a managed encrypted SaaS while preserving Web2-grade UX abstraction.

#### Acceptance Criteria

1. THE System SHALL centralize Seal encryption and decryption authority under the Infrastructure_Wallet.
2. THE Infrastructure_Wallet SHALL execute Walrus and Seal operations on behalf of authenticated users after authorization checks succeed.
3. THE System SHALL enforce access control through authenticated Authorization_Identities and Viewer_Permissions.
4. THE System SHALL preserve Web2-grade UX abstraction by hiding signer and blockchain complexity from end users in primary user-visible flows.
5. THE Infrastructure_Wallet SHALL own Seal encryption authority for encrypted Forms and Submissions.
6. THE Backend SHALL only perform decryption operations after successful authorization checks against ownership and Viewer_Permission rules.
7. THE Backend SHALL log and audit all decryption operations.
8. THE Backend SHALL reject decryption requests for unauthorized Authorization_Identities with HTTP 403 responses, and SHALL use distinct HTTP status codes for non-authorization failures (for example HTTP 400 for malformed requests, HTTP 404 for missing records, HTTP 500 for server errors) so that HTTP 403 is reserved exclusively for authorization rejections.
9. THE System SHALL store encrypted submissions on Walrus_Store and SHALL restrict decryption operations to authorized workflows validated through ownership and Viewer_Permission checks.

**Correctness properties for property-based testing**

- For all generated authenticated user flows, every Walrus or Seal operation observed in the trace was executed by the Infrastructure_Wallet after a passing authorization check (centralization invariant).
- For all generated decryption operations, the operation is preceded by a passing authorization check against ownership or Viewer_Permission rules and produces an Audit_Log entry (managed-authority invariant).

### Requirement 14: Decryption Audit and Activity Logging

**User Story:** As a compliance reviewer, I want every decryption operation and every failed authorization attempt to be recorded with complete attribution, so that access to encrypted submissions can be reviewed and incidents can be investigated.

#### Acceptance Criteria

1. THE System SHALL audit all decryption operations including: requester Authorization_Identity, timestamp, form identifier, submission identifier, authorization result, and outcome.
2. THE System SHALL log failed authorization attempts for encrypted Submission access, including requester Authorization_Identity (or `unknown` when unauthenticated), timestamp, form identifier, submission identifier, rejection reason, and resulting HTTP status.
3. THE System SHALL persist Audit_Log entries in Postgres_Store as append-only records.
4. THE System SHALL NOT include plaintext Submission_Payload bytes, decryption keys, or Infrastructure_Wallet credentials in any Audit_Log entry.
5. THE API_Server SHALL expose a query endpoint that returns Audit_Log entries filtered by Authorization_Identity, by form identifier, and by time range, available only to a Form_Owner Authorization_Identity for their own forms.
6. WHEN a decryption operation completes (whether successful or rejected), THE API_Server SHALL write the Audit_Log entry within the same transactional boundary as the authorization decision so that decision and audit cannot diverge.
7. IF an Audit_Log write fails, THEN THE API_Server SHALL roll back any associated decryption response and SHALL return a structured server error rather than emitting plaintext.

**Correctness properties for property-based testing**

- For all generated decryption operations, the count of Audit_Log entries equals the count of decryption attempts (audit completeness invariant).
- For all generated successful decryption operations, the Audit_Log entry references the same requester Authorization_Identity, form identifier, and submission identifier as the operation (attribution invariant).
- For all generated failed authorization attempts, an Audit_Log entry exists with an authorization result of `denied` and an HTTP status of 401 or 403 (rejection-audit invariant).

### Requirement 15: Operational Simplicity

**User Story:** As an operator and maintainer, I want the system to prioritize operational simplicity over premature decentralization complexity, so that deployments are reliable and the platform remains maintainable.

#### Acceptance Criteria

1. THE System SHALL prioritize operational simplicity, deployment reliability, and maintainability over premature decentralization complexity.
2. THE System SHALL run as a single Docker Compose stack on a single VPS_Host in the migration target deployment, without requiring distributed coordination services.
3. THE API_Server SHALL keep encryption, authorization, decryption, and audit responsibilities consolidated under one production-authoritative module per concern.
4. THE System SHALL document operational runbooks for: Infrastructure_Wallet credential rotation, Audit_Log review, Walrus blob orphan reconciliation, and database migration rollback.
5. WHERE additional decentralization features are proposed (for example client-held decryption authority or distributed key management), THE System SHALL defer them, and WHILE such a feature remains deferred, THE Swrap repository SHALL NOT contain a published threat model document for that feature; a threat model update SHALL be authored only when the feature is brought into scope.
