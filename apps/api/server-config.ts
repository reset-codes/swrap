/**
 * Server configuration loader for the Swrap VPS API server.
 *
 * Validates all required environment variables at startup. Any missing or
 * invalid variable causes an immediate fatal error — we fail fast rather
 * than discover misconfiguration during request handling.
 */

import { loadPocEnv } from '@poc/shared';

export interface ServerConfig {
  port: number;
  corsOrigins: string[];
  apiSecretKey: string;
  /** Whether to skip auth for development (never true in production) */
  skipAuth: boolean;
  nodeEnv: 'development' | 'production' | 'test';
  /** Walrus publisher URL */
  walrusPublisherUrl: string;
  /** Walrus aggregator URL */
  walrusAggregatorUrl: string;
  /** Sui RPC URL */
  suiRpcUrl: string;
  /** Sui POC package ID */
  suiPocPackageId: string;
}

export function loadServerConfig(): ServerConfig {
  // Load and validate POC env vars (will throw EnvLoadError if invalid)
  // IMPORTANT: POC_ALLOW_PROD=true must be set in production
  const pocEnv = loadPocEnv();

  const port = parseInt(process.env.PORT ?? '4000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${process.env.PORT}". Must be a number between 1–65535.`);
  }

  const apiSecretKey = process.env.API_SECRET_KEY ?? '';
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as ServerConfig['nodeEnv'];
  const skipAuth = nodeEnv !== 'production' && !apiSecretKey;

  if (nodeEnv === 'production' && !apiSecretKey) {
    throw new Error(
      'API_SECRET_KEY must be set in production. Generate a strong random key and set it in your environment.',
    );
  }

  if (!process.env.INFRA_WALLET_PRIVATE_KEY) {
    throw new Error(
      'INFRA_WALLET_PRIVATE_KEY is required. Set it to the infrastructure wallet bech32 private key (suiprivkey1...).',
    );
  }

  if (!pocEnv.SUI_POC_PACKAGE_ID) {
    throw new Error(
      'SUI_POC_PACKAGE_ID is required. Set it to the 0x-prefixed 64-hex-char package address after `sui client publish`.',
    );
  }

  const corsOriginsRaw = process.env.API_CORS_ORIGINS ?? '*';
  const corsOrigins = corsOriginsRaw === '*' ? ['*'] : corsOriginsRaw.split(',').map((s) => s.trim());

  return {
    port,
    corsOrigins,
    apiSecretKey,
    skipAuth,
    nodeEnv,
    walrusPublisherUrl: pocEnv.WALRUS_PUBLISHER_URL,
    walrusAggregatorUrl: pocEnv.WALRUS_AGGREGATOR_URL,
    suiRpcUrl: pocEnv.SUI_RPC_URL,
    suiPocPackageId: pocEnv.SUI_POC_PACKAGE_ID,
  };
}
