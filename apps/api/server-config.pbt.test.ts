/**
 * Property-based tests for the env validator (server-config.ts)
 *
 * **Validates: Requirements 9.8**
 *
 * Property 36: Env validator
 *   - For all generated valid env objects, startup succeeds (no throw).
 *   - For all generated env objects missing any required key, startup throws
 *     with a descriptive error that names the missing key.
 *   - For all generated env objects containing any forbidden key, startup
 *     throws with a descriptive error that names the forbidden key.
 *
 * Required keys (post task-2.3 update):
 *   DATABASE_URL, SUI_RPC_URL, WALRUS_PUBLISHER_URL, WALRUS_AGGREGATOR_URL,
 *   API_CORS_ORIGINS, SESSION_SECRET, INFRASTRUCTURE_WALLET_SECRET
 *
 * Forbidden keys (presence is fatal):
 *   INFRA_WALLET_PRIVATE_KEY, DEV_BYPASS_STORAGE, DEV_LOCAL_SIGNER,
 *   DEV_ALLOW_PLAINTEXT
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateEnv } from './server-config';

// ---------------------------------------------------------------------------
// Constants — must stay in sync with server-config.ts
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = [
  'DATABASE_URL',
  'SUI_RPC_URL',
  'WALRUS_PUBLISHER_URL',
  'WALRUS_AGGREGATOR_URL',
  'API_CORS_ORIGINS',
  'SESSION_SECRET',
  'INFRASTRUCTURE_WALLET_SECRET',
] as const;

const FORBIDDEN_KEYS = [
  'INFRA_WALLET_PRIVATE_KEY',
  'DEV_BYPASS_STORAGE',
  'DEV_LOCAL_SIGNER',
  'DEV_ALLOW_PLAINTEXT',
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];
type ForbiddenKey = (typeof FORBIDDEN_KEYS)[number];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Non-empty printable ASCII string (no control chars) */
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** A valid URL string */
const urlArb = fc
  .constantFrom(
    'https://example.com',
    'https://rpc.sui.io:443',
    'https://publisher.walrus.test',
    'https://aggregator.walrus.test',
    'http://localhost:5432',
    'postgres://user:pass@localhost:5432/db',
  )
  .chain((base) =>
    fc.constant(base),
  );

/** A valid CORS origins string (comma-separated URLs) */
const corsOriginsArb = fc.oneof(
  fc.constant('https://app.example.com'),
  fc.constant('https://app.example.com,https://staging.example.com'),
  fc.constant('http://localhost:3000'),
);

/** A valid INFRASTRUCTURE_WALLET_SECRET (non-empty string) */
const walletSecretArb = fc.stringMatching(/^[a-zA-Z0-9+/=_-]{10,100}$/);

/** Generates a complete, valid env object with all required keys present and no forbidden keys */
const validEnvArb: fc.Arbitrary<Record<string, string>> = fc.record({
  DATABASE_URL: urlArb,
  SUI_RPC_URL: urlArb,
  WALRUS_PUBLISHER_URL: urlArb,
  WALRUS_AGGREGATOR_URL: urlArb,
  API_CORS_ORIGINS: corsOriginsArb,
  SESSION_SECRET: walletSecretArb,
  INFRASTRUCTURE_WALLET_SECRET: walletSecretArb,
});

/** Picks one required key to omit */
const missingKeyArb: fc.Arbitrary<RequiredKey> = fc.constantFrom(...REQUIRED_KEYS);

/** Picks one forbidden key to inject */
const forbiddenKeyArb: fc.Arbitrary<ForbiddenKey> = fc.constantFrom(...FORBIDDEN_KEYS);

// ---------------------------------------------------------------------------
// Property 36a: Valid env → startup succeeds
// ---------------------------------------------------------------------------

describe('Property 36: Env validator — valid env objects', () => {
  /**
   * **Validates: Requirements 9.8**
   *
   * For all generated valid env objects (all required keys present, no
   * forbidden keys), validateEnv() MUST NOT throw.
   */
  it('Property 36a: validateEnv does not throw for any valid env object', () => {
    fc.assert(
      fc.property(validEnvArb, (env) => {
        expect(() => validateEnv(env)).not.toThrow();
      }),
      { numRuns: 15 },
    );
  });

  it('Property 36a: validateEnv returns a config object for any valid env object', () => {
    fc.assert(
      fc.property(validEnvArb, (env) => {
        const config = validateEnv(env);
        expect(config).toBeDefined();
        expect(typeof config).toBe('object');
      }),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 36b: Missing required key → startup throws with descriptive error
// ---------------------------------------------------------------------------

describe('Property 36: Env validator — missing required keys', () => {
  /**
   * **Validates: Requirements 9.8**
   *
   * For all generated env objects missing any single required key,
   * validateEnv() MUST throw an error whose message names the missing key.
   */
  it('Property 36b: validateEnv throws for any env object missing a required key', () => {
    fc.assert(
      fc.property(validEnvArb, missingKeyArb, (env, keyToRemove) => {
        const incompleteEnv = { ...env };
        delete incompleteEnv[keyToRemove];

        expect(() => validateEnv(incompleteEnv)).toThrow();
      }),
      { numRuns: 25 },
    );
  });

  it('Property 36b: error message names the missing key', () => {
    fc.assert(
      fc.property(validEnvArb, missingKeyArb, (env, keyToRemove) => {
        const incompleteEnv = { ...env };
        delete incompleteEnv[keyToRemove];

        let thrownError: unknown;
        try {
          validateEnv(incompleteEnv);
        } catch (err) {
          thrownError = err;
        }

        expect(thrownError).toBeDefined();
        expect(thrownError).toBeInstanceOf(Error);
        const message = (thrownError as Error).message;
        // The error message must mention the missing key so operators know what to fix
        expect(message).toContain(keyToRemove);
      }),
      { numRuns: 25 },
    );
  });

  it('Property 36b: throws when ALL required keys are missing', () => {
    expect(() => validateEnv({})).toThrow();
  });

  it('Property 36b: throws for each individual missing required key', () => {
    fc.assert(
      fc.property(validEnvArb, (env) => {
        for (const key of REQUIRED_KEYS) {
          const incompleteEnv = { ...env };
          delete incompleteEnv[key];

          let thrownError: unknown;
          try {
            validateEnv(incompleteEnv);
          } catch (err) {
            thrownError = err;
          }

          expect(thrownError).toBeDefined();
          expect(thrownError).toBeInstanceOf(Error);
          expect((thrownError as Error).message).toContain(key);
        }
      }),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 36c: Forbidden key present → startup throws with descriptive error
// ---------------------------------------------------------------------------

describe('Property 36: Env validator — forbidden keys', () => {
  /**
   * **Validates: Requirements 9.8**
   *
   * For all generated env objects that contain any forbidden key,
   * validateEnv() MUST throw an error whose message names the forbidden key.
   * This enforces that legacy bypass flags and old credential names cannot
   * accidentally be present in a production deployment.
   */
  it('Property 36c: validateEnv throws for any env object containing a forbidden key', () => {
    fc.assert(
      fc.property(validEnvArb, forbiddenKeyArb, nonEmptyStringArb, (env, forbiddenKey, value) => {
        const envWithForbidden = { ...env, [forbiddenKey]: value };

        expect(() => validateEnv(envWithForbidden)).toThrow();
      }),
      { numRuns: 25 },
    );
  });

  it('Property 36c: error message names the forbidden key', () => {
    fc.assert(
      fc.property(validEnvArb, forbiddenKeyArb, nonEmptyStringArb, (env, forbiddenKey, value) => {
        const envWithForbidden = { ...env, [forbiddenKey]: value };

        let thrownError: unknown;
        try {
          validateEnv(envWithForbidden);
        } catch (err) {
          thrownError = err;
        }

        expect(thrownError).toBeDefined();
        expect(thrownError).toBeInstanceOf(Error);
        const message = (thrownError as Error).message;
        // The error message must mention the forbidden key so operators know what to remove
        expect(message).toContain(forbiddenKey);
      }),
      { numRuns: 25 },
    );
  });

  it('Property 36c: throws for each individual forbidden key', () => {
    fc.assert(
      fc.property(validEnvArb, nonEmptyStringArb, (env, value) => {
        for (const key of FORBIDDEN_KEYS) {
          const envWithForbidden = { ...env, [key]: value };

          let thrownError: unknown;
          try {
            validateEnv(envWithForbidden);
          } catch (err) {
            thrownError = err;
          }

          expect(thrownError).toBeDefined();
          expect(thrownError).toBeInstanceOf(Error);
          expect((thrownError as Error).message).toContain(key);
        }
      }),
      { numRuns: 5 },
    );
  });

  it('Property 36c: forbidden key takes precedence even when all required keys are present', () => {
    fc.assert(
      fc.property(validEnvArb, forbiddenKeyArb, nonEmptyStringArb, (env, forbiddenKey, value) => {
        // All required keys are present AND a forbidden key is present → must still throw
        const envWithForbidden = { ...env, [forbiddenKey]: value };

        expect(() => validateEnv(envWithForbidden)).toThrow();
      }),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 36d: Both missing required and forbidden present → throws
// ---------------------------------------------------------------------------

describe('Property 36: Env validator — combined invalid cases', () => {
  /**
   * **Validates: Requirements 9.8**
   *
   * When an env object has both a missing required key AND a forbidden key,
   * validateEnv() must still throw with a descriptive error.
   */
  it('Property 36d: throws when env has both missing required key and forbidden key', () => {
    fc.assert(
      fc.property(
        validEnvArb,
        missingKeyArb,
        forbiddenKeyArb,
        nonEmptyStringArb,
        (env, keyToRemove, forbiddenKey, value) => {
          const badEnv = { ...env, [forbiddenKey]: value };
          delete badEnv[keyToRemove];

          expect(() => validateEnv(badEnv)).toThrow();
        },
      ),
      { numRuns: 15 },
    );
  });
});
