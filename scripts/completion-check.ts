/**
 * scripts/completion-check.ts
 *
 * Verifies all POC deliverables are present.
 * Checks documentation files, source files, API routes, page files,
 * and git baseline ancestry.
 *
 * Requirements: R16.6
 *
 * Run via: npm run completion-check
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, '..');

function exists(relativePath: string): boolean {
  return existsSync(join(ROOT, relativePath));
}

/** Check if at least one of the given paths exists (case-sensitive alternatives). */
function existsAny(...relativePaths: string[]): boolean {
  return relativePaths.some((p) => exists(p));
}

interface CheckResult {
  label: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function check(label: string, passed: boolean, detail?: string): void {
  results.push({ label, passed, detail });
}

// ---------------------------------------------------------------------------
// 1. Documentation files
// ---------------------------------------------------------------------------

check(
  'docs/architecture.md (or ARCHITECTURE.md)',
  existsAny('docs/architecture.md', 'docs/ARCHITECTURE.md'),
);
check('docs/dev-mode.md', exists('docs/dev-mode.md'));
check('docs/security.md', exists('docs/security.md'));
check('docs/walrus-flow.md', exists('docs/walrus-flow.md'));
check(
  'docs/roadmap.md (or ROADMAP.md)',
  existsAny('docs/roadmap.md', 'docs/ROADMAP.md'),
);
check('docs/design-system.md', exists('docs/design-system.md'));

// ---------------------------------------------------------------------------
// 2. Source files
// ---------------------------------------------------------------------------

const sourceFiles = [
  'packages/shared/src/env.ts',
  'packages/shared/src/pretty-printer.ts',
  'packages/shared/src/validator.ts',
  'packages/shared/src/parser.ts',
  'packages/shared/src/schema-hash.ts',
  'packages/seal/src/encrypted-blob.ts',
  'packages/seal/src/encryptor.ts',
  'packages/seal/src/decryptor.ts',
  'packages/walrus/src/client.ts',
  'packages/sui/src/signer-detector.ts',
  'packages/sui/src/sui-client.ts',
  'packages/sui/src/metadata-anchor.ts',
  'packages/sui/move/sealbase_poc/Move.toml',
  'packages/sui/move/sealbase_poc/sources/metadata.move',
];

for (const file of sourceFiles) {
  check(file, exists(file));
}

// ---------------------------------------------------------------------------
// 3. API route files
// ---------------------------------------------------------------------------

const apiRoutes = [
  'src/app/api/poc/health/route.ts',
  'src/app/api/poc/forms/route.ts',
  'src/app/api/poc/submissions/route.ts',
  'src/app/api/poc/metadata/[address]/route.ts',
];

for (const route of apiRoutes) {
  check(route, exists(route));
}

// ---------------------------------------------------------------------------
// 4. Page files
// ---------------------------------------------------------------------------

const pageFiles = [
  'src/app/poc/page.tsx',
  'src/app/poc/forms/new/page.tsx',
];

for (const page of pageFiles) {
  check(page, exists(page));
}

// ---------------------------------------------------------------------------
// 5. Git: v0-baseline tag exists and HEAD descends from it
// ---------------------------------------------------------------------------

function checkGitBaseline(): { tagExists: boolean; headDescends: boolean } {
  let tagExists = false;
  let headDescends = false;

  try {
    execSync('git rev-parse v0-baseline', { cwd: ROOT, stdio: 'pipe' });
    tagExists = true;
  } catch {
    tagExists = false;
  }

  if (tagExists) {
    try {
      execSync('git merge-base --is-ancestor v0-baseline HEAD', {
        cwd: ROOT,
        stdio: 'pipe',
      });
      headDescends = true;
    } catch {
      headDescends = false;
    }
  }

  return { tagExists, headDescends };
}

const { tagExists, headDescends } = checkGitBaseline();
check('git tag v0-baseline exists', tagExists);
check('HEAD descends from v0-baseline', headDescends);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.passed);
const failed = results.filter((r) => !r.passed);

console.log('\nPOC Completion Check\n' + '='.repeat(60));

if (passed.length > 0) {
  console.log(`\n✓ PASSED (${passed.length}):`);
  for (const r of passed) {
    console.log(`    ✓  ${r.label}`);
  }
}

if (failed.length > 0) {
  console.log(`\n✗ FAILED (${failed.length}):`);
  for (const r of failed) {
    console.error(`    ✗  ${r.label}${r.detail ? `  — ${r.detail}` : ''}`);
  }
}

console.log('\n' + '='.repeat(60));
console.log(
  `Result: ${passed.length} passed, ${failed.length} failed\n`,
);

if (failed.length > 0) {
  process.exit(1);
}
