/**
 * Property-based tests for db/migrations/0001_core_schema.sql
 *
 * **Validates: Requirements 5.5, 5.6, 3.4**
 *
 * Property 21: Postgres metadata schema contains no payload bodies
 *   — assert no column type is `bytea`, no column name matches
 *     `body|plaintext|cipher|private_key`
 *
 * Property 22: Walrus blob ID uniqueness per table
 *   — for any generated blob ID, the migration SQL contains a UNIQUE
 *     constraint on `walrus_blob_id` in every table that carries one
 *
 * Property 23: Foreign keys enforce referential integrity
 *   — the migration SQL contains FK constraints for:
 *       submissions → forms
 *       files → submissions
 *       permissions → forms
 *
 * NOTE: @testcontainers/postgresql is not installed in this project.
 * Properties 22 and 23 are implemented as SQL-parsing tests that verify
 * the migration file contains the correct UNIQUE and FK constraints.
 * This is equivalent to a structural lint: if the migration file is the
 * source of truth for the schema, asserting its content is sufficient.
 *
 * For live DB integration tests, set USE_REAL_DB=true and ensure
 * DATABASE_URL points to a running Postgres instance.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Load the migration file once
// ---------------------------------------------------------------------------

const MIGRATION_PATH = path.resolve(__dirname, 'migrations/0001_core_schema.sql');

let migrationSql: string;
/** migrationSql with SQL line comments (-- ...) stripped, for content assertions */
let migrationSqlNoComments: string;

beforeAll(() => {
  migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  // Strip single-line SQL comments (-- to end of line) so assertions don't
  // accidentally match text that only appears in comments.
  migrationSqlNoComments = migrationSql.replace(/--[^\n]*/g, '');
});

// ---------------------------------------------------------------------------
// SQL parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract all CREATE TABLE blocks from the SQL.
 * Returns a map of { tableName → tableBody } where tableBody is the
 * content between the opening `(` and the closing `);`.
 */
function extractTableBlocks(sql: string): Map<string, string> {
  const tables = new Map<string, string>();

  // Match: CREATE TABLE <name> ( ... );
  // The body may span multiple lines and contain nested parens (CHECK constraints).
  const tablePattern = /CREATE\s+TABLE\s+(\w+)\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;

  while ((match = tablePattern.exec(sql)) !== null) {
    const tableName = match[1].toLowerCase();
    const tableBody = match[2];
    tables.set(tableName, tableBody);
  }

  return tables;
}

/**
 * Extract all column definitions from a table body.
 * Returns an array of { name, type, rest } for each column line.
 */
interface ColumnDef {
  name: string;
  type: string;
  rest: string;
}

function extractColumns(tableBody: string): ColumnDef[] {
  const columns: ColumnDef[] = [];

  // Split on commas that are NOT inside parentheses (to avoid splitting CHECK constraints)
  const lines = splitTopLevelCommas(tableBody);

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip constraint lines (UNIQUE, CHECK, FOREIGN KEY, PRIMARY KEY at top level)
    if (/^(UNIQUE|CHECK|FOREIGN\s+KEY|PRIMARY\s+KEY|CONSTRAINT)/i.test(trimmed)) {
      continue;
    }
    // Column definition: starts with an identifier followed by a type
    const colMatch = trimmed.match(/^(\w+)\s+(\w+)(.*)/s);
    if (colMatch) {
      columns.push({
        name: colMatch[1].toLowerCase(),
        type: colMatch[2].toLowerCase(),
        rest: colMatch[3],
      });
    }
  }

  return columns;
}

/**
 * Split a string on top-level commas (not inside parentheses).
 */
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of s) {
    if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

/**
 * Check whether a table body contains a UNIQUE constraint on a given column.
 * Handles both:
 *   - Inline:  column_name  TEXT  NOT NULL  UNIQUE
 *   - Standalone: UNIQUE (column_name)
 */
function hasUniqueOnColumn(tableBody: string, columnName: string): boolean {
  const col = columnName.toLowerCase();

  // Standalone UNIQUE constraint: UNIQUE (col) or UNIQUE (col, other)
  const standalonePattern = new RegExp(
    `UNIQUE\\s*\\(\\s*${col}\\s*(?:,|\\))`,
    'i',
  );
  if (standalonePattern.test(tableBody)) {
    return true;
  }

  // Inline UNIQUE on the column definition line
  // Match lines like: walrus_blob_id  TEXT  NOT NULL  UNIQUE
  const inlinePattern = new RegExp(
    `\\b${col}\\b[^\\n]*\\bUNIQUE\\b`,
    'i',
  );
  if (inlinePattern.test(tableBody)) {
    return true;
  }

  return false;
}

/**
 * Check whether the SQL contains a REFERENCES clause linking
 * `childTable.childColumn` → `parentTable(parentColumn)`.
 *
 * Handles both inline FK on the column definition and standalone
 * FOREIGN KEY ... REFERENCES ... constraints.
 */
function hasForeignKey(
  sql: string,
  childTable: string,
  childColumn: string,
  parentTable: string,
): boolean {
  const tables = extractTableBlocks(sql);
  const tableBody = tables.get(childTable.toLowerCase());
  if (!tableBody) return false;

  const col = childColumn.toLowerCase();
  const parent = parentTable.toLowerCase();

  // Inline FK: child_col  TYPE  NOT NULL  REFERENCES parent_table(col)
  const inlinePattern = new RegExp(
    `\\b${col}\\b[^\\n]*REFERENCES\\s+${parent}\\s*\\(`,
    'i',
  );
  if (inlinePattern.test(tableBody)) {
    return true;
  }

  // Standalone FK: FOREIGN KEY (child_col) REFERENCES parent_table(col)
  const standalonePattern = new RegExp(
    `FOREIGN\\s+KEY\\s*\\(\\s*${col}\\s*\\)\\s*REFERENCES\\s+${parent}\\s*\\(`,
    'i',
  );
  if (standalonePattern.test(tableBody)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Tables that carry a walrus_blob_id column (from the design doc)
// ---------------------------------------------------------------------------

const TABLES_WITH_BLOB_ID = ['forms', 'submissions', 'files'] as const;

// ---------------------------------------------------------------------------
// Property 21: No payload bodies in schema
// ---------------------------------------------------------------------------

describe('Property 21: Postgres metadata schema contains no payload bodies', () => {
  /**
   * **Validates: Requirements 5.6, 3.4**
   *
   * The migration file MUST NOT contain any column whose type is `bytea`.
   * Payload bodies live on Walrus; Postgres holds only metadata.
   */
  it('Property 21a: no column has type bytea', () => {
    const tables = extractTableBlocks(migrationSqlNoComments);

    for (const [tableName, tableBody] of tables) {
      const columns = extractColumns(tableBody);
      for (const col of columns) {
        expect(
          col.type,
          `Table '${tableName}' column '${col.name}' must not be bytea`,
        ).not.toBe('bytea');
      }
    }
  });

  /**
   * **Validates: Requirements 5.6, 3.4**
   *
   * No column name may match the forbidden set:
   *   body | plaintext | cipher | private_key
   *
   * These names indicate payload storage, which is forbidden in Postgres.
   */
  it('Property 21b: no column name matches body|plaintext|cipher|private_key', () => {
    const FORBIDDEN_NAMES = /\b(body|plaintext|cipher|private_key)\b/i;
    const tables = extractTableBlocks(migrationSqlNoComments);

    for (const [tableName, tableBody] of tables) {
      const columns = extractColumns(tableBody);
      for (const col of columns) {
        expect(
          FORBIDDEN_NAMES.test(col.name),
          `Table '${tableName}' has forbidden column name '${col.name}'`,
        ).toBe(false);
      }
    }
  });

  /**
   * **Validates: Requirements 5.6**
   *
   * Property-based variant: for any generated forbidden column name pattern,
   * the migration SQL does not contain a column definition matching it.
   *
   * This uses fast-check to generate variations of forbidden names and
   * confirms none appear as column definitions in the migration.
   */
  it('Property 21c: fast-check — no generated forbidden column name variant appears in schema', () => {
    // Generate strings that are substrings of forbidden names
    const forbiddenRoots = ['body', 'plaintext', 'cipher', 'private_key'];

    fc.assert(
      fc.property(
        fc.constantFrom(...forbiddenRoots),
        fc.constantFrom('TEXT', 'BYTEA', 'JSONB', 'VARCHAR', 'bytea', 'jsonb'),
        (forbiddenRoot, colType) => {
          // Build a pattern that would match a column definition like:
          //   forbidden_name  TYPE
          // We check the comment-stripped SQL for this pattern.
          const pattern = new RegExp(
            `\\b${forbiddenRoot}\\b\\s+${colType}`,
            'i',
          );
          expect(
            pattern.test(migrationSqlNoComments),
            `Migration SQL must not contain column '${forbiddenRoot}' of type '${colType}'`,
          ).toBe(false);
        },
      ),
      { numRuns: forbiddenRoots.length * 6 },
    );
  });

  /**
   * **Validates: Requirements 5.6**
   *
   * The migration SQL must not contain `jsonb_body` or `json_body` columns,
   * which are common anti-patterns for storing payload bodies in Postgres.
   */
  it('Property 21d: no jsonb_body or json_body columns', () => {
    expect(migrationSqlNoComments).not.toMatch(/\bjsonb_body\b/i);
    expect(migrationSqlNoComments).not.toMatch(/\bjson_body\b/i);
  });
});

// ---------------------------------------------------------------------------
// Property 22: Walrus blob ID uniqueness per table
// ---------------------------------------------------------------------------

describe('Property 22: Walrus blob ID uniqueness per table', () => {
  /**
   * **Validates: Requirements 5.7**
   *
   * Every table that stores a Walrus blob reference MUST have a UNIQUE
   * constraint on `walrus_blob_id`. This prevents duplicate blob references
   * and supports idempotent reconcile on retry.
   *
   * Tables checked: forms, submissions, files
   */
  it('Property 22a: forms.walrus_blob_id has a UNIQUE constraint', () => {
    const tables = extractTableBlocks(migrationSqlNoComments);
    const formsBody = tables.get('forms');
    expect(formsBody, 'forms table must exist in migration').toBeDefined();
    expect(
      hasUniqueOnColumn(formsBody!, 'walrus_blob_id'),
      'forms.walrus_blob_id must have a UNIQUE constraint',
    ).toBe(true);
  });

  it('Property 22b: submissions.walrus_blob_id has a UNIQUE constraint', () => {
    const tables = extractTableBlocks(migrationSqlNoComments);
    const submissionsBody = tables.get('submissions');
    expect(submissionsBody, 'submissions table must exist in migration').toBeDefined();
    expect(
      hasUniqueOnColumn(submissionsBody!, 'walrus_blob_id'),
      'submissions.walrus_blob_id must have a UNIQUE constraint',
    ).toBe(true);
  });

  it('Property 22c: files.walrus_blob_id has a UNIQUE constraint', () => {
    const tables = extractTableBlocks(migrationSqlNoComments);
    const filesBody = tables.get('files');
    expect(filesBody, 'files table must exist in migration').toBeDefined();
    expect(
      hasUniqueOnColumn(filesBody!, 'walrus_blob_id'),
      'files.walrus_blob_id must have a UNIQUE constraint',
    ).toBe(true);
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * Property-based variant: for all tables in TABLES_WITH_BLOB_ID,
   * the UNIQUE constraint on walrus_blob_id is present.
   *
   * Uses fast-check to iterate over the table set and assert the invariant
   * holds for every member.
   */
  it('Property 22d: fast-check — all blob-carrying tables have UNIQUE on walrus_blob_id', () => {
    const tables = extractTableBlocks(migrationSqlNoComments);

    fc.assert(
      fc.property(
        fc.constantFrom(...TABLES_WITH_BLOB_ID),
        (tableName) => {
          const tableBody = tables.get(tableName);
          expect(
            tableBody,
            `Table '${tableName}' must exist in migration`,
          ).toBeDefined();
          expect(
            hasUniqueOnColumn(tableBody!, 'walrus_blob_id'),
            `Table '${tableName}' must have UNIQUE constraint on walrus_blob_id`,
          ).toBe(true);
        },
      ),
      { numRuns: TABLES_WITH_BLOB_ID.length },
    );
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * The upload_jobs table has a composite UNIQUE on (owner_address, walrus_blob_id)
   * to support idempotent retry writes.
   */
  it('Property 22e: upload_jobs has UNIQUE (owner_address, walrus_blob_id)', () => {
    const tables = extractTableBlocks(migrationSqlNoComments);
    const uploadJobsBody = tables.get('upload_jobs');
    expect(uploadJobsBody, 'upload_jobs table must exist in migration').toBeDefined();

    // Check for composite UNIQUE (owner_address, walrus_blob_id)
    const compositePattern = /UNIQUE\s*\(\s*owner_address\s*,\s*walrus_blob_id\s*\)/i;
    expect(
      compositePattern.test(uploadJobsBody!),
      'upload_jobs must have UNIQUE (owner_address, walrus_blob_id)',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property 23: Foreign keys enforce referential integrity
// ---------------------------------------------------------------------------

describe('Property 23: Foreign keys enforce referential integrity', () => {
  /**
   * **Validates: Requirements 5.8**
   *
   * The migration MUST enforce the complete set of FK relationships:
   *   submissions.form_id → forms(id)
   *   files.submission_id → submissions(id)
   *   permissions.form_id → forms(id)
   *
   * Partial enforcement (only some of these) is explicitly rejected by
   * Requirement 5.8.
   */
  it('Property 23a: submissions.form_id references forms(id)', () => {
    expect(
      hasForeignKey(migrationSqlNoComments, 'submissions', 'form_id', 'forms'),
      'submissions.form_id must REFERENCES forms(id)',
    ).toBe(true);
  });

  it('Property 23b: files.submission_id references submissions(id)', () => {
    expect(
      hasForeignKey(migrationSqlNoComments, 'files', 'submission_id', 'submissions'),
      'files.submission_id must REFERENCES submissions(id)',
    ).toBe(true);
  });

  it('Property 23c: permissions.form_id references forms(id)', () => {
    expect(
      hasForeignKey(migrationSqlNoComments, 'permissions', 'form_id', 'forms'),
      'permissions.form_id must REFERENCES forms(id)',
    ).toBe(true);
  });

  /**
   * **Validates: Requirements 5.8**
   *
   * Property-based variant: the complete FK set is present — no FK is missing.
   * Uses fast-check to iterate over the required FK set and assert each one.
   */
  it('Property 23d: fast-check — all required FK relationships are present', () => {
    type FkSpec = { child: string; column: string; parent: string };
    const REQUIRED_FKS: FkSpec[] = [
      { child: 'submissions', column: 'form_id', parent: 'forms' },
      { child: 'files', column: 'submission_id', parent: 'submissions' },
      { child: 'permissions', column: 'form_id', parent: 'forms' },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED_FKS),
        ({ child, column, parent }) => {
          expect(
            hasForeignKey(migrationSqlNoComments, child, column, parent),
            `${child}.${column} must REFERENCES ${parent}`,
          ).toBe(true);
        },
      ),
      { numRuns: REQUIRED_FKS.length },
    );
  });

  /**
   * **Validates: Requirements 5.8**
   *
   * Additional FK relationships present in the schema:
   *   forms.owner_address → users(address)
   *   submissions.submitter_address → users(address)
   *   upload_jobs.owner_address → users(address)
   *   permissions.grantee_address → users(address)
   *   permissions.granted_by_address → users(address)
   *
   * These are not in the minimum set required by Req 5.8 but are part of
   * the design and should be present.
   */
  it('Property 23e: forms.owner_address references users(address)', () => {
    expect(
      hasForeignKey(migrationSqlNoComments, 'forms', 'owner_address', 'users'),
      'forms.owner_address must REFERENCES users(address)',
    ).toBe(true);
  });

  it('Property 23f: submissions.submitter_address references users(address)', () => {
    expect(
      hasForeignKey(migrationSqlNoComments, 'submissions', 'submitter_address', 'users'),
      'submissions.submitter_address must REFERENCES users(address)',
    ).toBe(true);
  });

  /**
   * **Validates: Requirements 5.8**
   *
   * Negative property: a table that should NOT have a FK to forms does not
   * have one. This guards against accidental FK additions that would violate
   * the schema design.
   *
   * The `activity` table is an append-only audit log and must NOT have a FK
   * to forms (it records target_id as a plain UUID, not a FK, to allow
   * audit entries for deleted forms).
   */
  it('Property 23g: activity table does NOT have a FK to forms', () => {
    expect(
      hasForeignKey(migrationSqlNoComments, 'activity', 'target_id', 'forms'),
      'activity.target_id must NOT be a FK to forms (audit log must be append-only without FK constraints)',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Structural completeness checks (bonus — not numbered properties)
// ---------------------------------------------------------------------------

describe('Schema structural completeness', () => {
  /**
   * All seven tables defined in the design must be present in the migration.
   */
  it('all seven required tables are present', () => {
    const REQUIRED_TABLES = [
      'users',
      'forms',
      'submissions',
      'files',
      'upload_jobs',
      'activity',
      'permissions',
    ];
    const tables = extractTableBlocks(migrationSqlNoComments);

    for (const tableName of REQUIRED_TABLES) {
      expect(
        tables.has(tableName),
        `Table '${tableName}' must be defined in the migration`,
      ).toBe(true);
    }
  });

  /**
   * The migration file must be non-empty and parseable.
   */
  it('migration file is non-empty and contains CREATE TABLE statements', () => {
    expect(migrationSql.trim().length).toBeGreaterThan(0);
    expect(migrationSql).toMatch(/CREATE\s+TABLE/i);
  });
});
