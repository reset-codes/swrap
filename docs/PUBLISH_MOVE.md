# Publishing the Move Package

This document explains how to publish the `sealbase_poc` Move package to Sui testnet and switch the Metadata_Anchor from the self-transfer fallback to the real Move module.

---

## Prerequisites

- Sui CLI installed and configured (`sui --version`)
- Active address on Sui testnet with sufficient SUI for gas (≥ 0.1 SUI recommended)
- `USE_SUI_TESTNET=true` in your `.env.local`

Verify your active address and network:

```sh
sui client active-address
sui client active-env
```

If the active environment is not `testnet`, switch it:

```sh
sui client switch --env testnet
```

---

## Step 1 — Publish the package

From the repository root, run:

```sh
cd packages/sui/move/sealbase_poc
sui client publish --gas-budget 100000000
```

The command outputs a transaction digest and a list of created objects. Look for the **Published Objects** section — it contains a line like:

```
PackageID: 0xabc123...
```

Copy that address. It is your `SUI_POC_PACKAGE_ID`.

---

## Step 2 — Set `SUI_POC_PACKAGE_ID` in `.env.local`

Open `.env.local` (create it from `.env.example` if it does not exist) and add or update:

```dotenv
SUI_POC_PACKAGE_ID=0xabc123...   # replace with the real package ID from Step 1
```

The `Env_Loader` (`packages/shared/src/env.ts`) reads this value at startup. Once set, the Metadata_Anchor automatically switches to the Move-call path — no code change is required.

---

## Step 3 — Verify the switch

Restart the dev server and call the health endpoint:

```sh
curl http://localhost:3000/api/poc/health | jq .sui
```

You should see:

```json
{
  "anchor_mode": "move",
  "package_id": "0xabc123..."
}
```

If `anchor_mode` is still `"self-transfer"`, the env var was not picked up — check that `.env.local` is saved and the server was restarted.

---

## How the automatic switch works

`packages/sui/src/metadata-anchor.ts` contains two code paths inside `anchorMetadata`:

```
if (packageId) {
  // Move-call path — calls sealbase_poc::metadata::anchor_record
} else {
  // Self-transfer fallback — embeds a binary memo in a zero-value coin transfer
}
```

The `packageId` argument is populated from `SUI_POC_PACKAGE_ID` by the callers in `apps/api/forms.ts` and `apps/api/submissions.ts`. Setting the env var is the only action needed to activate the real Move module.

---

## Step 4 — Remove the fallback (TODO 7.5)

Once the Move package is published and verified, the self-transfer fallback branch should be deleted from `metadata-anchor.ts`. The file contains a marker comment:

```typescript
// TODO(7.5): delete self-transfer fallback branch after `sui client publish`.
```

Delete the `anchorWithSelfTransfer` function, the `buildMemoPayload` helper, the `MEMO_MAGIC` constant, and the `else` branch in `anchorMetadata`. The `anchorWithMoveModule` path becomes the only path.

After removing the fallback, update the `/api/poc/health` handler to always return `anchor_mode: 'move'` (remove the conditional that returns `'self-transfer'`).

---

## Move module reference

Package: `sealbase_poc`  
Module: `metadata`  
Entry function: `anchor_record`

```move
public entry fun anchor_record(
    blob_id:      vector<u8>,   // Walrus blob ID as UTF-8 bytes
    schema_hash:  vector<u8>,   // SHA-256 of canonical JSON — exactly 32 bytes
    record_type:  u8,           // 1 = form, 2 = submission
    form_blob_id: Option<vector<u8>>,  // required when record_type == 2
    ctx:          &mut TxContext,
)
```

The function emits a `MetadataAnchored` event and transfers a `MetadataRecord` object to the caller's address. The record stores only references and hashes — never plaintext content.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `anchor_mode: "self-transfer"` after setting env var | Server not restarted | Restart `npm run dev` |
| `EInvalidSchemaHash` on-chain error | `schema_hash` is not exactly 32 bytes | Verify `schemaHashHex` produces a 64-char hex string |
| `EInvalidRecordType` on-chain error | `form_blob_id` missing for a submission | Ensure `formBlobId` is passed when `recordType === 'submission'` |
| Insufficient gas | Gas budget too low | Increase `--gas-budget` or fund the address from the testnet faucet |
