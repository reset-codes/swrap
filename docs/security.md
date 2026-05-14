# Security Model

> **Scope:** `walrus-poc` branch only. This document describes the POC's trust model, its known limitations, and the migration path to a production security posture.

---

## Trust Assumptions

The POC operates under a **single trusted developer machine** model. The following assumptions are explicit and intentional:

| Assumption | Implication |
|---|---|
| The developer's machine is trusted | No network-level auth, no TLS client certificates, no rate limiting |
| The local Sui keystore is trusted | Private key bytes are read from `~/.sui/sui_config/sui.keystore` at startup; the file is not encrypted at rest |
| The developer is both Owner and Respondent | The same local signer creates forms and fills them out; no multi-party trust model |
| Testnet funds are free | No credit accounting; the Walrus publisher pays Sui fees on behalf of the uploader |
| No production traffic | The `/api/poc/*` routes and `/poc/*` pages bypass NextAuth entirely |
| `DEV_BYPASS_STORAGE=true` is the default | Production storage-credit checks are skipped |

**These assumptions are NOT acceptable in production.** The POC is a single-developer proof of concept. Every assumption above must be replaced before any production deployment.

---

## Local_Signer Risks

The `Local_Signer` is the most significant security surface in the POC.

### How it works

`Signer_Detector` reads `~/.sui/sui_config/client.yaml` and `~/.sui/sui_config/sui.keystore` at startup. The private key is loaded into memory and wrapped in a `PocSigner` closure. The closure exposes only:

- `address` — the public Sui address
- `getPublicKey()` — raw public key bytes
- `signPersonalMessage()` — sign arbitrary bytes
- `signTransaction()` — sign a Sui transaction
- `deriveSymmetricKey(salt, info)` — HKDF-derived key material (used for encryption)

The raw secret bytes are never returned, logged, serialized, or stored. This is enforced by code structure (closure) and a lint rule that forbids property names like `secret*`, `privateKey`, etc. on `PocSigner`.

### Known risks

**1. Unencrypted keystore file**

`~/.sui/sui_config/sui.keystore` is a plaintext JSON file. Any process running as the same OS user can read it. If the developer's machine is compromised, the private key is compromised.

**2. Key reuse**

The POC uses the same keypair for both Sui transactions and encryption key derivation. In production, these should be separate keys with separate purposes.

**3. No key rotation**

There is no mechanism to rotate the encryption key. If the key is compromised, all previously encrypted blobs are compromised. In production, a KMS-managed key with rotation support is required.

**4. HKDF key derivation**

The encryption key is derived from the private key via HKDF-SHA-256 with the info string `"sealbase-poc-v1|{blobType}|{signer.address}"`. This is a deterministic derivation — the same key is always derived for the same signer and blob type. There is no forward secrecy.

**5. Single-signer model**

All forms and submissions are encrypted to the same key (the developer's local key). There is no per-form key, no per-user key, and no key escrow. If the key is lost, all encrypted blobs are permanently unreadable.

---

## What the POC Does NOT Protect Against

- **Compromised developer machine:** The keystore file is readable by any process with filesystem access. OS-level compromise = key compromise.
- **Replay attacks:** There is no nonce or timestamp validation on the Walrus upload path. An attacker who intercepts a blob ID can re-upload the same blob.
- **Blob ID enumeration:** Blob IDs are stored in `localStorage` and are not secret. Anyone with access to the browser's localStorage can see all blob IDs. The blobs themselves are encrypted, but the IDs are public.
- **Unauthorized Walrus reads:** Walrus is a public network. Anyone with a blob ID can fetch the encrypted bytes. The POC relies on encryption strength (AES-256-GCM) to protect content, not access control.
- **Sui testnet reorganizations:** Testnet is not finality-guaranteed. `MetadataRecord` objects anchored on testnet may be lost if the testnet is reset.
- **Side-channel attacks:** The POC does not implement constant-time comparisons or other side-channel mitigations.
- **Denial of service:** There is no rate limiting on `/api/poc/*` routes.
- **CSRF:** The POC bypasses NextAuth middleware, which also bypasses CSRF protection. The routes are only safe because they are local-only.

---

## Encryption Details

The POC uses **AES-256-GCM** with a key derived via **HKDF-SHA-256** from the Local_Signer's secret. This is the Plan B fallback — the real Seal SDK (`@mysten/seal`) was not yet published as a stable npm package at the time of the POC fork.

### Wire format (82-byte header)

```
[0]      version       = 0x01
[1]      scheme_id     = 0x01 (AES-256-GCM + HKDF)
[2..33]  owner_address   32 bytes (raw Sui address)
[34..49] salt            16 bytes (random, fresh per blob)
[50..61] nonce           12 bytes (random, fresh per blob)
[62..77] tag             16 bytes (GCM auth tag)
[78..81] blob_type       4 bytes ASCII ('form' | 'subm')
[82..]   ciphertext      variable length
```

### Security properties

- **Owner-only decryption:** The key is bound to `signer.address` via the HKDF `info` string. A different signer produces a different key and fails the GCM auth tag check.
- **Public unreadability:** The ciphertext does not contain the plaintext as a contiguous substring (verified by property test R17.8).
- **Integrity:** AES-256-GCM provides authenticated encryption. Tampered ciphertext fails the auth tag check.
- **No plaintext on-chain:** Sui `MetadataRecord` objects contain only blob IDs, schema hashes, timestamps, and the owner's address — never plaintext content.

### What is NOT protected

- **Key derivation is deterministic:** The same signer always produces the same key for the same blob type. There is no forward secrecy.
- **No key escrow:** If the local keystore is deleted, all encrypted blobs are permanently unreadable.
- **Plan B, not Plan A:** The real Seal SDK provides threshold decryption with a distributed key management network. The POC's AES-GCM approach is a single-key symmetric scheme — simpler but weaker.

---

## How to Harden for Production

The following changes are required before any production deployment. See `docs/roadmap.md` for the staged migration plan.

### 1. Replace Local_Signer with a KMS-managed key

- Use AWS KMS, Google Cloud KMS, or HashiCorp Vault to manage the encryption key.
- The application never holds the raw key material — all encrypt/decrypt operations are API calls to the KMS.
- Enable automatic key rotation.

### 2. Replace Plan B encryption with the real Seal SDK

- When `@mysten/seal` stabilizes, replace `packages/seal/src/encryptor.ts` and `decryptor.ts` with SDK calls.
- The public surface (`encrypt(plaintext, signer, blobType)`, `decrypt(bytes, signer)`) stays identical.
- Plan A blobs use wire-format version `0x02`; Plan B blobs (`0x01`) remain decryptable during migration.
- Seal's threshold decryption model eliminates the single-key risk.

### 3. Add authentication and authorization

- Implement NextAuth with a production OAuth provider (Google, GitHub, etc.).
- Add RBAC: `owner` role for form creators, `viewer` role for submission readers.
- Remove the `DEV_BYPASS_STORAGE` bypass.
- Add CSRF protection (re-enable NextAuth middleware for `/api/poc/*` routes).

### 4. Add rate limiting and abuse prevention

- Rate-limit all write endpoints (form creation, submission upload).
- Add request size limits.
- Add IP-based rate limiting for public form submission endpoints.

### 5. Replace localStorage with server-side persistence

- Move form and submission metadata from `localStorage` to a server-side database (PostgreSQL via Prisma).
- Add proper session management so metadata is tied to authenticated users, not browser storage.

### 6. Separate signing keys from encryption keys

- Use a dedicated Sui keypair for on-chain transactions (metadata anchoring).
- Use a separate KMS-managed key for encryption/decryption.
- Never derive encryption keys from signing keys.

### 7. Add observability

- Add structured logging with a log aggregation service.
- Add error tracking (Sentry or equivalent).
- Add uptime monitoring for Walrus and Sui RPC endpoints.
- Alert on failed anchoring transactions.

---

## Related Documents

- `docs/dev-mode.md` — environment flags and their security implications
- `docs/walrus-flow.md` — step-by-step flow diagrams
- `docs/roadmap.md` — staged migration from POC to production
