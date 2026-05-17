# Runbook: Secrets Rotation

## Overview

This runbook covers rotating the secrets used by the Swrap production stack. Rotate secrets immediately if you suspect a compromise, or on a regular schedule (recommended: every 90 days for session/API secrets).

---

## SESSION_SECRET Rotation

Rotating the session secret invalidates all active user sessions. Users will need to re-authenticate.

```bash
# 1. Generate a new secret
NEW_SECRET=$(openssl rand -base64 48)
echo "New SESSION_SECRET: $NEW_SECRET"

# 2. Update .env.deploy
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$NEW_SECRET/" .env.deploy

# 3. Restart the API service to pick up the new secret
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d api

# 4. Verify the API is healthy
curl -fsS https://your-domain.example.com/api/health
```

---

## API_SECRET_KEY Rotation

```bash
# 1. Generate a new key
NEW_KEY=$(openssl rand -base64 32)
echo "New API_SECRET_KEY: $NEW_KEY"

# 2. Update .env.deploy
sed -i "s/^API_SECRET_KEY=.*/API_SECRET_KEY=$NEW_KEY/" .env.deploy

# 3. Update any internal services or scripts that use this key

# 4. Restart the API
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d api
```

---

## POSTGRES_PASSWORD Rotation

```bash
# 1. Generate a new password
NEW_PW=$(openssl rand -base64 32)

# 2. Update the password in Postgres
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U swrap -d swrap -c "ALTER USER swrap PASSWORD '$NEW_PW';"

# 3. Update .env.deploy
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW_PW/" .env.deploy

# 4. Restart the API (it reads DATABASE_URL which includes the password)
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d api

# 5. Verify connectivity
docker compose -f docker-compose.prod.yml exec postgres \
  pg_isready -U swrap -d swrap
```

---

## INFRASTRUCTURE_WALLET_SECRET Rotation

**Warning:** Rotating the Infrastructure_Wallet changes the Seal encryption authority. Existing encrypted submissions will remain decryptable only if the old wallet's Seal policies are still valid. Coordinate this rotation carefully.

```bash
# 1. Generate a new Sui keypair
#    (requires sui CLI installed locally)
sui keytool generate ed25519
# Note the new suiprivkey1... value

# 2. Fund the new wallet on testnet/mainnet as needed

# 3. Update .env.deploy with the new key
#    Edit manually — do not use sed for secrets of this sensitivity
nano .env.deploy
# Update INFRASTRUCTURE_WALLET_SECRET=suiprivkey1<new-value>

# 4. Restart the API
docker compose -f docker-compose.prod.yml --env-file .env.deploy up -d api

# 5. Verify startup (check logs for EnvValidationError)
docker compose -f docker-compose.prod.yml logs --tail=20 api

# 6. Verify health
curl -fsS https://your-domain.example.com/api/health
```

---

## After Any Rotation

1. Verify the service is healthy: `curl -fsS https://your-domain.example.com/api/health`
2. Check logs for errors: `docker compose -f docker-compose.prod.yml logs --tail=50 api`
3. Document the rotation date in your internal secrets log
4. Revoke the old secret from any other locations where it was stored
