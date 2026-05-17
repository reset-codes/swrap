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

## CI/CD Pipeline

```
Local Machine
    │ git push
    ▼
GitHub (private repo)
    │ push to main (paths: apps/api/**, packages/**, db/**)
    ▼
GitHub Actions
    ├── 1. Type check (tsc --noEmit)
    ├── 2. Run tests (vitest run)
    │       ↓ (must pass)
    └── 3. SSH into VPS as 'deploy' user
            ├── git fetch + reset to target commit
            ├── docker compose up --build
            ├── Run database migrations
            ├── Health check (12 retries × 5s)
            ├── ✓ Success → deployment complete
            └── ✗ Failure → auto-rollback to previous commit
```

## DNS Configuration

| Record | Type | Value |
|--------|------|-------|
| `api.swrap.tech` | A | `168.144.95.178` |
| `swrap.tech` | CNAME | `cname.vercel-dns.com` |

---

## SSH Key Architecture

Three separate keys with distinct purposes:

| Key | Purpose | Location |
|-----|---------|----------|
| Personal SSH key | You → GitHub (push code) | `~/.ssh/id_ed25519` on your machine |
| CI/CD SSH key | GitHub Actions → VPS (deploy) | GitHub Secret `VPS_SSH_PRIVATE_KEY` |
| Deploy key | VPS → GitHub (pull code) | `/home/deploy/.ssh/github_deploy_key` on VPS |

**Never reuse keys across purposes.**

---

## Initial VPS Setup

### 1. Run Base Setup

```bash
ssh root@168.144.95.178 'bash -s' < deploy/setup-vps.sh
```

### 2. Create Deploy User

```bash
ssh root@168.144.95.178 'bash -s' < deploy/setup-deploy-user.sh
```

Follow the printed instructions to:
- Add the deploy key to GitHub (repo → Settings → Deploy Keys)
- Generate and configure the CI/CD SSH key
- Add GitHub Secrets

### 3. Clone Repo (as deploy user)

```bash
ssh deploy@168.144.95.178
cd /opt/swrap
git clone git@github.com:YOUR_USERNAME/swrap.git .
```

### 4. Configure Environment

```bash
cp .env.deploy.example .env.deploy
nano .env.deploy  # Fill in all values
chmod 600 .env.deploy
```

**Required values:**

| Variable | How to generate |
|----------|----------------|
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `INFRASTRUCTURE_WALLET_SECRET` | `sui keytool generate ed25519` |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `API_SECRET_KEY` | `openssl rand -base64 32` |
| `API_CORS_ORIGINS` | `https://swrap.tech,https://www.swrap.tech` |

### 5. First Deploy

```bash
./deploy/deploy.sh
```

---

## GitHub Secrets Required

Set in: Repo → Settings → Secrets and Variables → Actions

| Secret | Value |
|--------|-------|
| `VPS_HOST` | `168.144.95.178` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_PRIVATE_KEY` | Contents of `~/.ssh/swrap_github_actions` |

---

## Day-to-Day Operations

### Automatic Deployment

Push to `main` with changes in `apps/api/**`, `packages/**`, `db/**`, or `docker-compose.vps.yml` → automatic deploy.

### Manual Deploy (from local)

```bash
ssh deploy@168.144.95.178 'cd /opt/swrap && ./deploy/deploy.sh'
```

Or use the npm script:
```bash
npm run deploy:vps
```

### Emergency Deploy (skip tests)

Use the GitHub Actions "Run workflow" button with `skip_tests: true`.

### Check Status

```bash
ssh deploy@168.144.95.178 'cd /opt/swrap && ./deploy/deploy.sh --status'
```

### View Logs

```bash
ssh deploy@168.144.95.178 'cd /opt/swrap && ./deploy/deploy.sh --logs'
```

### Manual Rollback

```bash
ssh deploy@168.144.95.178 'cd /opt/swrap && ./deploy/deploy.sh --rollback'
```

---

## Useful Docker Commands

```bash
# View logs (follow)
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

Set in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_APP_URL` | `https://swrap.tech` |
| `NEXT_PUBLIC_API_URL` | `https://api.swrap.tech` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Your Firebase key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Your project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `your-project.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Your sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Your app ID |
| `NEXTAUTH_URL` | `https://swrap.tech` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Full JSON string |

### 3. Deploy

Vercel auto-deploys on every push to `main`.

---

## Security Hardening

### Firewall (UFW)

```bash
sudo ufw status          # Check current rules
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP (ACME + redirect)
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### Fail2Ban

```bash
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
```

### SSH Hardening

Edit `/etc/ssh/sshd_config`:
```
PermitRootLogin no          # After deploy user is confirmed working
PasswordAuthentication no   # Key-only access
MaxAuthTries 3
```

### Docker Security

- Non-root user inside containers (already configured in Dockerfile)
- Resource limits on containers (already in docker-compose.vps.yml)
- No exposed ports except 80/443 via Nginx

---

## TLS Certificate Renewal

Auto-renewal is configured via cron. To manually renew:

```bash
certbot renew
docker compose -f docker-compose.vps.yml exec nginx nginx -s reload
```

---

## Monitoring

### Health Check

```bash
curl https://api.swrap.tech/health
```

Expected:
```json
{"status":"ok","checks":{"db":"ok","infraWallet":"ok"},"timestamp":"..."}
```

### Recommended External Monitoring

- [UptimeRobot](https://uptimerobot.com) — free tier, 5-min checks
- [Better Stack](https://betterstack.com) — incident management + status page

Monitor:
- `https://api.swrap.tech/health` — API health
- `https://swrap.tech` — Frontend availability

### Deployment History

```bash
cat /opt/swrap/deploy/history.log
```

---

## Disaster Recovery

### Database Backup

```bash
# Manual backup
docker compose -f docker-compose.vps.yml exec postgres \
  pg_dump -U swrap -d swrap > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore
cat backup.sql | docker compose -f docker-compose.vps.yml exec -T postgres \
  psql -U swrap -d swrap
```

### Full Recovery Steps

1. Provision new VPS
2. Run `setup-vps.sh`
3. Run `setup-deploy-user.sh`
4. Clone repo, configure `.env.deploy`
5. Restore database from backup
6. Update DNS A record
7. Run `deploy.sh`

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
docker compose -f docker-compose.vps.yml logs postgres
```

### TLS certificate issues
```bash
certbot certificates
certbot renew --dry-run
```

### CORS errors
- Verify `API_CORS_ORIGINS` in `.env.deploy` includes your Vercel domain
- Test: `curl -H "Origin: https://swrap.tech" -I https://api.swrap.tech/health`

### Deployment stuck
```bash
# Check what's running
docker ps
# Force restart
docker compose -f docker-compose.vps.yml down
docker compose -f docker-compose.vps.yml --env-file .env.deploy up -d --build
```
