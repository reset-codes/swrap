# Requirements Document

## Introduction

SEALBASE is a Walrus-native decentralized feedback and form infrastructure platform for Web3 teams. It enables feedback collection, bug reports, feature requests, surveys, contributor applications, ecosystem onboarding, community forms, and media-rich submissions. The platform follows a "Web2 UX, Web3 Infrastructure" philosophy: submitters interact with a polished, familiar form experience while all meaningful data is stored on Walrus (decentralized blob storage) and optionally encrypted via Seal. PostgreSQL serves as an index layer only — storing blob references, lightweight metadata, and auth data — never as the canonical data store. The system is append-only; submissions are immutable after creation.

---

## Glossary

- **System**: The SEALBASE platform as a whole, including frontend, API, service, and storage layers.
- **Admin**: An authenticated user with `owner` or `admin` role who manages forms, views submissions, and controls storage credits.
- **Owner**: An Admin with the highest privilege level — full access including billing, form deletion, and team management.
- **Viewer**: An authenticated user with read-only access to submissions; cannot edit, decrypt, or export.
- **Submitter**: An anonymous end-user who fills out and submits a public form; requires no account, wallet, or crypto knowledge.
- **Form**: A structured data collection schema created by an Admin, consisting of ordered fields with configuration, published at a unique public URL.
- **Field**: A single input element within a Form, with a type, label, configuration options, and optional encryption toggle.
- **Submission**: An immutable record of a Submitter's response to a Form, canonically stored as a blob on Walrus.
- **Walrus**: The decentralized blob storage network that serves as the canonical source of truth for all meaningful data.
- **Seal**: The encryption and access-control service used to encrypt sensitive field values and full submission payloads.
- **Blob**: A binary object stored on Walrus, identified by a globally unique `walrus_blob_id`.
- **Submission_Blob_ID**: The canonical Walrus blob identifier for a submission; the authoritative identifier for that submission.
- **Form_Schema**: A JSON document describing a Form's fields, configuration, and metadata, stored as a Blob on Walrus.
- **Storage_Credits**: A balance of WAL/SUI tokens deposited by an Admin that is consumed by Walrus write operations.
- **Infrastructure_Wallet**: A SEALBASE-managed keypair that executes all Walrus and Seal operations on behalf of Admins and Submitters.
- **Seal_Policy**: An access-control policy created in Seal that governs who may decrypt a given encrypted payload.
- **Status_Tag**: An append-only label applied to a Submission by an Admin; one of: `open`, `under_review`, `planned`, `resolved`, `rejected`.
- **Form_Builder**: The Admin UI for creating and editing Forms, supporting Table Mode and Conversational Mode.
- **Conversational_Mode**: A Typeform-style form presentation that shows one question at a time with animated transitions.
- **Table_Mode**: An Airtable/basic-form-style presentation that shows all fields simultaneously in a compact layout.
- **Dashboard**: The authenticated Admin interface for managing Forms, viewing Submissions, and monitoring Storage_Credits.
- **Public_Form**: The publicly accessible form page at `sealbase.app/f/[slug]` where Submitters fill out and submit a Form.
- **Slug**: A unique, URL-safe identifier for a Form, immutable after publication.
- **IndexService**: The service responsible for writing lightweight metadata to PostgreSQL after a successful Walrus write.
- **StorageService**: The service responsible for estimating costs, checking credits, executing Walrus writes, and deducting credits.
- **EncryptionService**: The service responsible for encrypting and decrypting field values and payloads via Seal.
- **CreditService**: The service responsible for managing Storage_Credit balances, deposits, and deductions.
- **FormService**: The service responsible for form creation, editing, schema serialization, and publishing.
- **SubmissionService**: The service responsible for assembling, storing, and indexing Submissions.
- **Pretty_Printer**: A function that serializes a structured object (Form_Schema, Submission payload) back into its canonical JSON string representation.
- **Validator**: The component responsible for validating API inputs and form field values against defined schemas.

---

## Requirements

### Requirement 1: Admin Authentication

**User Story:** As a Web3 team member, I want to log in with my Google account, so that I can access the SEALBASE admin dashboard without managing a separate password or connecting a crypto wallet.

#### Acceptance Criteria

1. WHEN an unauthenticated user visits any dashboard route, THE System SHALL redirect them to the login page.
2. WHEN a user initiates Google OAuth login, THE System SHALL authenticate them via NextAuth and create or retrieve their user record.
3. WHEN authentication succeeds, THE System SHALL assign the user a role of `owner` (first user in a workspace) or `admin` (subsequent invites) and redirect them to the dashboard.
4. IF authentication fails due to a Google OAuth error, THEN THE System SHALL display a descriptive error message and allow the user to retry.
5. WHEN an authenticated Admin accesses a route requiring elevated privileges, THE System SHALL enforce role-based access control at the API layer.
6. THE System SHALL support three roles: `owner`, `admin`, and `viewer`, each with distinct permission sets as defined in the architecture.
7. WHEN an Admin session expires, THE System SHALL redirect the user to the login page without data loss.

---

### Requirement 2: Role-Based Access Control

**User Story:** As an Owner, I want to control what each team member can do, so that sensitive operations like decryption and form deletion are restricted to authorized roles.

#### Acceptance Criteria

1. THE System SHALL restrict form deletion to users with the `owner` role.
2. THE System SHALL restrict Seal decryption of encrypted submissions to users with `admin` or `owner` roles.
3. THE System SHALL restrict CSV export to users with `admin` or `owner` roles.
4. THE System SHALL allow users with the `viewer` role to view submission metadata and status tags but not decrypt or export.
5. WHEN a user with insufficient role attempts a restricted action, THE System SHALL return an HTTP 403 response with a descriptive error message.
6. THE System SHALL enforce role checks at the API layer, independent of UI-level controls.

---

### Requirement 3: Form Builder — Field System

**User Story:** As an Admin, I want to build forms with a rich set of field types and configuration options, so that I can collect exactly the data my team needs.

#### Acceptance Criteria

1. THE FormService SHALL support the following field types: `short_text`, `long_text`, `rich_text`, `dropdown`, `multi_select`, `checkbox`, `star_rating`, `url`, `image_upload`, `video_upload`, `file_upload`.
2. WHEN an Admin configures a field, THE FormService SHALL allow setting: required toggle, placeholder text, help text, validation rules, and encryption toggle.
3. WHEN the encryption toggle is enabled on a field, THE System SHALL mark that field for Seal encryption before Walrus storage.
4. THE FormService SHALL validate that each field has a non-empty label before the form can be saved.
5. WHEN an Admin reorders fields using drag-and-drop, THE FormService SHALL preserve the new field order in the Form_Schema.
6. THE FormService SHALL support adding, editing, and removing fields from a form before publication.

---

### Requirement 4: Form Builder — Modes and Publishing

**User Story:** As an Admin, I want to choose between Conversational and Table form modes and publish my form to a unique public URL, so that submitters get the right experience for my use case.

#### Acceptance Criteria

1. THE FormService SHALL support two form presentation modes: `conversational` and `table`.
2. WHEN an Admin selects `conversational` mode, THE System SHALL render the Public_Form as a Typeform-style one-question-at-a-time experience with animated transitions.
3. WHEN an Admin selects `table` mode, THE System SHALL render the Public_Form as a compact, all-fields-visible layout.
4. WHEN an Admin publishes a form, THE FormService SHALL serialize the Form_Schema to JSON and store it as a Blob on Walrus.
5. WHEN the Form_Schema Blob is successfully stored, THE FormService SHALL index the `schema_blob_id`, `slug`, `title`, and `owner_id` in PostgreSQL.
6. WHEN a form is published, THE System SHALL generate a unique public URL of the format `sealbase.app/f/[slug]`.
7. THE System SHALL enforce that a Slug is unique across all published forms.
8. WHEN a form is published, THE System SHALL make the Slug immutable — it cannot be changed after publication.
9. WHEN an Admin saves a new version of an already-published form, THE FormService SHALL store a new Form_Schema Blob on Walrus and update the `schema_blob_id` reference in PostgreSQL, preserving the original Slug.
10. IF a Walrus write fails during form publishing, THEN THE FormService SHALL not mark the form as published and SHALL return an error to the Admin.

---

### Requirement 5: Form Schema Serialization

**User Story:** As a developer, I want form schemas to be reliably serialized and deserialized, so that form definitions are faithfully preserved across storage and retrieval cycles.

#### Acceptance Criteria

1. WHEN a Form_Schema is serialized to JSON, THE Pretty_Printer SHALL produce a valid JSON string that fully represents all fields, their types, order, and configuration.
2. WHEN a JSON string is parsed back into a Form_Schema, THE System SHALL produce an object equivalent to the original Form_Schema.
3. FOR ALL valid Form_Schema objects, serializing then parsing SHALL produce an equivalent Form_Schema (round-trip property).
4. WHEN a Form_Schema JSON string contains an unrecognized field type, THE Validator SHALL return a descriptive parse error.
5. WHEN a Form_Schema JSON string is malformed, THE Validator SHALL return a descriptive parse error.

---

### Requirement 6: Public Form Submission

**User Story:** As a Submitter, I want to fill out and submit a form at a public URL without needing an account, wallet, or any crypto knowledge, so that I can provide feedback effortlessly.

#### Acceptance Criteria

1. WHEN a Submitter visits `sealbase.app/f/[slug]`, THE System SHALL render the Public_Form without requiring authentication.
2. WHEN the Public_Form is in `conversational` mode, THE System SHALL display one field at a time with animated transitions between questions.
3. WHEN the Public_Form is in `table` mode, THE System SHALL display all fields simultaneously in a scrollable layout.
4. WHEN a Submitter attempts to advance past a required field without providing a value, THE System SHALL prevent advancement and display a validation error.
5. WHEN a Submitter submits a form, THE SubmissionService SHALL assemble the submission payload as a JSON object containing all field values and blob references for uploaded files.
6. WHEN a Submitter uploads a file, THE StorageService SHALL upload the file to Walrus and return a `blob_id` before the submission is assembled.
7. WHEN the submission payload is assembled, THE SubmissionService SHALL store the canonical submission as a Blob on Walrus.
8. WHEN the submission Blob is successfully stored, THE IndexService SHALL index the `submission_blob_id`, `form_id`, `submitted_at`, and initial status `open` in PostgreSQL.
9. WHEN the submission is successfully indexed, THE CreditService SHALL deduct the storage cost from the Admin's Storage_Credits balance.
10. WHEN submission is complete, THE System SHALL display a success state to the Submitter.
11. IF the Walrus write for the submission fails, THEN THE System SHALL not index the submission in PostgreSQL and SHALL display an error to the Submitter.
12. THE System SHALL not require Submitters to provide any personally identifiable information unless the form explicitly includes such fields.

---

### Requirement 7: Submission Immutability

**User Story:** As an Admin, I want submitted data to be immutable and append-only, so that I have a trustworthy, auditable record that cannot be tampered with.

#### Acceptance Criteria

1. WHEN a Submission is stored on Walrus, THE System SHALL treat the Submission_Blob_ID as the permanent canonical identifier for that Submission.
2. THE SubmissionService SHALL never update or overwrite an existing Submission Blob on Walrus.
3. WHEN an Admin updates the Status_Tag of a Submission, THE System SHALL create a new status layer record in PostgreSQL referencing the original Submission_Blob_ID, rather than modifying the original record.
4. THE System SHALL support the following Status_Tags: `open`, `under_review`, `planned`, `resolved`, `rejected`.
5. WHEN a Status_Tag is applied, THE System SHALL record the `admin_id`, `new_status`, and `timestamp` in the status layer record.
6. THE System SHALL allow multiple Status_Tag changes over time, each recorded as a separate append-only entry.

---

### Requirement 8: Storage Pipeline — Walrus Integration

**User Story:** As an Admin, I want all meaningful data to be stored on Walrus, so that my data is decentralized, censorship-resistant, and not dependent on SEALBASE's database.

#### Acceptance Criteria

1. THE StorageService SHALL store all Form_Schemas, Submission payloads, and uploaded files on Walrus before considering any operation complete.
2. WHEN a Walrus write fails, THE StorageService SHALL retry the operation up to 3 times with exponential backoff before returning an error.
3. IF a Walrus write fails after all retries, THEN THE StorageService SHALL not index the data in PostgreSQL and SHALL return an error to the caller.
4. WHEN a Walrus write succeeds, THE StorageService SHALL return the `walrus_blob_id` to the caller.
5. THE System SHALL never treat a PostgreSQL record as valid if it lacks a corresponding `walrus_blob_id`.
6. WHEN a Walrus read is requested for a Submission, THE StorageService SHALL fetch the Blob by its `walrus_blob_id` and return the payload.

---

### Requirement 9: Storage Pipeline — Seal Encryption

**User Story:** As an Admin, I want sensitive submission data to be encrypted via Seal before storage, so that only authorized admins can access confidential information.

#### Acceptance Criteria

1. WHEN a form has one or more fields with the encryption toggle enabled, THE EncryptionService SHALL encrypt those field values via Seal before the submission payload is sent to Walrus.
2. WHEN full-submission encryption is configured, THE EncryptionService SHALL encrypt the entire submission payload via Seal before Walrus storage.
3. WHEN encryption is applied, THE EncryptionService SHALL use a Seal_Policy associated with the form to control decryption access.
4. THE EncryptionService SHALL never store plaintext versions of encrypted field values in PostgreSQL, logs, or error messages.
5. WHEN an authorized Admin requests decryption of an encrypted Submission, THE EncryptionService SHALL decrypt the payload in-memory via Seal and return the plaintext values without persisting them.
6. WHEN a user without `admin` or `owner` role requests decryption, THE System SHALL return an HTTP 403 error.
7. IF Seal encryption fails, THEN THE EncryptionService SHALL abort the submission storage operation and return an error to the caller.
8. WHEN a Submission contains encrypted fields, THE Dashboard SHALL display an encryption indicator for those fields.

---

### Requirement 10: Storage Credits

**User Story:** As an Admin, I want to deposit storage credits and have them automatically deducted per Walrus write, so that I have predictable cost control over my team's storage usage.

#### Acceptance Criteria

1. WHEN an Admin deposits WAL or SUI, THE CreditService SHALL record the deposit and update the Admin's Storage_Credits balance in PostgreSQL.
2. BEFORE any Walrus write, THE CreditService SHALL check that the Admin's Storage_Credits balance is sufficient to cover the estimated write cost.
3. IF the Storage_Credits balance is insufficient, THEN THE System SHALL return an HTTP 402 error with a descriptive message and SHALL not proceed with the Walrus write.
4. WHEN a Walrus write succeeds, THE CreditService SHALL deduct the actual storage cost from the Admin's Storage_Credits balance.
5. THE Dashboard SHALL display the Admin's current Storage_Credits balance.
6. THE Dashboard SHALL display per-form storage usage and historical credit spend.
7. WHEN the Storage_Credits balance falls below a configurable threshold, THE System SHALL display a low-credits warning in the Dashboard.
8. THE Infrastructure_Wallet SHALL execute all Walrus storage operations on behalf of Admins, abstracting all blockchain interactions from Submitters.

---

### Requirement 11: Admin Dashboard — Forms Management

**User Story:** As an Admin, I want a clear overview of all my forms with submission counts and quick actions, so that I can efficiently manage my feedback infrastructure.

#### Acceptance Criteria

1. WHEN an Admin visits the Dashboard, THE System SHALL display a list of all Forms owned by or accessible to that Admin.
2. WHEN displaying the Forms list, THE System SHALL show each form's title, Slug, publication status, submission count, and creation date.
3. WHEN an Admin clicks a Form, THE System SHALL navigate to the Form's submission viewer.
4. WHEN an Admin creates a new Form, THE System SHALL open the Form_Builder.
5. WHEN an Admin deletes a Form (owner only), THE System SHALL remove the Form's metadata from PostgreSQL and display a confirmation dialog before proceeding.
6. THE Dashboard SHALL display an empty state when no Forms exist.

---

### Requirement 12: Admin Dashboard — Submission Viewer

**User Story:** As an Admin, I want to view, filter, search, and manage all submissions for my forms, so that I can efficiently process feedback and track resolution status.

#### Acceptance Criteria

1. WHEN an Admin opens a Form's submission viewer, THE System SHALL display a paginated list of all Submissions for that Form.
2. WHEN displaying Submissions, THE System SHALL show the Submission_Blob_ID, submission timestamp, current Status_Tag, and a preview of non-encrypted field values.
3. WHEN an Admin filters Submissions by Status_Tag, THE System SHALL return only Submissions matching the selected status.
4. WHEN an Admin searches Submissions by keyword, THE System SHALL return Submissions whose indexed metadata matches the search term.
5. WHEN an Admin opens a Submission detail view, THE System SHALL display all field values, file previews, the Walrus blob reference, and the encryption indicator for encrypted fields.
6. WHEN an Admin clicks "Decrypt" on an encrypted field, THE EncryptionService SHALL decrypt the value in-memory and display it without persisting the plaintext.
7. WHEN an Admin updates the Status_Tag of a Submission, THE System SHALL create an append-only status layer record and update the displayed status.
8. WHEN an Admin exports Submissions to CSV, THE System SHALL include metadata and decrypted field values (for authorized roles) in the export file.
9. THE System SHALL display media previews (images, videos) inline in the Submission detail view.
10. THE System SHALL display Walrus blob IDs in monospace font with a copy-to-clipboard action.

---

### Requirement 13: Storage Analytics

**User Story:** As an Admin, I want to see storage usage analytics, so that I can understand my costs and plan credit deposits accordingly.

#### Acceptance Criteria

1. THE Dashboard SHALL display total Storage_Credits consumed across all Forms.
2. THE Dashboard SHALL display per-Form storage usage broken down by Blob type (submissions, file uploads, form schemas).
3. THE Dashboard SHALL display a historical credit spend log with timestamps and amounts.
4. WHEN an Admin views the analytics page, THE System SHALL display the current Storage_Credits balance prominently.

---

### Requirement 14: Public Form — Validation and UX

**User Story:** As a Submitter, I want clear validation feedback and a smooth submission experience, so that I can complete forms accurately without confusion.

#### Acceptance Criteria

1. WHEN a Submitter provides an invalid value for a field (e.g., non-URL in a URL field), THE Validator SHALL display a field-level error message adjacent to the field.
2. WHEN a Submitter submits a form with one or more validation errors, THE System SHALL prevent submission and highlight all invalid fields.
3. WHEN a file upload is in progress, THE System SHALL display an upload progress indicator.
4. WHEN a file upload exceeds the maximum allowed size, THE System SHALL display an error message and prevent the upload.
5. WHEN a Submitter completes a Conversational_Mode form, THE System SHALL display a progress indicator showing the current question number and total question count.
6. WHEN a Submitter successfully submits a form, THE System SHALL display a success confirmation screen.
7. THE Public_Form SHALL be fully functional on mobile devices at viewport widths of 640px and above.
8. THE Public_Form SHALL load within 2 seconds on a 4G connection.

---

### Requirement 15: Infrastructure Wallet and Blockchain Abstraction

**User Story:** As a Submitter, I want to submit forms without any knowledge of wallets, gas, or blockchain, so that the experience feels like a normal web application.

#### Acceptance Criteria

1. THE System SHALL never require Submitters to connect a wallet, sign a transaction, or hold any cryptocurrency.
2. THE Infrastructure_Wallet SHALL execute all Walrus write operations on behalf of Submitters and Admins.
3. THE Infrastructure_Wallet SHALL execute all Seal encryption operations on behalf of Admins.
4. THE System SHALL never expose Infrastructure_Wallet private keys in API responses, logs, or error messages.
5. WHEN an Infrastructure_Wallet operation fails, THE System SHALL surface a user-friendly error message without exposing internal wallet details.

---

### Requirement 16: API Design and Error Handling

**User Story:** As a developer integrating with SEALBASE, I want consistent, predictable API responses, so that I can build reliable integrations.

#### Acceptance Criteria

1. THE System SHALL return all successful API responses in the format `{ success: true, data: T }`.
2. THE System SHALL return all error API responses in the format `{ success: false, error: { code: string, message: string } }`.
3. THE Validator SHALL validate all API inputs using Zod schemas before processing.
4. IF API input validation fails, THEN THE System SHALL return an HTTP 400 response with a descriptive validation error.
5. THE System SHALL never expose internal error messages, stack traces, or sensitive values in API error responses.
6. WHEN a storage credit check fails, THE System SHALL return an HTTP 402 response.
7. WHEN an authorization check fails, THE System SHALL return an HTTP 403 response.

---

### Requirement 17: Form Import (Bonus)

**User Story:** As an Admin migrating from another platform, I want to import my existing forms from Typeform, Google Forms, or Airtable, so that I can adopt SEALBASE without rebuilding my forms from scratch.

#### Acceptance Criteria

1. WHEN an Admin provides a Typeform JSON export, THE System SHALL parse the schema and create an equivalent Form in SEALBASE with all supported field types mapped.
2. WHEN an Admin provides a Google Forms JSON export, THE System SHALL parse the schema and create an equivalent Form in SEALBASE with all supported field types mapped.
3. WHEN an Admin provides an Airtable base schema export, THE System SHALL parse the schema and create an equivalent Form in SEALBASE with all supported field types mapped.
4. WHEN an imported schema contains field types not supported by SEALBASE, THE System SHALL skip those fields and notify the Admin of the skipped fields.
5. WHEN an import is complete, THE System SHALL present the Admin with the imported Form in the Form_Builder for review and editing before publication.
6. FOR ALL valid import schemas, parsing then serializing to a SEALBASE Form_Schema SHALL produce a valid Form_Schema (round-trip property).

---

### Requirement 18: Dashboard Performance and Accessibility

**User Story:** As an Admin, I want the dashboard to load quickly and be accessible, so that I can work efficiently and the product is usable by everyone.

#### Acceptance Criteria

1. THE Dashboard SHALL load within 3 seconds on a standard broadband connection.
2. THE System SHALL paginate all list views and SHALL never load unbounded lists.
3. THE Dashboard SHALL display skeleton loading states while data is being fetched.
4. THE Dashboard SHALL display appropriate empty states when no data exists for a given view.
5. ALL interactive elements in the Dashboard SHALL have accessible labels compliant with WCAG 2.1 AA standards.
6. ALL form fields in the Dashboard SHALL have associated labels and error messages linked via `aria-describedby`.
7. THE Dashboard SHALL support keyboard navigation for all interactive elements.
8. THE Dashboard SHALL be optimized for viewport widths of 1024px and above, with a collapsible sidebar at 768px.

---

### Requirement 19: Data Integrity Invariants

**User Story:** As a system architect, I want the platform to enforce core data integrity rules at all times, so that the system remains trustworthy and reconstructable from Walrus.

#### Acceptance Criteria

1. THE System SHALL ensure every Submission record in PostgreSQL has a valid `walrus_blob_id` before the record is considered persisted.
2. THE System SHALL ensure every Form record in PostgreSQL has a valid `schema_blob_id` before the form is considered published.
3. THE System SHALL ensure that Slugs are unique across all Forms at the time of publication.
4. THE System SHALL ensure that Slugs are immutable after a Form is published.
5. THE System SHALL ensure that Submission payloads are never modified after initial storage on Walrus.
6. THE System SHALL ensure that Storage_Credits are checked and confirmed sufficient before any Walrus write is initiated.
7. THE System SHALL ensure that encrypted payloads are never decrypted and persisted — decryption occurs in-memory only.
