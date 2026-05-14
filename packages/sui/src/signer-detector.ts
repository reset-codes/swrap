/**
 * Signer_Detector — reads the local Sui CLI configuration and returns a
 * wrapped PocSigner whose raw secret bytes never leave the closure.
 *
 * Requirements: R3.1, R3.2, R3.3, R3.5, R3.6, R3.7
 */

import { readFile } from 'node:fs/promises';
import { hkdfSync } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SignerScheme = 'ed25519' | 'secp256k1' | 'secp256r1';

export interface PocSigner {
  readonly scheme: SignerScheme;
  readonly address: string; // 0x-prefixed 32-byte hex
  getPublicKey(): Uint8Array; // raw 32 bytes (ed25519) or 33 bytes (compressed secp)
  signPersonalMessage(bytes: Uint8Array): Promise<{ signature: string; bytes: string }>;
  /**
   * Sign pre-built transaction bytes (BCS-encoded).
   * Callers (e.g. Sui_Client.executeTransaction) are responsible for calling
   * `tx.build({ client })` to obtain the bytes before passing them here.
   */
  signTransaction(txBytes: Uint8Array): Promise<{ signature: string; bytes: string }>;
  /** Seal-only: derive a 32-byte symmetric key from the secret + salt/info (HKDF-SHA-256). */
  deriveSymmetricKey(salt: Uint8Array, info: Uint8Array): Uint8Array;
}

export interface SignerDetectorResult {
  signer: PocSigner;
  activeNetwork: string; // e.g. "testnet"
  clientYamlPath: string;
  keystorePath: string;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class SignerDetectorError extends Error {
  constructor(
    public readonly code:
      | 'MissingClientYaml'
      | 'MissingKeystore'
      | 'NoMatchingKey'
      | 'UnsupportedScheme'
      | 'MalformedClientYaml'
      | 'MalformedKeystore',
    public readonly path: string,
    public readonly field?: string,
    message?: string,
  ) {
    super(message ?? `${code} at ${path}${field ? ` (field: ${field})` : ''}`);
    this.name = 'SignerDetectorError';
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Reads `~/.sui/sui_config/client.yaml`, resolves `active_address` +
 * `active_env`, reads `~/.sui/sui_config/sui.keystore`, iterates entries,
 * and returns the first keypair whose `.toSuiAddress()` matches.
 *
 * Throws `SignerDetectorError` on any filesystem or parse failure.
 */
export async function detectLocalSigner(): Promise<SignerDetectorResult> {
  const clientYamlPath = join(homedir(), '.sui', 'sui_config', 'client.yaml');
  const defaultKeystorePath = join(homedir(), '.sui', 'sui_config', 'sui.keystore');

  // 1. Read client.yaml
  let yamlRaw: string;
  try {
    yamlRaw = await readFile(clientYamlPath, 'utf-8');
  } catch {
    throw new SignerDetectorError('MissingClientYaml', clientYamlPath);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlRaw);
  } catch {
    throw new SignerDetectorError('MalformedClientYaml', clientYamlPath);
  }

  const config = parsed as Record<string, unknown> | null | undefined;
  const activeAddress = config?.active_address as string | undefined;
  const activeEnv = config?.active_env as string | undefined;
  const keystoreConfig = config?.keystore as Record<string, string> | undefined;
  const keystorePath: string = keystoreConfig?.File ?? defaultKeystorePath;

  if (!activeAddress) {
    throw new SignerDetectorError('MalformedClientYaml', clientYamlPath, 'active_address');
  }
  if (!activeEnv) {
    throw new SignerDetectorError('MalformedClientYaml', clientYamlPath, 'active_env');
  }

  // 2. Read sui.keystore (JSON array of bech32-encoded private keys)
  let keystoreRaw: string;
  try {
    keystoreRaw = await readFile(keystorePath, 'utf-8');
  } catch {
    throw new SignerDetectorError('MissingKeystore', keystorePath);
  }

  let entries: string[];
  try {
    const parsedKeystore: unknown = JSON.parse(keystoreRaw);
    if (!Array.isArray(parsedKeystore)) throw new Error('not array');
    entries = parsedKeystore as string[];
  } catch {
    throw new SignerDetectorError('MalformedKeystore', keystorePath);
  }

  // 3. Find the entry whose derived address matches active_address
  for (const entry of entries) {
    let scheme: string;
    let secretKey: Uint8Array;
    try {
      const decoded = decodeSuiPrivateKey(entry);
      scheme = decoded.scheme;
      secretKey = decoded.secretKey;
    } catch {
      // Malformed entry — skip and try next
      continue;
    }

    try {
      const keypair = buildKeypair(scheme, secretKey);
      if (keypair.toSuiAddress() === activeAddress) {
        return {
          signer: wrapKeypair(keypair, schemeToSignerScheme(scheme)),
          activeNetwork: activeEnv,
          clientYamlPath,
          keystorePath,
        };
      }
    } catch (err) {
      if ((err as SignerDetectorError).code === 'UnsupportedScheme') throw err;
      // Otherwise continue — malformed entry, try next
    }
  }

  throw new SignerDetectorError('NoMatchingKey', keystorePath, 'active_address');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AnyKeypair = Ed25519Keypair | Secp256k1Keypair | Secp256r1Keypair;

function buildKeypair(scheme: string, secretKey: Uint8Array): AnyKeypair {
  switch (scheme) {
    case 'ED25519':
      return Ed25519Keypair.fromSecretKey(secretKey);
    case 'Secp256k1':
      return Secp256k1Keypair.fromSecretKey(secretKey);
    case 'Secp256r1':
      return Secp256r1Keypair.fromSecretKey(secretKey);
    default:
      throw new SignerDetectorError('UnsupportedScheme', '', scheme);
  }
}

function schemeToSignerScheme(scheme: string): SignerScheme {
  switch (scheme) {
    case 'ED25519':
      return 'ed25519';
    case 'Secp256k1':
      return 'secp256k1';
    case 'Secp256r1':
      return 'secp256r1';
    default:
      throw new SignerDetectorError('UnsupportedScheme', '', scheme);
  }
}

/**
 * Wrap the keypair so callers never receive the secret bytes. The secret lives
 * only inside this function's closure. `deriveSymmetricKey` is the ONLY path
 * that exposes key-derived material (never the raw secret).
 *
 * The returned object is `Object.freeze()`d so no new properties can be added.
 */
function wrapKeypair(kp: AnyKeypair, scheme: SignerScheme): PocSigner {
  // Extract the raw 32-byte secret from the keypair.
  // `getSecretKey()` returns a bech32-encoded string; decode it to get raw bytes.
  const rawSecret: Uint8Array = decodeSuiPrivateKey(kp.getSecretKey()).secretKey;

  // Defensive copy so the original keypair's internal buffer cannot be mutated
  // from outside this closure.
  const secret = new Uint8Array(rawSecret);

  return Object.freeze({
    scheme,
    address: kp.toSuiAddress(),
    getPublicKey: (): Uint8Array => kp.getPublicKey().toRawBytes(),
    signPersonalMessage: (bytes: Uint8Array) => kp.signPersonalMessage(bytes),
    signTransaction: (txBytes: Uint8Array) => kp.signTransaction(txBytes),
    deriveSymmetricKey: (salt: Uint8Array, info: Uint8Array): Uint8Array =>
      hkdfSha256(secret, salt, info, 32),
  } satisfies PocSigner);
}

/**
 * HKDF-SHA-256 using Node's built-in `crypto.hkdfSync` (available in Node 15+).
 * Returns `length` bytes of derived key material.
 */
function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  const derived = hkdfSync('sha256', ikm, salt, info, length);
  return new Uint8Array(derived);
}
