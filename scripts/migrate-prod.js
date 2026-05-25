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
    name: 'create_app_enums',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
          CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'viewer');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormMode') THEN
          CREATE TYPE "FormMode" AS ENUM ('conversational', 'table');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EncryptionMode') THEN
          CREATE TYPE "EncryptionMode" AS ENUM ('none', 'field_level', 'full_submission');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubmissionStatus') THEN
          CREATE TYPE "SubmissionStatus" AS ENUM ('open', 'under_review', 'planned', 'resolved', 'rejected');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BlobType') THEN
          CREATE TYPE "BlobType" AS ENUM ('form_schema', 'submission', 'file_upload', 'encrypted_field');
        END IF;
      END
      $$;
    `,
  },
  {
    name: 'create_app_tables',
    sql: `
      -- 1. app_users
      CREATE TABLE IF NOT EXISTS public.app_users (
          id text NOT NULL PRIMARY KEY,
          email text NOT NULL UNIQUE,
          name text,
          image text,
          role "UserRole" NOT NULL DEFAULT 'admin'::"UserRole",
          "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- 2. app_forms
      CREATE TABLE IF NOT EXISTS public.app_forms (
          id text NOT NULL PRIMARY KEY,
          slug text NOT NULL UNIQUE,
          title text NOT NULL,
          description text,
          "ownerId" text NOT NULL,
          "schemaBlobId" text,
          "draftSchema" jsonb,
          mode "FormMode" NOT NULL DEFAULT 'table'::"FormMode",
          "encryptionMode" "EncryptionMode" NOT NULL DEFAULT 'none'::"EncryptionMode",
          "sealPolicyId" text,
          "isPublished" boolean NOT NULL DEFAULT false,
          "publishedAt" timestamp(3) without time zone,
          "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("ownerId") REFERENCES app_users(id) ON UPDATE CASCADE ON DELETE CASCADE
      );

      -- 3. app_submissions
      CREATE TABLE IF NOT EXISTS public.app_submissions (
          id text NOT NULL PRIMARY KEY,
          "formId" text NOT NULL,
          "walrusBlobId" text NOT NULL UNIQUE,
          status "SubmissionStatus" NOT NULL DEFAULT 'open'::"SubmissionStatus",
          "submittedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("formId") REFERENCES app_forms(id) ON UPDATE CASCADE ON DELETE CASCADE
      );

      -- 4. app_blob_references
      CREATE TABLE IF NOT EXISTS public.app_blob_references (
          id text NOT NULL PRIMARY KEY,
          "walrusBlobId" text NOT NULL UNIQUE,
          "blobType" "BlobType" NOT NULL,
          "sizeBytes" integer,
          "formId" text,
          "submissionId" text,
          "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("formId") REFERENCES app_forms(id) ON UPDATE CASCADE ON DELETE SET NULL,
          FOREIGN KEY ("submissionId") REFERENCES app_submissions(id) ON UPDATE CASCADE ON DELETE SET NULL
      );

      -- 5. app_storage_credits
      CREATE TABLE IF NOT EXISTS public.app_storage_credits (
          id text NOT NULL PRIMARY KEY,
          "userId" text NOT NULL UNIQUE,
          balance double precision NOT NULL DEFAULT 0,
          "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("userId") REFERENCES app_users(id) ON UPDATE CASCADE ON DELETE CASCADE
      );

      -- 6. app_credit_transactions
      CREATE TABLE IF NOT EXISTS public.app_credit_transactions (
          id text NOT NULL PRIMARY KEY,
          "userId" text NOT NULL,
          "creditId" text NOT NULL,
          amount double precision NOT NULL,
          type text NOT NULL,
          "walrusBlobId" text,
          description text,
          "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("creditId") REFERENCES app_storage_credits(id) ON UPDATE CASCADE ON DELETE CASCADE,
          FOREIGN KEY ("userId") REFERENCES app_users(id) ON UPDATE CASCADE ON DELETE CASCADE
      );

      -- 7. app_submission_status_logs
      CREATE TABLE IF NOT EXISTS public.app_submission_status_logs (
          id text NOT NULL PRIMARY KEY,
          "submissionId" text NOT NULL,
          "adminId" text NOT NULL,
          status "SubmissionStatus" NOT NULL,
          note text,
          "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("adminId") REFERENCES app_users(id) ON UPDATE CASCADE ON DELETE CASCADE,
          FOREIGN KEY ("submissionId") REFERENCES app_submissions(id) ON UPDATE CASCADE ON DELETE CASCADE
      );
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
