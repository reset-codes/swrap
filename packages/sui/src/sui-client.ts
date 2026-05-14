/**
 * Sui_Client — connects to Sui testnet, queries chain state, and submits
 * transactions signed by the Local_Signer.
 *
 * Requirements: R4.1, R4.2, R4.4, R4.5, R4.6
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import type { PocSigner } from './signer-detector';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MetadataRecord {
  object_id: string; // Sui owned-object ID of the MetadataRecord
  blob_id: string; // Walrus blob ID
  schema_hash: string; // hex-encoded sha256
  record_type: 'form' | 'submission';
  form_blob_id?: string; // only set when record_type === 'submission'
  owner_address: string;
  created_at: string; // ISO 8601
  tx_digest: string;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class SuiClientError extends Error {
  constructor(
    public readonly code:
      | 'RPC_UNREACHABLE'
      | 'RPC_TIMEOUT'
      | 'TX_FAILED'
      | 'QUERY_FAILED'
      | 'INSUFFICIENT_GAS',
    public readonly endpoint: string,
    message: string,
  ) {
    super(message);
    this.name = 'SuiClientError';
  }
}

// ---------------------------------------------------------------------------
// Default timeout
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Create an AbortSignal that times out after `ms` milliseconds.
 * If a signal is already provided, returns it as-is.
 */
function resolveSignal(signal?: AbortSignal, ms = DEFAULT_TIMEOUT_MS): AbortSignal {
  if (signal) return signal;
  return AbortSignal.timeout(ms);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `SuiJsonRpcClient` connected to the given RPC URL.
 * Defaults to the Sui testnet fullnode.
 *
 * Requirements: R4.1
 */
export function createSuiClient(
  rpcUrl: string = getJsonRpcFullnodeUrl('testnet'),
): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: rpcUrl, network: 'testnet' });
}

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

/**
 * Fetch the SUI balance for `address`.
 *
 * Returns `{ totalBalance, coinType }`.
 * Throws `SuiClientError` with code `RPC_UNREACHABLE` or `RPC_TIMEOUT` on
 * network failures.
 *
 * Requirements: R4.2
 */
export async function getBalance(
  client: SuiJsonRpcClient,
  address: string,
  signal?: AbortSignal,
): Promise<{ totalBalance: string; coinType: string }> {
  const rpcUrl = (client as unknown as { transport?: { url?: string } }).transport?.url ?? 'unknown';

  const effectiveSignal = resolveSignal(signal);

  try {
    const result = await client.getBalance({ owner: address, signal: effectiveSignal });
    return {
      totalBalance: result.totalBalance,
      coinType: result.coinType,
    };
  } catch (err) {
    throw wrapRpcError(err, rpcUrl);
  }
}

// ---------------------------------------------------------------------------
// signAndExecuteTestMessage
// ---------------------------------------------------------------------------

/** Static test payload used for the handshake round-trip. */
const TEST_PAYLOAD = new TextEncoder().encode('sealbase-poc-handshake');

/**
 * Sign the static "sealbase-poc-handshake" payload with `signer` and verify
 * the resulting signature. Returns `{ signature, valid }`.
 *
 * Throws `SuiClientError` with code `TX_FAILED` if verification fails.
 *
 * Requirements: R4.4
 */
export async function signAndExecuteTestMessage(
  signer: PocSigner,
  signal?: AbortSignal,
): Promise<{ signature: string; valid: boolean }> {
  const effectiveSignal = resolveSignal(signal);

  // Wrap the signing in an abort-aware promise so the timeout is respected.
  const { signature } = await withAbort(
    signer.signPersonalMessage(TEST_PAYLOAD),
    effectiveSignal,
    'signer',
  );

  // Verify the signature against the signer's address.
  try {
    const publicKey = await withAbort(
      verifyPersonalMessageSignature(TEST_PAYLOAD, signature, { address: signer.address }),
      effectiveSignal,
      'signer',
    );

    const derivedAddress = publicKey.toSuiAddress();
    const valid = derivedAddress === signer.address;

    if (!valid) {
      throw new SuiClientError(
        'TX_FAILED',
        'signer',
        `Signature verification failed: derived address ${derivedAddress} does not match signer ${signer.address}`,
      );
    }

    return { signature, valid };
  } catch (err) {
    if (err instanceof SuiClientError) throw err;
    throw new SuiClientError(
      'TX_FAILED',
      'signer',
      `Signature verification error: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// executeTransaction
// ---------------------------------------------------------------------------

/**
 * Build, sign, and execute a `Transaction` on-chain.
 *
 * Returns `{ digest, effects, errorMsg? }`.
 * Throws `SuiClientError` with appropriate codes on failure.
 *
 * Requirements: R4.5
 */
export async function executeTransaction(
  client: SuiJsonRpcClient,
  tx: Transaction,
  signer: PocSigner,
  signal?: AbortSignal,
): Promise<{ digest: string; effects: 'success' | 'failure'; errorMsg?: string }> {
  const rpcUrl = (client as unknown as { transport?: { url?: string } }).transport?.url ?? 'unknown';
  const effectiveSignal = resolveSignal(signal);

  // Set sender so the transaction can be built.
  tx.setSenderIfNotSet(signer.address);

  // Build the transaction to BCS bytes.
  let txBytes: Uint8Array;
  try {
    txBytes = await withAbort(tx.build({ client }), effectiveSignal, rpcUrl);
  } catch (err) {
    if (err instanceof SuiClientError) throw err;
    throw wrapRpcError(err, rpcUrl);
  }

  // Sign the built bytes.
  let signature: string;
  try {
    const signed = await withAbort(signer.signTransaction(txBytes), effectiveSignal, rpcUrl);
    signature = signed.signature;
  } catch (err) {
    if (err instanceof SuiClientError) throw err;
    throw new SuiClientError(
      'TX_FAILED',
      rpcUrl,
      `Transaction signing failed: ${(err as Error).message}`,
    );
  }

  // Execute the transaction.
  let result: Awaited<ReturnType<typeof client.executeTransactionBlock>>;
  try {
    result = await withAbort(
      client.executeTransactionBlock({
        transactionBlock: txBytes,
        signature,
        options: { showEffects: true },
        signal: effectiveSignal,
      }),
      effectiveSignal,
      rpcUrl,
    );
  } catch (err) {
    if (err instanceof SuiClientError) throw err;
    throw wrapRpcError(err, rpcUrl);
  }

  const status = result.effects?.status?.status;
  if (status !== 'success') {
    const errorMsg = result.effects?.status?.error ?? 'unknown error';
    // Check for gas-related errors.
    if (errorMsg.toLowerCase().includes('gas') || errorMsg.toLowerCase().includes('insufficient')) {
      throw new SuiClientError('INSUFFICIENT_GAS', rpcUrl, `Transaction failed (gas): ${errorMsg}`);
    }
    return { digest: result.digest, effects: 'failure', errorMsg };
  }

  return { digest: result.digest, effects: 'success' };
}

// ---------------------------------------------------------------------------
// queryMetadataRecords
// ---------------------------------------------------------------------------

/**
 * Query on-chain MetadataRecord objects owned by `owner` for the given
 * `packageId`.
 *
 * **Stub:** returns `[]` until Phase 6 lands the Move module.
 *
 * Requirements: R4.6
 */
export async function queryMetadataRecords(
  _client: SuiJsonRpcClient,
  _packageId: string,
  _owner: string,
  _signal?: AbortSignal,
): Promise<MetadataRecord[]> {
  // Phase 6 will implement this using queryEvents + getOwnedObjects once the
  // Move module (sealbase_poc::metadata) is published.
  return [];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a promise so it rejects with `SuiClientError` if `signal` fires before
 * the promise settles.
 */
async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  endpoint: string,
): Promise<T> {
  if (signal.aborted) {
    throw new SuiClientError('RPC_TIMEOUT', endpoint, `Request aborted: ${signal.reason}`);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        new SuiClientError(
          'RPC_TIMEOUT',
          endpoint,
          `Request timed out or was aborted: ${signal.reason}`,
        ),
      );
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Convert a raw RPC error into a `SuiClientError` with the appropriate code.
 */
function wrapRpcError(err: unknown, endpoint: string): SuiClientError {
  if (err instanceof SuiClientError) return err;

  const message = (err as Error)?.message ?? String(err);
  const isTimeout =
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('aborted') ||
    (err instanceof Error && err.name === 'AbortError');

  if (isTimeout) {
    return new SuiClientError('RPC_TIMEOUT', endpoint, `RPC timeout at ${endpoint}: ${message}`);
  }

  return new SuiClientError(
    'RPC_UNREACHABLE',
    endpoint,
    `RPC unreachable at ${endpoint}: ${message}`,
  );
}
