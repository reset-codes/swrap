# Runbook: Audit Log Review

**Requirement: 15.4**

This runbook explains how to query and interpret the Swrap audit log (`activity` table).

---

## Overview

Every decryption attempt, authorization decision, and metadata write is recorded in the `activity` table. The audit log is append-only — rows are never updated or deleted.

**Key fields:**

| Field | Description |
|---|---|
| `id` | Unique audit entry ID (UUID) |
| `request_id` | Correlates with the HTTP request that triggered the event |
| `actor_address` | Sui address of the authenticated user |
| `action` | What was attempted (e.g., `decrypt_submission`, `create_form`) |
| `target_kind` | Resource type (`submission`, `form`, `file`) |
| `target_id` | Resource ID |
| `form_id` | Parent form ID (for submissions and files) |
| `authorization_result` | `granted` or `denied` |
| `outcome` | `ok`, `denied`, or `error` |
| `http_status` | HTTP status code returned to the client |
| `rejection_reason` | Human-readable reason for denials (no payload content) |
| `created_at` | Timestamp of the event |

---

## Querying via the API

The audit log is accessible to form owners via the `GET /audit` endpoint:

```bash
# Get all audit entries for your forms (requires auth)
curl -H "Authorization: Bearer <session_token>" \
  "https://your-domain.com/api/audit?formId=<form_id>"

# Filter by time range
curl -H "Authorization: Bearer <session_token>" \
  "https://your-domain.com/api/audit?fromTime=2024-01-01T00:00:00Z&toTime=2024-01-31T23:59:59Z"
```

---

## Direct database queries

### All decryption attempts in the last 24 hours

```sql
SELECT
  request_id,
  actor_address,
  action,
  target_id AS submission_id,
  form_id,
  authorization_result,
  outcome,
  http_status,
  rejection_reason,
  created_at
FROM activity
WHERE action = 'decrypt_submission'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Failed authorization attempts (potential unauthorized access)

```sql
SELECT
  request_id,
  actor_address,
  action,
  target_id,
  form_id,
  rejection_reason,
  http_status,
  created_at
FROM activity
WHERE authorization_result = 'denied'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Decryption error rate (last hour)

```sql
SELECT
  outcome,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS pct
FROM activity
WHERE action = 'decrypt_submission'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY outcome;
```

### Activity by actor (identify high-volume users)

```sql
SELECT
  actor_address,
  COUNT(*) AS total_requests,
  COUNT(*) FILTER (WHERE authorization_result = 'denied') AS denied_count,
  MAX(created_at) AS last_seen
FROM activity
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY actor_address
ORDER BY total_requests DESC
LIMIT 20;
```

### Audit completeness check (every decryption attempt has an entry)

```sql
-- Count decryption attempts vs audit entries
SELECT
  'decryption_attempts' AS metric,
  COUNT(*) AS count
FROM activity
WHERE action = 'decrypt_submission'
  AND created_at > NOW() - INTERVAL '1 hour'
UNION ALL
SELECT
  'total_activity_entries',
  COUNT(*)
FROM activity
WHERE created_at > NOW() - INTERVAL '1 hour';
```

---

## Interpreting entries

### Normal successful decryption

```json
{
  "action": "decrypt_submission",
  "authorization_result": "granted",
  "outcome": "ok",
  "http_status": 200
}
```

### Unauthorized access attempt

```json
{
  "action": "decrypt_submission",
  "authorization_result": "denied",
  "outcome": "denied",
  "http_status": 403,
  "rejection_reason": "Actor is not the form owner and has no viewer permission"
}
```

### System error during decryption

```json
{
  "action": "decrypt_submission",
  "authorization_result": "granted",
  "outcome": "error",
  "http_status": 500,
  "rejection_reason": "Walrus fetch failed after 5 attempts"
}
```

---

## Alerting thresholds

Consider alerting on:

- `authorization_result = 'denied'` rate > 10% of requests in a 5-minute window (potential brute force)
- `outcome = 'error'` rate > 5% of decryption requests (infrastructure issue)
- Any single `actor_address` making > 100 decryption requests per minute (rate limit bypass)
- Gap in audit entries (audit log write failures indicate a critical system issue)

---

## Security notes

- Audit entries **never** contain plaintext payload bytes, decryption keys, or Infrastructure_Wallet credentials
- The `rejection_reason` field contains only human-readable descriptions, never sensitive data
- Audit log access via the API is restricted to form owners for their own forms
- Direct database access should be restricted to authorized operations personnel
