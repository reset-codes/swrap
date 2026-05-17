-- Migration 0001: core schema
-- Creates all seven metadata tables for the Walrus-native ZK Login architecture.
--
-- Design invariants enforced here:
--   • No bytea columns — content bodies live on Walrus, not in Postgres.
--   • No jsonb_body / plaintext / cipher / private_key columns.
--   • Every table that references a Walrus blob carries a UNIQUE constraint on walrus_blob_id.
--   • Foreign keys: submissions → forms, files → submissions, permissions → forms.
--   • All state columns are constrained to the Upload_State_Machine state set.
--
-- Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. users
--    One row per known signer address, created lazily on first authenticated
--    request. The address is the canonical Authorization_Identity used for
--    ownership mapping, viewer permissions, and audit attribution.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  address          TEXT        PRIMARY KEY,                          -- Sui address (0x-prefixed)
  signer_kind      TEXT        NOT NULL
                               CHECK (signer_kind IN ('zk-login', 'external-wallet')),
  display_name     TEXT,                                             -- optional, user-set
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. forms
--    One row per Form_Definition version. The canonical body lives on Walrus;
--    this row holds only the blob reference, ownership, privacy mode, and state.
--    A privacy mode change creates a new version row (predecessor_id links them).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE forms (
  id               UUID        PRIMARY KEY,
  owner_address    TEXT        NOT NULL REFERENCES users(address),
  walrus_blob_id   TEXT        NOT NULL UNIQUE,                      -- canonical Form_Definition blob
  privacy_mode     TEXT        NOT NULL
                               CHECK (privacy_mode IN ('public', 'private')),
  policy_id        TEXT,                                             -- Seal_Policy ID; NULL for public forms
  version          INTEGER     NOT NULL DEFAULT 1,
  predecessor_id   UUID        REFERENCES forms(id),                 -- prior version on privacy change
  state            TEXT        NOT NULL
                               CHECK (state IN ('pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A private form MUST have a policy_id; a public form MUST NOT require one.
  CHECK (privacy_mode = 'public' OR policy_id IS NOT NULL)
);

CREATE INDEX forms_owner_idx ON forms(owner_address);
CREATE INDEX forms_state_idx ON forms(state);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. submissions
--    One row per Submission_Payload (plaintext or ciphertext blob on Walrus).
--    The composite UNIQUE(form_id, walrus_blob_id) supports idempotent reconcile
--    when the client retries a metadata write after an orphan timeout.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE submissions (
  id                 UUID        PRIMARY KEY,
  form_id            UUID        NOT NULL REFERENCES forms(id),
  form_version       INTEGER     NOT NULL,
  submitter_address  TEXT        NOT NULL REFERENCES users(address),
  walrus_blob_id     TEXT        NOT NULL UNIQUE,                    -- Submission_Payload blob
  privacy_mode       TEXT        NOT NULL
                                 CHECK (privacy_mode IN ('public', 'private')),
  content_digest     TEXT        NOT NULL,                           -- SHA-256(bytes), hex-encoded
  size_bytes         BIGINT      NOT NULL CHECK (size_bytes >= 0),
  state              TEXT        NOT NULL
                                 CHECK (state IN ('pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, walrus_blob_id)                                   -- idempotent reconcile support
);

CREATE INDEX submissions_form_idx  ON submissions(form_id);
CREATE INDEX submissions_owner_idx ON submissions(submitter_address);
CREATE INDEX submissions_state_idx ON submissions(state);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. files
--    One row per file attachment associated with a submission. File bytes live
--    on Walrus; this row holds only the blob reference, content type, size, and
--    integrity digest.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE files (
  id              UUID        PRIMARY KEY,
  submission_id   UUID        NOT NULL REFERENCES submissions(id),
  walrus_blob_id  TEXT        NOT NULL UNIQUE,                       -- file attachment blob
  content_type    TEXT        NOT NULL,
  size_bytes      BIGINT      NOT NULL CHECK (size_bytes >= 0),
  content_digest  TEXT        NOT NULL,                              -- SHA-256(bytes), hex-encoded
  state           TEXT        NOT NULL
                              CHECK (state IN ('pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX files_submission_idx ON files(submission_id);
CREATE INDEX files_state_idx      ON files(state);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. upload_jobs
--    Server-visible reflection of the client Upload_Job, used for reconciliation
--    and audit. artifact_id and walrus_blob_id are NULL until the corresponding
--    step completes. The composite UNIQUE(owner_address, walrus_blob_id) makes
--    retry writes idempotent once a blob ID is known.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE upload_jobs (
  id              UUID        PRIMARY KEY,
  owner_address   TEXT        NOT NULL REFERENCES users(address),
  artifact_kind   TEXT        NOT NULL
                              CHECK (artifact_kind IN ('form', 'submission', 'file')),
  artifact_id     UUID,                                              -- NULL until indexed
  walrus_blob_id  TEXT,                                              -- NULL until uploaded
  state           TEXT        NOT NULL
                              CHECK (state IN ('pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed')),
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_address, walrus_blob_id)                             -- idempotent on retry
);

CREATE INDEX upload_jobs_state_idx ON upload_jobs(state);
CREATE INDEX upload_jobs_owner_idx ON upload_jobs(owner_address);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. activity
--    Append-only audit log. Records every decryption operation (successful and
--    rejected), every failed authorization attempt, and key API actions.
--    Rows are never updated or deleted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE activity (
  id           BIGSERIAL   PRIMARY KEY,
  request_id   TEXT        NOT NULL,
  actor_address TEXT,                                                -- NULL for unauthenticated requests
  action       TEXT        NOT NULL,                                 -- e.g. "submission.create", "submission.decrypt"
  target_kind  TEXT,                                                 -- e.g. "form", "submission", "file"
  target_id    UUID,
  outcome      TEXT        NOT NULL
               CHECK (outcome IN ('ok', 'denied', 'error')),
  http_status  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX activity_actor_idx   ON activity(actor_address);
CREATE INDEX activity_action_idx  ON activity(action);
CREATE INDEX activity_created_idx ON activity(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. permissions
--    Forward-compatible viewer/submit/manage grants for shared and protected
--    form modes. Currently owner-only access is enforced at the application
--    layer; this table is the extension point for future sharing flows.
--    The composite UNIQUE(form_id, grantee_address, capability) prevents
--    duplicate grants and makes grant writes idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE permissions (
  id                  UUID        PRIMARY KEY,
  form_id             UUID        NOT NULL REFERENCES forms(id),
  grantee_address     TEXT        NOT NULL REFERENCES users(address),
  capability          TEXT        NOT NULL
                                  CHECK (capability IN ('view', 'submit', 'manage')),
  granted_by_address  TEXT        NOT NULL REFERENCES users(address),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, grantee_address, capability)
);
