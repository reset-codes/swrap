#!/usr/bin/env bash
# =============================================================================
# Swrap — Walrus Publisher Wallet Setup
#
# Automatically installs Sui CLI + Walrus CLI on the VPS and generates a
# dedicated publisher wallet. The wallet address is printed for funding.
# The private key is stored ONLY in the Sui keystore — never logged or echoed.
#
# Usage:
#   ssh deploy@168.144.95.178 'bash -s' < deploy/setup-walrus-wallet.sh
#
# After running:
#   1. Fund the printed wallet address with SUI (testnet faucet or transfer)
#   2. Add the wallet's bech32 private key to .env.deploy as INFRASTRUCTURE_WALLET_SECRET
#      Get it via: sui keytool export --key-identity <address>
#
# Requirements: VPS running Ubuntu 22.04+ with Docker
# =============================================================================

set -euo pipefail

WALRUS_VERSION="${WALRUS_VERSION:-testnet-v1.4.0}"
SUI_VERSION="${SUI_VERSION:-1.43.0}"
WALRUS_CONFIG_DIR="${HOME}/.config/walrus"
SUI_CONFIG_DIR="${HOME}/.sui/sui_config"

echo "═══════════════════════════════════════════════════════════════"
echo "  Swrap — Walrus Publisher Wallet Setup"
echo "  Target: $(hostname) ($(uname -m))"
echo "═══════════════════════════════════════════════════════════════"

# ─── 1. Detect architecture ─────────────────────────────────────────────────
ARCH="$(uname -m)"
if [[ "$ARCH" == "x86_64" ]]; then
    SUI_ARCH="ubuntu-x86_64"
    WALRUS_ARCH="ubuntu-x86_64"
elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
    SUI_ARCH="ubuntu-arm64"
    WALRUS_ARCH="ubuntu-arm64"
else
    echo "  ✗ Unsupported architecture: $ARCH"
    exit 1
fi

# ─── 2. Install Sui CLI ─────────────────────────────────────────────────────
echo ""
echo "▶ Checking Sui CLI..."
if command -v sui &>/dev/null; then
    CURRENT_SUI_VERSION=$(sui --version 2>/dev/null | head -1 || echo "unknown")
    echo "  ✓ Sui CLI already installed: $CURRENT_SUI_VERSION"
else
    echo "  Installing Sui CLI v${SUI_VERSION}..."
    SUI_URL="https://github.com/MystenLabs/sui/releases/download/mainnet-v${SUI_VERSION}/sui-mainnet-v${SUI_VERSION}-${SUI_ARCH}.tgz"
    
    # Try mainnet release first, then testnet
    if ! curl -fsSL --connect-timeout 30 "$SUI_URL" -o /tmp/sui.tgz 2>/dev/null; then
        SUI_URL="https://github.com/MystenLabs/sui/releases/download/testnet-v${SUI_VERSION}/sui-testnet-v${SUI_VERSION}-${SUI_ARCH}.tgz"
        curl -fsSL --connect-timeout 30 "$SUI_URL" -o /tmp/sui.tgz || {
            echo "  ✗ Failed to download Sui CLI. Trying latest release..."
            # Fallback: download latest
            SUI_URL="https://github.com/MystenLabs/sui/releases/latest/download/sui-${SUI_ARCH}.tgz"
            curl -fsSL --connect-timeout 30 "$SUI_URL" -o /tmp/sui.tgz
        }
    fi
    
    cd /tmp && tar -xzf /tmp/sui.tgz
    # Binary may be named 'sui' or 'sui-ubuntu-x86_64' depending on version
    if [ -f "/tmp/sui" ]; then
        sudo mv /tmp/sui /usr/local/bin/sui
    elif [ -f "/tmp/target/release/sui" ]; then
        sudo mv /tmp/target/release/sui /usr/local/bin/sui
    else
        # Search for any sui binary in the extracted files
        SUI_BIN=$(find /tmp -maxdepth 3 -name 'sui' -type f 2>/dev/null | head -1)
        if [ -n "$SUI_BIN" ]; then
            sudo mv "$SUI_BIN" /usr/local/bin/sui
        else
            echo "  ✗ Could not find sui binary after extraction"
            ls -la /tmp/
            exit 1
        fi
    fi
    sudo chmod +x /usr/local/bin/sui
    rm -f /tmp/sui.tgz
    echo "  ✓ Sui CLI installed: $(sui --version 2>/dev/null | head -1)"
fi

# ─── 3. Configure Sui CLI for testnet ───────────────────────────────────────
echo ""
echo "▶ Configuring Sui CLI for testnet..."
mkdir -p "$SUI_CONFIG_DIR"

if ! sui client active-env 2>/dev/null | grep -q "testnet"; then
    # Initialize or add testnet environment
    if [ ! -f "$SUI_CONFIG_DIR/client.yaml" ]; then
        # First time: initialize with testnet
        echo "  Initializing Sui client config..."
        sui client --yes 2>/dev/null || true
    fi
    
    # Add testnet if not present
    if ! sui client envs 2>/dev/null | grep -q "testnet"; then
        sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443 2>/dev/null || true
    fi
    
    # Switch to testnet
    sui client switch --env testnet 2>/dev/null || true
fi

echo "  ✓ Sui active env: $(sui client active-env 2>/dev/null || echo 'testnet')"

# ─── 4. Install Walrus CLI ───────────────────────────────────────────────────
echo ""
echo "▶ Checking Walrus CLI..."
if command -v walrus &>/dev/null; then
    echo "  ✓ Walrus CLI already installed: $(walrus --version 2>/dev/null | head -1 || echo 'unknown')"
else
    echo "  Installing Walrus CLI ${WALRUS_VERSION}..."
    WALRUS_URL="https://github.com/MystenLabs/walrus-docs/releases/download/${WALRUS_VERSION}/walrus-${WALRUS_VERSION}-${WALRUS_ARCH}"
    
    if ! curl -fsSL --connect-timeout 60 "$WALRUS_URL" -o /tmp/walrus-bin 2>/dev/null; then
        # Fallback to alternative URL format
        WALRUS_URL="https://storage.googleapis.com/mysten-walrus-binaries/walrus-${WALRUS_VERSION}-${WALRUS_ARCH}"
        curl -fsSL --connect-timeout 60 "$WALRUS_URL" -o /tmp/walrus-bin || {
            echo "  ⚠ Could not download Walrus binary. Trying latest..."
            WALRUS_URL="https://github.com/MystenLabs/walrus/releases/latest/download/walrus-${WALRUS_ARCH}"
            curl -fsSL --connect-timeout 60 "$WALRUS_URL" -o /tmp/walrus-bin
        }
    fi
    
    sudo mv /tmp/walrus-bin /usr/local/bin/walrus
    sudo chmod +x /usr/local/bin/walrus
    echo "  ✓ Walrus CLI installed: $(walrus --version 2>/dev/null | head -1 || echo 'installed')"
fi

# ─── 5. Configure Walrus CLI ────────────────────────────────────────────────
echo ""
echo "▶ Configuring Walrus CLI..."
mkdir -p "$WALRUS_CONFIG_DIR"

if [ ! -f "$WALRUS_CONFIG_DIR/client_config.yaml" ]; then
    cat > "$WALRUS_CONFIG_DIR/client_config.yaml" << 'WALRUS_CONFIG'
# Walrus testnet client config
# Generated by deploy/setup-walrus-wallet.sh

system_object: 0x6c2547cbbc38025cf3adac45f63cb9a8f3caa4e63e1a04fcfc28ad9e5bc69be6
staking_object: 0x90a7f9e379ac21c82f319a19ad3be1c68a4b12d5da75ef4d88deb49a8ee2b19a

# Exchange rate for testnet WAL
exchange_objects:
  - 0x30ef3f1f32a98e58c3e9f3c8da4cd2e27ba7f35c6cba0ee29b99f7ba00f7e4f5

# Aggregator and publisher for testnet
aggregator: https://aggregator.walrus-testnet.walrus.space
publisher: https://publisher.walrus-testnet.walrus.space

# Number of epochs to store blobs
epochs: 1
WALRUS_CONFIG
    echo "  ✓ Walrus config created at $WALRUS_CONFIG_DIR/client_config.yaml"
else
    echo "  ✓ Walrus config already exists"
fi

# ─── 6. Generate publisher wallet ───────────────────────────────────────────
echo ""
echo "▶ Generating Walrus publisher wallet..."

# Check if a wallet already exists for publishing
EXISTING_ADDRESS=$(sui client active-address 2>/dev/null || echo "")

if [ -n "$EXISTING_ADDRESS" ]; then
    echo ""
    echo "  ✓ Existing wallet found: $EXISTING_ADDRESS"
    echo ""
    echo "  To use this wallet, export the private key:"
    echo "    sui keytool export --key-identity $EXISTING_ADDRESS"
    echo "  Then set INFRASTRUCTURE_WALLET_SECRET in .env.deploy"
    WALLET_ADDRESS="$EXISTING_ADDRESS"
else
    echo "  Generating new Ed25519 keypair..."
    # Generate new keypair — output goes to stdout/stderr, NOT logged
    KEYGEN_OUTPUT=$(sui keytool generate ed25519 2>&1)
    
    # Extract the address (starts with 0x) — NEVER print the mnemonic or key
    WALLET_ADDRESS=$(echo "$KEYGEN_OUTPUT" | grep -oP '0x[a-fA-F0-9]{64}' | head -1 || echo "")
    
    if [ -z "$WALLET_ADDRESS" ]; then
        # Try alternative output format
        WALLET_ADDRESS=$(sui client active-address 2>/dev/null || echo "")
    fi
    
    echo "  ✓ New wallet generated"
fi

# ─── 7. Verify installation ─────────────────────────────────────────────────
echo ""
echo "▶ Verifying installation..."
echo "  Sui CLI:   $(sui --version 2>/dev/null | head -1 || echo '✗ not found')"
echo "  Sui env:   $(sui client active-env 2>/dev/null || echo 'testnet')"
echo "  Walrus CLI:$(walrus --version 2>/dev/null | head -1 || echo '✗ not found')"

# ─── 8. Configure container wallet access ───────────────────────────────────
echo ""
echo "▶ Checking Docker container wallet access..."
if docker compose -f /opt/swrap/docker-compose.vps.yml ps api 2>/dev/null | grep -q "running\|Up"; then
    echo "  ✓ API container is running"
    echo "  To verify walrus CLI inside container:"
    echo "    docker compose -f /opt/swrap/docker-compose.vps.yml exec api walrus --version"
else
    echo "  ⚠ API container not running yet (will be available after deploy)"
fi

# ─── 9. Summary ──────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Walrus Publisher Wallet Setup Complete"
echo ""
if [ -n "$WALLET_ADDRESS" ]; then
    echo "  Publisher Wallet Address:"
    echo "    $WALLET_ADDRESS"
    echo ""
    echo "  ⚡ NEXT STEPS:"
    echo ""
    echo "  1. Fund this wallet with SUI (testnet):"
    echo "     https://faucet.testnet.sui.io/?address=$WALLET_ADDRESS"
    echo "     Or use: sui client faucet"
    echo ""
    echo "  2. Export the private key (handle securely):"
    echo "     sui keytool export --key-identity $WALLET_ADDRESS"
    echo ""
    echo "  3. Set INFRASTRUCTURE_WALLET_SECRET in /opt/swrap/.env.deploy:"
    echo "     INFRASTRUCTURE_WALLET_SECRET=suiprivkey1..."
    echo ""
    echo "  4. Restart the API container:"
    echo "     cd /opt/swrap && docker compose -f docker-compose.vps.yml --env-file .env.deploy up -d api"
    echo ""
    echo "  ⚠  SECURITY: The private key above is stored in ~/.sui/sui_config"
    echo "     Only export it once and store in .env.deploy"
    echo "     NEVER commit the private key to git"
fi
echo "═══════════════════════════════════════════════════════════════"
