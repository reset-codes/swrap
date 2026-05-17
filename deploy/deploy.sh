#!/usr/bin/env bash
# =============================================================================
# Swrap — Deploy/Update Script
# Run on the VPS to pull latest changes and redeploy.
#
# Usage (from VPS):
#   cd /opt/swrap && ./deploy/deploy.sh
#
# Usage (from local machine):
#   ssh root@168.144.95.178 'cd /opt/swrap && git pull && ./deploy/deploy.sh'
# =============================================================================

set -euo pipefail

COMPOSE_FILE="docker-compose.vps.yml"
ENV_FILE=".env.deploy"

echo "═══════════════════════════════════════════════════════════════"
echo "  Swrap API Deployment — api.swrap.tech"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════════"

# ─── Preflight checks ───────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    echo "✗ Missing $ENV_FILE — copy from .env.deploy.example and fill in values"
    exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "✗ Missing $COMPOSE_FILE — are you in the project root?"
    exit 1
fi

# ─── Pull latest code ───────────────────────────────────────────────────────
echo ""
echo "▶ Pulling latest code..."
git pull --ff-only 2>/dev/null || echo "  (skipped — not a git repo or no remote)"

# ─── Build and deploy ────────────────────────────────────────────────────────
echo ""
echo "▶ Building and deploying containers..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --remove-orphans

# ─── Run migrations ─────────────────────────────────────────────────────────
echo ""
echo "▶ Running database migrations..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api \
    npx node-pg-migrate up --migrations-dir db/migrations --database-url-var DATABASE_URL \
    2>&1 || echo "  ⚠ Migration step completed (check output above)"

# ─── Health check ────────────────────────────────────────────────────────────
echo ""
echo "▶ Waiting for API to be healthy..."
sleep 5

MAX_RETRIES=10
RETRY=0
until curl -sf http://localhost:4000/health > /dev/null 2>&1; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "  ✗ API health check failed after ${MAX_RETRIES} attempts"
        echo "  Check logs: docker compose -f $COMPOSE_FILE logs api"
        exit 1
    fi
    echo "  Waiting... (attempt $RETRY/$MAX_RETRIES)"
    sleep 3
done

echo "  ✓ API is healthy"

# ─── Show status ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Container status:"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Deployment complete!"
echo "  API: https://api.swrap.tech/health"
echo "═══════════════════════════════════════════════════════════════"
