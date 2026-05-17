# Runbook: Incident Response

## Service Down

### Symptoms
- Health check at `/api/health` returns non-200 or times out
- Users report the site is unreachable

### Steps

```bash
cd /opt/swrap

# 1. Check container status
docker compose -f docker-compose.prod.yml ps

# 2. Check recent logs for the failing service
docker compose -f docker-compose.prod.yml logs --tail=100 api
docker compose -f docker-compose.prod.yml logs --tail=100 web
docker compose -f docker-compose.prod.yml logs --tail=100 nginx

# 3. Restart the affected service
docker compose -f docker-compose.prod.yml restart api
# or
docker compose -f docker-compose.prod.yml restart web

# 4. If postgres is unhealthy
docker compose -f docker-compose.prod.yml restart postgres
# Wait for healthy, then restart api
sleep 15
docker compose -f docker-compose.prod.yml restart api

# 5. Full stack restart (last resort)
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d
```

---

## Database Connection Failures

### Symptoms
- API logs show `ECONNREFUSED` or `connection refused` to postgres
- Health check reports database unhealthy

### Steps

```bash
# Check postgres container
docker compose -f docker-compose.prod.yml ps postgres
docker compose -f docker-compose.prod.yml logs --tail=50 postgres

# Verify postgres is accepting connections
docker compose -f docker-compose.prod.yml exec postgres \
  pg_isready -U swrap -d swrap

# Check disk space (postgres fails if disk is full)
df -h /var/lib/docker

# Restart postgres if needed
docker compose -f docker-compose.prod.yml restart postgres
```

---

## Infrastructure Wallet Misconfiguration

### Symptoms
- API startup fails with `EnvValidationError`
- Logs show `INFRASTRUCTURE_WALLET_SECRET` missing or invalid

### Steps

```bash
# Check the env file has the correct key name (not the old INFRA_WALLET_PRIVATE_KEY)
grep INFRASTRUCTURE_WALLET_SECRET .env.deploy

# Verify the key format (should start with suiprivkey1)
# Do NOT print the full value — just check the prefix
head -c 20 <(grep INFRASTRUCTURE_WALLET_SECRET .env.deploy | cut -d= -f2)

# After fixing .env.deploy, restart the api service
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d api
```

---

## High Memory Usage

### Symptoms
- Droplet OOM killer terminates containers
- `docker stats` shows services near memory limits

### Steps

```bash
# Check current memory usage
docker stats --no-stream

# Check system memory
free -h

# If postgres is consuming too much, check for long-running queries
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U swrap -d swrap -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10;"

# Restart the high-memory service
docker compose -f docker-compose.prod.yml restart <service>
```

---

## TLS Certificate Expired

### Symptoms
- Browser shows certificate error
- `curl -fsS https://your-domain.example.com` fails with SSL error

### Steps

```bash
# Check certificate expiry
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal

# Reload nginx to pick up new certificate
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## Disk Space Full

### Symptoms
- Docker operations fail
- Postgres write errors

### Steps

```bash
# Check disk usage
df -h

# Clean up unused Docker images and containers
docker system prune -f

# Check log sizes
du -sh /var/lib/docker/containers/*/

# Truncate old logs if needed (logs are capped at 20m/5 files per service)
docker compose -f docker-compose.prod.yml logs --tail=0 api > /dev/null
```
