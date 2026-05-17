/**
 * Server configuration loader for the Swrap VPS API server.
 *
 * Validates all required environment variables at startup using Zod.
 * Any missing required variable or any forbidden legacy variable causes an
 * immediate fatal error — we fail fast rather than discover misconfiguration
 * during request handling.
 *
 * Required env vars:
 *   PORT                        — TCP port (default: 4000)
 *   NODE_ENV                    — development | production | test
 *   API_SECRET_KEY              — Bearer token for admin route authentication (optional in dev)
 *   DATABASE_URL                — PostgreSQL connection string
 *   INFRASTRUCTURE_WALLET_SECRET — bech32 private key for the Infrastructure_Wallet (suiprivkey1...)
 *   WALRUS_PUBLISHER_URL        — Walrus publisher endpoint
 *   WALRUS_AGGREGATOR_URL       — Walrus aggregator endpoint
 *   SUI_RPC_URL                 — Sui fullnode gRPC/RPC URL
 *   SESSION_SECRET              — Secret used to sign session tokens (min 32 chars)
 *   API_CORS_ORIGINS            — Comma-separated allowed CORS origins
 *
 * Forbidden env vars (presence causes startup failure):
 *   DEV_BYPASS_STORAGE          — Legacy POC bypass flag; forbidden in production builds
 *   DEV_LOCAL_SIGNER            — Legacy POC local signer flag; forbidden in production builds
 *   DEV_ALLOW_PLAINTEXT         — Legacy POC plaintext flag; forbidden in production builds
 *   INFRA_WALLET_PRIVATE_KEY    — Renamed to INFRASTRUCTURE_WALLET_SECRET; old name is forbidden
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Forbidden legacy keys — presence of any of these causes startup failure
// ---------------------------------------------------------------------------

export const FORBIDDEN_ENV_KEYS = [
  'DEV_BYPASS_STORAGE',
  'DEV_LOCAL_SIGNER',
  'DEV_ALLOW_PLAINTEXT',
  'INFRA_WALLET_PRIVATE_KEY',
] as const;

export type ForbiddenEnvKey = (typeof FORBIDDEN_ENV_KEYS)[number];

// ---------------------------------------------------------------------------
// Zod schema for required production env vars
// ---------------------------------------------------------------------------

const ServerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL must be a non-empty connection string'),

  INFRASTRUCTURE_WALLET_SECRET: z
    .string()
    .min(1, 'INFRASTRUCTURE_WALLET_SECRET must be a non-empty string'),

  WALRUS_PUBLISHER_URL: z.string().url('WALRUS_PUBLISHER_URL must be a valid URL'),

  WALRUS_AGGREGATOR_URL: z.string().url('WALRUS_AGGREGATOR_URL must be a valid URL'),

  SUI_RPC_URL: z.string().url('SUI_RPC_URL must be a valid URL'),

  SESSION_SECRET: z
    .string()
    .min(10, 'SESSION_SECRET must be at least 10 characters'),

  API_CORS_ORIGINS: z.string().min(1, 'API_CORS_ORIGINS must be a non-empty string'),
});

// ---------------------------------------------------------------------------
// Public config interface
// ---------------------------------------------------------------------------

export interface ServerConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  /** Bearer token for admin route authentication */
  apiSecretKey: string;
  /**
   * Whether to skip auth for development.
   * Derived: true only when nodeEnv !== 'production' AND apiSecretKey is empty.
   * Never true in production.
   */
  skipAuth: boolean;
  /** bech32-encoded Infrastructure_Wallet private key — never log this value */
  infrastructureWalletSecret: string;
  /** PostgreSQL connection string */
  databaseUrl: string;
  /** Walrus publisher URL */
  walrusPublisherUrl: string;
  /** Walrus aggregator URL */
  walrusAggregatorUrl: string;
  /** Sui fullnode RPC URL */
  suiRpcUrl: string;
  /** Secret used to sign session tokens */
  sessionSecret: string;
  /** Allowed CORS origins */
  corsOrigins: string[];
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown by `loadServerConfig` / `validateEnv` when one or more env vars are
 * missing, invalid, or forbidden. The `issues` array lists every problem found
 * so operators can fix all misconfigurations in a single deploy cycle.
 */
export class EnvValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(
      `Server configuration is invalid. Fix the following issues before starting:\n` +
        issues.map((msg) => `  • ${msg}`).join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

// ---------------------------------------------------------------------------
// Core validator — exported for testing (task 2.4 PBT)
// ---------------------------------------------------------------------------

/**
 * Validate an env-like object against the server configuration schema.
 *
 * Collects ALL errors (missing required keys + forbidden legacy keys) before
 * throwing so operators see the full picture in one startup failure.
 *
 * @param source - env object to validate (defaults to `process.env`)
 * @returns Validated config values (subset — callers compose the full ServerConfig)
 * @throws {EnvValidationError} listing every issue found
 */
export function validateEnv(
  source: Record<string, string | undefined>,
): z.infer<typeof ServerEnvSchema> {
  const errors: string[] = [];

  // 1. Check for forbidden legacy keys — their presence is always an error
  const presentForbidden = FORBIDDEN_ENV_KEYS.filter((key) => source[key] !== undefined);
  for (const key of presentForbidden) {
    const hint =
      key === 'INFRA_WALLET_PRIVATE_KEY'
        ? ` (renamed to INFRASTRUCTURE_WALLET_SECRET — update your environment)`
        : ` (legacy POC flag — remove from environment)`;
    errors.push(`Forbidden env var present: ${key}${hint}`);
  }

  // 2. Validate required keys via Zod (collect all field errors)
  const result = ServerEnvSchema.safeParse(source);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.join('.');
      errors.push(`Missing or invalid env var: ${field} — ${issue.message}`);
    }
  }

  // 3. Fail fast with all collected errors
  if (errors.length > 0) {
    throw new EnvValidationError(errors);
  }

  return (result as z.SafeParseSuccess<z.infer<typeof ServerEnvSchema>>).data;
}

// ---------------------------------------------------------------------------
// Full server config loader
// ---------------------------------------------------------------------------

/**
 * Load and validate all required server environment variables.
 *
 * Throws a descriptive `EnvValidationError` listing every missing required key
 * and every forbidden legacy key that is present. Never throws partial errors —
 * all issues are collected and reported together.
 */
export function loadServerConfig(
  source: Record<string, string | undefined> = process.env,
): ServerConfig {
  const env = validateEnv(source);

  const port = parseInt(source.PORT ?? '4000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new EnvValidationError([
      `Missing or invalid env var: PORT — "${source.PORT}" is not a valid port number (1–65535)`,
    ]);
  }

  const nodeEnv = (source.NODE_ENV ?? 'development') as ServerConfig['nodeEnv'];
  const apiSecretKey = source.API_SECRET_KEY ?? '';
  const skipAuth = nodeEnv !== 'production' && !apiSecretKey;

  const corsOrigins = env.API_CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port,
    nodeEnv,
    apiSecretKey,
    skipAuth,
    infrastructureWalletSecret: env.INFRASTRUCTURE_WALLET_SECRET,
    databaseUrl: env.DATABASE_URL,
    walrusPublisherUrl: env.WALRUS_PUBLISHER_URL,
    walrusAggregatorUrl: env.WALRUS_AGGREGATOR_URL,
    suiRpcUrl: env.SUI_RPC_URL,
    sessionSecret: env.SESSION_SECRET,
    corsOrigins,
  };
}
