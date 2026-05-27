/**
 * Unit tests for apps/api/services/audit-log.ts
 *
 * Tests cover:
 *   - writeAuditEntry: happy path, sensitive-data guard, AuditLogWriteError
 *   - queryAuditLog: filtering by actorAddress, formId, submissionId, time range
 *   - Append-only invariant: no mutation of existing rows
 *   - AuditLogWriteError: thrown on sensitive data, wraps unexpected errors
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  writeAuditEntry,
  queryAuditLog,
  AuditLogWriteError,
  _auditLogStore,
  _resetAuditLogStore,
  type AuditLogEntry,
} from './audit-log';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    requestId: 'req-001',
    actorAddress: '0xabc123',
    action: 'submission.decrypt',
    targetKind: 'submission',
    targetId: 'sub-uuid-001',
    formId: 'form-uuid-001',
    submissionId: 'sub-uuid-001',
    authorizationResult: 'granted',
    outcome: 'ok',
    httpStatus: 200,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  _resetAuditLogStore();
});

// ---------------------------------------------------------------------------
// writeAuditEntry — happy path
// ---------------------------------------------------------------------------

describe('writeAuditEntry — happy path', () => {
  it('persists a valid entry to the store', async () => {
    const entry = makeEntry();
    await writeAuditEntry(entry);

    expect(_auditLogStore).toHaveLength(1);
    const row = _auditLogStore[0];
    expect(row.requestId).toBe(entry.requestId);
    expect(row.actorAddress).toBe(entry.actorAddress);
    expect(row.action).toBe(entry.action);
    expect(row.authorizationResult).toBe('granted');
    expect(row.outcome).toBe('ok');
    expect(row.httpStatus).toBe(200);
  });

  it('assigns a sequential id starting at 1', async () => {
    await writeAuditEntry(makeEntry({ requestId: 'req-001' }));
    await writeAuditEntry(makeEntry({ requestId: 'req-002' }));
    await writeAuditEntry(makeEntry({ requestId: 'req-003' }));

    expect(_auditLogStore[0].id).toBe(1);
    expect(_auditLogStore[1].id).toBe(2);
    expect(_auditLogStore[2].id).toBe(3);
  });

  it('assigns a createdAt timestamp', async () => {
    const before = new Date();
    await writeAuditEntry(makeEntry());
    const after = new Date();

    const row = _auditLogStore[0];
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('accepts entries with null formId and submissionId (unauthenticated failed auth)', async () => {
    const entry = makeEntry({
      actorAddress: 'unknown',
      authorizationResult: 'denied',
      outcome: 'denied',
      httpStatus: 401,
      formId: null,
      submissionId: null,
      targetId: null,
      rejectionReason: 'No session token',
    });
    await expect(writeAuditEntry(entry)).resolves.toBeUndefined();
    expect(_auditLogStore).toHaveLength(1);
  });

  it('accepts entries with optional rejectionReason', async () => {
    const entry = makeEntry({
      authorizationResult: 'denied',
      outcome: 'denied',
      httpStatus: 403,
      rejectionReason: 'Actor is not the form owner',
    });
    await writeAuditEntry(entry);
    expect(_auditLogStore[0].rejectionReason).toBe('Actor is not the form owner');
  });

  it('is append-only: multiple writes accumulate without overwriting', async () => {
    await writeAuditEntry(makeEntry({ requestId: 'req-A', actorAddress: '0xaaa' }));
    await writeAuditEntry(makeEntry({ requestId: 'req-B', actorAddress: '0xbbb' }));

    expect(_auditLogStore).toHaveLength(2);
    expect(_auditLogStore[0].actorAddress).toBe('0xaaa');
    expect(_auditLogStore[1].actorAddress).toBe('0xbbb');
  });
});

// ---------------------------------------------------------------------------
// writeAuditEntry — sensitive-data guard (Requirement 14.4)
// ---------------------------------------------------------------------------

describe('writeAuditEntry — sensitive-data guard', () => {
  it('throws AuditLogWriteError when a forbidden field name is present', async () => {
    const entry = {
      ...makeEntry(),
      plaintext: 'some plaintext data',
    };
    await expect(writeAuditEntry(entry as AuditLogEntry)).rejects.toThrow(AuditLogWriteError);
  });

  it('throws AuditLogWriteError when a field name "ciphertext" is present', async () => {
    const entry = {
      ...makeEntry(),
      ciphertext: 'base64encodedciphertext',
    };
    await expect(writeAuditEntry(entry as AuditLogEntry)).rejects.toThrow(AuditLogWriteError);
  });

  it('throws AuditLogWriteError when a field name "privateKey" is present', async () => {
    const entry = {
      ...makeEntry(),
      privateKey: 'suiprivkey1abc',
    };
    await expect(writeAuditEntry(entry as AuditLogEntry)).rejects.toThrow(AuditLogWriteError);
  });

  it('throws AuditLogWriteError when a field value matches the Sui private key prefix', async () => {
    // The rejectionReason field is a string field — if it accidentally contains
    // a private key prefix, the guard must catch it.
    const entry = makeEntry({
      rejectionReason: 'suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    });
    await expect(writeAuditEntry(entry)).rejects.toThrow(AuditLogWriteError);
  });

  it('throws AuditLogWriteError when a field value is a 64-char hex string (raw key material)', async () => {
    const entry = makeEntry({
      // A 64-char hex string looks like a raw 32-byte secret key.
      rejectionReason: 'a'.repeat(64),
    });
    await expect(writeAuditEntry(entry)).rejects.toThrow(AuditLogWriteError);
  });

  it('does NOT throw for a normal UUID (not a 64-char hex string)', async () => {
    // UUIDs are 36 chars with dashes — they should not trigger the guard.
    const entry = makeEntry({
      targetId: '550e8400-e29b-41d4-a716-446655440000',
    });
    await expect(writeAuditEntry(entry)).resolves.toBeUndefined();
  });

  it('does NOT throw for a normal Sui address (0x-prefixed, 66 chars total)', async () => {
    // Sui addresses are 0x + 64 hex chars. The guard checks for ONLY 64 hex
    // chars (no 0x prefix), so a full Sui address should not be flagged.
    const entry = makeEntry({
      actorAddress: '0x' + 'a'.repeat(64),
    });
    await expect(writeAuditEntry(entry)).resolves.toBeUndefined();
  });

  it('does not persist the entry when the sensitive-data guard fires', async () => {
    const entry = {
      ...makeEntry(),
      payload: 'some payload data',
    };
    await expect(writeAuditEntry(entry as AuditLogEntry)).rejects.toThrow(AuditLogWriteError);
    // The store must remain empty — no partial write.
    expect(_auditLogStore).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// queryAuditLog — no filter (returns all)
// ---------------------------------------------------------------------------

describe('queryAuditLog — no filter', () => {
  it('returns an empty array when the store is empty', async () => {
    const rows = await queryAuditLog();
    expect(rows).toEqual([]);
  });

  it('returns all rows when no filter is supplied', async () => {
    await writeAuditEntry(makeEntry({ requestId: 'req-1' }));
    await writeAuditEntry(makeEntry({ requestId: 'req-2' }));
    await writeAuditEntry(makeEntry({ requestId: 'req-3' }));

    const rows = await queryAuditLog();
    expect(rows).toHaveLength(3);
  });

  it('returns rows in insertion order (oldest first)', async () => {
    await writeAuditEntry(makeEntry({ requestId: 'req-first' }));
    await writeAuditEntry(makeEntry({ requestId: 'req-second' }));

    const rows = await queryAuditLog();
    expect(rows[0].requestId).toBe('req-first');
    expect(rows[1].requestId).toBe('req-second');
  });
});

// ---------------------------------------------------------------------------
// queryAuditLog — actorAddress filter
// ---------------------------------------------------------------------------

describe('queryAuditLog — actorAddress filter', () => {
  it('returns only rows matching the actorAddress', async () => {
    await writeAuditEntry(makeEntry({ actorAddress: '0xalice', requestId: 'req-1' }));
    await writeAuditEntry(makeEntry({ actorAddress: '0xbob', requestId: 'req-2' }));
    await writeAuditEntry(makeEntry({ actorAddress: '0xalice', requestId: 'req-3' }));

    const rows = await queryAuditLog({ actorAddress: '0xalice' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actorAddress === '0xalice')).toBe(true);
  });

  it('returns an empty array when no rows match the actorAddress', async () => {
    await writeAuditEntry(makeEntry({ actorAddress: '0xalice' }));
    const rows = await queryAuditLog({ actorAddress: '0xcharlie' });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// queryAuditLog — formId filter
// ---------------------------------------------------------------------------

describe('queryAuditLog — formId filter', () => {
  it('returns only rows matching the formId', async () => {
    await writeAuditEntry(makeEntry({ formId: 'form-A', requestId: 'req-1' }));
    await writeAuditEntry(makeEntry({ formId: 'form-B', requestId: 'req-2' }));
    await writeAuditEntry(makeEntry({ formId: 'form-A', requestId: 'req-3' }));

    const rows = await queryAuditLog({ formId: 'form-A' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.formId === 'form-A')).toBe(true);
  });

  it('returns rows with null formId only when filter is omitted', async () => {
    await writeAuditEntry(makeEntry({ formId: null, requestId: 'req-null' }));
    await writeAuditEntry(makeEntry({ formId: 'form-X', requestId: 'req-x' }));

    // No filter — returns both
    const all = await queryAuditLog();
    expect(all).toHaveLength(2);

    // Filter by formId — returns only the non-null one
    const filtered = await queryAuditLog({ formId: 'form-X' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].requestId).toBe('req-x');
  });
});

// ---------------------------------------------------------------------------
// queryAuditLog — submissionId filter
// ---------------------------------------------------------------------------

describe('queryAuditLog — submissionId filter', () => {
  it('returns only rows matching the submissionId', async () => {
    await writeAuditEntry(makeEntry({ submissionId: 'sub-A', requestId: 'req-1' }));
    await writeAuditEntry(makeEntry({ submissionId: 'sub-B', requestId: 'req-2' }));

    const rows = await queryAuditLog({ submissionId: 'sub-A' });
    expect(rows).toHaveLength(1);
    expect(rows[0].submissionId).toBe('sub-A');
  });
});

// ---------------------------------------------------------------------------
// queryAuditLog — time range filter
// ---------------------------------------------------------------------------

describe('queryAuditLog — time range filter', () => {
  it('returns rows within the fromTime..toTime range (inclusive)', async () => {
    // We write entries and then query with a time range that brackets the
    // middle entry. Because the in-memory store uses real Date.now(), we
    // use a small delay to ensure distinct timestamps.
    const t0 = new Date();

    await writeAuditEntry(makeEntry({ requestId: 'req-early' }));

    // Capture the timestamp of the first entry.
    const afterFirst = new Date();

    await writeAuditEntry(makeEntry({ requestId: 'req-middle' }));

    const afterMiddle = new Date();

    await writeAuditEntry(makeEntry({ requestId: 'req-late' }));

    // Query: fromTime = afterFirst, toTime = afterMiddle
    // Should include req-middle (and possibly req-early if timestamps are equal).
    const rows = await queryAuditLog({ fromTime: afterFirst, toTime: afterMiddle });

    // All returned rows must have createdAt within [afterFirst, afterMiddle].
    for (const row of rows) {
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(afterFirst.getTime());
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(afterMiddle.getTime());
    }
  });

  it('returns all rows when fromTime is before all entries', async () => {
    const veryEarly = new Date(0); // epoch
    await writeAuditEntry(makeEntry({ requestId: 'req-1' }));
    await writeAuditEntry(makeEntry({ requestId: 'req-2' }));

    const rows = await queryAuditLog({ fromTime: veryEarly });
    expect(rows).toHaveLength(2);
  });

  it('returns no rows when toTime is before all entries', async () => {
    await writeAuditEntry(makeEntry({ requestId: 'req-1' }));

    const veryEarly = new Date(0); // epoch
    const rows = await queryAuditLog({ toTime: veryEarly });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// queryAuditLog — combined filters
// ---------------------------------------------------------------------------

describe('queryAuditLog — combined filters', () => {
  it('ANDs multiple filter fields together', async () => {
    await writeAuditEntry(
      makeEntry({ actorAddress: '0xalice', formId: 'form-A', requestId: 'req-1' }),
    );
    await writeAuditEntry(
      makeEntry({ actorAddress: '0xalice', formId: 'form-B', requestId: 'req-2' }),
    );
    await writeAuditEntry(
      makeEntry({ actorAddress: '0xbob', formId: 'form-A', requestId: 'req-3' }),
    );

    const rows = await queryAuditLog({ actorAddress: '0xalice', formId: 'form-A' });
    expect(rows).toHaveLength(1);
    expect(rows[0].requestId).toBe('req-1');
  });
});

// ---------------------------------------------------------------------------
// AuditLogWriteError
// ---------------------------------------------------------------------------

describe('AuditLogWriteError', () => {
  it('has the correct code', () => {
    const err = new AuditLogWriteError(new Error('test'));
    expect(err.code).toBe('AUDIT_LOG_WRITE_FAILED');
  });

  it('has the correct name', () => {
    const err = new AuditLogWriteError(new Error('test'));
    expect(err.name).toBe('AuditLogWriteError');
  });

  it('includes the cause message in its own message', () => {
    const cause = new Error('underlying DB error');
    const err = new AuditLogWriteError(cause);
    expect(err.message).toContain('underlying DB error');
  });

  it('sets the cause property when cause is an Error', () => {
    const cause = new Error('cause');
    const err = new AuditLogWriteError(cause);
    expect(err.cause).toBe(cause);
  });

  it('handles non-Error causes gracefully', () => {
    const err = new AuditLogWriteError('string cause');
    expect(err.message).toContain('string cause');
  });

  it('is an instance of Error', () => {
    const err = new AuditLogWriteError(new Error('test'));
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Append-only invariant
// ---------------------------------------------------------------------------

describe('Append-only invariant', () => {
  it('does not expose any mutation method on the returned rows', async () => {
    await writeAuditEntry(makeEntry({ requestId: 'req-1' }));
    const rows = await queryAuditLog();

    // Mutating the returned array does not affect the store.
    rows.length = 0;
    expect(_auditLogStore).toHaveLength(1);
  });

  it('existing rows are not modified by subsequent writes', async () => {
    await writeAuditEntry(makeEntry({ requestId: 'req-1', actorAddress: '0xoriginal' }));
    const firstId = _auditLogStore[0].id;
    const firstCreatedAt = _auditLogStore[0].createdAt;

    await writeAuditEntry(makeEntry({ requestId: 'req-2' }));

    // The first row must be unchanged.
    expect(_auditLogStore[0].id).toBe(firstId);
    expect(_auditLogStore[0].createdAt).toBe(firstCreatedAt);
    expect(_auditLogStore[0].actorAddress).toBe('0xoriginal');
  });
});
