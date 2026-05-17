# Runbook: Production Deployment

## Overview

Swrap runs as a Docker Compose stack on a 2 GB DigitalOcean Ubuntu droplet. The stack consists of four services: `nginx` (TLS termination), `web` (Next.js), `api` (Express), and `postgres` (metadata store).

---

## Prerequisites

- Ubuntu 22.04 LTS droplet, 2 GB RAM, 50 GB SSD
- Docker Engine 24+ and Docker Compose v2 installed
- Domain DNS A record pointing to the droplet IP
- TLS certificate obtained via Certbot (see TLS section below)

---

## First-Time Setup

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Clone the repository

```bash
git clone https://github.com/your-org/swrap.git /opt/swrap
cd /opt/swrap
```

### 3. Obtain TLS certificates

```bash
sudo apt install certbot -y
sudo certbot certonly --standalone -d your-domain.example.com
```

Certificates are written to `/etc/letsencrypt/live/your-domain.example.com/`.

### 4. Configure Nginx

Edit `nginx/conf.d/swrap.conf` and replace every occurrence of `<YOUR_DOMAIN>` with your actual domain.

### 5. Configure environment

```bash
cp .env.deploy.example .env.deploy
# Edit .env.deploy — fill in all values (see .env.deploy.example for guidance)
nano .env.deploy
```

Required values to set:
- `POSTGRES_PASSWORD` — strong random password
- `INFRASTRUCTURE_WALLET_SECRET` — bech32 Sui private key for the infra wallet
- `SESSION_SECRET` — at least 32 random characters
- `API_SECRET_KEY` — strong random token
- `API_CORS_ORIGINS` — your domain, e.g. `https://your-domain.example.com`
- `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_URL` — your domain

### 6. Run database migrations

```bash
docker compose -f docker-compose.prod.yml --env-file .env.deploy run --rm api \
  node dist/apps/api/server.js migrate
```

### 7. Start the stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d
```

### 8. Verify

```bash
# Check all services are healthy
docker compose -f docker-compose.prod.yml ps

# Verify API health endpoint
curl -fsS https://your-domain.example.com/api/health
```

---

## Routine Deployment (Updates)

```bash
cd /opt/swrap
git pull origin main

# Rebuild images and restart services with zero-downtime rolling update
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d --build

# Verify health after deploy
curl -fsS https://your-domain.example.com/api/health
docker compose -f docker-compose.prod.yml ps
```

---

## TLS Certificate Renewal

Certbot auto-renews certificates. Nginx needs to reload after renewal:

```bash
# Add to crontab (runs twice daily, reloads nginx on renewal)
0 0,12 * * * certbot renew --quiet --deploy-hook "docker compose -f /opt/swrap/docker-compose.prod.yml exec nginx nginx -s reload"
```

---

## Rollback

```bash
cd /opt/swrap
git log --oneline -10   # find the previous good commit
git checkout <commit-sha>
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d --build
```

---

## Checking Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# API only (structured JSON logs)
docker compose -f docker-compose.prod.yml logs -f api | jq .

# Nginx access logs
docker compose -f docker-compose.prod.yml logs -f nginx
```

---

## Stopping the Stack

```bash
docker compose -f docker-compose.prod.yml down
# To also remove volumes (DESTRUCTIVE — deletes postgres data):
docker compose -f docker-compose.prod.yml down -v
```
