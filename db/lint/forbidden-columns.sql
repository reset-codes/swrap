-- Schema lint: forbidden-columns.sql
-- Asserts that no column in any application table has:
--   • data_type = 'bytea'
--   • column_name matching: body, plaintext, cipher, private_key
--
-- Requirements: 5.6
-- Design invariant: Postgres_Store must never hold canonical content bodies,
-- ciphertext bodies, or file bytes. All such content lives on Walrus.
--
-- Usage: psql $DATABASE_URL -f db/lint/forbidden-columns.sql
-- Exit behaviour: returns a result set; run-lint.sh interprets the count.

SELECT
  table_schema,
  table_name,
  column_name,
  data_type,
  CASE
    WHEN data_type = 'bytea'
      THEN 'forbidden type: bytea'
    WHEN column_name ~* '^(body|plaintext|cipher|private_key)$'
      THEN 'forbidden column name: ' || column_name
    ELSE 'unknown violation'
  END AS violation_reason
FROM information_schema.columns
WHERE
  table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND (
    data_type = 'bytea'
    OR column_name ~* '^(body|plaintext|cipher|private_key)$'
  )
ORDER BY table_schema, table_name, column_name;
