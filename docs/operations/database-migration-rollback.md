# Runbook: Database Migration Rollback

**Requirement: 15.4**

This runbook covers rolling back a database migration using `node-pg-migrate`.

---

## Overview

Swrap uses `node-pg-migrate` for versioned database migrations. Migration history is tracked in the `pgmigrations` table. Each migration file has an `up` (apply) and `down` (rollback) SQL block.

---

## Pre-rollback checklist

1. **Stop the API server** to prevent new writes during rollback:
   ```bash
   docker compose -f docker-compose.prod.yml stop api
   ```

2. **Take a database backup**:
   ```bash
   pg_dump $DATABASE_URL > /tmp/swrap-backup-$(date +%Y%m%d-%H%M%S).sql
   ```

3. **Identify the current migration state**:
   ```bash
   psql $DATABASE_URL -c "SELECT id, name, run_on FROM pgmigrations ORDER BY run_on DESC LIMIT 5;"
   ```

4. **Confirm the rollback target** — identify which migration to roll back to.

---

## Rollback procedure

### Roll back the most recent migration

```bash
# Roll back one migration
npm run migrate:down
# or
node-pg-migrate down --migrations-dir db/migrations --database-url-var DATABASE_URL
```

### Roll back to a specific migration

```bash
# Roll back to a specific migration by count
node-pg-migrate down --count 2 --migrations-dir db/migrations --database-url-var DATABASE_URL
```

### Verify the rollback

```bash
# Check current migration state
psql $DATABASE_URL -c "SELECT id, name, run_on FROM pgmigrations ORDER BY run_on DESC LIMIT 5;"

# Verify the schema matches the expected state
psql $DATABASE_URL -c "\dt"
```

---

## Data integrity checks after rollback

Run these checks after any rollback to verify data integrity:

```sql
-- Check for orphaned foreign key references
SELECT COUNT(*) FROM submissions s
LEFT JOIN forms f ON s.form_id = f.id
WHERE f.id IS NULL;
-- Expected: 0

-- Check for NULL required fields
SELECT COUNT(*) FROM forms WHERE owner_address IS NULL OR walrus_blob_id IS NULL;
-- Expected: 0

SELECT COUNT(*) FROM submissions WHERE form_id IS NULL OR walrus_blob_id IS NULL;
-- Expected: 0

-- Run the schema lint to verify no forbidden columns exist
-- (requires db/lint/forbidden-columns.sql)
```

---

## Re-applying migrations after rollback

Once the issue is resolved, re-apply migrations:

```bash
# Apply all pending migrations
npm run migrate:up
# or
node-pg-migrate up --migrations-dir db/migrations --database-url-var DATABASE_URL
```

---

## Restart the API server

```bash
docker compose -f docker-compose.prod.yml start api

# Verify health
curl -s https://your-domain.com/api/health | jq '.result'
# Expected: { ok: true, ready: true, db: true, infraWallet: true }
```

---

## Emergency: manual schema rollback

If `node-pg-migrate down` fails (e.g., the migration file is missing or the `down` block is broken), you may need to manually roll back:

1. Identify the SQL changes made by the migration from the migration file in `db/migrations/`
2. Write the inverse SQL manually
3. Apply it in a transaction:
   ```sql
   BEGIN;
   -- Your inverse SQL here
   -- Remove the migration record
   DELETE FROM pgmigrations WHERE name = '<migration_name>';
   COMMIT;
   ```

4. Verify the schema is correct before restarting the API server.

---

## Notes

- Always back up before rolling back
- Test rollbacks in a staging environment before applying to production
- The `db/lint/forbidden-columns.sql` check should pass after any rollback
- If a rollback removes tables that have data, that data is permanently lost — ensure the backup was taken before proceeding
