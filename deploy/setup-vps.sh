#!/usr/bin/env bash
# =============================================================================
# Swrap VPS Setup Script
# Target: Ubuntu 22.04+ VPS at 168.144.95.178 (api.swrap.tech)
#
# Run this script on the VPS as root for initial setup.
# Usage: ssh root@168.144.95.178 'bash -s' < deploy/setup-vps.sh
# =============================================================================

set -euo pipefail

echo "═══════════════════════════════════════════════════════════════"
echo "  Swrap VPS Setup — api.swrap.tech (168.144.95.178)"
echo "═══════════════════════════════════════════════════════════════"

# ─── 1. System updates ──────────────────────────────────────────────────────
echo ""
echo "▶ Updating system packages..."
apt-get update -y
apt-get upgrade -y

# ─── 2. Install Docker ──────────────────────────────────────────────────────
echo ""
echo "▶ Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "  ✓ Docker installed"
else
    echo "  ✓ Docker already installed"
fi

# ─── 3. Install Docker Compose plugin ───────────────────────────────────────
echo ""
echo "▶ Checking Docker Compose..."
if docker compose version &> /dev/null; then
    echo "  ✓ Docker Compose available"
else
    apt-get install -y docker-compose-plugin
    echo "  ✓ Docker Compose plugin installed"
fi

# ─── 4. Install Certbot ─────────────────────────────────────────────────────
echo ""
echo "▶ Installing Certbot..."
if ! command -v certbot &> /dev/null; then
    apt-get install -y certbot
    echo "  ✓ Certbot installed"
else
    echo "  ✓ Certbot already installed"
fi

# ─── 5. Create app directory ────────────────────────────────────────────────
echo ""
echo "▶ Setting up app directory..."
mkdir -p /opt/swrap
mkdir -p /var/www/certbot

# ─── 6. Configure firewall ──────────────────────────────────────────────────
echo ""
echo "▶ Configuring firewall (UFW)..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP (for ACME + redirect)
    ufw allow 443/tcp   # HTTPS
    ufw --force enable
    echo "  ✓ Firewall configured (22, 80, 443 open)"
else
    echo "  ⚠ UFW not found — configure firewall manually"
fi

# ─── 7. Create swap (for 2GB VPS) ───────────────────────────────────────────
echo ""
echo "▶ Checking swap..."
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "  ✓ 1GB swap created"
else
    echo "  ✓ Swap already configured"
fi

# ─── 8. Obtain TLS certificate ──────────────────────────────────────────────
echo ""
echo "▶ Obtaining TLS certificate for api.swrap.tech..."
if [ ! -f /etc/letsencrypt/live/api.swrap.tech/fullchain.pem ]; then
    echo "  Stopping any service on port 80..."
    systemctl stop nginx 2>/dev/null || true
    docker stop $(docker ps -q --filter "publish=80") 2>/dev/null || true
    
    certbot certonly \
        --standalone \
        --non-interactive \
        --agree-tos \
        --email admin@swrap.tech \
        -d api.swrap.tech
    
    echo "  ✓ TLS certificate obtained"
else
    echo "  ✓ TLS certificate already exists"
fi

# ─── 9. Setup certbot auto-renewal ──────────────────────────────────────────
echo ""
echo "▶ Setting up certificate auto-renewal..."
cat > /etc/cron.d/certbot-renew << 'EOF'
# Renew certificates twice daily, reload nginx after renewal
0 0,12 * * * root certbot renew --quiet --deploy-hook "docker exec $(docker ps -q --filter name=nginx) nginx -s reload 2>/dev/null || true"
EOF
echo "  ✓ Auto-renewal cron configured"

# ─── 10. Summary ────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ VPS setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Clone repo to /opt/swrap:"
echo "       cd /opt/swrap && git clone <repo-url> ."
echo ""
echo "    2. Create .env.deploy:"
echo "       cp .env.deploy.example .env.deploy"
echo "       nano .env.deploy  # fill in all values"
echo ""
echo "    3. Start services:"
echo "       docker compose -f docker-compose.vps.yml --env-file .env.deploy up -d --build"
echo ""
echo "    4. Run database migrations:"
echo "       docker compose -f docker-compose.vps.yml --env-file .env.deploy exec api npx node-pg-migrate up --migrations-dir db/migrations"
echo ""
echo "    5. Verify:"
echo "       curl https://api.swrap.tech/health"
echo "═══════════════════════════════════════════════════════════════"
