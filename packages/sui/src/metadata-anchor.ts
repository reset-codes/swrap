/**
 * Metadata_Anchor — anchors blob metadata on Sui testnet.
 *
 * Two code paths:
 *   - Move-call path: when SUI_POC_PACKAGE_ID is set, calls
 *     `${packageId}::metadata::anchor_record` with BCS-encoded args.
 *   - Self-transfer fallback: when SUI_POC_PACKAGE_ID is NOT set, transfers a
 *     zero-value Coin<SUI> to self with a binary memo payload embedded as a
 *     pure vector<u8> argument.
 *
 * The fallback is a two-week interim bridge and MUST be removed in task 7.5
 * once the Move package is published.
 * TODO(7.5): delete self-transfer fallback branch after `sui client publish`.
 *
 * Requirements: R13.1, R13.2, R13.6
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type { PocSigner } from './signer-detector';
import { executeTransaction } from './sui-client';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AnchorInput {
  blobId: string;
  schemaHash: string;
  recordType: 'form' | 'submission';
  formBlobId?: string;
  createdAt: string;
}

export interface AnchorResult {
  txDigest: string;
  mode: 'move' | 'self-transfer';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Magic prefix for self-transfer memo payloads. */
const MEMO_MAGIC = new TextEncoder().encode('SBPOC'); // 5 bytes

const RECORD_TYPE_FORM: number = 1;
const RECORD_TYPE_SUBMISSION: number = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Anchor metadata on Sui testnet.
 *
 * When `packageId` is provided (i.e. `SUI_POC_PACKAGE_ID` is set): calls the
 * Move module's `anchor_record` entry function.
 *
 * Otherwise: uses a self-transfer fallback — transfers a zero-value Coin<SUI>
 * to self with a binary memo payload as a pure vector<u8> argument.
 *
 * Requirements: R13.1, R13.2, R13.6
 */
export async function anchorMetadata(
  client: SuiJsonRpcClient,
  signer: PocSigner,
  input: AnchorInput,
  packageId?: string,
): Promise<AnchorResult> {
  if (packageId) {
    return anchorWithMoveModule(client, signer, input, packageId);
  }
  return anchorWithSelfTransfer(client, signer, input);
}

// ---------------------------------------------------------------------------
// Move-call path
// ---------------------------------------------------------------------------

async function anchorWithMoveModule(
  client: SuiJsonRpcClient,
  signer: PocSigner,
  input: AnchorInput,
  packageId: string,
): Promise<AnchorResult> {
  const tx = new Transaction();

  const recordTypeByte = input.recordType === 'form' ? RECORD_TYPE_FORM : RECORD_TYPE_SUBMISSION;
  const blobIdBytes = Array.from(new TextEncoder().encode(input.blobId));
  const schemaHashBytes = Array.from(hexToBytes(input.schemaHash));

  // Call anchor_record(blob_id, schema_hash, record_type, form_blob_id, ctx)
  tx.moveCall({
    target: `${packageId}::metadata::anchor_record`,
    arguments: [
      tx.pure.vector('u8', blobIdBytes),
      tx.pure.vector('u8', schemaHashBytes),
      tx.pure.u8(recordTypeByte),
      tx.pure.option(
        'vector<u8>',
        input.formBlobId
          ? Array.from(new TextEncoder().encode(input.formBlobId))
          : null,
      ),
    ],
  });

  const result = await executeTransaction(client, tx, signer);
  return { txDigest: result.digest, mode: 'move' };
}

// ---------------------------------------------------------------------------
// Self-transfer fallback
// ---------------------------------------------------------------------------

/**
 * Self-transfer fallback: transfers a zero-value Coin<SUI> to self with a
 * binary memo payload embedded as a pure vector<u8> argument.
 *
 * Memo layout:
 *   "SBPOC" (5 bytes)  — magic prefix
 *   record_type (1 byte) — 0x01 = form, 0x02 = submission
 *   schema_hash (32 bytes) — raw SHA-256 bytes
 *   blob_id (variable) — UTF-8 encoded
 *   0x00 (1 byte) — separator
 *   form_blob_id (variable, optional) — UTF-8 encoded; absent if not a submission
 *
 * WARNING: Metadata_Anchor: using self-transfer fallback; publish Move package to upgrade.
 */
async function anchorWithSelfTransfer(
  client: SuiJsonRpcClient,
  signer: PocSigner,
  input: AnchorInput,
): Promise<AnchorResult> {
  // eslint-disable-next-line no-console
  console.warn(
    'Metadata_Anchor: using self-transfer fallback; publish Move package to upgrade',
  );

  const tx = new Transaction();

  // Build the binary memo payload.
  const memoBytes = buildMemoPayload(input);

  // Split a zero-value coin from gas and transfer to self.
  const [coin] = tx.splitCoins(tx.gas, [0]);
  tx.transferObjects([coin], signer.address);

  // Attach the memo as a pure vector<u8> argument.
  // This is not consumed by the transfer but is recorded in the transaction
  // inputs and can be retrieved by indexers querying the transaction.
  tx.pure.vector('u8', Array.from(memoBytes));

  const result = await executeTransaction(client, tx, signer);
  return { txDigest: result.digest, mode: 'self-transfer' };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the binary memo payload for the self-transfer fallback.
 *
 * Layout:
 *   "SBPOC" (5 bytes) || record_type (1 byte) || schema_hash (32 bytes)
 *   || blob_id_utf8 || 0x00 || form_blob_id_utf8? (omitted if absent)
 */
function buildMemoPayload(input: AnchorInput): Uint8Array {
  const recordTypeByte = input.recordType === 'form' ? RECORD_TYPE_FORM : RECORD_TYPE_SUBMISSION;
  const schemaHashBytes = hexToBytes(input.schemaHash);
  const blobIdBytes = new TextEncoder().encode(input.blobId);
  const formBlobIdBytes = input.formBlobId
    ? new TextEncoder().encode(input.formBlobId)
    : new Uint8Array(0);

  // Total length: 5 (magic) + 1 (type) + 32 (hash) + blobId + 1 (sep) + formBlobId
  const totalLength =
    MEMO_MAGIC.length + 1 + schemaHashBytes.length + blobIdBytes.length + 1 + formBlobIdBytes.length;

  const buf = new Uint8Array(totalLength);
  let offset = 0;

  buf.set(MEMO_MAGIC, offset);
  offset += MEMO_MAGIC.length;

  buf[offset++] = recordTypeByte;

  buf.set(schemaHashBytes, offset);
  offset += schemaHashBytes.length;

  buf.set(blobIdBytes, offset);
  offset += blobIdBytes.length;

  buf[offset++] = 0x00; // separator

  if (formBlobIdBytes.length > 0) {
    buf.set(formBlobIdBytes, offset);
  }

  return buf;
}

/**
 * Decode a hex string (with or without `0x` prefix) to a `Uint8Array`.
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
