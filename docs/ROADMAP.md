# Swrap — Roadmap

> **Scope:** This document describes the migration path from the `walrus-poc` branch proof of concept to a production-ready Swrap platform. It is organized into three stages.

---

## Stage Overview

| Stage | Name | Branch | Status |
|---|---|---|---|
| 1 | POC | `walrus-poc` | In progress |
| 2 | Beta | `main` (new features) | Planned |
| 3 | Production | `main` (hardened) | Future |

---

## Stage 1 — POC (Current)

**Goal:** Validate the complete Swrap data flow end-to-end on a single developer machine connected to Sui testnet and Walrus testnet.

**What it proves:**
- Encrypted form schemas and encrypted submissions can be uploaded to Walrus testnet
- AES-256-GCM encryption (Plan B fallback for Seal SDK) works end-to-end
- A local Sui signer can connect to Sui testnet, fetch balance, and anchor blob metadata
- The complete product flow works: Create Form → Encrypt → Upload → Retrieve → Decrypt → Submit → Encrypt Response → Upload Response → Decrypt Response

**What it intentionally skips:**
- OAuth / NextAuth / sessions — single trusted developer, no auth needed
- RBAC — "Owner" = active Sui address from local keystore
- Multi-tenant isolation — no workspace, team, or user tables
- Billing / storage credits — Walrus testnet publisher pays fees
- Production infrastructure — no VPS, managed DB, KMS/HSM, queue, CDN
- PostgreSQL / Prisma — Local_Store is browser-side Zustand + localStorage
- Real Seal SDK — using AES-256-GCM fallback until `@mysten/seal` stabilizes

**Exit criteria:**
- All property tests pass (R17.1–R17.9)
- `/api/poc/health` returns `ok: true` with `signer_status: "ready"`
- Full form creation → submission → retrieval flow works on a single machine
- All five documentation deliverables exist in `docs/`

---

## Stage 2 — Beta

**Goal:** A hosted, multi-user backend with real authentication, storage accounting, and the real Seal SDK for the Swrap platform.

### What needs to change

**Authentication and authorization**
- Replace the `DEV_BYPASS_STORAGE` bypass with real NextAuth sessions
- Add Google OAuth (or equivalent) as the primary sign-in method
- Implement RBAC: `owner` role for form creators, `viewer` role for submission readers
- Add CSRF protection (re-enable NextAuth middleware for all API routes)
- Remove the `DEV_LOCAL_SIGNER` model — users authenticate via wallet or OAuth, not a local keystore file

**Encryption**
- Replace the Plan B AES-256-GCM fallback with the real `@mysten/seal` SDK
- The public surface (`encrypt(plaintext, signer, blobType)`, `decrypt(bytes, signer)`) stays identical
- Plan A blobs use wire-format version `0x02`; Plan B blobs (`0x01`) remain decryptable during migration
- Seal's threshold decryption model eliminates the single-key risk of the POC

**Storage and persistence**
- Replace `localStorage` / Zustand persist with PostgreSQL via Prisma
- Add proper session management so metadata is tied to authenticated users
- Implement storage credit accounting: credit balance, deduction per write, deposit flow
- Add the `DEV_ALLOW_PLAINTEXT=false` enforcement at the infrastructure level (not just a flag)

**Infrastructure**
- Deploy to a VPS or managed cloud (Vercel, Railway, Fly.io, etc.)
- Add a managed PostgreSQL instance
- Add structured logging and error tracking (Sentry)
- Add uptime monitoring for Walrus and Sui RPC endpoints
- Add rate limiting on all write endpoints

**Multi-tenant isolation**
- Add workspace / team model
- Scope all form and submission queries to the authenticated user's workspace
- Add user invitation flow

**API hardening**
- Add request size limits
- Add input sanitization
- Add proper HTTP caching headers
- Add API versioning (`/api/v1/`)

### What stays the same

- The `packages/seal`, `packages/walrus`, `packages/sui`, `packages/shared` package structure
- The tsconfig path aliases (`@poc/shared`, `@poc/seal`, etc.)
- The wire format for encrypted blobs (version `0x01` for Plan B, `0x02` for Plan A)
- The Move package for Sui metadata anchoring (may need upgrade path added)
- The design system tokens and UI primitives

---

## Stage 3 — Production

**Goal:** A hardened, scalable, production-grade platform suitable for real users and real data.

### What needs to change from Stage 2

**Key management**
- Replace any remaining local key material with KMS-managed keys (AWS KMS, Google Cloud KMS, or HashiCorp Vault)
- Enable automatic key rotation
- Implement key escrow for recovery scenarios
- Separate signing keys (Sui transactions) from encryption keys (Seal)

**Scalability**
- Add a message queue for async Walrus uploads and Sui anchoring (avoid blocking HTTP requests on slow testnet operations)
- Add a distributed job system for retry logic
- Add a CDN for static assets
- Add horizontal scaling for the Next.js server

**Observability**
- Add distributed tracing (OpenTelemetry)
- Add metrics and dashboards (Prometheus + Grafana, or Datadog)
- Add alerting on failed anchoring transactions, high error rates, and low storage credits
- Add audit logging for all form and submission operations

**Sui mainnet migration**
- Migrate from Sui testnet to Sui mainnet
- Migrate from Walrus testnet to Walrus mainnet
- Update the Move package with an upgrade path (the POC Move module has no upgrade capability)
- Fund the infrastructure wallet with real SUI for gas

**Compliance and security hardening**
- Add penetration testing
- Add a security audit of the Seal integration
- Add data retention policies
- Add GDPR compliance tooling (data export, deletion)
- Add SOC 2 controls if required by customers

**Monitoring and incident response**
- Add on-call rotation
- Add runbooks for common failure modes (Walrus publisher down, Sui RPC timeout, key rotation)
- Add automated rollback procedures

---

## Migration Notes

### Local_Store → PostgreSQL

The POC's `localStorage` / Zustand persist store (`sealbase-poc@1`) is not migrated to PostgreSQL automatically. Stage 2 starts with a fresh database. Developers who want to preserve their POC data should export blob IDs before switching to Stage 2.

### Plan B → Plan A encryption

Blobs encrypted with the Plan B AES-256-GCM scheme (wire-format version `0x01`) remain decryptable after the Plan A migration. The `decrypt()` function checks the version byte and routes to the appropriate decryption path. No re-encryption of existing blobs is required.

### Sui testnet → mainnet

The POC Move package (`sealbase_poc::metadata`) is published on Sui testnet. The mainnet deployment requires a new `sui client publish` with a funded mainnet wallet. The `SUI_POC_PACKAGE_ID` environment variable must be updated to the mainnet package ID.

### Branch strategy

The `walrus-poc` branch is a fork of `v0-baseline`. It is not merged into `main`. Stage 2 work begins on `main` as new features, informed by the POC's learnings but not constrained by its code structure.

---

## Related Documents

- `docs/security.md` — trust assumptions and hardening checklist
- `docs/dev-mode.md` — environment flags (Stage 1 only)
- `docs/walrus-flow.md` — data flow diagrams
- `docs/ARCHITECTURE.md` — POC system architecture
