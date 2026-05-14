// packages/shared/src/env.pbt.test.ts
// Property-based tests for Env_Loader (packages/shared/src/env.ts)
// Requirements: R2.1, R2.9
//
// **Validates: Requirements R2.1, R2.9**
//
// Property: parse(serialize(env)) == env for all valid boolean combinations.
// Generate all 2⁵ = 32 flag combinations + arbitrary valid URLs;
// assert loadPocEnv(serialized).flags matches input after cache reset.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { loadPocEnv, _resetPocEnvForTesting } from './env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIVE_FLAGS = [
  'DEV_BYPASS_STORAGE',
  'DEV_LOCAL_SIGNER',
  'DEV_ALLOW_PLAINTEXT',
  'USE_WALRUS_TESTNET',
  'USE_SUI_TESTNET',
] as const;

type FlagName = (typeof FIVE_FLAGS)[number];

/** Serialize a boolean flag value to the string form accepted by StrictBool. */
function serializeFlag(value: boolean): string {
  return value ? 'true' : 'false';
}

/** Build a NodeJS.ProcessEnv-compatible object from boolean flag values + optional URLs. */
function buildEnvSource(
  flags: Record<FlagName, boolean>,
  urls?: {
    WALRUS_PUBLISHER_URL?: string;
    WALRUS_AGGREGATOR_URL?: string;
    SUI_RPC_URL?: string;
  },
): Record<string, string> {
  const source: Record<string, string> = {
    NODE_ENV: 'test',
  };
  for (const flag of FIVE_FLAGS) {
    source[flag] = serializeFlag(flags[flag]);
  }
  if (urls?.WALRUS_PUBLISHER_URL) source.WALRUS_PUBLISHER_URL = urls.WALRUS_PUBLISHER_URL;
  if (urls?.WALRUS_AGGREGATOR_URL) source.WALRUS_AGGREGATOR_URL = urls.WALRUS_AGGREGATOR_URL;
  if (urls?.SUI_RPC_URL) source.SUI_RPC_URL = urls.SUI_RPC_URL;
  return source;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for a single boolean flag value. */
const boolArb = fc.boolean();

/** Arbitrary for all five flag combinations (covers all 2⁵ = 32 combinations). */
const flagCombinationArb = fc.record<Record<FlagName, boolean>>({
  DEV_BYPASS_STORAGE: boolArb,
  DEV_LOCAL_SIGNER: boolArb,
  DEV_ALLOW_PLAINTEXT: boolArb,
  USE_WALRUS_TESTNET: boolArb,
  USE_SUI_TESTNET: boolArb,
});

/**
 * Arbitrary for a valid HTTPS URL.
 * We use a constrained set of realistic-looking URLs to avoid Zod URL
 * validation rejecting exotic fast-check-generated strings.
 */
const validUrlArb = fc.constantFrom(
  'https://publisher.walrus-testnet.walrus.space',
  'https://aggregator.walrus-testnet.walrus.space',
  'https://fullnode.testnet.sui.io:443',
  'https://custom-publisher.example.com',
  'https://custom-aggregator.example.com',
  'https://custom-rpc.example.com',
  'https://publisher.walrus-mainnet.walrus.space',
  'https://aggregator.walrus-mainnet.walrus.space',
);

/** Arbitrary for optional URL overrides. */
const urlOverridesArb = fc.record({
  WALRUS_PUBLISHER_URL: fc.option(validUrlArb, { nil: undefined }),
  WALRUS_AGGREGATOR_URL: fc.option(validUrlArb, { nil: undefined }),
  SUI_RPC_URL: fc.option(validUrlArb, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetPocEnvForTesting();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('Env_Loader PBT — parse(serialize(env)) == env', () => {
  /**
   * Core property: for any valid combination of the five boolean flags,
   * serializing them to strings and loading via loadPocEnv produces the
   * exact same boolean values.
   *
   * This covers all 2⁵ = 32 flag combinations exhaustively (fast-check
   * will explore all combinations given enough runs; we set numRuns: 100
   * to ensure good coverage beyond the 32 base cases).
   */
  it('Property: loadPocEnv(serialize(flags)).flags === flags for all boolean combinations', () => {
    fc.assert(
      fc.property(flagCombinationArb, (flags) => {
        _resetPocEnvForTesting();
        const source = buildEnvSource(flags);
        const env = loadPocEnv(source);

        // Assert each flag round-trips correctly
        for (const flag of FIVE_FLAGS) {
          expect(env[flag]).toBe(flags[flag]);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Extended property: same round-trip holds when arbitrary valid URLs are
   * also provided alongside the flag combinations.
   */
  it('Property: loadPocEnv(serialize(flags + urls)).flags === flags for all combinations with arbitrary URLs', () => {
    fc.assert(
      fc.property(flagCombinationArb, urlOverridesArb, (flags, urls) => {
        _resetPocEnvForTesting();
        const source = buildEnvSource(flags, {
          WALRUS_PUBLISHER_URL: urls.WALRUS_PUBLISHER_URL ?? undefined,
          WALRUS_AGGREGATOR_URL: urls.WALRUS_AGGREGATOR_URL ?? undefined,
          SUI_RPC_URL: urls.SUI_RPC_URL ?? undefined,
        });
        const env = loadPocEnv(source);

        // Flags must round-trip regardless of URL values
        for (const flag of FIVE_FLAGS) {
          expect(env[flag]).toBe(flags[flag]);
        }

        // URLs must be preserved when explicitly provided
        if (urls.WALRUS_PUBLISHER_URL !== undefined) {
          expect(env.WALRUS_PUBLISHER_URL).toBe(urls.WALRUS_PUBLISHER_URL);
        }
        if (urls.WALRUS_AGGREGATOR_URL !== undefined) {
          expect(env.WALRUS_AGGREGATOR_URL).toBe(urls.WALRUS_AGGREGATOR_URL);
        }
        if (urls.SUI_RPC_URL !== undefined) {
          expect(env.SUI_RPC_URL).toBe(urls.SUI_RPC_URL);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Exhaustive enumeration: explicitly test all 32 flag combinations to
   * guarantee 100% coverage of the boolean space (not just statistical).
   */
  it('Exhaustive: all 32 flag combinations round-trip correctly', () => {
    for (let i = 0; i < 32; i++) {
      _resetPocEnvForTesting();
      const flags: Record<FlagName, boolean> = {
        DEV_BYPASS_STORAGE:  Boolean(i & 1),
        DEV_LOCAL_SIGNER:    Boolean(i & 2),
        DEV_ALLOW_PLAINTEXT: Boolean(i & 4),
        USE_WALRUS_TESTNET:  Boolean(i & 8),
        USE_SUI_TESTNET:     Boolean(i & 16),
      };
      const source = buildEnvSource(flags);
      const env = loadPocEnv(source);

      for (const flag of FIVE_FLAGS) {
        expect(env[flag]).toBe(flags[flag]);
      }
    }
  });

  /**
   * Case-insensitive serialization property: "TRUE" and "true" both
   * deserialize to the same boolean value.
   */
  it('Property: case-insensitive serialization — "TRUE" and "true" both parse to true', () => {
    const caseVariants = fc.constantFrom('true', 'TRUE', 'True', 'tRuE', '  true  ', '  TRUE  ');

    fc.assert(
      fc.property(caseVariants, (variant) => {
        _resetPocEnvForTesting();
        const source = {
          DEV_BYPASS_STORAGE: variant,
          DEV_LOCAL_SIGNER: 'true',
          DEV_ALLOW_PLAINTEXT: 'false',
          USE_WALRUS_TESTNET: 'true',
          USE_SUI_TESTNET: 'true',
          NODE_ENV: 'test',
        };
        const env = loadPocEnv(source);
        expect(env.DEV_BYPASS_STORAGE).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * Rejection property: values that are not "true"/"false" (case-insensitive)
   * must always throw EnvLoadError.
   */
  it('Property: non-boolean strings always throw EnvLoadError', () => {
    const invalidBoolArb = fc.string().filter(
      (s) => !['true', 'false'].includes(s.trim().toLowerCase()),
    );

    fc.assert(
      fc.property(invalidBoolArb, (invalidValue) => {
        _resetPocEnvForTesting();
        const source = {
          DEV_BYPASS_STORAGE: invalidValue,
          DEV_LOCAL_SIGNER: 'true',
          DEV_ALLOW_PLAINTEXT: 'false',
          USE_WALRUS_TESTNET: 'true',
          USE_SUI_TESTNET: 'true',
          NODE_ENV: 'test',
        };
        expect(() => loadPocEnv(source)).toThrow();
      }),
      { numRuns: 200 },
    );
  });
});
