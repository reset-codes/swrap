#!/usr/bin/env bash
# =============================================================================
# Swrap — Deploy/Update Script
# Run on the VPS to pull latest changes and redeploy.
#
# Usage (from VPS):
#   cd /opt/swrap && ./deploy/deploy.sh
#
# Usage (from local machine):
#   ssh deploy@168.144.95.178 'cd /opt/swrap && ./deploy/deploy.sh'
#
# Options:
#   --rollback    Roll back to the previous deployment
#   --status      Show current deployment status
#   --logs        Show recent API logs
# =============================================================================

set -euo pipefail

COMPOSE_FILE="docker-compose.vps.yml"
ENV_FILE=".env.deploy"
DEPLOY_LOG="/opt/swrap/deploy/history.log"

# ─── Helper functions ────────────────────────────────────────────────────────
log_deploy() {
    local status="$1"
    local sha="$2"
    local msg="${3:-}"
    echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') | $status | $sha | $msg" >> "$DEPLOY_LOG"
}

health_check() {
    local max_retries="${1:-12}"
    local retry=0
    while [ $retry -lt "$max_retries" ]; do
        if curl -sf http://localhost:4000/health | grep -q '"status":"ok"'; then
            return 0
        fi
        retry=$((retry + 1))
        echo "  Waiting... (attempt $retry/$max_retries)"
        sleep 5
    done
    return 1
}

show_status() {
    echo "═══════════════════════════════════════════════════════════════"
    echo "  Swrap Deployment Status"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "  Current commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    echo "  Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
    echo ""
    echo "  Container status:"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps 2>/dev/null || echo "  (not running)"
    echo ""
    echo "  Health: $(curl -sf http://localhost:4000/health 2>/dev/null || echo 'UNREACHABLE')"
    echo ""
    if [ -f "$DEPLOY_LOG" ]; then
        echo "  Last 5 deployments:"
        tail -5 "$DEPLOY_LOG" | sed 's/^/    /'
    fi
    echo "═══════════════════════════════════════════════════════════════"
}

show_logs() {
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50 api
}

do_rollback() {
    echo "▶ Rolling back to previous commit..."
    local prev_sha
    prev_sha=$(git log --format='%H' -2 | tail -1)
    if [ -z "$prev_sha" ]; then
        echo "  ✗ No previous commit to roll back to"
        exit 1
    fi
    echo "  Rolling back to: ${prev_sha:0:7}"
    git reset --hard "$prev_sha"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --remove-orphans
    sleep 5
    if health_check 6; then
        echo "  ✓ Rollback successful"
        log_deploy "ROLLBACK" "${prev_sha:0:7}" "Manual rollback"
    else
        echo "  ✗ Rollback failed — manual intervention required"
        log_deploy "ROLLBACK_FAILED" "${prev_sha:0:7}" "Health check failed after rollback"
        exit 1
    fi
}

# ─── Parse arguments ─────────────────────────────────────────────────────────
case "${1:-}" in
    --rollback)
        do_rollback
        exit 0
        ;;
    --status)
        show_status
        exit 0
        ;;
    --logs)
        show_logs
        exit 0
        ;;
esac

# ─── Preflight checks ───────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    echo "✗ Missing $ENV_FILE — copy from .env.deploy.example and fill in values"
    exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "✗ Missing $COMPOSE_FILE — are you in the project root?"
    exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Swrap API Deployment — api.swrap.tech"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════════"

# ─── Save current state for rollback ────────────────────────────────────────
PREV_SHA=$(git rev-parse HEAD 2>/dev/null || echo "none")

# ─── Pull latest code ───────────────────────────────────────────────────────
echo ""
echo "▶ Pulling latest code..."
git fetch origin main
git reset --hard origin/main

CURRENT_SHA=$(git rev-parse --short HEAD)
echo "  Deploying: $CURRENT_SHA (was: ${PREV_SHA:0:7})"

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

if health_check 12; then
    echo "  ✓ API is healthy"
    log_deploy "SUCCESS" "$CURRENT_SHA" "Deployed from ${PREV_SHA:0:7}"
else
    echo "  ✗ API health check failed after 12 attempts"
    echo ""

    # Automatic rollback
    if [ "$PREV_SHA" != "none" ]; then
        echo "▶ Auto-rolling back to ${PREV_SHA:0:7}..."
        git reset --hard "$PREV_SHA"
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --remove-orphans
        sleep 10

        if health_check 6; then
            echo "  ✓ Rollback successful — running at ${PREV_SHA:0:7}"
            log_deploy "AUTO_ROLLBACK" "${PREV_SHA:0:7}" "Failed deploy of $CURRENT_SHA"
        else
            echo "  ✗ Rollback also failed — MANUAL INTERVENTION REQUIRED"
            log_deploy "CRITICAL" "$CURRENT_SHA" "Deploy and rollback both failed"
        fi
    fi

    echo ""
    echo "▶ Recent API logs:"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=30 api
    exit 1
fi

# ─── Show status ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Container status:"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

# ─── Cleanup old Docker images ───────────────────────────────────────────────
echo ""
echo "▶ Cleaning up old images..."
docker image prune -f --filter "until=72h" 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Deployment complete!"
echo "  Commit: $CURRENT_SHA"
echo "  API: https://api.swrap.tech/health"
echo "═══════════════════════════════════════════════════════════════"
