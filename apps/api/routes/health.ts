/**
 * Health route for the Express VPS server.
 *
 * GET /health — Returns system status: wallet, Walrus, and Sui connectivity.
 * Public route — no authentication required.
 *
 * Requirements: R2.3, R4.3, R5.3
 */

import { Router } from 'express';
import type { ServerConfig } from '../server-config';
import { loadPocEnv } from '@poc/shared';
import { createWalrusClient } from '@poc/walrus';
import { createSuiClient, getBalance } from '@poc/sui';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export function healthRouter(config: ServerConfig): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const env = loadPocEnv();

      // Derive infra wallet address from key (never expose the key itself)
      let infraAddress: string | null = null;
      try {
        const rawKey = process.env.INFRA_WALLET_PRIVATE_KEY ?? '';
        if (rawKey) {
          const { scheme, secretKey } = decodeSuiPrivateKey(rawKey);
          if (scheme === 'ED25519') {
            const kp = Ed25519Keypair.fromSecretKey(secretKey);
            infraAddress = kp.toSuiAddress();
          }
        }
      } catch {
        // Key decode failed — address stays null
      }

      // Walrus health
      const walrusClient = createWalrusClient({
        publisherUrl: config.walrusPublisherUrl,
        aggregatorUrl: config.walrusAggregatorUrl,
      });

      let walrusHealth = {
        publisher: { ok: false, url: config.walrusPublisherUrl },
        aggregator: { ok: false, url: config.walrusAggregatorUrl },
        signer_status: 'not_ready' as 'ready' | 'not_ready',
      };

      try {
        const health = await walrusClient.healthCheck();
        walrusHealth = {
          publisher: { ok: health.publisher.ok, url: health.publisher.url },
          aggregator: { ok: health.aggregator.ok, url: health.aggregator.url },
          signer_status: health.signerStatus,
        };
      } catch {
        // Continue — partial failure allowed
      }

      // Sui balance
      let suiBalance: string | null = null;
      if (infraAddress) {
        try {
          const suiClient = createSuiClient(config.suiRpcUrl);
          const { totalBalance } = await getBalance(suiClient, infraAddress);
          suiBalance = totalBalance;
        } catch {
          // Continue — partial failure allowed
        }
      }

      const ok =
        infraAddress !== null &&
        walrusHealth.publisher.ok &&
        walrusHealth.aggregator.ok;

      res.json({
        ok,
        server: 'swrap-api',
        version: '1.0.0',
        env_flags: {
          DEV_BYPASS_STORAGE: env.DEV_BYPASS_STORAGE,
          DEV_LOCAL_SIGNER: env.DEV_LOCAL_SIGNER,
          DEV_ALLOW_PLAINTEXT: env.DEV_ALLOW_PLAINTEXT,
          USE_WALRUS_TESTNET: env.USE_WALRUS_TESTNET,
          USE_SUI_TESTNET: env.USE_SUI_TESTNET,
        },
        wallet: {
          address: infraAddress,
          sui_balance: suiBalance,
          network: env.USE_SUI_TESTNET ? 'testnet' : 'mainnet',
        },
        walrus: walrusHealth,
        seal: {
          mode: 'real',
          package_id_set: !!config.suiPocPackageId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
