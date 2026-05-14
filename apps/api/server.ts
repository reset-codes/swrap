/**
 * Swrap VPS API Server
 *
 * Standalone Express server for VPS deployment. Exposes the Swrap API
 * endpoints independently of the Next.js frontend, using the same
 * @poc/* packages for Seal encryption and Walrus storage.
 *
 * Environment variables required:
 *   PORT                     — HTTP port (default: 4000)
 *   API_CORS_ORIGINS         — comma-separated allowed origins (default: *)
 *   INFRA_WALLET_PRIVATE_KEY — Ed25519 bech32 private key (suiprivkey1...)
 *   SUI_RPC_URL              — Sui fullnode gRPC URL (default: testnet)
 *   SUI_POC_PACKAGE_ID       — 0x-prefixed 64-hex package address
 *   DEV_BYPASS_STORAGE       — true | false
 *   DEV_LOCAL_SIGNER         — true | false
 *   DEV_ALLOW_PLAINTEXT      — true | false
 *   USE_WALRUS_TESTNET       — true | false
 *   USE_SUI_TESTNET          — true | false
 *   POC_ALLOW_PROD           — true (required in production)
 *   WALRUS_PUBLISHER_URL     — Walrus publisher endpoint
 *   WALRUS_AGGREGATOR_URL    — Walrus aggregator endpoint
 *   API_SECRET_KEY           — Bearer token for admin route authentication
 */

import http from 'node:http';
import { loadServerConfig } from './server-config';
import { createApp } from './app';

async function main(): Promise<void> {
  // Load and validate configuration at startup — fail fast if misconfigured
  const config = loadServerConfig();

  const app = createApp(config);
  const server = http.createServer(app);

  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        event: 'server_started',
        port: config.port,
        env: process.env.NODE_ENV ?? 'development',
        corsOrigins: config.corsOrigins,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(JSON.stringify({ event: 'shutdown_signal', signal }));
    server.close(() => {
      console.log(JSON.stringify({ event: 'server_closed' }));
      process.exit(0);
    });
    // Force-close after 10s if connections don't drain
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(JSON.stringify({ event: 'startup_failed', error: String(err) }));
  process.exit(1);
});
