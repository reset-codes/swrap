/**
 * apps/api/services/infrastructure-wallet.ts
 *
 * Infrastructure_Wallet loader and Seal authority module.
 *
 * This module is the ONLY place in the API server that holds the
 * Infrastructure_Wallet keypair. It exposes:
 *
 *   - `getInfrastructureWallet()` — loads and validates the keypair from the
 *     `INFRASTRUCTURE_WALLET_SECRET` environment variable. Throws
 *     `WalletNotConfiguredError` if the variable is absent or malformed.
 *
 *   - `sealEncrypt(plaintext, policyOwnerAddress)` — encrypts bytes via the
 *     Seal SDK using the Infrastructure_Wallet. Returns ciphertext, a policyId
 *     (the Seal IBE identity used for the policy), and a SHA-256 digest over
 *     the ciphertext bytes.
 *
 *   - `sealDecrypt(ciphertext, policyId)` — decrypts bytes via the Seal SDK
 *     using the Infrastructure_Wallet. MUST only be called after an
 *     authorization check has passed (enforced by callers).
 *
 * Security invariants:
 *   - Plaintext bytes are held ephemerally; references are released on
 *     completion or failure.
 *   - Wallet credentials, Seal session secrets, and decryption keys are NEVER
 *     logged at any log level.
 *   - The keypair is loaded fresh from the environment on each call to
 *     `getInfrastructureWallet()` so that secret rotation takes effect without
 *     a restart (the caller may cache the result for the lifetime of a single
 *     request, but MUST NOT cache it across requests in a module-level
 *     singleton).
 *
 * Requirements: 2.2, 2.3, 2.4, 2.7, 9.3, 9.4, 12.2, 13.1, 13.2, 13.5
 */

import { createHash } from 'node:crypto';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import { SuiGrpcClient } from '@mysten/sui/grpc';

// ---------------------------------------------------------------------------
// Seal testnet configuration (mirrors packages/seal/src/encrypted-blob.ts)
// ---------------------------------------------------------------------------

const SEAL_TESTNET_SERVER_CONFIGS = [
  {
    objectId: '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98',
    aggregatorUrl: 'https://seal-aggregator-testnet.mystenlabs.com',
    weight: 1,
  },
];

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when `INFRASTRUCTURE_WALLET_SECRET` is absent, empty, or contains a
 * key that cannot be decoded as a valid Sui bech32 private key.
 *
 * Callers MUST surface this as a 500 Internal Server Error and MUST NOT
 * include the raw error message in any client-facing response (it may contain
 * partial key material from the env var).
 */
export class WalletNotConfiguredError extends Error {
  readonly code = 'WALLET_NOT_CONFIGURED' as const;

  constructor(reason: 'missing' | 'malformed' | 'wrong_scheme') {
    const messages: Record<typeof reason, string> = {
      missing:
        'INFRASTRUCTURE_WALLET_SECRET is not set. Configure it in the deployment environment.',
      malformed:
        'INFRASTRUCTURE_WALLET_SECRET could not be decoded as a Sui bech32 private key.',
      wrong_scheme:
        'INFRASTRUCTURE_WALLET_SECRET must be an ED25519 key (suiprivkey1... prefix).',
    };
    super(messages[reason]);
    this.name = 'WalletNotConfiguredError';
  }
}

/**
 * Thrown when Seal encryption fails for any reason other than wallet
 * misconfiguration.
 */
export class SealEncryptionError extends Error {
  readonly code = 'SEAL_ENCRYPTION_FAILED' as const;

  constructor(cause: unknown) {
    super(
      `Seal encryption failed: ${cause instanceof Error ? cause.message : 'unknown error'}`,
    );
    this.name = 'SealEncryptionError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when Seal decryption fails for any reason other than wallet
 * misconfiguration.
 */
export class SealDecryptionError extends Error {
  readonly code = 'SEAL_DECRYPTION_FAILED' as const;

  constructor(cause: unknown) {
    super(
      `Seal decryption failed: ${cause instanceof Error ? cause.message : 'unknown error'}`,
    );
    this.name = 'SealDecryptionError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Keypair type
// ---------------------------------------------------------------------------

/**
 * A loaded Sui keypair. Callers receive this from `getInfrastructureWallet()`
 * and pass it to `sealEncrypt` / `sealDecrypt`. The type is intentionally
 * opaque to prevent callers from extracting the raw secret key.
 */
export type SuiKeypair = Ed25519Keypair;

// ---------------------------------------------------------------------------
// Wallet loader
// ---------------------------------------------------------------------------

/**
 * Load the Infrastructure_Wallet keypair from `INFRASTRUCTURE_WALLET_SECRET`.
 *
 * Throws `WalletNotConfiguredError` if:
 *   - The environment variable is absent or empty.
 *   - The value cannot be decoded as a Sui bech32 private key.
 *   - The decoded key scheme is not ED25519.
 *
 * SECURITY: This function reads from `process.env` on every call. Do NOT
 * cache the returned keypair in a module-level variable — doing so would
 * prevent secret rotation from taking effect.
 */
export function getInfrastructureWallet(): SuiKeypair {
  const rawSecret = process.env.INFRASTRUCTURE_WALLET_SECRET;

  if (!rawSecret || rawSecret.trim() === '') {
    throw new WalletNotConfiguredError('missing');
  }

  let scheme: string;
  let secretKey: Uint8Array;

  try {
    ({ scheme, secretKey } = decodeSuiPrivateKey(rawSecret.trim()));
  } catch {
    // decodeSuiPrivateKey throws on malformed bech32 — do NOT log the raw
    // value as it may contain partial key material.
    throw new WalletNotConfiguredError('malformed');
  }

  if (scheme !== 'ED25519') {
    throw new WalletNotConfiguredError('wrong_scheme');
  }

  try {
    return Ed25519Keypair.fromSecretKey(secretKey);
  } finally {
    // Zeroize the decoded secret key bytes immediately after constructing the
    // keypair so they do not linger in the call frame's memory.
    secretKey.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Seal client factory (internal)
// ---------------------------------------------------------------------------

/**
 * Build a SealClient backed by the testnet key servers.
 *
 * The SUI_RPC_URL environment variable is used for the Sui gRPC client that
 * the Seal SDK uses internally for object lookups. Falls back to the public
 * testnet endpoint if the variable is not set.
 */
function buildSealClient(): { client: SealClient; suiClient: SuiGrpcClient } {
  const rpcUrl = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';

  const suiClient = new SuiGrpcClient({
    network: 'testnet',
    baseUrl: rpcUrl,
  });

  const client = new SealClient({
    suiClient,
    serverConfigs: SEAL_TESTNET_SERVER_CONFIGS,
    verifyKeyServers: false,
  });

  return { client, suiClient };
}

// ---------------------------------------------------------------------------
// SHA-256 digest helper (internal)
// ---------------------------------------------------------------------------

/**
 * Compute a hex-encoded SHA-256 digest over `bytes`.
 * Used to produce the integrity digest returned by `sealEncrypt`.
 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt `plaintext` bytes using the Seal SDK under a policy that authorizes
 * `policyOwnerAddress`.
 *
 * The `policyId` returned is the Seal IBE identity string used during
 * encryption. It must be stored alongside the ciphertext so that
 * `sealDecrypt` can reconstruct the approval transaction.
 *
 * SECURITY:
 *   - `plaintext` is consumed and its reference is released before this
 *     function returns (the caller should also drop their reference).
 *   - The Infrastructure_Wallet keypair is loaded fresh from the environment
 *     on each call.
 *   - No plaintext bytes, session secrets, or key material are logged.
 *
 * @param plaintext          Raw bytes to encrypt. Reference is released on
 *                           completion or failure.
 * @param policyOwnerAddress Sui address of the Form_Owner. Used as the Seal
 *                           IBE identity so that the policy authorizes this
 *                           address.
 *
 * @returns `{ ciphertext, policyId, digest }` where:
 *   - `ciphertext` — encrypted bytes produced by the Seal SDK.
 *   - `policyId`   — the Seal IBE identity (== `policyOwnerAddress` for
 *                    owner-only policies; callers may extend this in future).
 *   - `digest`     — hex-encoded SHA-256 over `ciphertext` for integrity
 *                    verification at retrieval time.
 *
 * @throws `WalletNotConfiguredError` if the wallet env var is absent/malformed.
 * @throws `SealEncryptionError` if the Seal SDK call fails.
 */
export async function sealEncrypt(
  plaintext: Uint8Array,
  policyOwnerAddress: string,
): Promise<{ ciphertext: Uint8Array; policyId: string; digest: string }> {
  // Load wallet — throws WalletNotConfiguredError if misconfigured.
  const keypair = getInfrastructureWallet();

  const packageId = process.env.SUI_POC_PACKAGE_ID;
  if (!packageId) {
    throw new SealEncryptionError(new Error('SUI_POC_PACKAGE_ID is required for Seal encryption'));
  }

  // The Seal IBE identity is the Form_Owner address. This binds the policy to
  // the owner so that only the Infrastructure_Wallet (acting on behalf of the
  // owner) can decrypt.
  const policyId = policyOwnerAddress;

  let encryptedObject: Uint8Array;

  try {
    const { client } = buildSealClient();

    const result = await client.encrypt({
      packageId,
      id: policyId,
      data: plaintext,
      threshold: 1,
    });

    encryptedObject = result.encryptedObject;
  } catch (err) {
    throw new SealEncryptionError(err);
  } finally {
    // Release plaintext reference regardless of success or failure.
    // Overwrite the buffer to reduce the window during which plaintext bytes
    // are reachable in memory.
    plaintext.fill(0);
  }

  const ciphertext = new Uint8Array(encryptedObject);
  const digest = sha256Hex(ciphertext);

  return { ciphertext, policyId, digest };
}

/**
 * Decrypt `ciphertext` bytes using the Seal SDK.
 *
 * SECURITY:
 *   - This function MUST only be called after an authorization check has
 *     confirmed that the requesting Authorization_Identity is permitted to
 *     access the target submission. The caller is responsible for this gate.
 *   - No decryption keys, session secrets, or plaintext bytes are logged.
 *   - The Infrastructure_Wallet keypair is loaded fresh from the environment
 *     on each call.
 *
 * @param ciphertext Raw ciphertext bytes as returned by `sealEncrypt`.
 * @param policyId   The Seal IBE identity recorded at encryption time
 *                   (== the Form_Owner address for owner-only policies).
 *
 * @returns Decrypted plaintext bytes.
 *
 * @throws `WalletNotConfiguredError` if the wallet env var is absent/malformed.
 * @throws `SealDecryptionError` if the Seal SDK call fails.
 */
export async function sealDecrypt(
  ciphertext: Uint8Array,
  policyId: string,
): Promise<Uint8Array> {
  // Load wallet — throws WalletNotConfiguredError if misconfigured.
  const keypair = getInfrastructureWallet();

  const packageId = process.env.SUI_POC_PACKAGE_ID;
  if (!packageId) {
    throw new SealDecryptionError(new Error('SUI_POC_PACKAGE_ID is required for Seal decryption'));
  }

  try {
    const { client, suiClient } = buildSealClient();

    // Create a SessionKey for the Infrastructure_Wallet address.
    const sessionKey = await SessionKey.create({
      address: keypair.toSuiAddress(),
      packageId,
      ttlMin: 10, // Short TTL — session keys are ephemeral per-request.
      signer: keypair as any, // Ed25519Keypair satisfies the Seal signer interface.
      suiClient,
    });

    // Build the approval transaction. The identity passed here must match the
    // identity used during encryption (the policyId / Form_Owner address).
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::metadata::seal_approve`,
      arguments: [tx.pure.vector('u8', hexToBytes(policyId))],
    });
    tx.setSender(keypair.toSuiAddress());
    const txBytes = await tx.build({ client: suiClient as any, onlyTransactionKind: true });

    const plaintext = await client.decrypt({
      data: ciphertext,
      sessionKey,
      txBytes,
    });

    return new Uint8Array(plaintext);
  } catch (err) {
    throw new SealDecryptionError(err);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a hex string (with or without 0x prefix) to a Uint8Array.
 * Used to encode the policyId as bytes for the Move call argument.
 */
function hexToBytes(hex: string): number[] {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new SealDecryptionError(
      new Error(`policyId hex string has odd length: ${clean.length}`),
    );
  }
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16);
    if (isNaN(byte)) {
      throw new SealDecryptionError(
        new Error(`policyId contains invalid hex character at position ${i}`),
      );
    }
    bytes.push(byte);
  }
  return bytes;
}
