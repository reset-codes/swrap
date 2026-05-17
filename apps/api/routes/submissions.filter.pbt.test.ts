/**
 * Property 24: Filter queries return exactly matching rows
 *
 * **Validates: Requirements 5.9**
 *
 * For any generated set of metadata rows and any filter combination over
 * (owner_address, form_id, state), the filter function returns exactly the
 * rows satisfying ALL specified filters and no others.
 *
 * This tests the filter logic directly without a real database.
 * The filter function mirrors what the API's GET /submissions and GET /forms
 * query endpoints must implement.
 *
 * Requirements: 5.9
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadState = 'pending' | 'encrypting' | 'uploading' | 'uploaded' | 'indexed' | 'failed';
type PrivacyMode = 'public' | 'private';

interface SubmissionRow {
  id: string;
  form_id: string;
  form_version: number;
  submitter_address: string;
  walrus_blob_id: string;
  privacy_mode: PrivacyMode;
  content_digest: string;
  size_bytes: number;
  state: UploadState;
  created_at: string;
}

interface FormRow {
  id: string;
  owner_address: string;
  walrus_blob_id: string;
  privacy_mode: PrivacyMode;
  policy_id: string | null;
  version: number;
  predecessor_id: string | null;
  state: UploadState;
  created_at: string;
}

interface SubmissionFilter {
  submitter_address?: string;
  form_id?: string;
  state?: UploadState;
}

interface FormFilter {
  owner_address?: string;
  state?: UploadState;
}

// ─── Filter Functions Under Test ──────────────────────────────────────────────
// These mirror the query logic that GET /submissions and GET /forms must implement.
// Requirement 5.9: The API_Server SHALL expose query endpoints that filter by
// Form_Owner Authorization_Identity, by form identifier, and by Upload_State_Machine state.

/**
 * Filter submissions by any combination of submitter_address, form_id, and state.
 * All specified filters are applied as AND conditions.
 */
function filterSubmissions(rows: SubmissionRow[], filter: SubmissionFilter): SubmissionRow[] {
  return rows.filter((row) => {
    if (filter.submitter_address !== undefined && row.submitter_address !== filter.submitter_address) {
      return false;
    }
    if (filter.form_id !== undefined && row.form_id !== filter.form_id) {
      return false;
    }
    if (filter.state !== undefined && row.state !== filter.state) {
      return false;
    }
    return true;
  });
}

/**
 * Filter forms by any combination of owner_address and state.
 * All specified filters are applied as AND conditions.
 */
function filterForms(rows: FormRow[], filter: FormFilter): FormRow[] {
  return rows.filter((row) => {
    if (filter.owner_address !== undefined && row.owner_address !== filter.owner_address) {
      return false;
    }
    if (filter.state !== undefined && row.state !== filter.state) {
      return false;
    }
    return true;
  });
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const UPLOAD_STATES: UploadState[] = ['pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed'];
const PRIVACY_MODES: PrivacyMode[] = ['public', 'private'];

/** Generate a hex string of exactly `len` characters */
function hexStringArb(len: number): fc.Arbitrary<string> {
  return fc.stringMatching(new RegExp(`^[0-9a-f]{${len}}$`), { maxLength: len }).filter(
    (s) => s.length === len,
  );
}

/** Generate a realistic-looking Sui address (0x + 64 hex chars) */
const suiAddressArb: fc.Arbitrary<string> = hexStringArb(64).map((hex) => `0x${hex}`);

/** Generate a UUID-like string */
const uuidArb: fc.Arbitrary<string> = fc
  .tuple(
    hexStringArb(8),
    hexStringArb(4),
    hexStringArb(4),
    hexStringArb(4),
    hexStringArb(12),
  )
  .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

/** Generate a Walrus blob ID */
const blobIdArb: fc.Arbitrary<string> = hexStringArb(16).map((hex) => `blob-${hex}`);

const uploadStateArb: fc.Arbitrary<UploadState> = fc.constantFrom(...UPLOAD_STATES);
const privacyModeArb: fc.Arbitrary<PrivacyMode> = fc.constantFrom(...PRIVACY_MODES);

const isoDateArb: fc.Arbitrary<string> = fc
  .integer({ min: new Date('2024-01-01').getTime(), max: new Date('2025-12-31').getTime() })
  .map((ts) => new Date(ts).toISOString());

const submissionRowArb: fc.Arbitrary<SubmissionRow> = fc.record({
  id: uuidArb,
  form_id: uuidArb,
  form_version: fc.integer({ min: 1, max: 10 }),
  submitter_address: suiAddressArb,
  walrus_blob_id: blobIdArb,
  privacy_mode: privacyModeArb,
  content_digest: hexStringArb(64),
  size_bytes: fc.integer({ min: 0, max: 1_000_000 }),
  state: uploadStateArb,
  created_at: isoDateArb,
});

const formRowArb: fc.Arbitrary<FormRow> = fc.record({
  id: uuidArb,
  owner_address: suiAddressArb,
  walrus_blob_id: blobIdArb,
  privacy_mode: privacyModeArb,
  policy_id: fc.option(hexStringArb(16), { nil: null }),
  version: fc.integer({ min: 1, max: 10 }),
  predecessor_id: fc.option(uuidArb, { nil: null }),
  state: uploadStateArb,
  created_at: isoDateArb,
});

// ─── Property 24: Filter queries return exactly matching rows ─────────────────

describe('Property 24: Filter queries return exactly matching rows', () => {
  /**
   * **Validates: Requirements 5.9**
   *
   * For any generated set of submission rows and any filter combination over
   * (submitter_address, form_id, state), the filter returns exactly the rows
   * satisfying ALL specified filters — no extra rows, no missing rows.
   */
  describe('Submission filter', () => {
    it('Property 24a: single submitter_address filter returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          suiAddressArb,
          (rows, targetAddress) => {
            const result = filterSubmissions(rows, { submitter_address: targetAddress });

            // Every returned row must match the filter
            for (const row of result) {
              expect(row.submitter_address).toBe(targetAddress);
            }

            // Every matching row in the input must appear in the result
            const expected = rows.filter((r) => r.submitter_address === targetAddress);
            expect(result).toHaveLength(expected.length);

            // No extra rows (result is a subset of input)
            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24b: single form_id filter returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          uuidArb,
          (rows, targetFormId) => {
            const result = filterSubmissions(rows, { form_id: targetFormId });

            for (const row of result) {
              expect(row.form_id).toBe(targetFormId);
            }

            const expected = rows.filter((r) => r.form_id === targetFormId);
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24c: single state filter returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          uploadStateArb,
          (rows, targetState) => {
            const result = filterSubmissions(rows, { state: targetState });

            for (const row of result) {
              expect(row.state).toBe(targetState);
            }

            const expected = rows.filter((r) => r.state === targetState);
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24d: combined (submitter_address + form_id) filter returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          suiAddressArb,
          uuidArb,
          (rows, targetAddress, targetFormId) => {
            const filter: SubmissionFilter = {
              submitter_address: targetAddress,
              form_id: targetFormId,
            };
            const result = filterSubmissions(rows, filter);

            // Every returned row must satisfy ALL filter conditions
            for (const row of result) {
              expect(row.submitter_address).toBe(targetAddress);
              expect(row.form_id).toBe(targetFormId);
            }

            // Every row satisfying ALL conditions must appear in result
            const expected = rows.filter(
              (r) => r.submitter_address === targetAddress && r.form_id === targetFormId,
            );
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24e: combined (submitter_address + state) filter returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          suiAddressArb,
          uploadStateArb,
          (rows, targetAddress, targetState) => {
            const filter: SubmissionFilter = {
              submitter_address: targetAddress,
              state: targetState,
            };
            const result = filterSubmissions(rows, filter);

            for (const row of result) {
              expect(row.submitter_address).toBe(targetAddress);
              expect(row.state).toBe(targetState);
            }

            const expected = rows.filter(
              (r) => r.submitter_address === targetAddress && r.state === targetState,
            );
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24f: combined (form_id + state) filter returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          uuidArb,
          uploadStateArb,
          (rows, targetFormId, targetState) => {
            const filter: SubmissionFilter = {
              form_id: targetFormId,
              state: targetState,
            };
            const result = filterSubmissions(rows, filter);

            for (const row of result) {
              expect(row.form_id).toBe(targetFormId);
              expect(row.state).toBe(targetState);
            }

            const expected = rows.filter(
              (r) => r.form_id === targetFormId && r.state === targetState,
            );
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24g: all three filters combined return exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          suiAddressArb,
          uuidArb,
          uploadStateArb,
          (rows, targetAddress, targetFormId, targetState) => {
            const filter: SubmissionFilter = {
              submitter_address: targetAddress,
              form_id: targetFormId,
              state: targetState,
            };
            const result = filterSubmissions(rows, filter);

            // Every returned row must satisfy ALL three conditions
            for (const row of result) {
              expect(row.submitter_address).toBe(targetAddress);
              expect(row.form_id).toBe(targetFormId);
              expect(row.state).toBe(targetState);
            }

            // Exactly the rows satisfying all three conditions
            const expected = rows.filter(
              (r) =>
                r.submitter_address === targetAddress &&
                r.form_id === targetFormId &&
                r.state === targetState,
            );
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24h: empty filter (no params) returns all rows', () => {
      fc.assert(
        fc.property(fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }), (rows) => {
          const result = filterSubmissions(rows, {});
          expect(result).toHaveLength(rows.length);
          for (const row of rows) {
            expect(result).toContain(row);
          }
        }),
        { numRuns: 15 },
      );
    });

    it('Property 24i: filter with rows seeded to match — result is non-empty when matching rows exist', () => {
      // Use rows that are guaranteed to contain at least one match
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 9 }),
          (rows, seedIdx) => {
            const seed = rows[Math.min(seedIdx, rows.length - 1)];
            const filter: SubmissionFilter = {
              submitter_address: seed.submitter_address,
              form_id: seed.form_id,
              state: seed.state,
            };
            const result = filterSubmissions(rows, filter);

            // The seed row itself must appear in the result
            expect(result).toContain(seed);
            expect(result.length).toBeGreaterThanOrEqual(1);

            // All returned rows must satisfy the filter
            for (const row of result) {
              expect(row.submitter_address).toBe(seed.submitter_address);
              expect(row.form_id).toBe(seed.form_id);
              expect(row.state).toBe(seed.state);
            }
          },
        ),
        { numRuns: 15 },
      );
    });
  });

  /**
   * **Validates: Requirements 5.9**
   *
   * For any generated set of form rows and any filter combination over
   * (owner_address, state), the filter returns exactly the rows satisfying
   * ALL specified filters — no extra rows, no missing rows.
   */
  describe('Form filter', () => {
    it('Property 24j: single owner_address filter returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(formRowArb, { minLength: 0, maxLength: 20 }),
          suiAddressArb,
          (rows, targetOwner) => {
            const result = filterForms(rows, { owner_address: targetOwner });

            for (const row of result) {
              expect(row.owner_address).toBe(targetOwner);
            }

            const expected = rows.filter((r) => r.owner_address === targetOwner);
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24k: single state filter on forms returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(formRowArb, { minLength: 0, maxLength: 20 }),
          uploadStateArb,
          (rows, targetState) => {
            const result = filterForms(rows, { state: targetState });

            for (const row of result) {
              expect(row.state).toBe(targetState);
            }

            const expected = rows.filter((r) => r.state === targetState);
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24l: combined (owner_address + state) filter on forms returns exactly matching rows', () => {
      fc.assert(
        fc.property(
          fc.array(formRowArb, { minLength: 0, maxLength: 20 }),
          suiAddressArb,
          uploadStateArb,
          (rows, targetOwner, targetState) => {
            const filter: FormFilter = {
              owner_address: targetOwner,
              state: targetState,
            };
            const result = filterForms(rows, filter);

            for (const row of result) {
              expect(row.owner_address).toBe(targetOwner);
              expect(row.state).toBe(targetState);
            }

            const expected = rows.filter(
              (r) => r.owner_address === targetOwner && r.state === targetState,
            );
            expect(result).toHaveLength(expected.length);

            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24m: empty form filter returns all rows', () => {
      fc.assert(
        fc.property(fc.array(formRowArb, { minLength: 0, maxLength: 20 }), (rows) => {
          const result = filterForms(rows, {});
          expect(result).toHaveLength(rows.length);
          for (const row of rows) {
            expect(result).toContain(row);
          }
        }),
        { numRuns: 15 },
      );
    });

    it('Property 24n: filter with seeded form row — result is non-empty when matching rows exist', () => {
      fc.assert(
        fc.property(
          fc.array(formRowArb, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 9 }),
          (rows, seedIdx) => {
            const seed = rows[Math.min(seedIdx, rows.length - 1)];
            const filter: FormFilter = {
              owner_address: seed.owner_address,
              state: seed.state,
            };
            const result = filterForms(rows, filter);

            expect(result).toContain(seed);
            expect(result.length).toBeGreaterThanOrEqual(1);

            for (const row of result) {
              expect(row.owner_address).toBe(seed.owner_address);
              expect(row.state).toBe(seed.state);
            }
          },
        ),
        { numRuns: 15 },
      );
    });
  });

  /**
   * Invariant: filter is idempotent — applying the same filter twice yields the same result.
   */
  describe('Filter idempotence invariant', () => {
    it('Property 24o: applying the same submission filter twice is idempotent', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          fc.record({
            submitter_address: fc.option(suiAddressArb, { nil: undefined }),
            form_id: fc.option(uuidArb, { nil: undefined }),
            state: fc.option(uploadStateArb, { nil: undefined }),
          }),
          (rows, filter) => {
            // Remove undefined keys to match SubmissionFilter shape
            const cleanFilter: SubmissionFilter = {};
            if (filter.submitter_address !== undefined) cleanFilter.submitter_address = filter.submitter_address;
            if (filter.form_id !== undefined) cleanFilter.form_id = filter.form_id;
            if (filter.state !== undefined) cleanFilter.state = filter.state;

            const once = filterSubmissions(rows, cleanFilter);
            const twice = filterSubmissions(once, cleanFilter);

            // Applying the filter to already-filtered results yields the same set
            expect(twice).toHaveLength(once.length);
            for (const row of twice) {
              expect(once).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24p: applying the same form filter twice is idempotent', () => {
      fc.assert(
        fc.property(
          fc.array(formRowArb, { minLength: 0, maxLength: 20 }),
          fc.record({
            owner_address: fc.option(suiAddressArb, { nil: undefined }),
            state: fc.option(uploadStateArb, { nil: undefined }),
          }),
          (rows, filter) => {
            const cleanFilter: FormFilter = {};
            if (filter.owner_address !== undefined) cleanFilter.owner_address = filter.owner_address;
            if (filter.state !== undefined) cleanFilter.state = filter.state;

            const once = filterForms(rows, cleanFilter);
            const twice = filterForms(once, cleanFilter);

            expect(twice).toHaveLength(once.length);
            for (const row of twice) {
              expect(once).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });
  });

  /**
   * Invariant: filter result is always a subset of the input.
   */
  describe('Subset invariant', () => {
    it('Property 24q: submission filter result is always a subset of input rows', () => {
      fc.assert(
        fc.property(
          fc.array(submissionRowArb, { minLength: 0, maxLength: 20 }),
          fc.record({
            submitter_address: fc.option(suiAddressArb, { nil: undefined }),
            form_id: fc.option(uuidArb, { nil: undefined }),
            state: fc.option(uploadStateArb, { nil: undefined }),
          }),
          (rows, filter) => {
            const cleanFilter: SubmissionFilter = {};
            if (filter.submitter_address !== undefined) cleanFilter.submitter_address = filter.submitter_address;
            if (filter.form_id !== undefined) cleanFilter.form_id = filter.form_id;
            if (filter.state !== undefined) cleanFilter.state = filter.state;

            const result = filterSubmissions(rows, cleanFilter);

            // Result must be a subset of input
            expect(result.length).toBeLessThanOrEqual(rows.length);
            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it('Property 24r: form filter result is always a subset of input rows', () => {
      fc.assert(
        fc.property(
          fc.array(formRowArb, { minLength: 0, maxLength: 20 }),
          fc.record({
            owner_address: fc.option(suiAddressArb, { nil: undefined }),
            state: fc.option(uploadStateArb, { nil: undefined }),
          }),
          (rows, filter) => {
            const cleanFilter: FormFilter = {};
            if (filter.owner_address !== undefined) cleanFilter.owner_address = filter.owner_address;
            if (filter.state !== undefined) cleanFilter.state = filter.state;

            const result = filterForms(rows, cleanFilter);

            expect(result.length).toBeLessThanOrEqual(rows.length);
            for (const row of result) {
              expect(rows).toContain(row);
            }
          },
        ),
        { numRuns: 15 },
      );
    });
  });
});
