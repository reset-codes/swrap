/**
 * Unit tests for `toErrorResponse` in apps/api/error-envelope.ts.
 *
 * Verifies that each known error class maps to the correct HTTP status code
 * and produces the expected error envelope shape.
 *
 * Requirements: R2.9, R3.5, R3.6, R4.5, R5.4
 */

import { describe, it, expect } from 'vitest';
import { toErrorResponse } from './error-envelope';
import { EnvLoadError } from '@poc/shared';
import { SignerDetectorError } from '@poc/sui';
import { SuiClientError } from '@poc/sui';
import { WalrusError } from '@poc/walrus';

// ---------------------------------------------------------------------------
// Helper: extract JSON body from a NextResponse
// ---------------------------------------------------------------------------

async function body(response: Response) {
  return response.json() as Promise<{
    error: { code: string; stage: string; message: string; details?: Record<string, unknown> };
  }>;
}

// ---------------------------------------------------------------------------
// EnvLoadError → 500, code: ENV_INVALID, stage: env
// ---------------------------------------------------------------------------

describe('EnvLoadError', () => {
  it('returns HTTP 500', async () => {
    const err = new EnvLoadError('DEV_BYPASS_STORAGE', 'must be true or false');
    const res = toErrorResponse(err);
    expect(res.status).toBe(500);
  });

  it('sets code to ENV_INVALID', async () => {
    const err = new EnvLoadError('DEV_BYPASS_STORAGE', 'must be true or false');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('ENV_INVALID');
  });

  it('sets stage to env', async () => {
    const err = new EnvLoadError('USE_WALRUS_TESTNET', 'missing');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.stage).toBe('env');
  });

  it('includes the field name in details', async () => {
    const err = new EnvLoadError('DEV_BYPASS_STORAGE', 'must be true or false');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.details).toEqual({ field: 'DEV_BYPASS_STORAGE' });
  });

  it('includes the error message', async () => {
    const err = new EnvLoadError('DEV_LOCAL_SIGNER', 'invalid value');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.message).toBe(err.message);
  });
});

// ---------------------------------------------------------------------------
// SignerDetectorError → 500, code: SIGNER_${error.code}, stage: signer
// ---------------------------------------------------------------------------

describe('SignerDetectorError', () => {
  it('returns HTTP 500', async () => {
    const err = new SignerDetectorError('MissingClientYaml', '/home/user/.sui/sui_config/client.yaml');
    const res = toErrorResponse(err);
    expect(res.status).toBe(500);
  });

  it('sets stage to signer', async () => {
    const err = new SignerDetectorError('MissingKeystore', '/home/user/.sui/sui_config/sui.keystore');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.stage).toBe('signer');
  });

  it('prefixes code with SIGNER_ and uppercases the error code', async () => {
    const err = new SignerDetectorError('MissingClientYaml', '/some/path');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('SIGNER_MISSINGCLIENTYAML');
  });

  it('includes path in details', async () => {
    const path = '/home/user/.sui/sui_config/client.yaml';
    const err = new SignerDetectorError('MissingClientYaml', path);
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.details?.path).toBe(path);
  });

  it('includes optional field in details when present', async () => {
    const err = new SignerDetectorError('MalformedClientYaml', '/some/path', 'active_address');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.details?.field).toBe('active_address');
  });

  it('omits field from details when not provided', async () => {
    const err = new SignerDetectorError('MissingKeystore', '/some/path');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.details?.field).toBeUndefined();
  });

  it('handles NoMatchingKey code', async () => {
    const err = new SignerDetectorError('NoMatchingKey', '/some/keystore');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('SIGNER_NOMATCHINGKEY');
    expect(res.status).toBe(500);
  });

  it('handles UnsupportedScheme code', async () => {
    const err = new SignerDetectorError('UnsupportedScheme', '', 'ECDSA');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('SIGNER_UNSUPPORTEDSCHEME');
    expect(res.status).toBe(500);
  });

  it('handles MalformedKeystore code', async () => {
    const err = new SignerDetectorError('MalformedKeystore', '/some/keystore');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('SIGNER_MALFORMEDKEYSTORE');
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// SuiClientError → 502, code: SUI_${error.code}, stage: sui
// ---------------------------------------------------------------------------

describe('SuiClientError', () => {
  it('returns HTTP 502', async () => {
    const err = new SuiClientError('RPC_UNREACHABLE', 'https://fullnode.testnet.sui.io', 'timeout');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });

  it('sets stage to sui', async () => {
    const err = new SuiClientError('RPC_TIMEOUT', 'https://fullnode.testnet.sui.io', 'timed out');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.stage).toBe('sui');
  });

  it('prefixes code with SUI_', async () => {
    const err = new SuiClientError('RPC_UNREACHABLE', 'https://fullnode.testnet.sui.io', 'unreachable');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('SUI_RPC_UNREACHABLE');
  });

  it('includes endpoint in details', async () => {
    const endpoint = 'https://fullnode.testnet.sui.io';
    const err = new SuiClientError('RPC_TIMEOUT', endpoint, 'timed out');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.details?.endpoint).toBe(endpoint);
  });

  it('handles TX_FAILED code', async () => {
    const err = new SuiClientError('TX_FAILED', 'https://fullnode.testnet.sui.io', 'tx failed');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('SUI_TX_FAILED');
    expect(res.status).toBe(502);
  });

  it('handles QUERY_FAILED code', async () => {
    const err = new SuiClientError('QUERY_FAILED', 'https://fullnode.testnet.sui.io', 'query failed');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('SUI_QUERY_FAILED');
    expect(res.status).toBe(502);
  });

  it('handles INSUFFICIENT_GAS code', async () => {
    const err = new SuiClientError('INSUFFICIENT_GAS', 'https://fullnode.testnet.sui.io', 'not enough gas');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('SUI_INSUFFICIENT_GAS');
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// WalrusError → 502 (network errors) / 404 (NOT_FOUND), code: WALRUS_${error.code}, stage: walrus
// ---------------------------------------------------------------------------

describe('WalrusError', () => {
  it('returns HTTP 502 for PUBLISHER_UNREACHABLE', async () => {
    const err = new WalrusError('PUBLISHER_UNREACHABLE', 'https://publisher.walrus-testnet.walrus.space', 'timeout');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });

  it('returns HTTP 502 for AGGREGATOR_UNREACHABLE', async () => {
    const err = new WalrusError('AGGREGATOR_UNREACHABLE', 'https://aggregator.walrus-testnet.walrus.space', 'timeout');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });

  it('returns HTTP 404 for AGGREGATOR_NOT_FOUND', async () => {
    const err = new WalrusError('AGGREGATOR_NOT_FOUND', 'https://aggregator.walrus-testnet.walrus.space', 'blob not found');
    const res = toErrorResponse(err);
    expect(res.status).toBe(404);
  });

  it('sets stage to walrus', async () => {
    const err = new WalrusError('UPLOAD_FAILED', 'https://publisher.walrus-testnet.walrus.space', 'upload failed');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.stage).toBe('walrus');
  });

  it('prefixes code with WALRUS_', async () => {
    const err = new WalrusError('PUBLISHER_UNREACHABLE', 'https://publisher.walrus-testnet.walrus.space', 'timeout');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('WALRUS_PUBLISHER_UNREACHABLE');
  });

  it('includes endpoint in details', async () => {
    const endpoint = 'https://publisher.walrus-testnet.walrus.space';
    const err = new WalrusError('UPLOAD_FAILED', endpoint, 'upload failed');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.details?.endpoint).toBe(endpoint);
  });

  it('returns HTTP 502 for UPLOAD_FAILED', async () => {
    const err = new WalrusError('UPLOAD_FAILED', 'https://publisher.walrus-testnet.walrus.space', 'failed');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });

  it('returns HTTP 502 for DOWNLOAD_FAILED', async () => {
    const err = new WalrusError('DOWNLOAD_FAILED', 'https://aggregator.walrus-testnet.walrus.space', 'failed');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });

  it('returns HTTP 502 for HEALTH_PUBLISHER_FAIL', async () => {
    const err = new WalrusError('HEALTH_PUBLISHER_FAIL', 'https://publisher.walrus-testnet.walrus.space', 'health failed');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });

  it('returns HTTP 502 for HEALTH_AGGREGATOR_FAIL', async () => {
    const err = new WalrusError('HEALTH_AGGREGATOR_FAIL', 'https://aggregator.walrus-testnet.walrus.space', 'health failed');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });

  it('returns HTTP 502 for SIGNER_NOT_READY', async () => {
    const err = new WalrusError('SIGNER_NOT_READY', 'https://publisher.walrus-testnet.walrus.space', 'signer not ready');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });

  it('returns HTTP 502 for PLAINTEXT_DISABLED', async () => {
    const err = new WalrusError('PLAINTEXT_DISABLED', 'https://publisher.walrus-testnet.walrus.space', 'plaintext disabled');
    const res = toErrorResponse(err);
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// Unknown errors → 500, code: INTERNAL_ERROR, stage: unknown
// ---------------------------------------------------------------------------

describe('unknown errors', () => {
  it('returns HTTP 500 for a plain Error', async () => {
    const err = new Error('something went wrong');
    const res = toErrorResponse(err);
    expect(res.status).toBe(500);
  });

  it('sets code to INTERNAL_ERROR', async () => {
    const err = new Error('something went wrong');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('sets stage to unknown', async () => {
    const err = new Error('something went wrong');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.stage).toBe('unknown');
  });

  it('includes the error message for a plain Error', async () => {
    const err = new Error('something went wrong');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.message).toBe('something went wrong');
  });

  it('handles a thrown string', async () => {
    const res = toErrorResponse('raw string error');
    const json = await body(res);
    expect(res.status).toBe(500);
    expect(json.error.code).toBe('INTERNAL_ERROR');
    expect(json.error.message).toBe('raw string error');
  });

  it('handles null/undefined with a fallback message', async () => {
    const res = toErrorResponse(null);
    const json = await body(res);
    expect(res.status).toBe(500);
    expect(json.error.code).toBe('INTERNAL_ERROR');
    expect(json.error.message).toBeTruthy();
  });

  it('does not include details for unknown errors', async () => {
    const err = new Error('oops');
    const res = toErrorResponse(err);
    const json = await body(res);
    expect(json.error.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Envelope shape invariants
// ---------------------------------------------------------------------------

describe('envelope shape', () => {
  it('always has error.code, error.stage, error.message', async () => {
    const errors = [
      new EnvLoadError('FLAG', 'bad'),
      new SignerDetectorError('MissingClientYaml', '/path'),
      new SuiClientError('RPC_UNREACHABLE', 'https://rpc', 'unreachable'),
      new WalrusError('PUBLISHER_UNREACHABLE', 'https://pub', 'timeout'),
      new Error('generic'),
    ];

    for (const err of errors) {
      const res = toErrorResponse(err);
      const json = await body(res);
      expect(typeof json.error.code).toBe('string');
      expect(typeof json.error.stage).toBe('string');
      expect(typeof json.error.message).toBe('string');
      expect(json.error.code.length).toBeGreaterThan(0);
      expect(json.error.stage.length).toBeGreaterThan(0);
      expect(json.error.message.length).toBeGreaterThan(0);
    }
  });
});
