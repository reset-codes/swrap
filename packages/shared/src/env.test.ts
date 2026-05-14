// packages/shared/src/env.test.ts
// Unit tests for Env_Loader (packages/shared/src/env.ts)
// Requirements: R2.1, R2.9

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadPocEnv,
  _resetPocEnvForTesting,
  EnvLoadError,
} from './env';

/** A minimal valid env that satisfies all five required flags. */
const VALID_BASE_ENV = {
  DEV_BYPASS_STORAGE: 'true',
  DEV_LOCAL_SIGNER: 'true',
  DEV_ALLOW_PLAINTEXT: 'false',
  USE_WALRUS_TESTNET: 'true',
  USE_SUI_TESTNET: 'true',
  NODE_ENV: 'test',
} as const;

const FIVE_FLAGS = [
  'DEV_BYPASS_STORAGE',
  'DEV_LOCAL_SIGNER',
  'DEV_ALLOW_PLAINTEXT',
  'USE_WALRUS_TESTNET',
  'USE_SUI_TESTNET',
] as const;

beforeEach(() => {
  _resetPocEnvForTesting();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// 1. Valid env loads successfully
// ---------------------------------------------------------------------------
describe('loadPocEnv — valid env', () => {
  it('returns a PocEnv with correct boolean flags for a fully valid env', () => {
    const env = loadPocEnv(VALID_BASE_ENV);
    expect(env.DEV_BYPASS_STORAGE).toBe(true);
    expect(env.DEV_LOCAL_SIGNER).toBe(true);
    expect(env.DEV_ALLOW_PLAINTEXT).toBe(false);
    expect(env.USE_WALRUS_TESTNET).toBe(true);
    expect(env.USE_SUI_TESTNET).toBe(true);
  });

  it('supplies default endpoint URLs when not provided', () => {
    const env = loadPocEnv(VALID_BASE_ENV);
    expect(env.WALRUS_PUBLISHER_URL).toBe('https://publisher.walrus-testnet.walrus.space');
    expect(env.WALRUS_AGGREGATOR_URL).toBe('https://aggregator.walrus-testnet.walrus.space');
    expect(env.SUI_RPC_URL).toBe('https://fullnode.testnet.sui.io:443');
  });

  it('accepts custom endpoint URLs', () => {
    const env = loadPocEnv({
      ...VALID_BASE_ENV,
      WALRUS_PUBLISHER_URL: 'https://custom-publisher.example.com',
      WALRUS_AGGREGATOR_URL: 'https://custom-aggregator.example.com',
      SUI_RPC_URL: 'https://custom-rpc.example.com',
    });
    expect(env.WALRUS_PUBLISHER_URL).toBe('https://custom-publisher.example.com');
    expect(env.WALRUS_AGGREGATOR_URL).toBe('https://custom-aggregator.example.com');
    expect(env.SUI_RPC_URL).toBe('https://custom-rpc.example.com');
  });

  it('accepts all five flags as "false"', () => {
    const env = loadPocEnv({
      DEV_BYPASS_STORAGE: 'false',
      DEV_LOCAL_SIGNER: 'false',
      DEV_ALLOW_PLAINTEXT: 'false',
      USE_WALRUS_TESTNET: 'false',
      USE_SUI_TESTNET: 'false',
      NODE_ENV: 'test',
    });
    expect(env.DEV_BYPASS_STORAGE).toBe(false);
    expect(env.DEV_LOCAL_SIGNER).toBe(false);
    expect(env.DEV_ALLOW_PLAINTEXT).toBe(false);
    expect(env.USE_WALRUS_TESTNET).toBe(false);
    expect(env.USE_SUI_TESTNET).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Each missing flag produces EnvLoadError naming that flag
// ---------------------------------------------------------------------------
describe('loadPocEnv — missing flags', () => {
  for (const flag of FIVE_FLAGS) {
    it(`throws EnvLoadError naming "${flag}" when it is missing`, () => {
      const env = { ...VALID_BASE_ENV } as Record<string, string>;
      delete env[flag];

      expect(() => loadPocEnv(env)).toThrow(EnvLoadError);
      try {
        loadPocEnv(env);
      } catch (err) {
        expect(err).toBeInstanceOf(EnvLoadError);
        expect((err as EnvLoadError).field).toBe(flag);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Case-insensitive "TRUE" / "FALSE" accepted
// ---------------------------------------------------------------------------
describe('loadPocEnv — case-insensitive boolean parsing', () => {
  it('accepts "TRUE" (uppercase) as true', () => {
    const env = loadPocEnv({ ...VALID_BASE_ENV, DEV_BYPASS_STORAGE: 'TRUE' });
    expect(env.DEV_BYPASS_STORAGE).toBe(true);
  });

  it('accepts "FALSE" (uppercase) as false', () => {
    const env = loadPocEnv({ ...VALID_BASE_ENV, DEV_ALLOW_PLAINTEXT: 'FALSE' });
    expect(env.DEV_ALLOW_PLAINTEXT).toBe(false);
  });

  it('accepts "True" (mixed case) as true', () => {
    const env = loadPocEnv({ ...VALID_BASE_ENV, USE_WALRUS_TESTNET: 'True' });
    expect(env.USE_WALRUS_TESTNET).toBe(true);
  });

  it('accepts "False" (mixed case) as false', () => {
    const env = loadPocEnv({ ...VALID_BASE_ENV, USE_SUI_TESTNET: 'False' });
    expect(env.USE_SUI_TESTNET).toBe(false);
  });

  it('accepts "  true  " (with surrounding whitespace) as true', () => {
    const env = loadPocEnv({ ...VALID_BASE_ENV, DEV_LOCAL_SIGNER: '  true  ' });
    expect(env.DEV_LOCAL_SIGNER).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. "1" / "yes" / other non-boolean strings are rejected
// ---------------------------------------------------------------------------
describe('loadPocEnv — invalid boolean values rejected', () => {
  const invalidValues = ['1', '0', 'yes', 'no', 'on', 'off', 'enabled', 'disabled', ''];

  for (const value of invalidValues) {
    it(`rejects "${value}" as a boolean value for DEV_BYPASS_STORAGE`, () => {
      expect(() =>
        loadPocEnv({ ...VALID_BASE_ENV, DEV_BYPASS_STORAGE: value }),
      ).toThrow(EnvLoadError);
    });
  }

  it('throws EnvLoadError with the offending field name when "1" is used', () => {
    try {
      loadPocEnv({ ...VALID_BASE_ENV, DEV_BYPASS_STORAGE: '1' });
    } catch (err) {
      expect(err).toBeInstanceOf(EnvLoadError);
      expect((err as EnvLoadError).field).toBe('DEV_BYPASS_STORAGE');
    }
  });

  it('throws EnvLoadError with the offending field name when "yes" is used', () => {
    try {
      loadPocEnv({ ...VALID_BASE_ENV, USE_WALRUS_TESTNET: 'yes' });
    } catch (err) {
      expect(err).toBeInstanceOf(EnvLoadError);
      expect((err as EnvLoadError).field).toBe('USE_WALRUS_TESTNET');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Cache returns the same instance
// ---------------------------------------------------------------------------
describe('loadPocEnv — caching', () => {
  it('returns the same object reference on repeated calls', () => {
    const first = loadPocEnv(VALID_BASE_ENV);
    const second = loadPocEnv(VALID_BASE_ENV);
    expect(first).toBe(second);
  });

  it('ignores a different source on the second call (cache wins)', () => {
    const first = loadPocEnv(VALID_BASE_ENV);
    // Pass a different env — should still return the cached result
    const second = loadPocEnv({
      ...VALID_BASE_ENV,
      DEV_BYPASS_STORAGE: 'false',
    });
    expect(second).toBe(first);
    expect(second.DEV_BYPASS_STORAGE).toBe(true); // cached value
  });

  it('returns a fresh instance after _resetPocEnvForTesting()', () => {
    const first = loadPocEnv(VALID_BASE_ENV);
    _resetPocEnvForTesting();
    const second = loadPocEnv(VALID_BASE_ENV);
    // Different object reference after reset
    expect(second).not.toBe(first);
  });

  it('logs exactly once on first load, not on subsequent calls', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logSpy.mockClear(); // clear any calls accumulated before this test
    loadPocEnv(VALID_BASE_ENV);
    loadPocEnv(VALID_BASE_ENV);
    loadPocEnv(VALID_BASE_ENV);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Production safety fuse
// ---------------------------------------------------------------------------
describe('loadPocEnv — production safety fuse', () => {
  it('throws EnvLoadError when NODE_ENV=production and POC_ALLOW_PROD is not set', () => {
    expect(() =>
      loadPocEnv({ ...VALID_BASE_ENV, NODE_ENV: 'production' }),
    ).toThrow(EnvLoadError);
  });

  it('throws EnvLoadError when NODE_ENV=production and POC_ALLOW_PROD=false', () => {
    expect(() =>
      loadPocEnv({ ...VALID_BASE_ENV, NODE_ENV: 'production', POC_ALLOW_PROD: 'false' }),
    ).toThrow(EnvLoadError);
  });

  it('succeeds when NODE_ENV=production and POC_ALLOW_PROD=true', () => {
    const env = loadPocEnv({
      ...VALID_BASE_ENV,
      NODE_ENV: 'production',
      POC_ALLOW_PROD: 'true',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.POC_ALLOW_PROD).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. EnvLoadError shape
// ---------------------------------------------------------------------------
describe('EnvLoadError', () => {
  it('has the correct name, field, and reason properties', () => {
    const err = new EnvLoadError('MY_FLAG', 'some reason');
    expect(err.name).toBe('EnvLoadError');
    expect(err.field).toBe('MY_FLAG');
    expect(err.reason).toBe('some reason');
    expect(err.message).toContain('MY_FLAG');
    expect(err.message).toContain('some reason');
  });

  it('is an instance of Error', () => {
    const err = new EnvLoadError('X', 'y');
    expect(err).toBeInstanceOf(Error);
  });
});
