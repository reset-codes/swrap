# Walrus Flow

> **Scope:** `walrus-poc` branch only. This document describes the step-by-step data flow for form creation and form submission, including the full pipeline from user action to on-chain anchor.

---

## Overview

Every form schema and every submission travels through the same pipeline:

```
plaintext JSON
  → canonicalize (RFC 8785 JCS)
  → encrypt (AES-256-GCM + HKDF)
  → upload to Walrus testnet
  → anchor hash on Sui testnet
```

Retrieval is the reverse:

```
blob ID
  → retrieve from Walrus testnet
  → decrypt (AES-256-GCM)
  → parse + validate
  → render
```

---

## Form Creation Flow

### Sequence

```
Browser (Form_Builder_UI)
  │
  │  1. Developer fills in form title and fields
  │  2. Clicks "Save form"
  │
  │  POST /api/poc/forms
  │  { form_schema: { title, fields, version, created_at } }
  │
  ▼
apps/api/forms.ts (POST handler)
  │
  ├─ [env]       loadPocEnv()
  │               Validates all five flags are present and boolean.
  │               Aborts with HTTP 500 if any flag is missing.
  │
  ├─ [signer]    detectLocalSigner()
  │               Reads ~/.sui/sui_config/client.yaml → active_address
  │               Reads ~/.sui/sui_config/sui.keystore → matching keypair
  │               Returns PocSigner (secret stays in closure)
  │               Aborts with HTTP 500 if keystore is missing or malformed.
  │
  ├─ [validate]  Validator.parseFormSchema(body.form_schema)
  │               Checks: title 1–200 chars, ≤50 fields, valid field types,
  │               labels 1–100 chars, version === 1, ISO 8601 created_at.
  │               Returns HTTP 400 with field-level errors on failure.
  │
  ├─ [canonicalize] Pretty_Printer.canonicalize(form_schema)
  │               RFC 8785 JCS: keys sorted by UTF-16 code unit, no whitespace.
  │               Returns Uint8Array (UTF-8 JSON bytes).
  │
  ├─ [hash]      schemaHashHex(form_schema)
  │               sha256(canonicalize(form_schema)) → 64-char hex string.
  │               Used for on-chain integrity verification.
  │
  ├─ [encrypt]   Seal.encrypt(bytes, signer, 'form')
  │               1. Generate random 16-byte salt
  │               2. Derive key: HKDF-SHA-256(secret, salt, info)
  │                  info = "sealbase-poc-v1|form|{signer.address}"
  │               3. Generate random 12-byte nonce
  │               4. AES-256-GCM encrypt → ciphertext + 16-byte auth tag
  │               5. Encode 82-byte header + ciphertext
  │               Returns Uint8Array (encrypted blob).
  │
  ├─ [upload]    WalrusClient.put(encrypted_blob, epochs=1)
  │               PUT {publisherUrl}/v1/blobs?epochs=1
  │               Content-Type: application/octet-stream
  │               Timeout: 30s, retry 3× on 5xx (1s/2s/4s backoff)
  │               Parses newlyCreated / alreadyCertified response.
  │               Returns { blobId, isNew, endpoint }.
  │
  ├─ [anchor]    MetadataAnchor.anchorRecord(blob_id, schema_hash, 'form')
  │               Builds Move transaction:
  │                 target: {SUI_POC_PACKAGE_ID}::metadata::anchor_record
  │                 args: blob_id, schema_hash, record_type=1, form_blob_id=None
  │               Signs with signer.signTransaction(tx)
  │               Executes on Sui testnet RPC
  │               Returns { txDigest, recordId }
  │               (If anchoring fails, upload is NOT rolled back — blob remains valid)
  │
  └─ HTTP 200
     { blob_id, schema_hash, tx_digest, created_at }

Browser (Form_Builder_UI)
  │
  └─ On 200:
       localStore.upsertForm({
         blob_id, schema_hash, title, created_at, owner_address
       })
       Navigate to /poc/forms/{blob_id} (preview)
```

### Error handling

| Stage | Error | HTTP | Code |
|---|---|---|---|
| env | Missing or invalid flag | 500 | `ENV_INVALID` |
| signer | Keystore missing | 500 | `SIGNER_MISSING_KEYSTORE` |
| signer | No matching key | 500 | `SIGNER_NO_MATCHING_KEY` |
| validate | Schema invalid | 400 | `VALIDATION_ERROR` |
| encrypt | (should not fail) | 500 | `ENCRYPT_FAILED` |
| upload | Publisher timeout | 504 | `PUBLISHER_TIMEOUT` |
| upload | Publisher 5xx after retries | 502 | `PUBLISHER_UNREACHABLE` |
| anchor | Sui RPC unreachable | 502 | `RPC_UNREACHABLE` |
| anchor | Transaction failed | 500 | `TX_FAILED` |

On any error, the Local_Store entry is NOT created and all entered data is preserved in the editor.

---

## Form Retrieval Flow (Owner Preview)

```
Browser (FormPreviewPage)
  │
  │  GET /api/poc/forms/{blob_id}
  │
  ▼
apps/api/forms.ts (GET handler)
  │
  ├─ [signer]    detectLocalSigner()
  │
  ├─ [retrieve]  WalrusClient.get(blob_id)
  │               GET {aggregatorUrl}/v1/blobs/{blob_id}
  │               Timeout: 30s
  │               Returns raw Uint8Array (encrypted blob bytes)
  │               404 → HTTP 404, code: AGGREGATOR_NOT_FOUND
  │
  ├─ [decrypt]   Seal.decrypt(encrypted_bytes, signer)
  │               1. Decode 82-byte header
  │               2. Check header.ownerAddress === signer.address
  │                  Mismatch → SealAuthError (category: 'authorization')
  │               3. Re-derive key: HKDF-SHA-256(secret, header.salt, info)
  │               4. AES-256-GCM decrypt with header.nonce + header.tag
  │                  Auth failure → SealParseError (category: 'parse')
  │               Returns plaintext Uint8Array
  │
  ├─ [parse]     parseFormSchema(plaintext_bytes)
  │               UTF-8 decode → JSON parse → Zod validation
  │               Returns FormSchema object
  │
  └─ HTTP 200
     { form_schema, blob_id, schema_hash }

Browser
  └─ Renders form fields in read-only mode
     On any error: shows stage-labeled error, does NOT render partial schema
```

---

## Form Submission Flow

### Sequence

```
Browser (Form_Submission_UI)
  │
  │  1. Respondent opens /poc/forms/{form_blob_id}/fill
  │  2. Page fetches and decrypts the form schema (same as retrieval flow above)
  │  3. Respondent fills in fields and clicks "Submit"
  │
  │  POST /api/poc/submissions
  │  { form_blob_id, answers: { [fieldId]: value } }
  │
  ▼
apps/api/submissions.ts (POST handler)
  │
  ├─ [env + signer]  (same as form creation)
  │
  ├─ [fetch form]    WalrusClient.get(form_blob_id)
  │                   Retrieve the form schema blob
  │
  ├─ [decrypt form]  Seal.decrypt(form_blob, signer)
  │                   Decrypt to get the FormSchema
  │
  ├─ [validate]      validateSubmissionAgainstForm(answers, form_schema)
  │                   Checks: all required fields answered, answer types match
  │                   field types, form_schema_hash matches recomputed hash.
  │                   Returns HTTP 400 with field-level errors on failure.
  │
  ├─ [assemble]      Build Submission object:
  │                   {
  │                     form_blob_id,
  │                     form_schema_hash: schemaHashHex(form_schema),
  │                     answers,
  │                     submitted_at: new Date().toISOString()
  │                   }
  │
  ├─ [canonicalize]  Pretty_Printer.canonicalize(submission)
  │
  ├─ [encrypt]       Seal.encrypt(bytes, signer, 'subm')
  │                   Same AES-256-GCM pipeline as form creation.
  │                   blob_type header field = 'subm' (4 bytes ASCII)
  │
  ├─ [upload]        WalrusClient.put(encrypted_submission, epochs=1)
  │                   Returns { blobId: submission_blob_id }
  │
  ├─ [anchor]        MetadataAnchor.anchorRecord(
  │                     submission_blob_id,
  │                     schema_hash,
  │                     record_type=2,
  │                     form_blob_id=form_blob_id
  │                   )
  │                   The form_blob_id pointer links submission to form on-chain.
  │
  └─ HTTP 200
     { blob_id: submission_blob_id, form_blob_id, schema_hash, submitted_at }

Browser
  └─ On 200:
       localStore.upsertSubmission({
         blob_id: submission_blob_id,
         form_blob_id,
         submitted_at
       })
       Shows success state
```

---

## Submission Retrieval Flow (Owner View)

```
Browser (SubmissionViewPage)
  │
  │  GET /api/poc/submissions/{submission_blob_id}
  │
  ▼
apps/api/submissions.ts (GET handler)
  │
  ├─ [signer]    detectLocalSigner()
  │
  ├─ [retrieve]  WalrusClient.get(submission_blob_id)
  │               Returns raw encrypted bytes
  │
  ├─ [decrypt]   Seal.decrypt(encrypted_bytes, signer)
  │               Owner address check: header.ownerAddress must match signer.address
  │               Returns plaintext Uint8Array
  │
  ├─ [parse]     parseSubmission(plaintext_bytes)
  │               Returns Submission object
  │
  └─ HTTP 200
     { submission, blob_id, form_blob_id }

Browser
  └─ Renders submission values in read-only FormField grid
```

---

## End-to-End Pipeline Summary

The complete pipeline for a form schema, expressed as a composition:

```
store_result = decrypt(retrieve(upload(encrypt(canonicalize(form_schema)))))
```

The correctness property verified by property test R17.5:

```
decrypt(retrieve(upload(encrypt(print(x))))) == print(x)
```

And the on-chain integrity invariant verified by property test R17.6:

```
sha256(decrypt(retrieve(record.blob_id))) == record.schema_hash
```

---

## Walrus Endpoint Reference

| Role | URL |
|---|---|
| Publisher (writes) | `https://publisher.walrus-testnet.walrus.space` |
| Aggregator (reads) | `https://aggregator.walrus-testnet.walrus.space` |
| Health check path | `GET /v1/api` on each endpoint |
| Upload path | `PUT /v1/blobs?epochs=1` |
| Retrieve path | `GET /v1/blobs/{blobId}` |

Both endpoints are health-checked at startup with a 10-second timeout. Results are cached for 5 seconds.

---

## Sui Endpoint Reference

| | |
|---|---|
| RPC | `https://fullnode.testnet.sui.io:443` |
| Move package | `{SUI_POC_PACKAGE_ID}::metadata::anchor_record` |
| Faucet | `https://faucet.testnet.sui.io` |

The Move package must be published once manually before anchoring works. See `docs/PUBLISH_MOVE.md` for instructions.
