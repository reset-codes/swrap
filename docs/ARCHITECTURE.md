# SEALBASE — Architecture

## Architectural Principles

1. **Walrus is the source of truth.** All meaningful data lives on Walrus.
2. **PostgreSQL is an index layer only.** It is non-authoritative and reconstructable.
3. **Append-only.** Submissions are immutable. Updates create new entries or status layers.
4. **Submitters are anonymous.** No wallet, no gas, no crypto knowledge required.
5. **Admins own the infrastructure.** Storage credits, encryption policies, and Walrus interactions are admin-managed.

---

## System Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        SEALBASE PLATFORM                        │
├─────────────────────────────────────────────────────────────────┤
│  PRESENTATION LAYER                                             │
│  Next.js 15 · TypeScript · TailwindCSS · shadcn/ui             │
│  Framer Motion · Public Form Pages · Admin Dashboard           │
├─────────────────────────────────────────────────────────────────┤
│  API LAYER                                                      │
│  Next.js API Routes / Fastify · Auth (NextAuth/Google)         │
│  Form API · Submission API · Storage API · Admin API           │
├─────────────────────────────────────────────────────────────────┤
│  SERVICE LAYER                                                  │
│  FormService · SubmissionService · StorageService              │
│  EncryptionService · CreditService · IndexService              │
├─────────────────────────────────────────────────────────────────┤
│  STORAGE ORCHESTRATION LAYER                                    │
│  Walrus SDK Client · Seal Encryption Client                    │
│  Infrastructure Wallet Manager · Blob Reference Tracker        │
├─────────────────────────────────────────────────────────────────┤
│  DATA LAYER                                                     │
│  Walrus (canonical) ←→ PostgreSQL/Prisma (index only)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Ownership Model

### What Lives on Walrus (Canonical)

| Data Type | Description |
|-----------|-------------|
| Form schemas | Full JSON schema of every form version |
| Submission payloads | Complete submission data, encrypted if configured |
| File uploads | Images, videos, documents attached to submissions |
| Encrypted field values | Seal-encrypted sensitive field data |
| Submission manifests | Canonical record linking all blobs for a submission |

### What Lives in PostgreSQL (Index Only)

| Data Type | Description |
|-----------|-------------|
| Walrus blob IDs | References to canonical data on Walrus |
| Submission metadata | form_id, submitted_at, status, submitter_id (anonymous) |
| Form metadata | slug, title, owner_id, created_at, published status |
| Storage credits | Balance, transaction log, wallet references |
| Auth data | User accounts, sessions, roles, permissions |
| Analytics cache | Submission counts, field response aggregates |
| Status tags | open, under_review, planned, resolved, rejected |

### What NEVER Lives in PostgreSQL

- Full submission content
- Uploaded file data
- Sensitive field answers
- Encrypted payloads
- Seal keys or policies

---

## Submission Flow

```
Submitter fills form (browser)
        │
        ▼
[1] Client-side validation
        │
        ▼
[2] File uploads → Walrus (via SEALBASE API)
        │         Returns: blob_id[]
        ▼
[3] Payload assembly (JSON with blob refs)
        │
        ▼
[4] Seal encryption (if form/field configured)
        │         Returns: encrypted_payload + seal_policy_id
        ▼
[5] Canonical submission stored on Walrus
        │         Returns: submission_blob_id
        ▼
[6] Metadata indexed in PostgreSQL
        │         Stores: submission_blob_id, form_id, timestamp, status
        ▼
[7] Storage credits deducted
        │
        ▼
[8] Success response to submitter
```

---

## Form Schema Flow

```
Admin creates/edits form (builder UI)
        │
        ▼
[1] Form schema assembled (JSON)
        │
        ▼
[2] Schema stored on Walrus
        │         Returns: schema_blob_id
        ▼
[3] Form metadata indexed in PostgreSQL
        │         Stores: schema_blob_id, slug, title, owner_id
        ▼
[4] Public URL generated: sealbase.app/f/[slug]
```

---

## Encryption Architecture

### Seal Integration Model

```
Form field marked "encrypted"
        │
        ▼
On submission: field value → Seal.encrypt(value, policy_id)
        │         Returns: encrypted_blob
        ▼
encrypted_blob stored on Walrus
        │
        ▼
Admin requests decryption:
  Seal.decrypt(encrypted_blob, admin_seal_key)
        │         Returns: plaintext value
        ▼
Displayed in admin dashboard (never persisted decrypted)
```

### Encryption Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| None | Payload stored as plaintext on Walrus | Public feedback, bug reports |
| Full submission | Entire payload encrypted | Contributor applications, sensitive surveys |
| Field-level | Individual fields encrypted | Mixed forms with some sensitive fields |

---

## Storage Credit System

```
Admin deposits WAL/SUI
        │
        ▼
Credits recorded in PostgreSQL (balance table)
        │
        ▼
On each Walrus write:
  - Estimate storage cost
  - Check credit balance
  - Execute write via infrastructure wallet
  - Deduct credits from balance
        │
        ▼
Admin dashboard shows:
  - Remaining credits
  - Per-form usage
  - Historical spend
```

### Infrastructure Wallet Model

SEALBASE maintains infrastructure wallets that:
- Hold WAL/SUI deposited by admins
- Execute all Walrus storage operations
- Execute all Seal encryption operations
- Abstract all blockchain interactions from submitters

Admins never expose their personal wallets to submitters. The infrastructure wallet is a SEALBASE-managed intermediary.

---

## Authentication Architecture

| Actor | Auth Method | Notes |
|-------|-------------|-------|
| Admin | Google OAuth (NextAuth) | Required for dashboard access |
| Submitter | None | Anonymous, no account needed |
| Future | Wallet connect (optional) | Planned, not MVP |

### Role Model

| Role | Permissions |
|------|-------------|
| owner | Full access, billing, delete forms, manage team |
| admin | Create/edit forms, view submissions, decrypt, export |
| viewer | View submissions only, no edit, no decrypt |

---

## Database Reconstruction

Because PostgreSQL is an index layer, it can be rebuilt from Walrus:

```
RECONSTRUCTION PROCEDURE:
1. Enumerate all known Walrus blob IDs (from admin records or on-chain)
2. Fetch each blob
3. Identify blob type (form schema, submission, file)
4. Re-index metadata into PostgreSQL
5. Rebuild form slugs, submission references, credit history
```

This is a disaster recovery procedure, not a routine operation. The system is designed so this is possible, not so it is frequent.

---

## Deployment Architecture

```
Vercel (Frontend + API Routes)
    │
    ├── Next.js App (SSR/SSG/ISR)
    ├── API Routes (form, submission, storage, admin)
    └── Edge Functions (public form rendering)

PostgreSQL (Supabase or Railway)
    └── Prisma ORM

Walrus Network
    └── Walrus SDK (blob storage)

Seal Network
    └── Seal SDK (encryption/access control)

Infrastructure Wallets
    └── Managed keypairs for Walrus/Seal operations
```

---

## Key Invariants

1. A submission blob ID on Walrus is the canonical identifier for any submission.
2. PostgreSQL rows without a valid Walrus blob ID are invalid and should be pruned.
3. Encrypted payloads are never decrypted server-side and stored — decryption happens in-memory per request.
4. Storage credits must be checked before any Walrus write. Writes must not proceed if credits are insufficient.
5. Form slugs are unique and immutable after publication.
6. Submission status changes are append-only status layer records, not mutations to the original submission.
