#!/usr/bin/env bash
# =============================================================================
# Swrap — Create Dedicated Deploy User
#
# Creates a non-root 'deploy' user with Docker access for CI/CD deployments.
# Run this ONCE on the VPS as root.
#
# Usage: ssh root@168.144.95.178 'bash -s' < deploy/setup-deploy-user.sh
# =============================================================================

set -euo pipefail

DEPLOY_USER="deploy"
APP_DIR="/opt/swrap"

echo "═══════════════════════════════════════════════════════════════"
echo "  Creating deploy user for CI/CD"
echo "═══════════════════════════════════════════════════════════════"

# ─── 1. Create user ─────────────────────────────────────────────────────────
echo ""
echo "▶ Creating user '$DEPLOY_USER'..."
if id "$DEPLOY_USER" &>/dev/null; then
    echo "  ✓ User already exists"
else
    adduser --disabled-password --gecos "Deploy User" "$DEPLOY_USER"
    echo "  ✓ User created"
fi

# ─── 2. Add to docker group ─────────────────────────────────────────────────
echo ""
echo "▶ Adding to docker group..."
usermod -aG docker "$DEPLOY_USER"
echo "  ✓ Added to docker group"

# ─── 3. Setup SSH directory ─────────────────────────────────────────────────
echo ""
echo "▶ Setting up SSH..."
DEPLOY_HOME=$(eval echo "~$DEPLOY_USER")
mkdir -p "$DEPLOY_HOME/.ssh"
chmod 700 "$DEPLOY_HOME/.ssh"
touch "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
echo "  ✓ SSH directory configured"

# ─── 4. Grant ownership of app directory ────────────────────────────────────
echo ""
echo "▶ Setting app directory permissions..."
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
echo "  ✓ $APP_DIR owned by $DEPLOY_USER"

# ─── 5. Allow deploy user to restart nginx (for cert renewal) ───────────────
echo ""
echo "▶ Configuring limited sudo access..."
cat > /etc/sudoers.d/deploy-swrap << 'EOF'
# Allow deploy user to manage Docker and Nginx without password
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose
deploy ALL=(ALL) NOPASSWD: /usr/bin/certbot
EOF
chmod 440 /etc/sudoers.d/deploy-swrap
echo "  ✓ Sudo rules configured"

# ─── 6. Generate deploy key for GitHub repo access ──────────────────────────
echo ""
echo "▶ Generating GitHub deploy key..."
DEPLOY_KEY="$DEPLOY_HOME/.ssh/github_deploy_key"
if [ -f "$DEPLOY_KEY" ]; then
    echo "  ✓ Deploy key already exists"
else
    sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "swrap-vps-deploy"
    echo "  ✓ Deploy key generated"
fi

# ─── 7. Configure SSH for GitHub ────────────────────────────────────────────
echo ""
echo "▶ Configuring SSH for GitHub..."
SSH_CONFIG="$DEPLOY_HOME/.ssh/config"
if ! grep -q "github.com" "$SSH_CONFIG" 2>/dev/null; then
    cat >> "$SSH_CONFIG" << EOF
Host github.com
    HostName github.com
    User git
    IdentityFile $DEPLOY_KEY
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOF
    chmod 600 "$SSH_CONFIG"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$SSH_CONFIG"
    echo "  ✓ SSH config created"
else
    echo "  ✓ SSH config already configured"
fi

# ─── 8. Summary ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Deploy user setup complete!"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Add this PUBLIC key as a Deploy Key in your GitHub repo:"
echo "     (Settings → Deploy Keys → Add → Allow Read Access)"
echo ""
cat "$DEPLOY_KEY.pub"
echo ""
echo "  2. Generate a CI/CD SSH key on your LOCAL machine:"
echo "     ssh-keygen -t ed25519 -f ~/.ssh/swrap_github_actions -C 'swrap-ci'"
echo ""
echo "  3. Add the PUBLIC key to the deploy user's authorized_keys:"
echo "     cat ~/.ssh/swrap_github_actions.pub | ssh root@168.144.95.178 \\"
echo "       'cat >> /home/deploy/.ssh/authorized_keys'"
echo ""
echo "  4. Add the PRIVATE key as a GitHub Secret:"
echo "     Repo → Settings → Secrets → Actions → New:"
echo "       Name: VPS_SSH_PRIVATE_KEY"
echo "       Value: (contents of ~/.ssh/swrap_github_actions)"
echo ""
echo "  5. Add other GitHub Secrets:"
echo "       VPS_HOST = 168.144.95.178"
echo "       VPS_USER = deploy"
echo ""
echo "  6. Test SSH access:"
echo "     ssh deploy@168.144.95.178 'docker ps'"
echo ""
echo "  7. Test GitHub access (as deploy user):"
echo "     ssh deploy@168.144.95.178 'ssh -T git@github.com'"
echo ""
echo "═══════════════════════════════════════════════════════════════"
