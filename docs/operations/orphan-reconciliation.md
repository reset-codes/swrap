# Runbook: Orphan Blob Reconciliation

**Requirement: 15.4**

This runbook explains how to identify and reconcile orphaned Walrus blobs — blobs that were successfully uploaded to Walrus but whose metadata was never written to Postgres.

---

## What is an orphan?

An orphan is an `upload_jobs` row in the `uploaded` state that has been there for longer than `ORPHAN_TIMEOUT_MS` (default: 5 minutes). This means:

1. The blob was successfully PUT to Walrus (the blob exists on the network)
2. The metadata write to Postgres failed or never completed
3. The submission/form is not visible to users because there is no `indexed` row

Orphans can occur due to:
- Network partition between the API server and Postgres during the metadata write
- API server crash after Walrus PUT but before Postgres INSERT
- Postgres connection pool exhaustion
- Transaction timeout

---

## Identifying orphans

### Via the API

```bash
# List all upload jobs in 'uploaded' state (potential orphans)
curl -H "Authorization: Bearer <session_token>" \
  "https://your-domain.com/api/upload-jobs?state=uploaded"
```

### Via the database

```sql
-- Find orphaned upload jobs (uploaded for > 5 minutes)
SELECT
  id,
  owner_address,
  artifact_kind,
  privacy_mode,
  state,
  blob_id,
  failure_reason,
  created_at,
  updated_at,
  NOW() - updated_at AS age
FROM upload_jobs
WHERE state = 'uploaded'
  AND updated_at < NOW() - INTERVAL '5 minutes'
ORDER BY updated_at ASC;
```

---

## Reconciliation procedure

### Option 1: API-based reconciliation (preferred)

The `POST /upload-jobs/reconcile` endpoint is idempotent and safe to call multiple times:

```bash
# Reconcile a specific orphaned job
curl -X POST \
  -H "Authorization: Bearer <session_token>" \
  -H "Content-Type: application/json" \
  -d '{"jobId": "<upload_job_id>"}' \
  "https://your-domain.com/api/upload-jobs/reconcile"
```

The reconcile endpoint:
1. Verifies the blob still exists on Walrus (`walrusBlobExists`)
2. Upserts the metadata row (idempotent on `(formId, walrusBlobId)`)
3. Transitions the job to `indexed`

### Option 2: Bulk reconciliation script

For multiple orphans, use the reconciliation script:

```bash
# List orphaned job IDs
psql $DATABASE_URL -t -c "
  SELECT id FROM upload_jobs
  WHERE state = 'uploaded'
    AND updated_at < NOW() - INTERVAL '5 minutes';
" | while read job_id; do
  echo "Reconciling job: $job_id"
  curl -s -X POST \
    -H "Authorization: Bearer $SESSION_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"jobId\": \"$job_id\"}" \
    "https://your-domain.com/api/upload-jobs/reconcile" | jq '.result.state'
done
```

### Option 3: Manual database reconciliation (last resort)

Only use this if the API is unavailable:

```sql
-- Verify the blob exists on Walrus first (check via Walrus aggregator)
-- Then manually transition the job and insert the metadata row

BEGIN;

-- 1. Transition the upload job to indexed
UPDATE upload_jobs
SET state = 'indexed', updated_at = NOW()
WHERE id = '<job_id>'
  AND state = 'uploaded';

-- 2. Insert the metadata row (adjust table and columns for the artifact kind)
-- For a submission:
INSERT INTO submissions (id, form_id, form_version, submitter_address, walrus_blob_id, privacy_mode, content_digest, size_bytes, state, policy_id, created_at)
VALUES ('<submission_id>', '<form_id>', 1, '<submitter_address>', '<blob_id>', '<privacy_mode>', '<digest>', <size_bytes>, 'indexed', '<policy_id>', NOW())
ON CONFLICT (form_id, walrus_blob_id) DO NOTHING;

COMMIT;
```

---

## Discarding orphans

If a blob should not be reconciled (e.g., the upload was intentionally abandoned):

```bash
# Mark the job as failed (discards it locally)
curl -X POST \
  -H "Authorization: Bearer <session_token>" \
  -H "Content-Type: application/json" \
  -d '{"jobId": "<upload_job_id>", "action": "discard"}' \
  "https://your-domain.com/api/upload-jobs/reconcile"
```

Note: Discarding an orphan only marks the job as `failed` in Postgres. The blob on Walrus is immutable and will expire according to Walrus's retention policy.

---

## Prevention

To reduce orphan frequency:
- Ensure Postgres connection pool is sized appropriately for peak load
- Set appropriate transaction timeouts
- Monitor the `uploaded` state count — a spike indicates a systemic issue
- Ensure the API server has retry logic for Postgres writes after Walrus PUT

---

## Monitoring

Alert if:
- More than 10 jobs in `uploaded` state for > 10 minutes
- Orphan count growing faster than reconciliation rate

```sql
-- Orphan count over time (run every 5 minutes)
SELECT
  DATE_TRUNC('minute', updated_at) AS minute,
  COUNT(*) AS orphan_count
FROM upload_jobs
WHERE state = 'uploaded'
  AND updated_at < NOW() - INTERVAL '5 minutes'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 12;
```
