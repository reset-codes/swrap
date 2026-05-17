#!/usr/bin/env bash
# db/lint/run-lint.sh
#
# Runs the forbidden-columns schema lint against the database.
# Exits 0 if no violations are found; exits 1 if any violations exist.
#
# Requirements: 5.6
# Requires: DATABASE_URL environment variable pointing to a running Postgres instance.
#
# Usage:
#   DATABASE_URL=postgres://... bash db/lint/run-lint.sh
#
# CI note: this script requires a running Postgres instance with the schema
# already migrated. Run `pnpm migrate:up` before invoking this script in CI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/forbidden-columns.sql"

# ── Validate prerequisites ────────────────────────────────────────────────────

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  echo "  Set DATABASE_URL to a valid Postgres connection string before running db:lint." >&2
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql is not installed or not on PATH." >&2
  exit 1
fi

if [ ! -f "$SQL_FILE" ]; then
  echo "ERROR: SQL lint file not found: $SQL_FILE" >&2
  exit 1
fi

# ── Run the lint query ────────────────────────────────────────────────────────

echo "Running schema lint: forbidden-columns..."

# Capture the violation rows (tab-separated, no headers, no alignment)
VIOLATIONS=$(psql "$DATABASE_URL" \
  --no-psqlrc \
  --tuples-only \
  --no-align \
  --field-separator=$'\t' \
  --command "
    SELECT
      table_schema,
      table_name,
      column_name,
      data_type,
      CASE
        WHEN data_type = 'bytea'
          THEN 'forbidden type: bytea'
        WHEN column_name ~* '^(body|plaintext|cipher|private_key)\$'
          THEN 'forbidden column name: ' || column_name
        ELSE 'unknown violation'
      END AS violation_reason
    FROM information_schema.columns
    WHERE
      table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND (
        data_type = 'bytea'
        OR column_name ~* '^(body|plaintext|cipher|private_key)\$'
      )
    ORDER BY table_schema, table_name, column_name;
  " 2>&1)

# ── Evaluate results ──────────────────────────────────────────────────────────

# Strip blank lines to get a clean count
VIOLATION_COUNT=$(echo "$VIOLATIONS" | grep -c '[^[:space:]]' || true)

if [ "$VIOLATION_COUNT" -eq 0 ]; then
  echo "✓ Schema lint passed: no forbidden columns found."
  exit 0
else
  echo "✗ Schema lint FAILED: $VIOLATION_COUNT forbidden column(s) found." >&2
  echo "" >&2
  echo "  schema | table | column | type | reason" >&2
  echo "  -------+-------+--------+------+--------" >&2
  echo "$VIOLATIONS" | while IFS=$'\t' read -r schema table col dtype reason; do
    echo "  $schema | $table | $col | $dtype | $reason" >&2
  done
  echo "" >&2
  echo "  Fix: remove or rename the offending columns. Canonical content" >&2
  echo "  (bodies, ciphertext, file bytes) must live on Walrus, not Postgres." >&2
  exit 1
fi
