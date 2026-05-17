# Runbook: Infrastructure Wallet Rotation

**Requirement: 9.5, 15.4**

This runbook covers rotating the `INFRASTRUCTURE_WALLET_SECRET` credential used by the Swrap API server for all Seal encryption and decryption operations.

---

## When to rotate

- Every 90 days (scheduled rotation)
- Immediately on suspected compromise
- After any team member with access departs
- After any security audit finding

---

## Pre-rotation checklist

1. Confirm no in-flight uploads are in `encrypting` or `uploading` state:
   ```bash
   # Query upload_jobs for in-flight jobs
   psql $DATABASE_URL -c "SELECT id, state, created_at FROM upload_jobs WHERE state IN ('encrypting', 'uploading') ORDER BY created_at;"
   ```
   Wait for all in-flight jobs to reach `indexed` or `failed` before proceeding.

2. Notify the on-call team that a rotation is in progress.

3. Take a snapshot of the current audit log baseline:
   ```bash
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM activity WHERE created_at > NOW() - INTERVAL '1 hour';" > /tmp/audit-baseline.txt
   ```

---

## Rotation procedure

### Step 1: Generate a new keypair

```bash
# Using the Sui CLI
sui keytool generate ed25519

# The output includes a bech32-encoded secret key starting with "suiprivkey..."
# Record the new secret key securely (e.g., in your secrets manager)
```

### Step 2: Deploy with dual-key support (transition window)

During the transition window, the API server must be able to:
- **Encrypt** new submissions using the **new** key
- **Decrypt** existing submissions using the **old** key

Update your secrets manager to set:
```
INFRASTRUCTURE_WALLET_SECRET=<new_key>
INFRASTRUCTURE_WALLET_SECRET_OUTGOING=<old_key>
```

The `infrastructure-wallet.ts` module checks `INFRASTRUCTURE_WALLET_SECRET_OUTGOING` as a fallback during decryption if the primary key fails. This allows in-flight decryption requests for blobs encrypted with the old key to continue working.

### Step 3: Deploy the updated configuration

```bash
# Rolling restart to pick up new env vars
docker compose -f docker-compose.prod.yml up -d --no-deps api
```

### Step 4: Verify the new key is active

```bash
# Health check should show infraWallet: true
curl -s https://your-domain.com/api/health | jq '.result.infraWallet'
# Expected: true

# Smoke test: create a test form and verify it encrypts/decrypts correctly
# (use the smoke test script in scripts/smoke-test.sh)
```

### Step 5: Verify audit log entries reference the new key's address

```bash
psql $DATABASE_URL -c "
  SELECT actor_address, action, outcome, created_at
  FROM activity
  WHERE action LIKE '%decrypt%'
  ORDER BY created_at DESC
  LIMIT 10;
"
```

The `actor_address` for new decryption operations should match the new Infrastructure_Wallet address.

### Step 6: Remove the outgoing key (after transition window)

After confirming all existing blobs can be decrypted with the new key (typically 24–48 hours), remove the outgoing key:

```bash
# Remove INFRASTRUCTURE_WALLET_SECRET_OUTGOING from secrets manager
# Redeploy
docker compose -f docker-compose.prod.yml up -d --no-deps api
```

---

## Rollback procedure

If the new key fails (health check shows `infraWallet: false` or decryption errors spike):

1. Immediately revert to the old key:
   ```bash
   # Set INFRASTRUCTURE_WALLET_SECRET back to the old key
   # Redeploy
   docker compose -f docker-compose.prod.yml up -d --no-deps api
   ```

2. Verify health check passes with the old key.

3. Investigate the failure before attempting rotation again.

---

## Post-rotation verification

- [ ] `GET /api/health` returns `{ infraWallet: true, ready: true }`
- [ ] New form creation succeeds (encryption with new key)
- [ ] Existing submission decryption succeeds (decryption with new key for new blobs)
- [ ] Audit log shows no `outcome: error` entries for decryption operations
- [ ] Old key is removed from all secrets managers and environment files

---

## Security notes

- The `INFRASTRUCTURE_WALLET_SECRET` must **never** appear in:
  - Source code or git history
  - Log files or monitoring dashboards
  - Container images (use runtime env injection)
  - `.env` files committed to the repository
- Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) for storage
- Restrict access to the secret to the minimum necessary personnel
