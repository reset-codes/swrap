# Requirements Document

## Introduction

This document specifies the requirements for the **Walrus Testnet Proof of Concept (POC)** for SEALBASE. The objective of this work is **not production readiness**. The objective is to validate, end-to-end, that:

1. Encrypted form schemas and encrypted submissions can be uploaded to Walrus testnet.
2. Seal encryption and decryption work against locally signed payloads.
3. A local Sui signer (read from `~/.sui/sui_config/client.yaml` and `~/.sui/sui_config/sui.keystore`) can connect to Sui testnet, fetch balance, and anchor blob metadata.
4. The complete product flow (Create Form → Encrypt → Upload → Retrieve → Decrypt → Submit → Encrypt Response → Upload Response → Decrypt Response) works on a single developer machine with minimal backend.

This spec is **separate from and non-overlapping with** the `sealbase-platform` production spec. This POC intentionally bypasses OAuth, RBAC, billing, storage credits, multi-tenant isolation, and production infrastructure. The local developer machine is treated as a trusted environment for the duration of the POC.

The POC is scoped as a branch (`walrus-poc`) off a tagged baseline (`v0-baseline`), so that all work is rollback-safe and does not disturb the existing production-oriented codebase.

---

## Glossary

- **POC_System**: The complete Walrus Testnet POC application — frontend, minimal backend routes, and packages — built on the `walrus-poc` branch.
- **Baseline_Tag**: The annotated git tag `v0-baseline` marking the commit `"chore: v0 baseline before walrus integration"` against which all POC work can be rolled back.
- **Recovery_Branch**: The git branch named `walrus-poc` on which all POC development occurs.
- **Local_Signer**: A Sui keypair loaded from the developer's local Sui CLI configuration (`~/.sui/sui_config/client.yaml` and `~/.sui/sui_config/sui.keystore`), used to sign Sui and Walrus operations during the POC.
- **Signer_Detector**: The component responsible for reading the local Sui CLI config, resolving the active address, and returning a usable signer object.
- **Sui_Client**: The component that connects to Sui testnet, queries chain state (active network, balance), and submits Sui transactions signed by the Local_Signer.
- **Walrus_Client**: The component that uploads and retrieves blobs to and from Walrus testnet using the Local_Signer.
- **Walrus**: The decentralized blob storage network. Used only for storing opaque blobs during the POC.
- **Sui**: The Sui testnet chain. Used only for anchoring references (blob IDs, schema hashes, timestamps, ownership pointers) during the POC.
- **Seal**: The encryption and decryption utility used to turn plaintext payloads into Encrypted_Blobs and back.
- **Seal_Encryptor**: The component that encrypts plaintext payloads into Encrypted_Blobs.
- **Seal_Decryptor**: The component that decrypts Encrypted_Blobs back into plaintext payloads, authorized by the Local_Signer.
- **Plaintext_Blob**: An unencrypted byte sequence stored on or retrieved from Walrus. Only permitted when `DEV_ALLOW_PLAINTEXT=true`.
- **Encrypted_Blob**: A byte sequence produced by the Seal_Encryptor, safe to store on public Walrus.
- **Blob_ID**: The canonical Walrus identifier returned when a blob is stored; used to retrieve the blob later.
- **Form_Schema**: A JSON document describing a form's title and ordered list of fields. Example: `{ "title": "Test Form", "fields": [{ "type": "text", "label": "Name" }] }`.
- **Submission**: A JSON document containing a respondent's field values for a given Form_Schema.
- **Schema_Hash**: A deterministic SHA-256 hash of the canonical serialized Form_Schema bytes, used for integrity verification and on-chain anchoring.
- **Metadata_Record**: A Sui on-chain record containing only references and hashes — never plaintext content. Fields: `blob_id`, `schema_hash`, `created_at`, `owner_address`, `record_type` (`form` or `submission`), and for submissions an optional `form_blob_id` pointer.
- **Metadata_Anchor**: The component that writes Metadata_Records to Sui testnet via Sui_Client.
- **Local_Store**: The client-side persistence layer for the POC. Concrete implementation MAY be `localStorage`, `IndexedDB`, or a Zustand store with local persistence. Server-side persistence, if any, MAY be a single SQLite file or a JSON file. Production databases, auth-gated storage, and multi-tenant tables are out of scope.
- **Form_Builder_UI**: The frontend surface that lets the developer create a Form_Schema, save it locally, encrypt it, and upload it to Walrus.
- **Form_Submission_UI**: The frontend surface that lets the developer open a form by Blob_ID, decrypt it locally, fill it out, encrypt the Submission, and upload it to Walrus.
- **Env_Loader**: The component that reads the POC environment flags (`DEV_BYPASS_STORAGE`, `DEV_LOCAL_SIGNER`, `DEV_ALLOW_PLAINTEXT`, `USE_WALRUS_TESTNET`, `USE_SUI_TESTNET`) at startup and makes them available to the POC_System.
- **Owner**: The identity represented by the Local_Signer's active Sui address; the creator of a form and the party entitled to decrypt its submissions in the POC.
- **Respondent**: The user filling out a form via the Form_Submission_UI. In the POC, the Respondent runs on the same trusted local machine as the Owner.
- **Pretty_Printer**: A function that deterministically serializes a Form_Schema (or Submission) to a canonical JSON byte string, used for hashing, encrypting, and round-trip testing.
- **Parser**: A function that reads a JSON byte string and returns a validated Form_Schema (or Submission) object, or a descriptive error.
- **Validator**: The component that checks POC inputs (form schemas, submissions, env flags) against their expected shapes before use.
- **Design_Tokens**: A centralized, typed module (`packages/shared/design-tokens.ts`) that exports the single source of truth for spacing, radius, typography, semantic color, elevation, and animation timing values used across the UI.
- **UI_Primitives**: The reusable, variant-based component set (`Button`, `Input`, `Textarea`, `Card`, `Modal`, `Dropdown`, `Badge`, `Tabs`, `Toast`, `EmptyState`, `LoadingState`, `FormField`) built with a `shadcn/ui`-style architecture and consumed by all feature surfaces.
- **UX_State**: One of the five canonical interaction states — `idle`, `loading`, `success`, `error`, `empty` — that every asynchronous POC action (upload, encryption, submission, retrieval, anchoring) must render explicitly.
- **Design_System_Doc**: The document at `docs/design-system.md` that defines the visual philosophy, spacing system, component rules, interaction philosophy, animation constraints, and accessibility requirements for the POC UI.

---

## Requirements

### Requirement 1: Rollback-Safe Baseline

**User Story:** As the developer of the POC, I want a tagged, rollback-safe baseline before any Walrus or Seal integration begins, so that I can discard the POC and return to the previous state at any time without data loss.

#### Acceptance Criteria

1. BEFORE any code change for the POC is made, THE POC_System SHALL require that the git working tree is clean (no uncommitted or untracked changes).
2. WHEN the baseline is established, THE POC_System SHALL require a git commit with the exact message `chore: v0 baseline before walrus integration` on the default branch.
3. WHEN the baseline commit exists, THE POC_System SHALL require an annotated git tag named `v0-baseline` pointing at that commit.
4. WHEN the baseline tag exists, THE POC_System SHALL require that all POC development occurs on a branch named `walrus-poc` created from the Baseline_Tag.
5. IF the git working tree is not clean at the time baseline setup is attempted, THEN THE POC_System SHALL abort baseline setup and report which files are dirty.
6. IF the `v0-baseline` tag already exists at a different commit, THEN THE POC_System SHALL abort baseline setup and report the conflict rather than overwriting the tag.

---

### Requirement 2: Environment Flag Configuration

**User Story:** As the developer of the POC, I want a single set of documented environment flags that control local-first behavior, so that the system's trust assumptions are explicit and cannot be enabled accidentally in production.

#### Acceptance Criteria

1. THE Env_Loader SHALL recognize the following environment flags: `DEV_BYPASS_STORAGE`, `DEV_LOCAL_SIGNER`, `DEV_ALLOW_PLAINTEXT`, `USE_WALRUS_TESTNET`, `USE_SUI_TESTNET`.
2. WHEN the POC_System starts, THE Env_Loader SHALL load the five POC flags and log their resolved boolean values before any network call is made.
3. WHEN `DEV_BYPASS_STORAGE=true`, THE POC_System SHALL skip the production Storage_Credit check and production auth checks for all Walrus writes.
4. WHEN `DEV_LOCAL_SIGNER=true`, THE POC_System SHALL use the Local_Signer for all Sui and Walrus signing operations.
5. WHEN `DEV_ALLOW_PLAINTEXT=true`, THE POC_System SHALL permit uploading Plaintext_Blobs to Walrus for development purposes.
6. WHEN `DEV_ALLOW_PLAINTEXT=false`, THE POC_System SHALL reject any request to upload a Plaintext_Blob and SHALL require an Encrypted_Blob instead.
7. WHEN `USE_WALRUS_TESTNET=true`, THE Walrus_Client SHALL target the Walrus testnet publisher and aggregator endpoints.
8. WHEN `USE_SUI_TESTNET=true`, THE Sui_Client SHALL target the Sui testnet RPC endpoint.
9. IF any of the five POC flags is missing or not parseable as a boolean, THEN THE Env_Loader SHALL abort startup with a descriptive error naming the offending flag.

---

### Requirement 3: Local Signer Detection

**User Story:** As the developer of the POC, I want the system to detect my local Sui signer from the standard Sui CLI config on my machine, so that I do not need to manage a separate keypair for the POC.

#### Acceptance Criteria

1. WHEN `DEV_LOCAL_SIGNER=true` and the POC_System starts, THE Signer_Detector SHALL read the Sui CLI config at `~/.sui/sui_config/client.yaml`.
2. WHEN the Sui CLI config is loaded, THE Signer_Detector SHALL resolve the active Sui address from the `active_address` field.
3. WHEN the active address is resolved, THE Signer_Detector SHALL load the corresponding private key from `~/.sui/sui_config/sui.keystore` and return a usable signer object.
4. WHEN the signer object is returned, THE POC_System SHALL log the active address and the active network name without logging any private key material.
5. IF the file `~/.sui/sui_config/client.yaml` does not exist or is unreadable, THEN THE Signer_Detector SHALL return a descriptive error naming the missing path.
6. IF the file `~/.sui/sui_config/sui.keystore` does not exist or does not contain an entry for the active address, THEN THE Signer_Detector SHALL return a descriptive error naming the missing entry.
7. THE Signer_Detector SHALL never write the loaded private key bytes to logs, API responses, error messages, or the Local_Store.

---

### Requirement 4: Sui Testnet Connectivity

**User Story:** As the developer of the POC, I want the system to connect to Sui testnet using my Local_Signer, so that I can confirm the testnet integration works before moving on to Walrus.

#### Acceptance Criteria

1. WHEN `USE_SUI_TESTNET=true`, THE Sui_Client SHALL connect to the Sui testnet RPC endpoint on startup.
2. WHEN the Sui testnet connection is established, THE Sui_Client SHALL fetch the active address's SUI balance.
3. WHEN the balance is fetched, THE POC_System SHALL display the active address, the active network, and the balance in the Form_Builder_UI.
4. WHEN a test transaction flow is triggered, THE Sui_Client SHALL sign a no-op or test payload with the Local_Signer and verify the signature validates.
5. IF the Sui testnet RPC is unreachable, THEN THE Sui_Client SHALL return a descriptive error that includes the endpoint URL.
6. IF the active address has a zero balance, THEN THE POC_System SHALL display a warning prompting the developer to fund the address from the testnet faucet, and SHALL still allow read-only operations to proceed.

---

### Requirement 5: Walrus Testnet Connectivity

**User Story:** As the developer of the POC, I want the system to connect to Walrus testnet using my Local_Signer, so that I can confirm the upload signer works before attempting real uploads.

#### Acceptance Criteria

1. IF `USE_WALRUS_TESTNET=true`, THEN THE Walrus_Client SHALL target the Walrus testnet publisher URL for writes and the Walrus testnet aggregator URL for reads.
2. WHEN the POC_System starts, THE Walrus_Client SHALL perform a health check against the configured Walrus publisher endpoint and the configured Walrus aggregator endpoint with a per-endpoint timeout of 10 seconds; the health check is considered successful when both endpoints return a success response within their timeouts.
3. WHEN the Walrus health check succeeds for both endpoints, THE POC_System SHALL log the active publisher URL, the active aggregator URL, and the signer status as exactly `ready` or exactly `not_ready`.
4. IF either the Walrus publisher endpoint or the Walrus aggregator endpoint fails the health check by exceeding its 10-second timeout or returning a non-success response, THEN THE Walrus_Client SHALL return an error that includes the endpoint role (publisher or aggregator), the endpoint URL, and the failure reason (timeout or non-success response with its status indicator).
5. WHEN the Walrus_Client is initialized and the Local_Signer is not available from the Signer_Detector, THE Walrus_Client SHALL log the signer status as `not_ready`.
6. WHILE the signer status is `not_ready`, THE Walrus_Client SHALL reject any upload attempt with an error that identifies the cause as signer unavailability and that names the Walrus_Client as the rejecting component.

---

### Requirement 6: Plaintext Blob Upload and Retrieval

**User Story:** As the developer of the POC, I want to upload and retrieve a plaintext JSON form schema from Walrus testnet, so that I can isolate and validate the storage path before adding encryption.

#### Acceptance Criteria

1. WHEN `DEV_ALLOW_PLAINTEXT=true` and the developer triggers a plaintext upload, THE Walrus_Client SHALL upload the provided JSON bytes to Walrus testnet and return a Blob_ID.
2. WHEN a Blob_ID is returned, THE POC_System SHALL display the Blob_ID in the Form_Builder_UI and store it in the Local_Store.
3. WHEN the developer requests retrieval of a Blob_ID, THE Walrus_Client SHALL fetch the blob from the Walrus aggregator and return the raw bytes.
4. WHEN the retrieved bytes are returned, THE POC_System SHALL verify that the retrieved bytes are byte-identical to the uploaded bytes.
5. FOR ALL Plaintext_Blobs successfully uploaded and then retrieved, THE POC_System SHALL satisfy the round-trip property `retrieve(upload(bytes)) == bytes`.
6. IF `DEV_ALLOW_PLAINTEXT=false` and a plaintext upload is requested, THEN THE Walrus_Client SHALL reject the request with a descriptive error referencing the `DEV_ALLOW_PLAINTEXT` flag.
7. IF the Walrus upload fails, THEN THE Walrus_Client SHALL return a descriptive error and SHALL NOT write any Blob_ID into the Local_Store.

---

### Requirement 7: Seal Encryption and Decryption

**User Story:** As the developer of the POC, I want to encrypt JSON payloads with Seal and decrypt them back, so that I can verify the encryption primitive works end-to-end before combining it with Walrus.

#### Acceptance Criteria

1. WHEN the Seal_Encryptor is invoked with a plaintext byte sequence of length between 1 byte and 1,048,576 bytes (1 MiB) inclusive and the Local_Signer's public identity, THE Seal_Encryptor SHALL return an Encrypted_Blob.
2. WHEN the Seal_Decryptor is invoked with an Encrypted_Blob previously produced by the Seal_Encryptor for a given Local_Signer and that same Local_Signer, THE Seal_Decryptor SHALL return a byte sequence bytewise-equal to the original plaintext byte sequence.
3. THE POC_System SHALL satisfy the round-trip property `decrypt(encrypt(p)) == p` under bytewise equality for every plaintext byte sequence `p` produced by the Pretty_Printer with length between 1 byte and 1,048,576 bytes (1 MiB) inclusive.
4. WHEN an Encrypted_Blob is produced for a non-empty plaintext byte sequence, THE Seal_Encryptor SHALL ensure the Encrypted_Blob bytes do not contain the plaintext byte sequence as a contiguous substring.
5. IF the Seal_Decryptor is invoked with an Encrypted_Blob and a signer whose identity does not match the identity the Encrypted_Blob was encrypted for, THEN THE Seal_Decryptor SHALL return an error whose category is identifiable as "authorization" and whose payload includes the rejected signer's public identity, AND SHALL NOT return any bytes of the original plaintext.
6. IF the Seal_Decryptor is invoked with a byte sequence that cannot be parsed as a well-formed Encrypted_Blob, THEN THE Seal_Decryptor SHALL return an error whose category is identifiable as "parse" and whose payload includes a reason indicator (for example, the failing byte offset or the name of the structural check that failed), AND SHALL NOT return any bytes of plaintext.

---

### Requirement 8: Encrypted Blob Upload, Retrieval, and Decryption

**User Story:** As the developer of the POC, I want encrypted blobs to travel through Walrus end-to-end, so that I can confirm a public observer cannot recover the plaintext and the Owner can.

#### Acceptance Criteria

1. WHEN the developer triggers an encrypted upload, THE POC_System SHALL produce an Encrypted_Blob via the Seal_Encryptor, upload the Encrypted_Blob via the Walrus_Client, and return a Blob_ID.
2. WHEN the developer retrieves a Blob_ID produced by an encrypted upload, THE Walrus_Client SHALL return bytes byte-identical to the originally uploaded Encrypted_Blob.
3. WHEN the retrieved Encrypted_Blob is passed to the Seal_Decryptor with the Owner's Local_Signer, THE Seal_Decryptor SHALL return the original plaintext.
4. FOR ALL Form_Schemas and Submissions successfully encrypted, uploaded, retrieved, and decrypted, THE POC_System SHALL satisfy the end-to-end round-trip property `decrypt(retrieve(upload(encrypt(p)))) == p`.
5. WHEN the Blob_ID's Encrypted_Blob is fetched via a public Walrus aggregator request without a Local_Signer, THE POC_System SHALL verify that the returned bytes do not contain the plaintext byte sequence as a contiguous substring.
6. IF `DEV_ALLOW_PLAINTEXT=false` and an attempted upload is not recognized as an Encrypted_Blob by the Validator, THEN THE Walrus_Client SHALL reject the upload with a descriptive error.

---

### Requirement 9: Form Schema Serialization

**User Story:** As the developer of the POC, I want Form_Schemas and Submissions to be deterministically serializable and parseable, so that hashing, encryption, and round-trip testing are reliable.

#### Acceptance Criteria

1. WHEN a Form_Schema object is passed to the Pretty_Printer, THE Pretty_Printer SHALL produce a canonical UTF-8 JSON byte string with fields ordered deterministically.
2. WHEN a Submission object is passed to the Pretty_Printer, THE Pretty_Printer SHALL produce a canonical UTF-8 JSON byte string with fields ordered deterministically.
3. WHEN a canonical JSON byte string is passed to the Parser, THE Parser SHALL produce a Form_Schema or Submission object equivalent to the original.
4. FOR ALL valid Form_Schema objects `s`, THE POC_System SHALL satisfy the round-trip property `parse(print(s)) == s`.
5. FOR ALL valid canonical JSON byte strings `b` produced by the Pretty_Printer, THE POC_System SHALL satisfy the round-trip property `print(parse(b)) == b`.
6. IF the Parser receives a byte string that is not valid UTF-8 JSON, THEN THE Parser SHALL return a descriptive parse error.
7. IF the Parser receives a JSON document that is valid JSON but does not conform to the Form_Schema or Submission shape, THEN THE Validator SHALL return a descriptive validation error.

---

### Requirement 10: Form Creation Flow

**User Story:** As the developer acting as the Owner, I want to create a form, add fields, save it, encrypt it, and upload it to Walrus from the frontend, so that the full form authoring path is validated end-to-end.

#### Acceptance Criteria

1. WHEN the Owner opens the Form_Builder_UI, THE POC_System SHALL display controls for setting a form title of 1 to 200 characters and for adding, editing, reordering, and removing up to 50 fields per form.
2. WHEN the Owner adds a field, THE Form_Builder_UI SHALL allow selecting a field type from the set `text`, `long_text`, `number`, `email`, `url`, `select`, `checkbox` and setting a label of 1 to 100 characters.
3. WHEN the Owner saves the form, THE POC_System SHALL serialize the Form_Schema via the Pretty_Printer, encrypt the serialized output via the Seal_Encryptor, upload the Encrypted_Blob via the Walrus_Client within 30 seconds, and return a non-empty Blob_ID string.
4. WHEN the Blob_ID is returned, THE POC_System SHALL store an entry in the Local_Store containing the Blob_ID, the Schema_Hash, the Owner's address, and the `created_at` timestamp in ISO 8601 UTC format.
5. WHEN the Owner lists their forms, THE Form_Builder_UI SHALL display each form's title, Blob_ID, and `created_at` timestamp from the Local_Store, ordered by `created_at` descending (most recent first).
6. WHEN the Owner opens a previously saved form by Blob_ID, THE POC_System SHALL retrieve the Encrypted_Blob from Walrus within 30 seconds, decrypt it via the Seal_Decryptor, and render the Form_Schema in the Form_Builder_UI.
7. IF the Form_Schema fails Validator checks before upload, THEN THE Form_Builder_UI SHALL display a validation error identifying each failing field by label and the specific rule violated (missing title, empty label, unsupported field type, or field count exceeded), and SHALL NOT initiate the upload, preserving all Owner-entered data in the editor.
8. IF the Seal_Encryptor or Walrus_Client fails during save, THEN THE POC_System SHALL display an error message indicating the failing stage (encryption or upload), SHALL NOT create a Local_Store entry, and SHALL preserve all Owner-entered data in the editor.
9. IF the Walrus_Client cannot retrieve the Encrypted_Blob or the Seal_Decryptor fails during open, THEN THE POC_System SHALL display an error message indicating the failing stage (retrieval or decryption) and SHALL NOT render a partial Form_Schema in the Form_Builder_UI.

---

### Requirement 11: Local Persistence

**User Story:** As the developer of the POC, I want form and submission references to persist across page reloads without any server-side auth, so that I can iterate on the flow on a single machine.

#### Acceptance Criteria

1. THE Local_Store SHALL persist Blob_IDs, Schema_Hashes, form titles (maximum 200 characters), `created_at` timestamps in ISO 8601 UTC format, and submission references locally on the developer's machine.
2. WHEN the POC_System reloads, THE Local_Store SHALL return all previously persisted entries to the Form_Builder_UI without prompting for any authentication, credential, or sign-in step.
3. THE Local_Store SHALL never persist plaintext Form_Schemas, plaintext Submissions, decrypted Seal payloads, or Local_Signer private key bytes.
4. IF a Local_Store entry conflicts with the corresponding Sui Metadata_Record or Walrus content, THEN THE POC_System SHALL treat the Sui Metadata_Records and Walrus content as authoritative and SHALL refresh or discard the conflicting Local_Store entry.
5. IF a Local_Store entry has no corresponding Walrus Blob_ID, THEN THE POC_System SHALL label the entry as `unlinked` in the Form_Builder_UI and SHALL prevent that entry from being published, exported, or used to accept new submissions.
6. IF a write to the Local_Store fails (for example due to storage quota exceeded or storage being disabled), THEN THE POC_System SHALL display an error indicator to the developer in the Form_Builder_UI and SHALL NOT report the associated form or submission reference as persisted.
7. IF a persisted Local_Store entry is unreadable or fails structural validation on load, THEN THE POC_System SHALL skip that entry, record the skip for developer visibility, and continue loading the remaining valid entries without blocking the Form_Builder_UI.

---

### Requirement 12: Form Submission Flow

**User Story:** As the developer acting as the Respondent, I want to open a form by its Blob_ID, fill it out, encrypt my submission, and upload it to Walrus, so that the submission path is validated end-to-end.

#### Acceptance Criteria

1. WHEN the Respondent opens a form by Blob_ID in the Form_Submission_UI, THE POC_System SHALL retrieve the Encrypted_Blob from Walrus, decrypt it via the Seal_Decryptor, and render the form fields.
2. WHEN the Respondent fills out the form and submits, THE POC_System SHALL validate the Submission against the Form_Schema via the Validator.
3. WHEN the Submission is valid, THE POC_System SHALL serialize the Submission via the Pretty_Printer, encrypt it via the Seal_Encryptor, upload the Encrypted_Blob via the Walrus_Client, and return a submission Blob_ID.
4. WHEN the submission Blob_ID is returned, THE POC_System SHALL store an entry in the Local_Store linking the submission Blob_ID to the form's Blob_ID and the `submitted_at` timestamp.
5. WHEN the Owner retrieves a submission by its Blob_ID, THE POC_System SHALL fetch the Encrypted_Blob from Walrus, decrypt it via the Seal_Decryptor with the Owner's Local_Signer, and render the Submission values.
6. IF a Respondent's Submission fails validation against the Form_Schema, THEN THE Form_Submission_UI SHALL display field-level validation errors and SHALL NOT initiate the upload.

---

### Requirement 13: Sui Metadata Anchoring

**User Story:** As the developer of the POC, I want Sui to store only references and hashes for forms and submissions, so that I can verify ownership and integrity on-chain without ever putting plaintext content on-chain.

#### Acceptance Criteria

1. WHEN a form or submission Encrypted_Blob is successfully uploaded to Walrus, THE Metadata_Anchor SHALL publish a Metadata_Record to Sui testnet containing the Blob_ID, the Schema_Hash, the `created_at` timestamp, the Owner's Sui address, and the `record_type`.
2. THE Metadata_Anchor SHALL NOT include any plaintext form field values, plaintext submission values, decrypted Seal payloads, or Local_Signer private key material in any Metadata_Record.
3. WHEN the developer queries the Metadata_Records for an Owner's Sui address, THE Sui_Client SHALL return all Metadata_Records owned by that address in chronological order.
4. WHEN a Metadata_Record is retrieved, THE POC_System SHALL recompute the Schema_Hash by hashing the retrieved Walrus blob's decrypted bytes and SHALL verify that the recomputed hash matches the hash stored in the Metadata_Record.
5. FOR ALL Metadata_Records successfully anchored, THE POC_System SHALL satisfy the integrity property `sha256(decrypt(retrieve(record.blob_id))) == record.schema_hash`.
6. IF the Sui anchoring transaction fails, THEN THE Metadata_Anchor SHALL return a descriptive error and SHALL NOT mark the form or submission as anchored in the Local_Store.

---

### Requirement 14: Repository Structure

**User Story:** As the developer of the POC, I want the POC code organized into dedicated packages and apps on the `walrus-poc` branch, so that the production-oriented code on the default branch is not disturbed.

#### Acceptance Criteria

1. THE POC_System SHALL organize code on the `walrus-poc` branch such that the following directories exist at the `walrus-poc` branch HEAD: `apps/web`, `apps/api`, `packages/seal`, `packages/walrus`, `packages/sui`, and `packages/shared`.
2. THE `packages/seal` package SHALL contain the Seal_Encryptor and Seal_Decryptor and SHALL NOT import any module from `apps/web` or `apps/api`.
3. THE `packages/walrus` package SHALL contain the Walrus_Client and SHALL NOT import any module from `apps/web` or `apps/api`.
4. THE `packages/sui` package SHALL contain the Sui_Client, Signer_Detector, and Metadata_Anchor and SHALL NOT import any module from `apps/web` or `apps/api`.
5. THE `packages/shared` package SHALL contain Pretty_Printer, Parser, Validator, Form_Schema types, and Submission types shared between `apps/web` and `apps/api`, and SHALL NOT import any module from `apps/web` or `apps/api`.
6. WHEN the POC_System build command is executed on the `walrus-poc` branch, THE POC_System SHALL complete both the `apps/web` build and the `apps/api` build with an exit code of zero and without emitting compilation or type errors.
7. THE POC_System SHALL confine all POC-specific source changes on the `walrus-poc` branch to files located under the `apps/` and `packages/` directories or to code paths guarded by the POC environment flags defined for this branch.
8. WHEN the default-branch build command is executed on the default branch, THE POC_System SHALL produce a successful build (exit code zero, no compilation or type errors) that is unaffected by any POC-specific code introduced on the `walrus-poc` branch.

---

### Requirement 15: Documentation Deliverables

**User Story:** As a future maintainer of the POC, I want the POC's trust assumptions and lifecycle documented, so that the boundaries between this POC and a production system are unambiguous.

#### Acceptance Criteria

1. THE POC_System SHALL include a document at `docs/architecture.md` describing the POC system overview, trust assumptions, the Local_Signer model, the encryption lifecycle, the Walrus upload lifecycle, and the Sui metadata lifecycle.
2. THE POC_System SHALL include a document at `docs/dev-mode.md` describing the behavior of `DEV_BYPASS_STORAGE`, `DEV_LOCAL_SIGNER`, `DEV_ALLOW_PLAINTEXT`, `USE_WALRUS_TESTNET`, and `USE_SUI_TESTNET`, and the security implications of each.
3. THE POC_System SHALL include a document at `docs/security.md` describing the temporary trust assumptions of the POC, the risks of the Local_Signer model, and the future migration path to production-grade signer infrastructure.
4. THE POC_System SHALL include a document at `docs/walrus-flow.md` describing the upload, retrieval, and decryption flow for both Form_Schemas and Submissions, including sequence diagrams or step lists.
5. THE POC_System SHALL include a document at `docs/roadmap.md` describing Stage 1 (POC: local signer, testnet, encrypted forms, encrypted submissions), Stage 2 (Beta: hosted backend, auth, rate limiting, storage accounting), and Stage 3 (Production: KMS/HSM, monitoring, tenant isolation, scalable queues, hardened infrastructure).
6. THE POC_System SHALL include a document at `docs/design-system.md` describing the visual philosophy, spacing system, component rules, interaction philosophy, animation constraints, and accessibility requirements (see Requirement 19).
7. WHEN any document above is missing from the repository at POC completion time, THE POC_System SHALL fail its completion check.

---

### Requirement 16: Git Discipline Across Phases

**User Story:** As the developer of the POC, I want a git commit at the end of each major phase, so that rollback is cheap and each phase leaves the system in a buildable state.

#### Acceptance Criteria

1. WHEN a POC phase is completed, THE POC_System SHALL require exactly one git commit on the `walrus-poc` branch whose message follows the Conventional Commits format `feat: <phase description>` (examples: `feat: add walrus testnet connectivity`, `feat: implement encrypted blob uploads`, `feat: add form submission encryption flow`), with a non-empty description of 10 to 100 characters.
2. WHEN a phase-end commit is made, THE POC_System SHALL verify that both `apps/web` and `apps/api` complete their production build commands at that commit with a zero exit code within 600 seconds each.
3. WHEN a phase-end commit is made, THE POC_System SHALL verify that every POC route returns an HTTP status code below 500 on its documented happy-path request within a 30-second timeout.
4. IF any POC route returns an HTTP 500-class status (500 to 599) or fails to respond within the 30-second timeout on its happy path, THEN THE POC_System SHALL mark phase-end verification as failed and record which route failed and its observed status or timeout.
5. WHEN a phase-end commit is made, THE POC_System SHALL verify that the `v0-baseline` tag is reachable from `HEAD` by confirming that `git merge-base --is-ancestor v0-baseline HEAD` exits with status 0.
6. IF any phase-end verification (build, happy-path route check, or `v0-baseline` ancestry check) fails, THEN THE POC_System SHALL block the start of the next phase, surface a failure indication identifying the specific verification that failed, and preserve the failing commit on the `walrus-poc` branch until the developer resolves the failure and re-runs all phase-end verifications successfully.

---

### Requirement 17: Correctness Properties

**User Story:** As the developer of the POC, I want a consolidated set of correctness properties the POC must uphold, so that property-based tests and integration tests can assert them directly.

#### Acceptance Criteria

1. FOR ALL valid Form_Schema objects `s`, THE POC_System SHALL satisfy `parse(print(s)) == s` (schema serialization round-trip).
2. FOR ALL valid Submission objects `r`, THE POC_System SHALL satisfy `parse(print(r)) == r` (submission serialization round-trip).
3. FOR ALL plaintext byte sequences `p` and the Owner's Local_Signer, THE POC_System SHALL satisfy `decrypt(encrypt(p)) == p` (Seal round-trip).
4. FOR ALL byte sequences `b` uploaded to Walrus, THE POC_System SHALL satisfy `retrieve(upload(b)) == b` (Walrus byte-identity round-trip).
5. FOR ALL Form_Schemas and Submissions going through the full pipeline, THE POC_System SHALL satisfy `decrypt(retrieve(upload(encrypt(print(x))))) == print(x)` (end-to-end pipeline round-trip).
6. FOR ALL Metadata_Records anchored on Sui, THE POC_System SHALL satisfy `sha256(decrypt(retrieve(record.blob_id))) == record.schema_hash` (integrity invariant).
7. FOR ALL Metadata_Records anchored on Sui, THE POC_System SHALL satisfy that the record contains no byte-identical substring of any plaintext Form_Schema or Submission payload (plaintext-leak invariant).
8. FOR ALL Encrypted_Blobs fetched via a public Walrus aggregator request without the Owner's Local_Signer, THE POC_System SHALL satisfy that the fetched bytes do not contain the plaintext payload as a contiguous substring (public-unreadability invariant).
9. FOR ALL Encrypted_Blobs produced for an Owner `O`, THE POC_System SHALL satisfy that a signer `O' != O` invoking the Seal_Decryptor on that blob returns an authorization error rather than plaintext (owner-only decryption invariant).

---

### Requirement 18: Non-Goals and Explicit Exclusions

**User Story:** As the reviewer of this POC, I want the scope boundaries made explicit, so that the POC is not held to production standards and scope creep is prevented.

#### Acceptance Criteria

1. THE POC_System SHALL NOT implement OAuth, Google sign-in, NextAuth sessions, or any form of production authentication; the single actor is the developer running the local machine.
2. THE POC_System SHALL NOT implement role-based access control (`owner`, `admin`, `viewer`), permission middleware, or any authorization policy beyond the Local_Signer-based decryption check.
3. THE POC_System SHALL NOT implement billing, Storage_Credits, WAL/SUI deposit flows, credit deduction, or any storage accounting.
4. THE POC_System SHALL NOT implement multi-tenant isolation, workspace separation, team management, or user invitations.
5. THE POC_System SHALL NOT deploy any component to a VPS, Kubernetes cluster, managed cloud database, KMS, HSM, or production infrastructure during the POC.
6. THE POC_System SHALL NOT introduce message queues, distributed job systems, observability pipelines, analytics pipelines, rate limiters, or CDNs during the POC.
7. THE POC_System SHALL NOT store application logic, execution scripts, or server-side behavior on Walrus; Walrus is used only as opaque blob storage.
8. THE POC_System SHALL NOT store full Form_Schema or Submission payloads on Sui; Sui stores only Metadata_Records containing Blob_IDs, Schema_Hashes, timestamps, and ownership references.
9. WHEN a feature from the `sealbase-platform` production spec is absent in the POC, THE POC_System SHALL NOT treat that absence as a defect; production features are deferred to Stage 2 and Stage 3 of the roadmap.

---

### Requirement 19: Design System and UI Consistency

**User Story:** As a developer using the POC, I want the UI to feel minimal, technical, calm, and trustworthy — in the style of Linear, Vercel, Notion, Raycast, Stripe Docs, and Supabase — so that SealBase reads as serious infrastructure software for encrypted forms rather than a generic crypto dashboard or admin template.

#### Acceptance Criteria

1. THE POC_System SHALL define a centralized Design_Tokens module at `packages/shared/design-tokens.ts` exporting typed tokens for: spacing scale, border radius scale, typography scale, semantic colors, elevation/shadow levels, and animation timings.
2. THE POC_System SHALL import all spacing, radius, typography, color, shadow, and animation-timing values used by any UI surface from the Design_Tokens module; ad-hoc numeric or color literals in component source SHALL be limited to values that do not appear in the Design_Tokens module and SHALL be justified in code comments.
3. THE POC_System SHALL use exactly one of `Inter` or `Geist` as the sole UI typeface and SHALL NOT introduce marketing-sized display fonts, decorative fonts, or additional font families in the POC UI.
4. THE POC_System SHALL restrict the color system to a neutral/slate base with at most one subtle blue accent, and SHALL NOT apply rainbow gradients, neon-saturated purples or cyans, or token-chart-style color palettes on any POC surface.
5. THE POC_System SHALL implement the UI_Primitives set (`Button`, `Input`, `Textarea`, `Card`, `Modal`, `Dropdown`, `Badge`, `Tabs`, `Toast`, `EmptyState`, `LoadingState`, `FormField`) using a `shadcn/ui`-style, variant-based, composable architecture with a single API per primitive.
6. THE POC_System SHALL require all Form_Builder_UI, Form_Submission_UI, Walrus, and submission surfaces to consume the UI_Primitives; duplicated button logic, one-off giant components, and inline styling SHALL be rejected in code review.
7. FOR EVERY asynchronous POC action covering uploads, encryption, submissions, retrieval, and Sui anchoring, THE POC_System SHALL render an explicit visual representation of each UX_State (`idle`, `loading`, `success`, `error`, `empty`) and SHALL NOT leave the user on a blank screen during a pending operation.
8. WHEN a Walrus operation (upload, retrieval, or anchoring) is in flight, THE POC_System SHALL surface progress using encryption-agnostic language (for example, "Securing your form…", "Uploading securely…") and SHALL NOT expose raw terms such as "decentralized blob storage finalization" or internal SDK jargon in user-visible copy.
9. THE POC_System SHALL restrict the Form_Builder_UI V1 field-type palette to exactly `text`, `textarea`, `email`, `number`, `select`, `checkbox` and SHALL NOT introduce drag-heavy builders, workflow engines, conditional logic, or automation systems in the POC.
10. THE POC_System SHALL structure the dashboard information hierarchy, in order of visual prominence, as: Form Name, Submission Count, Encryption Status, Upload Status, Blob Reference, Last Activity; analytics widgets, charts, and marketing content SHALL NOT appear on POC dashboard surfaces.
11. THE POC_System SHALL limit UI animations to opacity fades and small transforms with durations and easings defined in the Design_Tokens module; bouncing, overshoot, parallax, confetti, and crypto-flashy transitions SHALL NOT be used on POC surfaces.
12. THE POC_System SHALL organize UI component source into the folders `components/ui`, `components/forms`, `components/layout`, `components/walrus`, and `components/submissions`, with no mixed-concern or catch-all component folders.
13. THE POC_System SHALL render the Form_Builder_UI and Form_Submission_UI legibly and operably at viewport widths from 360 CSS pixels up to 1920 CSS pixels, with primary optimization for developer-laptop widths between 1280 and 1536 CSS pixels.
14. THE POC_System SHALL include a Design_System_Doc at `docs/design-system.md` defining: visual philosophy, spacing system, component rules, interaction philosophy, animation constraints, and accessibility requirements; each section SHALL be a dedicated markdown heading and SHALL be non-empty.
15. THE POC_System SHALL meet WCAG 2.1 AA contrast ratios for all text and interactive elements on POC surfaces, and all UI_Primitives SHALL be fully operable via keyboard with visible focus indicators drawn from the Design_Tokens module.
16. IF any POC UI surface is introduced that violates Requirements 19.2, 19.3, 19.4, 19.5, 19.6, 19.8, 19.9, 19.10, 19.11, or 19.12, THEN the Form_Builder_UI and Form_Submission_UI completion check SHALL fail until the violation is resolved.
