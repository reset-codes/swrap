# Authorization Boundary Architecture

**Requirement: 12.9, 15.5**

This document describes the authorization boundary in the Swrap architecture, identifying which components sit on which side of the boundary, what materials each component is authorized to hold, and the honest threat model.

---

## Components

| Component | Description |
|---|---|
| **Web_App** | Next.js frontend running in the user's browser |
| **API_Server** | Express.js backend running on the VPS |
| **Postgres_Store** | PostgreSQL database storing metadata (no payload bodies) |
| **Walrus_Store** | Decentralized blob storage (Walrus network) |
| **Seal_Service** | Threshold encryption/decryption service (Seal SDK) |
| **Infrastructure_Wallet** | Ed25519 keypair owned by the API_Server; the sole Seal authority |
| **ZK_Login_Account** | Ephemeral Ed25519 keypair derived from Google OAuth + ZK proof |
| **External_Wallet** | Browser extension wallet (e.g., Sui Wallet) |

---

## Authorization Boundary

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRUSTED SIDE (API_Server)                     │
│                                                                   │
│  ┌─────────────────────┐    ┌──────────────────────────────┐    │
│  │  Infrastructure_    │    │  Postgres_Store               │    │
│  │  Wallet             │    │  (metadata only, no payloads) │    │
│  │  (Seal authority)   │    └──────────────────────────────┘    │
│  └─────────────────────┘                                         │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  API_Server                                              │    │
│  │  - Validates authorization before any Seal operation     │    │
│  │  - Holds plaintext ephemerally during orchestration      │    │
│  │  - Writes audit log for every decryption attempt         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Authorization Boundary
                              │
┌─────────────────────────────────────────────────────────────────┐
│                  UNTRUSTED SIDE (Client)                          │
│                                                                   │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Web_App     │  │  ZK_Login_Account│  │  External_Wallet │  │
│  │  (browser)   │  │  (ephemeral key) │  │  (browser ext.)  │  │
│  └──────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    External Services
                              │
┌─────────────────────────────────────────────────────────────────┐
│                  EXTERNAL SERVICES                                │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────────────────────┐    │
│  │  Walrus_Store    │  │  Seal_Service                    │    │
│  │  (blob storage)  │  │  (threshold encryption)          │    │
│  └──────────────────┘  └──────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Which side each component sits on

| Component | Side | Reason |
|---|---|---|
| Web_App | Untrusted (client) | Runs in the user's browser; cannot be trusted to enforce server-side invariants |
| API_Server | Trusted | Runs on controlled infrastructure; enforces authorization before all Seal operations |
| Postgres_Store | Trusted | Controlled by the API_Server; stores only metadata, never payload bodies |
| Walrus_Store | External | Decentralized network; stores encrypted blobs; not under Swrap's control |
| Seal_Service | External | Threshold decryption network; called only by the API_Server after authorization |
| Infrastructure_Wallet | Trusted | Owned by the API_Server; the sole Seal encryption/decryption authority |
| ZK_Login_Account | Untrusted (client) | Authorization identity only; ephemeral key lives in browser sessionStorage |
| External_Wallet | Untrusted (client) | Authorization identity only; signs challenges to prove identity |

---

## Materials the API_Server is authorized to hold

The API_Server is authorized to hold:

1. **Infrastructure_Wallet keypair** — loaded from `INFRASTRUCTURE_WALLET_SECRET` env var at startup; never logged, never stored in Postgres, never sent to clients
2. **Ephemeral plaintext during orchestration** — held in memory only for the duration of the encryption operation; references released immediately after `sealEncrypt` returns
3. **Audit_Log data** — structured records of authorization decisions and decryption attempts; never contains payload bytes, decryption keys, or wallet credentials
4. **Session tokens** — opaque tokens bound to a verified address; stored in HttpOnly cookies; invalidated on logout

---

## Materials the API_Server MUST NOT hold

The API_Server must never hold:

1. **ZK Login ephemeral private keys** — these belong to the user's browser sessionStorage only; the API_Server receives only the ZK proof and verified address
2. **Seal session keys** — internal to the Seal_Service; the API_Server passes ciphertext and policyId but never sees the session key
3. **Raw JWT contents** — the API_Server verifies JWTs but must not log or persist the raw JWT string
4. **Payload bodies in Postgres** — the `submissions`, `forms`, and `files` tables store only Walrus blob IDs, digests, and sizes; never the actual content

---

## ZK_Login_Account and External_Wallet as Authorization Identities

ZK_Login_Account and External_Wallet are **authorization identities only**. They:

- Prove who the user is (via ZK proof or wallet signature)
- Authorize the API_Server to perform Seal operations on their behalf
- Do NOT directly invoke Seal_Service operations
- Do NOT hold Seal session keys or Infrastructure_Wallet credentials

The Web_App sends the user's verified address to the API_Server. The API_Server checks authorization (is this address the form owner or a viewer?) and then uses the Infrastructure_Wallet to perform the Seal operation.

---

## Honest Threat Model

### What the system protects against

- **Unauthorized decryption**: An attacker who knows a submission's blob ID cannot decrypt it without passing the authorization check on the API_Server
- **Plaintext leakage via Postgres**: Even if the database is compromised, it contains no payload bodies — only blob IDs and digests
- **Plaintext leakage via logs**: The structured logging redaction layer ensures no plaintext, keys, or credentials appear in log output
- **Replay attacks**: Session tokens are bound to verified addresses and expire with the ZK Login epoch

### What the system does NOT protect against

- **Compromised Infrastructure_Wallet**: If the `INFRASTRUCTURE_WALLET_SECRET` is leaked, an attacker with database access could decrypt all private submissions. Mitigations: authorization gating (attacker still needs to pass auth checks), audit logging (unauthorized decryption attempts are recorded), and key rotation (limit the blast radius of a compromised key).
- **Compromised API_Server**: A fully compromised API_Server can decrypt any private submission it has access to. Mitigation: principle of least privilege, network segmentation, and audit logging.
- **Walrus network compromise**: If Walrus is compromised, encrypted blobs could be exfiltrated. However, without the Infrastructure_Wallet, they cannot be decrypted.

### Trust assumptions

1. The API_Server infrastructure (VPS, OS, container runtime) is trusted
2. The `INFRASTRUCTURE_WALLET_SECRET` is stored securely and rotated regularly
3. The Seal_Service threshold network is honest (Seal's security model)
4. The Walrus network stores blobs durably and returns them faithfully

---

## Enforcement layers

The authorization boundary is enforced at three levels:

1. **Static (ESLint rules)**: `no-direct-seal-decrypt` rule prevents any module other than `submissions.ts` and `metadata-orchestrator.ts` from calling `sealDecrypt`
2. **Runtime (authorization service)**: `assertDecryptionAuthorized` is called before every `sealDecrypt` invocation; failure throws `ForbiddenError` and returns HTTP 403
3. **Test (property-based tests)**: PBT tests verify that for all generated unauthorized requests, `sealDecrypt` is never called and HTTP 403 is returned
