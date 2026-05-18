#!/usr/bin/env bash
# =============================================================================
# Swrap — Test Walrus CLI Publish Path
#
# Force-tests the Walrus CLI fallback by uploading a small test blob.
# Returns the blob ID if successful, exits non-zero if it fails.
#
# Usage (on VPS or inside container):
#   ./deploy/test-walrus-cli.sh
#
# Usage inside Docker container:
#   docker compose -f docker-compose.vps.yml exec api bash /app/deploy/test-walrus-cli.sh
# =============================================================================

set -euo pipefail

WALRUS_CLI="${WALRUS_CLI_PATH:-walrus}"
WALRUS_EPOCHS="${WALRUS_EPOCHS:-1}"
TEST_CONTENT="swrap-cli-test-$(date +%s)-$$"

echo "═══════════════════════════════════════════════════════════════"
echo "  Walrus CLI Publish Test"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── 1. Check CLI availability ───────────────────────────────────────────────
echo "▶ Checking Walrus CLI..."
if ! command -v "$WALRUS_CLI" &>/dev/null; then
    echo "  ✗ Walrus CLI not found at: $WALRUS_CLI"
    echo "    Set WALRUS_CLI_PATH or ensure 'walrus' is in PATH"
    exit 1
fi
echo "  ✓ Found: $($WALRUS_CLI --version 2>/dev/null | head -1 || echo 'unknown version')"

# ─── 2. Write test content to temp file ─────────────────────────────────────
echo ""
echo "▶ Publishing test blob..."
TMP_FILE=$(mktemp /tmp/walrus-test-XXXXXX.txt)
trap 'rm -f "$TMP_FILE"' EXIT

echo "$TEST_CONTENT" > "$TMP_FILE"
echo "  Test content: $TEST_CONTENT"

# ─── 3. Run CLI publish ──────────────────────────────────────────────────────
STORE_ARGS=("store")
if [ -n "${WALRUS_CONFIG_PATH:-}" ]; then
    STORE_ARGS+=("--config" "$WALRUS_CONFIG_PATH")
fi
STORE_ARGS+=("--epochs" "$WALRUS_EPOCHS" "--json" "$TMP_FILE")

echo "  Running: $WALRUS_CLI ${STORE_ARGS[*]}"
echo ""

STORE_OUTPUT=$("$WALRUS_CLI" "${STORE_ARGS[@]}" 2>&1) || {
    echo "  ✗ CLI exited non-zero"
    echo "  Output: $STORE_OUTPUT"
    exit 1
}

echo "  CLI output:"
echo "$STORE_OUTPUT" | head -20

# ─── 4. Parse blob ID ────────────────────────────────────────────────────────
echo ""
echo "▶ Parsing blob ID from output..."

BLOB_ID=""
# Try JSON parse first
while IFS= read -r line; do
    if echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('newlyCreated',{}).get('blobObject',{}).get('blobId','') or d.get('alreadyCertified',{}).get('blobId','') or d.get('blobId',''))" 2>/dev/null | grep -q .; then
        BLOB_ID=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('newlyCreated',{}).get('blobObject',{}).get('blobId','') or d.get('alreadyCertified',{}).get('blobId','') or d.get('blobId',''))" 2>/dev/null)
        break
    fi
done < <(echo "$STORE_OUTPUT")

# Fallback: regex
if [ -z "$BLOB_ID" ]; then
    BLOB_ID=$(echo "$STORE_OUTPUT" | grep -oP '"blobId"\s*:\s*"\K[A-Za-z0-9+/=_-]{20,}' | head -1 || echo "")
fi

if [ -z "$BLOB_ID" ]; then
    echo "  ✗ Could not parse blob ID from CLI output"
    echo "  Full output:"
    echo "$STORE_OUTPUT"
    exit 1
fi

echo "  ✓ Blob ID: $BLOB_ID"

# ─── 5. Verify blob retrievable ─────────────────────────────────────────────
echo ""
echo "▶ Verifying blob is retrievable from aggregator..."
AGGREGATOR="${WALRUS_AGGREGATOR_URL:-https://aggregator.walrus-testnet.walrus.space}"
BLOB_URL="${AGGREGATOR}/v1/blobs/${BLOB_ID}"

echo "  Checking: $BLOB_URL"
HTTP_STATUS=$(curl -sfL --connect-timeout 30 -o /dev/null -w "%{http_code}" "$BLOB_URL" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    echo "  ✓ Blob exists and is retrievable (HTTP 200)"
elif [ "$HTTP_STATUS" = "000" ]; then
    echo "  ⚠ Could not reach aggregator (network/DNS issue)"
    echo "    Blob was published (CLI succeeded) but verification failed"
else
    echo "  ⚠ Aggregator returned HTTP $HTTP_STATUS"
    echo "    Blob may still be propagating — try again in 30s"
fi

# ─── 6. Summary ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ CLI Publish Test PASSED"
echo ""
echo "  Blob ID:   $BLOB_ID"
echo "  View at:   ${AGGREGATOR}/v1/blobs/${BLOB_ID}"
echo "═══════════════════════════════════════════════════════════════"
