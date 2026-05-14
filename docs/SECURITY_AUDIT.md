# Comprehensive Architecture & Security Audit

## Executive Summary

The SEALBASE Walrus Proof-of-Concept (POC) successfully demonstrates the basic lifecycle of encrypting, storing, and referencing form schemas and submissions using the Sui testnet and Walrus storage network. However, the current architecture relies on a "Single Trusted Developer Machine" model that is fundamentally incompatible with production deployment, VPS hosting, or investor demonstrations.

The most critical finding is the **inversion of the encryption boundary**: the backend currently handles key loading, signing, encryption, and decryption. This violates Zero-Knowledge/E2EE principles and requires the server to load the developer's private Sui keystore (`~/.sui/sui_config/sui.keystore`) from the filesystem. Furthermore, the on-chain access control function (`seal_approve` in `metadata.move`) is a no-op, meaning any authorized Seal client could decrypt any blob.

To achieve production readiness, the architecture must be radically restructured to move signing, encryption, and decryption entirely to the client side (browser or a desktop client), utilizing standard Web3 wallet adapters (e.g., `@mysten/dapp-kit`) instead of a filesystem-bound CLI configuration.

### Audit Scores
- **Production Readiness:** 1/10 (Blocked by filesystem keystore dependency)
- **Scalability:** 2/10 (Walrus uploads are synchronous without retry/queueing; metadata anchoring is not atomic)
- **Security:** 1/10 (Server sees plaintext; keystore read directly; `seal_approve` is a no-op)
- **Maintainability:** 6/10 (Code is well-typed and modular, but the architecture itself is a dead end for production)

---

## 1. Current Architecture Overview

### End-to-End Flow
1. **Frontend:** The user (developer) creates a form using the `FormBuilderPage`. The JSON schema is sent to the backend.
2. **Backend (API):** The `/api/poc/forms` route receives the schema, reads `~/.sui/sui_config/sui.keystore`, canonicalizes the schema, encrypts it using the Seal SDK (or a fallback HKDF/AES implementation), uploads the blob to Walrus, and attempts to anchor the metadata to Sui via the `sealbase_poc` Move contract.
3. **Retrieval:** The frontend requests a form by `blob_id`. The backend fetches it from the Walrus aggregator, decrypts it using the local keystore, and returns the plaintext to the frontend.

### Trust Assumptions
- **The Developer Machine is Trusted:** The Node.js server has read access to the developer's private keys.
- **The Server is Trusted:** The frontend trusts the server not to log or steal the plaintext form data or the derived keys.
- **Owner = Respondent:** The POC assumes the same signer creates the form and submits answers.

---

## 2. Storage Architecture Audit

### Walrus Usage
- **Upload Flow:** The backend encrypts the payload and uses a basic HTTP `PUT` to the Walrus publisher endpoint (`/v1/blobs?epochs=1`).
- **Retrieval Flow:** A basic HTTP `GET` from the aggregator.
- **Atomicity:** Uploading to Walrus and anchoring the metadata on Sui are two separate steps. If the Sui transaction fails, the Walrus upload is orphaned (the blob exists, but there is no on-chain record).

### Flaws & Risks
- **No Client-Side Integrity Checks:** The client does not verify that `sha256(decrypt(blob))` matches the `schema_hash` anchored on-chain.
- **Orphaned Blobs:** The "best-effort" metadata anchoring means failed transactions result in lost data references.
- **Scaling:** Large blobs are uploaded synchronously via Next.js API routes, which will hit Vercel/serverless timeout limits (typically 10-60s).

### Proposed Architecture
- **Direct Client Uploads:** The client encrypts the data and uploads directly to Walrus.
- **Atomic Anchoring:** Use a distributed saga or a reliable background queue (e.g., Inngest) to guarantee metadata anchoring, or require the client to submit the anchoring transaction directly after a successful Walrus upload.

---

## 3. Seal / CL Encryption Audit

### Pipeline
- **Encryption:** Occurs entirely on the Next.js server (`packages/seal/src/encryptor.ts`).
- **Keys:** Keys are derived from the `active_address` in the Sui CLI config.
- **Boundary:** The boundary is broken. The server receives plaintext.

### Flaws & Risks
- **Critical Risk (Key Leakage):** The Node.js server reads `~/.sui/sui_config/sui.keystore`. In a VPS environment, you would have to upload your private keystore to the server, resulting in an immediate critical compromise.
- **Critical Risk (Access Control):** The `seal_approve` function in `metadata.move` is an empty function (`public entry fun seal_approve(_id: vector<u8>) {}`). Any Seal node will authorize decryption for any requester who can call this function.

### Proposed Architecture
- **Client-Side E2EE:** Move the entire `@mysten/seal` SDK integration to the browser.
- **Wallet Integration:** Use `@mysten/dapp-kit` to allow users to sign transactions and authorize decryption.
- **Secure Move Contract:** Implement actual logic in `seal_approve` to verify that the `tx_context::sender` is the `owner_address` of the `MetadataRecord` associated with the blob ID.

---

## 4. API & Backend Audit

### Route Audit
- `/api/poc/forms` & `/api/poc/submissions`: These routes currently act as proxies that do too much (encryption, Walrus upload, Sui transaction signing).

### Flaws & Risks
- **Unsafe Operations:** Signing transactions on the server using a local keystore is fundamentally unsafe for a web application.
- **Missing Authorization:** The API routes have no authentication (NextAuth is bypassed). Anyone who can reach the API can force the server to sign transactions with the developer's key.

### Proposed Architecture
- **Dumb Backend:** The API should only handle indexing, caching, and serving metadata. It should never see plaintext form data or private keys.
- **Authentication:** Re-enable NextAuth (or SIWS - Sign In With Sui) to rate-limit and protect API routes.

---

## 5. Frontend Architecture Audit

### Structure
- The frontend relies on `localStorage` (via a Zustand persist store) to remember which forms have been created.

### Flaws & Risks
- **State Loss:** If the user clears their browser data or switches devices, they lose all references to their forms, even though the blobs exist on Walrus and the metadata is anchored on Sui.
- **No On-Chain Discovery:** The frontend does not utilize the `queryMetadataRecords` function to recover state from the blockchain.

### Proposed Architecture
- **On-Chain Source of Truth:** On login, the frontend should query the Sui RPC for `MetadataAnchored` events associated with the user's address and hydrate the Zustand store from the chain.
- **Wallet Adapters:** Integrate `@mysten/dapp-kit` for wallet connection and transaction signing.

---

## 6. Data Model & Persistence Audit

### Schema
- `MetadataRecord` (Move struct) stores `blob_id`, `schema_hash`, `record_type`, `form_blob_id`, `owner_address`.

### Flaws & Risks
- **No Extensibility:** The Move module has no upgrade path (`has key, store` but no `UpgradeTicket` logic).

### Proposed Architecture
- **IndexedDB/SQLite Cache:** Cache on-chain metadata locally (IndexedDB for browser, SQLite/Postgres for a production indexer).
- **Upgradable Contracts:** Deploy the Move contracts with upgrade capability enabled.

---

## 7. Deployment & Infrastructure Audit

### Current Assumptions
- The app assumes it is running on macOS/Linux with `~/.sui/sui_config/` populated.

### Flaws & Risks
- **VPS Incompatibility:** Deploying this to a VPS (e.g., Render, AWS EC2, Vercel) will instantly fail because the `client.yaml` and keystore will not exist. If you copy them over, you expose your private keys to the hosting provider.

### Proposed Architecture
- **Dockerization:** Containerize the Next.js app.
- **Environment Variables:** Remove `DEV_LOCAL_SIGNER` logic. The backend should only need `SUI_RPC_URL`, `WALRUS_PUBLISHER_URL`, and `WALRUS_AGGREGATOR_URL`.

---

## 8. Security Audit

### Findings
| Risk | Severity | Description | Fix |
|---|---|---|---|
| **Keystore Exposure** | Critical | Server reads private keys from the filesystem. | Move signing to the client using a Wallet extension. |
| **Broken Access Control** | Critical | `seal_approve` Move function approves all decryption requests. | Implement ownership validation in the Move contract. |
| **E2EE Violation** | High | Server receives and processes plaintext. | Move Seal encryption/decryption to the browser. |
| **Unauthenticated API** | High | `POST /api/poc/*` routes allow unauthenticated SSRF/transaction forging. | Require SIWS or NextAuth; remove backend signing. |
| **Orphaned Walrus Data** | Medium | Upload succeeds but metadata anchor tx fails. | Implement client-side transaction orchestration or an indexing queue. |

---

## 9. Reliability & Stability Audit

### Findings
- **Walrus Retries:** The Walrus client has a basic 3-attempt retry loop for network errors, but Next.js API route timeouts may preempt it.
- **Sui RPC Stability:** The "best-effort" metadata anchor silently swallows errors, leading to state desyncs.

### Proposed Improvements
- Move large blob uploads to the client to avoid serverless timeouts.
- Use `@mysten/sui` client-side transaction blocks with proper RPC failover.

---

## 10. Production Refactor Plan

### Phase 1: Immediate Critical Fixes (Security & Identity)
- **Why:** The app cannot be deployed anywhere without leaking private keys.
- **Action:** Integrate `@mysten/dapp-kit` into the frontend. Remove `signer-detector.ts`. Move transaction signing to the browser.
- **Complexity:** High
- **Risk Level:** Critical

### Phase 2: Client-Side E2EE Integration
- **Why:** The server must not see plaintext data.
- **Action:** Move the `@poc/seal` package logic to the frontend. The browser must call the Seal SDK directly.
- **Complexity:** Medium
- **Risk Level:** High

### Phase 3: Secure Smart Contracts
- **Why:** Anyone can currently decrypt anything.
- **Action:** Rewrite `metadata.move` to ensure `seal_approve` validates that the caller owns the `MetadataRecord`.
- **Complexity:** Medium
- **Risk Level:** High

### Phase 4: State Recovery & Discovery
- **Why:** Users lose data if `localStorage` is cleared.
- **Action:** Implement a frontend hook to query Sui RPC for `MetadataAnchored` events on load, hydrating the local store from the chain.
- **Complexity:** Low
- **Risk Level:** Medium

### Phase 5: Infrastructure & Deployment Hardening
- **Why:** Prepare for VPS/Vercel deployment.
- **Action:** Create a `Dockerfile`, sanitize `.env.example`, and remove the `/api/poc` upload routes entirely, replacing them with direct client-to-Walrus flows.
- **Complexity:** Low
- **Risk Level:** Low
