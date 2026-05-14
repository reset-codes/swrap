/**
 * Health check handler for the POC.
 *
 * Returns a JSON snapshot of:
 *   - env flags loaded by Env_Loader
 *   - signer address + network (or null if detection fails)
 *   - Walrus publisher/aggregator health + signer_status
 *   - Sui balance + RPC endpoint
 *   - Seal mode ('fallback' until real Seal SDK is integrated)
 *
 * Requirements: R2.3, R4.3, R5.3, R14.7
 */

import { NextResponse } from 'next/server';
import { loadPocEnv } from '@poc/shared';
import { detectLocalSigner } from '@poc/sui';
import { createWalrusClient } from '@poc/walrus';
import { createSuiClient, getBalance } from '@poc/sui';
import { toErrorResponse } from './error-envelope';

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: boolean;
  env_flags: {
    DEV_BYPASS_STORAGE: boolean;
    DEV_LOCAL_SIGNER: boolean;
    DEV_ALLOW_PLAINTEXT: boolean;
    USE_WALRUS_TESTNET: boolean;
    USE_SUI_TESTNET: boolean;
  };
  signer: {
    address: string;
    network: string;
  } | null;
  walrus: {
    publisher: { ok: boolean; url: string };
    aggregator: { ok: boolean; url: string };
    signer_status: 'ready' | 'not_ready';
  };
  sui: {
    balance: string | null;
    rpc: string;
  };
  seal: {
    mode: 'fallback' | 'real';
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<HealthResponse>> {
  // 1. Load env — if this fails, return a structured error envelope.
  let env: ReturnType<typeof loadPocEnv>;
  try {
    env = loadPocEnv();
  } catch (err) {
    return toErrorResponse(err) as unknown as NextResponse<HealthResponse>;
  }

  const envFlags = {
    DEV_BYPASS_STORAGE: env.DEV_BYPASS_STORAGE,
    DEV_LOCAL_SIGNER: env.DEV_LOCAL_SIGNER,
    DEV_ALLOW_PLAINTEXT: env.DEV_ALLOW_PLAINTEXT,
    USE_WALRUS_TESTNET: env.USE_WALRUS_TESTNET,
    USE_SUI_TESTNET: env.USE_SUI_TESTNET,
  };

  // 2. Try to detect local signer — partial failure is allowed.
  let signerInfo: HealthResponse['signer'] = null;
  try {
    const { signer, activeNetwork } = await detectLocalSigner();
    signerInfo = { address: signer.address, network: activeNetwork };
  } catch {
    // Signer detection failed — continue with null signer.
  }

  // 3. Try Walrus health check — partial failure is allowed.
  const walrusClient = createWalrusClient({
    publisherUrl: env.WALRUS_PUBLISHER_URL,
    aggregatorUrl: env.WALRUS_AGGREGATOR_URL,
  });

  let walrusInfo: HealthResponse['walrus'] = {
    publisher: { ok: false, url: env.WALRUS_PUBLISHER_URL },
    aggregator: { ok: false, url: env.WALRUS_AGGREGATOR_URL },
    signer_status: 'not_ready',
  };

  try {
    const health = await walrusClient.healthCheck();
    walrusInfo = {
      publisher: { ok: health.publisher.ok, url: health.publisher.url },
      aggregator: { ok: health.aggregator.ok, url: health.aggregator.url },
      signer_status: health.signerStatus,
    };
  } catch {
    // Walrus health check failed — keep defaults (both ok: false).
  }

  // 4. Try Sui balance query — partial failure is allowed.
  const suiClient = createSuiClient(env.SUI_RPC_URL);
  let suiInfo: HealthResponse['sui'] = { balance: null, rpc: env.SUI_RPC_URL };

  if (signerInfo) {
    try {
      const { totalBalance } = await getBalance(suiClient, signerInfo.address);
      suiInfo = { balance: totalBalance, rpc: env.SUI_RPC_URL };
    } catch {
      // Balance query failed — keep null balance.
    }
  }

  // 5. Determine overall ok status.
  // ok = true when signer is detected AND walrus health is ok.
  const ok = signerInfo !== null && walrusInfo.publisher.ok && walrusInfo.aggregator.ok;

  return NextResponse.json({
    ok,
    env_flags: envFlags,
    signer: signerInfo,
    walrus: walrusInfo,
    sui: suiInfo,
    seal: { mode: 'fallback' },
  });
}
