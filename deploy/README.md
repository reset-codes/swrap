# Swrap Deployment Guide

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
└──────────────┬──────────────────────────────┬───────────────────┘
               │                              │
    ┌──────────▼──────────┐       ┌───────────▼──────────┐
    │   Vercel (Frontend)  │       │  VPS 168.144.95.178  │
    │   swrap.tech         │       │  api.swrap.tech      │
    │                      │       │                      │
    │  Next.js 15 App      │──────▶│  ┌────────────────┐  │
    │  React 19 + Tailwind │ HTTPS │  │  Nginx (TLS)   │  │
    │  Firebase Auth       │       │  │  :80 → :443    │  │
    └──────────────────────┘       │  └───────┬────────┘  │
                                   │          │           │
                                   │  ┌───────▼────────┐  │
                                   │  │  Express API   │  │
                                   │  │  :4000         │  │
                                   │  └───────┬────────┘  │
                                   │          │           │
                                   │  ┌───────▼────────┐  │
                                   │  │  PostgreSQL    │  │
                                   │  │  :5432         │  │
                                   │  └────────────────┘  │
                                   └──────────────────────┘
```

## DNS Configuration

| Record | Type | Value |
|--------|------|-------|
| `api.swrap.tech` | A | `168.144.95.178` |
| `swrap.tech` | CNAME | `cname.vercel-dns.com` |

---

## VPS Deployment (api.swrap.tech)

### Prerequisites

- Ubuntu 22.04+ VPS at 168.144.95.178
- DNS A record: `api.swrap.tech` → `168.144.95.178`
- SSH access as root

### 1. Initial VPS Setup

```bash
# From your local machine — run the setup script on the VPS
ssh root@168.144.95.178 'bash -s' < deploy/setup-vps.sh
```

This installs Docker, Certbot, configures the firewall, creates swap, and obtains the TLS certificate.

### 2. Clone and Configure

```bash
ssh root@168.144.95.178

cd /opt/swrap
git clone <your-repo-url> .

# Create production environment file
cp .env.deploy.example .env.deploy
nano .env.deploy  # Fill in all values
```

**Required values in `.env.deploy`:**

| Variable | How to generate |
|----------|----------------|
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `INFRASTRUCTURE_WALLET_SECRET` | `sui keytool generate ed25519` |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `API_SECRET_KEY` | `openssl rand -base64 32` |
| `API_CORS_ORIGINS` | `https://swrap.tech,https://www.swrap.tech` |

### 3. Deploy

```bash
# First deployment
docker compose -f docker-compose.vps.yml --env-file .env.deploy up -d --build

# Run database migrations
docker compose -f docker-compose.vps.yml --env-file .env.deploy exec api \
    npx node-pg-migrate up --migrations-dir db/migrations --database-url-var DATABASE_URL

# Verify
curl https://api.swrap.tech/health
```

### 4. Subsequent Deployments

```bash
cd /opt/swrap
./deploy/deploy.sh
```

Or from your local machine:
```bash
ssh root@168.144.95.178 'cd /opt/swrap && git pull && ./deploy/deploy.sh'
```

### Useful Commands

```bash
# View logs
docker compose -f docker-compose.vps.yml logs -f api
docker compose -f docker-compose.vps.yml logs -f postgres
docker compose -f docker-compose.vps.yml logs -f nginx

# Restart API only
docker compose -f docker-compose.vps.yml restart api

# Stop everything
docker compose -f docker-compose.vps.yml down

# Stop and remove volumes (DESTRUCTIVE — deletes DB data)
docker compose -f docker-compose.vps.yml down -v

# Shell into API container
docker compose -f docker-compose.vps.yml exec api sh

# Shell into Postgres
docker compose -f docker-compose.vps.yml exec postgres psql -U swrap -d swrap
```

---

## Vercel Deployment (Frontend)

### 1. Connect Repository

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your Git repository
3. Framework: Next.js (auto-detected)
4. Root Directory: `.` (project root)

### 2. Environment Variables

Set these in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_APP_URL` | `https://swrap.tech` | Your frontend domain |
| `NEXT_PUBLIC_API_URL` | `https://api.swrap.tech` | VPS API URL |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Your Firebase key | Public, safe to expose |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` | |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Your project ID | |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `your-project.appspot.com` | |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Your sender ID | |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Your app ID | |
| `NEXTAUTH_URL` | `https://swrap.tech` | |
| `NEXTAUTH_SECRET` | Generate with `openssl rand -base64 32` | |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Full JSON string | Server-side only |
| `DATABASE_URL` | `postgresql://swrap:<pass>@168.144.95.178:5432/swrap` | Only if needed |

### 3. Domain Configuration

In Vercel Dashboard → Project Settings → Domains:
- Add `swrap.tech`
- Add `www.swrap.tech` (redirects to `swrap.tech`)

### 4. Deploy

Vercel auto-deploys on every push to `main`. For manual deploys:
```bash
npx vercel --prod
```

---

## API Routing Strategy

The `vercel.json` includes a rewrite rule:
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.swrap.tech/:path*" }
  ]
}
```

This means the frontend can call `/api/forms` and it gets proxied to `https://api.swrap.tech/forms`. This avoids CORS issues for simple requests and provides a clean URL structure.

The frontend code also supports direct API calls via `NEXT_PUBLIC_API_URL` for cases where you want the browser to call the API directly (e.g., for WebSocket connections or large uploads).

---

## TLS Certificate Renewal

Certbot auto-renewal is configured via cron on the VPS. To manually renew:

```bash
# On VPS
certbot renew
docker compose -f docker-compose.vps.yml exec nginx nginx -s reload
```

---

## Monitoring

### Health Check

```bash
curl https://api.swrap.tech/health
```

Expected response:
```json
{
  "status": "ok",
  "checks": {
    "db": "ok",
    "infraWallet": "ok"
  },
  "timestamp": "2026-05-17T..."
}
```

### Uptime Monitoring

Set up an external monitor (UptimeRobot, Better Uptime, etc.) to ping:
- `https://api.swrap.tech/health` — API health
- `https://swrap.tech` — Frontend availability

---

## Troubleshooting

### API won't start
```bash
docker compose -f docker-compose.vps.yml logs api
# Check for EnvValidationError — means missing/invalid env vars
```

### Database connection failed
```bash
docker compose -f docker-compose.vps.yml exec postgres pg_isready -U swrap
# If not ready, check postgres logs
docker compose -f docker-compose.vps.yml logs postgres
```

### TLS certificate issues
```bash
certbot certificates  # Check cert status
certbot renew --dry-run  # Test renewal
```

### CORS errors in browser
- Verify `API_CORS_ORIGINS` in `.env.deploy` includes your Vercel domain
- Check: `curl -H "Origin: https://swrap.tech" -I https://api.swrap.tech/health`
