# VPS Deployment Foundation

Swrap can run as a single Next.js backend/frontend process on a VPS. PostgreSQL is the index layer; Walrus remains the source of truth, and Seal encryption happens before any submission data is written to Walrus.

## Runtime Services

- Node.js 22 LTS or newer
- PostgreSQL 16 or newer
- A process manager such as `systemd` or PM2
- A reverse proxy such as Caddy or Nginx with HTTPS

## Required Environment

Set these on the server process, not in committed files:

```bash
DATABASE_URL=postgresql://swrap:password@127.0.0.1:5432/swrap
AUTH_SECRET=...
NEXTAUTH_URL=https://your-domain.example
NEXT_PUBLIC_APP_URL=https://your-domain.example
FIREBASE_SERVICE_ACCOUNT_KEY=...

WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
SUI_POC_PACKAGE_ID=0x...
INFRA_WALLET_PRIVATE_KEY=suiprivkey1...

DEV_BYPASS_STORAGE=false
DEV_LOCAL_SIGNER=false
DEV_ALLOW_PLAINTEXT=false
USE_WALRUS_TESTNET=true
USE_SUI_TESTNET=true
POC_ALLOW_PROD=true
```

## Deploy Flow

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start
```

After the process starts, verify the backend with:

```bash
curl -fsS https://your-domain.example/api/health
```

`/api/health` only reports whether required runtime configuration is present. It does not expose secrets and should be safe behind the public reverse proxy.

## Security Notes

- Keep `INFRA_WALLET_PRIVATE_KEY` in the process environment or a server secret store only.
- Do not enable `DEV_ALLOW_PLAINTEXT` on a reachable server.
- Back up PostgreSQL, but treat Walrus blobs as canonical for forms and submissions.
- Use a dedicated infrastructure wallet for the VPS and fund it only for expected Walrus/Sui operations.
