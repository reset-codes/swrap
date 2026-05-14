// packages/shared/src/env.ts
// Env_Loader — loads and validates the five POC flags plus endpoint variables.
// Called exactly once per process, cached in module-level state.
// NEVER invoked per-request.

import { z } from 'zod';

const StrictBool = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(['true', 'false']))
  .transform((s) => s === 'true');

export const PocEnvSchema = z.object({
  // --- Five POC flags (Requirement 2.1) ---
  DEV_BYPASS_STORAGE:  StrictBool,
  DEV_LOCAL_SIGNER:    StrictBool,
  DEV_ALLOW_PLAINTEXT: StrictBool,
  USE_WALRUS_TESTNET:  StrictBool,
  USE_SUI_TESTNET:     StrictBool,

  // --- Endpoints (defaults supplied when USE_* are true) ---
  WALRUS_PUBLISHER_URL:  z.string().url().default('https://publisher.walrus-testnet.walrus.space'),
  WALRUS_AGGREGATOR_URL: z.string().url().default('https://aggregator.walrus-testnet.walrus.space'),
  SUI_RPC_URL:           z.string().url().default('https://fullnode.testnet.sui.io:443'),

  // --- Sui on-chain module (set after `sui client publish`) ---
  SUI_POC_PACKAGE_ID:    z.string().regex(/^0x[0-9a-f]{64}$/).optional(),

  // --- Safety fuses ---
  NODE_ENV:       z.enum(['development', 'production', 'test']).default('development'),
  POC_ALLOW_PROD: StrictBool.optional().default('false' as unknown as string),
});

export type PocEnv = z.infer<typeof PocEnvSchema>;

export class EnvLoadError extends Error {
  constructor(
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`Env flag "${field}" is invalid: ${reason}`);
    this.name = 'EnvLoadError';
  }
}

let cached: PocEnv | null = null;

/**
 * Load and validate POC env. First call parses process.env; subsequent calls
 * return the cached value. Logs a redacted one-line summary on first success.
 */
export function loadPocEnv(source: Record<string, string | undefined> = process.env): PocEnv {
  if (cached) return cached;

  const result = PocEnvSchema.safeParse(source);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new EnvLoadError(issue.path.join('.'), issue.message);
  }

  // Production safety fuse (see Security section)
  if (result.data.NODE_ENV === 'production' && !result.data.POC_ALLOW_PROD) {
    throw new EnvLoadError(
      'NODE_ENV',
      'POC is disabled in production. Set POC_ALLOW_PROD=true to override (not recommended).',
    );
  }

  cached = result.data;
  logEnvOnce(cached); // ONE-TIME log
  return cached;
}

/** For tests only. */
export function _resetPocEnvForTesting(): void {
  cached = null;
}

function logEnvOnce(env: PocEnv): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: 'poc_env_loaded',
      flags: {
        DEV_BYPASS_STORAGE:  env.DEV_BYPASS_STORAGE,
        DEV_LOCAL_SIGNER:    env.DEV_LOCAL_SIGNER,
        DEV_ALLOW_PLAINTEXT: env.DEV_ALLOW_PLAINTEXT,
        USE_WALRUS_TESTNET:  env.USE_WALRUS_TESTNET,
        USE_SUI_TESTNET:     env.USE_SUI_TESTNET,
      },
      endpoints: {
        walrus_publisher:  env.WALRUS_PUBLISHER_URL,
        walrus_aggregator: env.WALRUS_AGGREGATOR_URL,
        sui_rpc:           env.SUI_RPC_URL,
      },
      sui_package_id_set: !!env.SUI_POC_PACKAGE_ID,
    }),
  );
}
