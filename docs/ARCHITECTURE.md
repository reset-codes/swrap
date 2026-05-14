# Walrus Testnet POC — Architecture

> **Scope:** This document describes the `walrus-poc` branch only. It is **not** the production SEALBASE architecture (see `docs/ARCHITECTURE.md` on the `main` branch for that). The POC is a single-developer, single-machine, testnet-connected proof of concept. Everything here is intentionally simplified.

---

## 1. POC System Overview

### What it is

The Walrus Testnet POC validates the complete SEALBASE data flow end-to-end on a single developer machine connected to Sui testnet and Walrus testnet:

```
Form_Schema → canonicalize → encrypt → upload to Walrus → anchor hash on Sui
           → retrieve from Walrus → decrypt → render
Submission  → (same pipeline, linked to form_blob_id)
```

The POC lives on branch `walrus-poc`, forked from the annotated tag `v0-baseline`. All code is **additive** — the existing `src/lib/{seal,walrus,wallet}/*` and `src/app/api/{forms,submissions,upload}/*` files are never edited. The default branch continues to build and `v0-baseline` remains a clean rollback anchor.

### What it is not

The POC intentionally excludes:

| Excluded | Reason |
|---|---|
| OAuth / NextAuth / sessions | Single trusted developer; no auth needed |
| RBAC (owner/admin/viewer roles) | "Owner" = active Sui address from local keystore |
| Multi-tenant isolation | No workspace, team, or user tables |
| Billing / storage credits | Walrus testnet publisher pays fees on behalf of uploader |
| Production infrastructure | No VPS, managed DB, KMS/HSM, queue, CDN, or observability pipeline |
| PostgreSQL / Prisma | Local_Store is browser-side Zustand + localStorage |
| Walrus writes on the default branch | Production routes remain as-is, require NextAuth |

These are **design invariants**, not aspirations. Any requirement that conflicts with them belongs in `sealbase-platform`, not here.

### Component + deployment view

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Browser (single dev machine, trusted environment)                            │
│  ─────────────────────────────────────────────────────────────────────────    │
│  /poc                     Status dashboard (reads /api/poc/health)            │
│  /poc/forms/new           Form_Builder_UI                                     │
│  /poc/forms/[blob_id]     Owner preview                                       │
│  /poc/forms/[blob_id]/fill  Form_Submission_UI                                │
│  /poc/submissions/[blob_id] Owner-only submission view                        │
│                                                                                │
│  Zustand (persist) store: swrap-poc@1                                      │
│  localStorage (form & submission index)                                       │
└───────────────────────────────────────────────────────────────────────────────┘
                                │ fetch (same-origin)
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Next.js 15 server (next dev / next start) — same process                     │
│  ─────────────────────────────────────────────────────────────────────────    │
│  src/app/api/poc/health/route.ts         ── apps/api/health                   │
│  src/app/api/poc/forms/route.ts          ── apps/api/forms (POST)             │
│  src/app/api/poc/forms/[blob_id]/route.ts                                     │
│  src/app/api/poc/submissions/route.ts    ── apps/api/submissions (POST)       │
│  src/app/api/poc/submissions/[blob_id]/route.ts                               │
│  src/app/api/poc/metadata/[address]/route.ts                                  │
│                                                                                │
│  (all bypass NextAuth middleware — see Trust Assumptions)                     │
│                                                                                │
│         ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           │
│         │ @poc/shared   │    │ @poc/seal     │    │ @poc/walrus   │           │
│         │  Env_Loader   │    │  Encryptor    │    │  Walrus_Client│           │
│         │  Pretty_Print │    │  Decryptor    │    │  (HTTP)       │           │
│         │  Parser       │    │  Encrypted_   │    └──────┬────────┘           │
│         │  Validator    │    │  Blob format  │           │                    │
│         │  types        │    └──────┬────────┘           │                    │
│         └───────┬───────┘           │                    │                    │
│                 │                   ▼                    │                    │
│                 │           ┌───────────────┐            │                    │
│                 └──────────▶│ @poc/sui      │            │                    │
│                             │  Signer_Detect│            │                    │
│                             │  Sui_Client   │            │                    │
│                             │  Metadata_    │            │                    │
│                             │  Anchor       │            │                    │
│                             └──────┬────────┘            │                    │
└────────────────────────────────────┼─────────────────────┼────────────────────┘
                                     │                     │
                                     ▼                     ▼
┌──────────────────┐  ┌────────────────────────┐  ┌──────────────────────────┐
│ Local Sui CLI    │  │ Sui testnet RPC        │  │ Walrus testnet           │
│ ~/.sui/sui_      │  │ https://fullnode.      │  │ publisher:               │
│   config/        │  │   testnet.sui.io:443   │  │ https://publisher.       │
│   client.yaml    │  │                        │  │   walrus-testnet.        │
│   sui.keystore   │  │ (read-only for POC     │  │   walrus.space           │
│                  │  │  except Metadata       │  │ aggregator:              │
│ (read once,      │  │  anchor tx)            │  │ https://aggregator.      │
│  at startup)     │  │                        │  │   walrus-testnet.        │
└──────────────────┘  └────────────────────────┘  │   walrus.space           │
                                                  └──────────────────────────┘
```

---

## 2. Trust Assumptions

The POC operates under a **single trusted developer machine** model. The following assumptions are explicit and intentional:

| Assumption | Implication |
|---|---|
| The developer's machine is trusted | No network-level auth, no TLS client certificates, no rate limiting |
| The local Sui keystore is trusted | Private key bytes are read from `~/.sui/sui_config/sui.keystore` at startup; the file is not encrypted at rest |
| The developer is both Owner and Respondent | The same local signer creates forms and fills them out; no multi-party trust model |
| Testnet funds are free | No credit accounting; the Walrus publisher pays Sui fees on behalf of the uploader |
| No production traffic | The `/api/poc/*` routes and `/poc/*` pages bypass NextAuth entirely |
| `DEV_BYPASS_STORAGE=true` is the default | Production storage-credit checks are skipped |

**These assumptions are NOT acceptable in production.** See `docs/security.md` for the migration path to a production trust model.

### What the POC does NOT protect against

- A compromised developer machine (the keystore file is readable by any process with filesystem access)
- Replay attacks (no nonce or timestamp validation on the Walrus upload path)
- Unauthorized reads from Walrus (blobs are encrypted, but the blob IDs are stored in localStorage and are not secret)
- Sui testnet reorganizations (testnet is not finality-guaranteed)

---

## 3. Local_Signer Model

The `Local_Signer` is the single identity used for all Sui and Walrus operations during the POC. It is loaded once at process startup by the `Signer_Detector` component.

### How the keypair is loaded

```
Signer_Detector.detectLocalSigner()
  │
  ├─ 1. Read ~/.sui/sui_config/client.yaml
  │       Extract: active_address, active_env, keystore.File path
  │
  ├─ 2. Read ~/.sui/sui_config/sui.keystore
  │       JSON array of bech32-encoded private keys (suiprivkey1...)
  │
  ├─ 3. For each keystore entry:
  │       decodeSuiPrivateKey(entry) → { schema, secretKey }
  │       buildKeypair(schema, secretKey) → Ed25519 | Secp256k1 | Secp256r1
  │       keypair.toSuiAddress() === active_address? → match found
  │
  └─ 4. Wrap matched keypair in PocSigner closure
          Expose: scheme, address, getPublicKey(), signPersonalMessage(),
                  signTransaction(), deriveSymmetricKey(salt, info)
          Never expose: raw secret bytes
```

### PocSigner interface

```typescript
interface PocSigner {
  readonly scheme: 'ed25519' | 'secp256k1' | 'secp256r1';
  readonly address: string;                 // 0x-prefixed 32-byte hex
  getPublicKey(): Uint8Array;
  signPersonalMessage(bytes: Uint8Array): Promise<{ signature: string; bytes: string }>;
  signTransaction(tx: TransactionBlock): Promise<{ signature: string; bytes: string }>;
  deriveSymmetricKey(salt: Uint8Array, info: Uint8Array): Uint8Array;  // HKDF only
}
```

### Security invariants

1. The raw secret bytes live only inside the `wrapKeypair` closure. No method on `PocSigner` returns them.
2. `PocSigner` has no `toJSON`, no `toString` override, and no getter named `secret*`, `privateKey`, or similar.
3. `SignerDetectorResult` is never serialized to a log line or API response. `/api/poc/health` returns only `signer.address` and `activeNetwork`.
4. `deriveSymmetricKey` is the only path that exposes key-derived material — never the raw secret.

### Error codes

| Code | Cause |
|---|---|
| `MissingClientYaml` | `~/.sui/sui_config/client.yaml` unreadable |
| `MalformedClientYaml` | YAML parse fails, or `active_address`/`active_env` absent |
| `MissingKeystore` | `sui.keystore` unreadable |
| `MalformedKeystore` | Not JSON, not an array |
| `NoMatchingKey` | No entry derives to `active_address` |
| `UnsupportedScheme` | Keystore contains a scheme outside {Ed25519, Secp256k1, Secp256r1} |

---

## 4. Encryption Lifecycle

The POC uses **AES-256-GCM with a key derived via HKDF-SHA-256 from the Local_Signer's secret**. This is the Plan B fallback because `@mysten/seal` was not yet published as a stable npm package at the time of the POC fork. The startup log emits `WARNING: Seal fallback mode active — NOT real Seal` and `/api/poc/health` returns `seal.mode: 'fallback'`.

### Step-by-step

```
plaintext bytes (UTF-8 JSON)
  │
  ├─ 1. Canonicalize (RFC 8785 JCS)
  │       Pretty_Printer.canonicalize(formSchema) → Uint8Array
  │       Keys sorted by UTF-16 code unit, no whitespace
  │
  ├─ 2. Derive encryption key (HKDF-SHA-256)
  │       salt  = crypto.randomBytes(16)          ← fresh per blob
  │       info  = "sealbase-poc-v1|{blobType}|{signer.address}"
  │       key   = signer.deriveSymmetricKey(salt, info)  → 32 bytes
  │       (internally: hkdfSync('sha256', secret, salt, info, 32))
  │
  ├─ 3. Encrypt (AES-256-GCM)
  │       nonce      = crypto.randomBytes(12)     ← fresh per blob
  │       ciphertext = AES-256-GCM.encrypt(key, nonce, plaintext)
  │       tag        = cipher.getAuthTag()        ← 16 bytes
  │
  └─ 4. Encode wire format (82-byte header + ciphertext)
          [0]     version      = 0x01
          [1]     scheme_id    = 0x01 (AES-256-GCM + HKDF)
          [2..33] owner_address  32 bytes (raw Sui address)
          [34..49] salt          16 bytes
          [50..61] nonce         12 bytes
          [62..77] tag           16 bytes
          [78..81] blob_type     4 bytes ASCII ('form' | 'subm')
          [82..]  ciphertext    variable length
```

### Decryption

```
encrypted bytes
  │
  ├─ 1. Decode wire format → EncryptedBlob header + ciphertext
  │       Validate: bytes[0] === 0x01, bytes[1] === 0x01, length >= 82
  │
  ├─ 2. Owner check
  │       header.ownerAddress !== signer.address → SealAuthError (category: 'authorization')
  │
  ├─ 3. Re-derive key
  │       info = "sealbase-poc-v1|{header.blobType}|{header.ownerAddress}"
  │       key  = signer.deriveSymmetricKey(header.salt, info)
  │
  └─ 4. Decrypt (AES-256-GCM)
          decipher.setAuthTag(header.tag)
          plaintext = AES-256-GCM.decrypt(key, header.nonce, ciphertext)
          GCM auth failure → SealParseError (category: 'parse', "AES-GCM authentication failed")
```

### Key properties

- **Owner-only decryption:** the key is bound to `signer.address` via the HKDF `info` string. A different signer produces a different key and fails the GCM auth tag check.
- **Public unreadability:** the ciphertext does not contain the plaintext as a contiguous substring (verified by property test R17.8).
- **Round-trip:** `decrypt(encrypt(p, signer, type), signer) === p` for all valid plaintexts (verified by property test R17.3).

### Plan A migration path

When `@mysten/seal` stabilizes, `packages/seal/src/encryptor.ts` and `decryptor.ts` are rewritten to call the SDK. The public surface (`encrypt(plaintext, signer, blobType)`, `decrypt(bytes, signer)`) stays identical, so route handlers and tests do not change. Plan A blobs use wire-format version `0x02`; Plan B blobs (`0x01`) remain decryptable.

---

## 5. Walrus Upload Lifecycle

The Walrus_Client is a pure HTTP client. No Sui signing is required on the client side — the Walrus testnet publisher pays Sui fees on behalf of the uploader.

### Upload (PUT)

```
encrypted bytes (Uint8Array)
  │
  ├─ 1. Health check (cached 5s)
  │       GET {publisherUrl}/v1/api  → must return 2xx within 10s
  │       GET {aggregatorUrl}/v1/api → must return 2xx within 10s
  │       Either failure → WalrusError (HEALTH_PUBLISHER_FAIL | HEALTH_AGGREGATOR_FAIL)
  │
  ├─ 2. PUT {publisherUrl}/v1/blobs?epochs=1
  │       Content-Type: application/octet-stream
  │       Body: raw encrypted bytes
  │       Timeout: 30s
  │
  ├─ 3. Parse response
  │       {"newlyCreated": {"blobObject": {"blobId": "..."}}}  → isNew: true
  │       {"alreadyCertified": {"blobId": "..."}}              → isNew: false
  │       → return { blobId, isNew, endpoint }
  │
  └─ 4. Retry policy
          3 attempts, backoff 1s / 2s / 4s
          Retry on: HTTP 5xx, network errors
          Never retry: HTTP 4xx, 404
```

### Retrieve (GET)

```
blobId (string)
  │
  ├─ GET {aggregatorUrl}/v1/blobs/{blobId}
  │       Timeout: 30s
  │
  └─ Return raw bytes (Uint8Array)
          404 → WalrusError (AGGREGATOR_NOT_FOUND, no retry)
```

### Signer status semantics

The `/api/poc/health` endpoint reports `signer_status` as:

```
signer_status = (Signer_Detector succeeded)
             AND (publisher health OK)
             AND (aggregator health OK)
             ? 'ready'
             : 'not_ready'
```

While `signer_status` is `not_ready`, the Walrus_Client rejects any upload attempt with `WalrusError(SIGNER_NOT_READY)`.

### Error codes

| Code | Cause |
|---|---|
| `PUBLISHER_TIMEOUT` | PUT exceeded 30s |
| `PUBLISHER_UNREACHABLE` | Network error or 5xx after 3 retries |
| `PUBLISHER_REJECTED` | HTTP 4xx from publisher |
| `AGGREGATOR_TIMEOUT` | GET exceeded 30s |
| `AGGREGATOR_UNREACHABLE` | Network error or 5xx after 3 retries |
| `AGGREGATOR_NOT_FOUND` | HTTP 404 — blob not yet certified |
| `BAD_RESPONSE` | Unexpected response shape |
| `HEALTH_PUBLISHER_FAIL` | Publisher health check failed |
| `HEALTH_AGGREGATOR_FAIL` | Aggregator health check failed |
| `SIGNER_NOT_READY` | Upload attempted while signer unavailable |

---

## 6. Sui Metadata Lifecycle

Sui is used **only** to anchor references and hashes — never plaintext content. The on-chain `MetadataRecord` object contains only `blob_id`, `schema_hash`, `record_type`, `form_blob_id` (for submissions), `owner_address`, and `created_at_ms`.

### Anchor flow

```
successful Walrus upload → blob_id returned
  │
  ├─ 1. Compute schema_hash
  │       sha256(canonicalize(formSchema)) → 32 bytes
  │
  ├─ 2. Build Move transaction
  │       target: {SUI_POC_PACKAGE_ID}::metadata::anchor_record
  │       args:
  │         blob_id      (vector<u8>, UTF-8 bytes of the Walrus blob ID)
  │         schema_hash  (vector<u8>, 32 bytes)
  │         record_type  (u8: 1 = form, 2 = submission)
  │         form_blob_id (Option<vector<u8>>: set iff record_type == 2)
  │
  ├─ 3. Sign and execute
  │       signer.signTransaction(tx) → { bytes, signature }
  │       suiClient.executeTransactionBlock(bytes, signature)
  │
  ├─ 4. Parse result
  │       effects.status.status === 'success'
  │       event MetadataAnchored → { record_id, blob_id, schema_hash, ... }
  │       → return { txDigest, recordId }
  │
  └─ 5. On failure
          Metadata_Anchor returns descriptive error
          Form/submission NOT marked as anchored in Local_Store
          The Walrus blob remains valid — upload is not rolled back
```

### MetadataRecord Move struct

```move
public struct MetadataRecord has key, store {
    id:             UID,
    blob_id:        vector<u8>,          // Walrus blob ID as UTF-8 bytes
    schema_hash:    vector<u8>,          // sha256 of canonical JSON — 32 bytes
    record_type:    u8,                  // 1 = form, 2 = submission
    form_blob_id:   Option<vector<u8>>,  // set iff record_type == 2
    owner_address:  address,
    created_at_ms:  u64,
}
```

### Integrity invariant

For all successfully anchored records:

```
sha256(decrypt(retrieve(record.blob_id))) == record.schema_hash
```

This is verified by property test R17.6.

### Query

```
GET /api/poc/metadata/{address}
  │
  └─ queryMetadataRecords(suiClient, packageId, ownerAddress)
       queryEvents({ MoveEventModule: { package, module: 'metadata' } })
       → MetadataRecord[] ordered chronologically
```

### What is NEVER stored on-chain

- Plaintext form field values
- Plaintext submission values
- Decrypted Seal payloads
- Local_Signer private key material
- Any content that would allow a chain observer to reconstruct the form or submission

---

## 7. Repository Structure

All POC code lives on the `walrus-poc` branch. The structure is additive — nothing under `src/lib/` or `src/app/api/{forms,submissions,upload}/` is modified.

```
sealbase/
├── apps/
│   ├── web/                      # POC UI code (React components, page bodies)
│   │   ├── pages/
│   │   │   ├── StatusDashboardPage.tsx   # /poc — form list + status
│   │   │   ├── FormBuilderPage.tsx       # /poc/forms/new — Form_Builder_UI
│   │   │   ├── FormPreviewPage.tsx       # /poc/forms/[blob_id]
│   │   │   ├── FormFillPage.tsx          # /poc/forms/[blob_id]/fill — Form_Submission_UI
│   │   │   └── SubmissionViewPage.tsx    # /poc/submissions/[blob_id]
│   │   ├── components/
│   │   │   ├── ui/               # UI_Primitives (Button, Input, Card, Modal, …)
│   │   │   ├── layout/           # AppShell, PocHeader, PocSidebar, ContentFrame
│   │   │   ├── forms/            # FormTitleInput, FieldRow, FieldEditor, …
│   │   │   ├── submissions/      # SubmissionFillFields, SubmissionListRow, …
│   │   │   └── walrus/           # UploadStatusPill
│   │   ├── stores/
│   │   │   └── local-store.ts    # Zustand + persist (sealbase-poc@1)
│   │   └── copy/
│   │       └── ux-copy.ts        # All user-visible strings
│   └── api/                      # POC route handler implementations
│       ├── health.ts             # GET /api/poc/health
│       ├── forms.ts              # POST/GET /api/poc/forms
│       ├── submissions.ts        # POST/GET /api/poc/submissions
│       ├── metadata.ts           # GET /api/poc/metadata/[address]
│       ├── error-envelope.ts     # Shared error response helper
│       └── index.ts
├── packages/
│   ├── shared/                   # Env_Loader, Pretty_Printer, Parser, Validator, types
│   │   └── src/
│   │       ├── env.ts            # loadPocEnv(), PocEnvSchema
│   │       ├── types.ts          # FormSchema, Submission, FormField interfaces
│   │       ├── pretty-printer.ts # canonicalize() — RFC 8785 JCS
│   │       ├── parser.ts         # parseFormSchema(), parseSubmission()
│   │       ├── validator.ts      # Zod schemas + validateSubmissionAgainstForm()
│   │       ├── schema-hash.ts    # schemaHash(), schemaHashHex()
│   │       ├── design-tokens.ts  # spacing, color, typography, motion tokens
│   │       └── index.ts
│   ├── seal/                     # Seal_Encryptor, Seal_Decryptor, wire format
│   │   └── src/
│   │       ├── encrypted-blob.ts # encode(), decode(), looksLikeEncryptedBlob()
│   │       ├── encryptor.ts      # encrypt(plaintext, signer, blobType)
│   │       ├── decryptor.ts      # decrypt(bytes, signer)
│   │       └── index.ts
│   ├── walrus/                   # Walrus_Client (HTTP)
│   │   └── src/
│   │       ├── client.ts         # createWalrusClient(), put(), get(), healthCheck()
│   │       ├── health.ts         # Health check helpers
│   │       └── index.ts
│   └── sui/                      # Signer_Detector, Sui_Client, Metadata_Anchor
│       ├── src/
│       │   ├── signer-detector.ts  # detectLocalSigner(), PocSigner
│       │   ├── sui-client.ts       # createSuiClient(), getBalance(), queryMetadataRecords()
│       │   ├── metadata-anchor.ts  # anchorRecord()
│       │   └── index.ts
│       └── move/sealbase_poc/    # Move package (published once manually)
│           ├── Move.toml
│           └── sources/metadata.move
├── src/app/poc/                  # Thin Next.js page wrappers (one-liners)
│   ├── page.tsx                  → <StatusDashboardPage />
│   ├── forms/new/page.tsx        → <FormBuilderPage />
│   ├── forms/[blob_id]/page.tsx  → <FormPreviewPage />
│   ├── forms/[blob_id]/fill/page.tsx → <FormFillPage />
│   └── submissions/[blob_id]/page.tsx → <SubmissionViewPage />
├── src/app/api/poc/              # Thin Next.js route wrappers (one-liners)
│   ├── health/route.ts
│   ├── forms/route.ts
│   ├── forms/[blob_id]/route.ts
│   ├── submissions/route.ts
│   ├── submissions/[blob_id]/route.ts
│   └── metadata/[address]/route.ts
└── src/lib/...                   # UNCHANGED — existing production-spec code
```

### Package dependency rules

Packages under `packages/` MUST NOT import from `apps/`. This is enforced by an ESLint `no-restricted-imports` rule scoped to `packages/**/*.ts` that forbids `@poc/apps/*` imports.

| Package | May import from |
|---|---|
| `@poc/shared` | Nothing in `apps/` or other `packages/` |
| `@poc/seal` | `@poc/shared`, `@poc/sui` (for `PocSigner` type) |
| `@poc/walrus` | `@poc/shared` |
| `@poc/sui` | `@poc/shared` |
| `apps/api` | All four packages |
| `apps/web` | `@poc/shared` (types, tokens, copy) |

### tsconfig path aliases

```json
{
  "paths": {
    "@poc/shared":     ["./packages/shared/src/index.ts"],
    "@poc/shared/*":   ["./packages/shared/src/*"],
    "@poc/seal":       ["./packages/seal/src/index.ts"],
    "@poc/seal/*":     ["./packages/seal/src/*"],
    "@poc/walrus":     ["./packages/walrus/src/index.ts"],
    "@poc/walrus/*":   ["./packages/walrus/src/*"],
    "@poc/sui":        ["./packages/sui/src/index.ts"],
    "@poc/sui/*":      ["./packages/sui/src/*"],
    "@poc/apps/web":   ["./apps/web/index.ts"],
    "@poc/apps/web/*": ["./apps/web/*"],
    "@poc/apps/api":   ["./apps/api/index.ts"],
    "@poc/apps/api/*": ["./apps/api/*"]
  }
}
```

---

## Related documents

- `docs/dev-mode.md` — environment flags and their security implications
- `docs/security.md` — trust assumptions, Local_Signer risks, migration path to production
- `docs/walrus-flow.md` — step-by-step sequence diagrams for form creation and submission
- `docs/ARCHITECTURE.md` on `main` branch — production SEALBASE platform architecture (separate from this POC)
- `packages/shared/src/design-tokens.ts` — executable source of truth for all UI tokens
