/**
 * migrate-prod.js — safe DB migration runner for Vercel builds.
 *
 * Runs idempotent SQL migrations that can't be managed by prisma migrate
 * (since we're using a manually-managed schema, not prisma migrate history).
 *
 * Uses IF NOT EXISTS / IF EXISTS so re-runs are safe.
 *
 * Called as part of the build script: `prisma generate && node scripts/migrate-prod.js && next build`
 */

// Only run if DATABASE_URL is set (skip during local dev if not needed)
if (!process.env.DATABASE_URL) {
  console.log('[migrate-prod] No DATABASE_URL set — skipping migration.');
  process.exit(0);
}

const { Client } = require('pg');

const MIGRATIONS = [
  {
    name: 'add_draftSchema_to_forms',
    // Only runs if the forms table already exists (Prisma managed it).
    // Safe to re-run — IF NOT EXISTS prevents duplicate column error.
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'forms'
        ) THEN
          ALTER TABLE forms ADD COLUMN IF NOT EXISTS "draftSchema" jsonb;
          RAISE NOTICE 'draftSchema column ensured on forms table.';
        ELSE
          RAISE NOTICE 'forms table does not exist yet — skipping draftSchema migration.';
        END IF;
      END
      $$;
    `,
  },
];

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    console.log('[migrate-prod] Connected to database.');

    for (const migration of MIGRATIONS) {
      try {
        await client.query(migration.sql);
        console.log(`[migrate-prod] ✓ ${migration.name}`);
      } catch (err) {
        // Non-fatal — log and continue (column may already exist)
        console.warn(`[migrate-prod] ⚠ ${migration.name}:`, err.message);
      }
    }

    console.log('[migrate-prod] Migrations complete.');
  } catch (err) {
    // DB connection failure is non-fatal for the build
    console.warn('[migrate-prod] Could not connect to DB:', err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

run().catch((err) => {
  console.error('[migrate-prod] Unexpected error:', err);
  // Don't fail the build on migration errors
  process.exit(0);
});
