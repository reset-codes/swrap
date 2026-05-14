# Dev Mode Flags

> **Scope:** `walrus-poc` branch only. These flags are POC-specific and have no effect on the `main` branch.

The POC is controlled by five boolean environment flags loaded at startup by `Env_Loader` (`packages/shared/src/env.ts`). All five must be present in the environment — missing or non-boolean values abort startup with a descriptive error naming the offending flag.

---

## The Five Flags

### `DEV_BYPASS_STORAGE`

| | |
|---|---|
| **Default** | `true` |
| **Type** | boolean (`"true"` / `"false"`, case-insensitive) |
| **When to change** | Set to `false` only if you want to test the production storage-credit check path (not needed for the POC) |

When `true`, the POC skips the production `Storage_Credit` check and production auth checks for all Walrus writes. This is the expected state for the POC — Walrus testnet's publisher-pays model covers upload fees, so no credit accounting is needed.

**Security implication:** With this flag `true`, any process that can reach `/api/poc/*` can write blobs to Walrus without any credit gate. On a local dev machine this is acceptable. Do not set this flag in any environment reachable by untrusted parties.

---

### `DEV_LOCAL_SIGNER`

| | |
|---|---|
| **Default** | `true` |
| **Type** | boolean |
| **When to change** | Must be `true` for the POC to function. Set to `false` only to test the "signer unavailable" error path. |

When `true`, the `Signer_Detector` reads the developer's local Sui CLI config at startup:

1. `~/.sui/sui_config/client.yaml` — resolves `active_address` and `active_env`
2. `~/.sui/sui_config/sui.keystore` — loads the matching private key

The loaded keypair is wrapped in a `PocSigner` closure that never exposes the raw secret bytes. All Sui and Walrus signing operations use this signer.

**Security implication:** The private key is read from an unencrypted file on disk. Any process with filesystem access to `~/.sui/sui_config/` can read the same key. This is acceptable on a trusted developer machine but is not acceptable in any shared or server environment. See `docs/security.md` for the production migration path.

When `false`, the Walrus_Client rejects all upload attempts with `SIGNER_NOT_READY` and `/api/poc/health` reports `signer_status: "not_ready"`.

---

### `DEV_ALLOW_PLAINTEXT`

| | |
|---|---|
| **Default** | `false` |
| **Type** | boolean |
| **When to change** | Set to `true` only when debugging the Walrus upload path in isolation, before encryption is involved. Reset to `false` immediately after. |

When `true`, the Walrus_Client accepts plaintext (unencrypted) blob uploads. This is useful for isolating the storage path from the encryption path during development.

When `false` (the default), any upload that does not pass the `looksLikeEncryptedBlob` check is rejected with HTTP 400 and `code: "PLAINTEXT_DISABLED"`. This is the safe default — it ensures that no unencrypted form data reaches Walrus.

**Security implication:** Setting this flag `true` means form schemas and submissions can be uploaded to Walrus in plaintext, where they are publicly readable by anyone with the blob ID. Never set this flag `true` with real or sensitive data. The flag exists only for development debugging.

---

### `USE_WALRUS_TESTNET`

| | |
|---|---|
| **Default** | `true` |
| **Type** | boolean |
| **When to change** | Leave `true` for all POC work. Set to `false` only if you want to run the POC entirely offline with MSW mocks. |

When `true`, the Walrus_Client targets the Walrus testnet endpoints:

- Publisher: `https://publisher.walrus-testnet.walrus.space` (or `WALRUS_PUBLISHER_URL` override)
- Aggregator: `https://aggregator.walrus-testnet.walrus.space` (or `WALRUS_AGGREGATOR_URL` override)

At startup, the client performs a health check against both endpoints (10-second timeout each). If either fails, startup logs a warning and `/api/poc/health` reports the failure.

**Security implication:** Walrus testnet is a public network. Blobs uploaded there are publicly retrievable by anyone with the blob ID. The POC relies on encryption (not access control) to protect content. Blob IDs stored in `localStorage` are not secret — treat them as public references.

When `false`, the Walrus_Client is not initialized and all upload/retrieve calls fail immediately. This is only useful for running the test suite without network access.

---

### `USE_SUI_TESTNET`

| | |
|---|---|
| **Default** | `true` |
| **Type** | boolean |
| **When to change** | Leave `true` for all POC work. Set to `false` only to skip Sui connectivity during offline testing. |

When `true`, the Sui_Client connects to the Sui testnet RPC at startup:

- RPC: `https://fullnode.testnet.sui.io:443` (or `SUI_RPC_URL` override)

The client fetches the active address's SUI balance and displays it in the status dashboard. If the balance is zero, the dashboard shows a warning prompting you to fund the address from the testnet faucet at `https://faucet.testnet.sui.io`.

Sui testnet is used for two things in the POC:
1. Querying balance (read-only)
2. Anchoring `MetadataRecord` objects after successful Walrus uploads (requires gas)

**Security implication:** Sui testnet tokens have no real-world value. Transactions on testnet are public and permanent (within testnet's lifetime). The `MetadataRecord` objects anchored on-chain contain only blob IDs, schema hashes, timestamps, and the owner's Sui address — never plaintext content.

---

## Startup Behavior

On first call to any `/api/poc/*` route, `Env_Loader` parses all five flags and emits a single JSON log line:

```json
{
  "event": "poc_env_loaded",
  "flags": {
    "DEV_BYPASS_STORAGE": true,
    "DEV_LOCAL_SIGNER": true,
    "DEV_ALLOW_PLAINTEXT": false,
    "USE_WALRUS_TESTNET": true,
    "USE_SUI_TESTNET": true
  },
  "endpoints": {
    "walrus_publisher": "https://publisher.walrus-testnet.walrus.space",
    "walrus_aggregator": "https://aggregator.walrus-testnet.walrus.space",
    "sui_rpc": "https://fullnode.testnet.sui.io:443"
  },
  "sui_package_id_set": true
}
```

This log is emitted exactly once per process. Subsequent calls return the cached value.

If any flag is missing or not parseable as a boolean, startup aborts with:

```
Env flag "<FLAG_NAME>" is invalid: <reason>
```

---

## Production Safety Fuse

If `NODE_ENV=production` and `POC_ALLOW_PROD` is not explicitly set to `true`, `Env_Loader` throws an error and refuses to start. This prevents the POC from accidentally running in a production environment.

**Do not set `POC_ALLOW_PROD=true` in production.** The POC bypasses auth, RBAC, and storage accounting. It is not safe for production use.

---

## `.env.example` Reference

```bash
# POC flags — all five are required
DEV_BYPASS_STORAGE=true
DEV_LOCAL_SIGNER=true
DEV_ALLOW_PLAINTEXT=false
USE_WALRUS_TESTNET=true
USE_SUI_TESTNET=true

# Endpoint overrides (optional — defaults shown)
WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
SUI_RPC_URL=https://fullnode.testnet.sui.io:443

# Set after running: sui client publish --gas-budget 100000000
SUI_POC_PACKAGE_ID=
```
