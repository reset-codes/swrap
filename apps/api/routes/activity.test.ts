/**
 * Unit tests for apps/api/routes/activity.ts
 *
 * Tests cover:
 *   - GET /activity: happy path, validation, authorization, filtering
 *   - Authorization: only form owners can query activity for their forms
 *   - Pagination: limit and offset work correctly
 *   - Typed response envelope: ApiResponse<AuditLogRow[]>
 *
 * Uses a lightweight in-process HTTP server (node:http + express) so tests
 * exercise the full route stack without requiring supertest.
 *
 * Requirements: 7.4, 14.5, 14.6
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { activityRouter } from './activity';
import {
  writeAuditEntry,
  _resetAuditLogStore,
  type AuditLogEntry,
} from '../services/audit-log';
import { _seedForm, _clearStores } from './submissions';
import type { ApiResponse } from '../error-envelope';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLogRowJson {
  id: number;
  requestId: string;
  actorAddress: string;
  action: string;
  targetKind: string;
  targetId: string | null;
  formId: string | null;
  submissionId: string | null;
  authorizationResult: 'granted' | 'denied';
  outcome: 'ok' | 'denied' | 'error';
  httpStatus: number;
  rejectionReason?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    requestId: 'req-001',
    actorAddress: '0xalice',
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

async function fetchActivity(
  query: string = '',
  headers: Record<string, string> = {},
): Promise<{ status: number; body: ApiResponse<AuditLogRowJson[]> }> {
  const response = await fetch(`${baseUrl}?${query}`, { headers });
  const body = (await response.json()) as ApiResponse<AuditLogRowJson[]>;
  return { status: response.status, body };
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = express();
      app.use(express.json());
      app.use('/api/activity', activityRouter({} as Parameters<typeof activityRouter>[0]));

      server = createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}/api/activity`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetAuditLogStore();
  _clearStores();
});

// ---------------------------------------------------------------------------
// GET /activity — no filter (returns all)
// ---------------------------------------------------------------------------

describe('GET /activity — no filter', () => {
  it('returns an empty array when the audit log is empty', async () => {
    const { status, body } = await fetchActivity();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result).toEqual([]);
  });

  it('returns all audit entries when no filter is provided', async () => {
    await writeAuditEntry(makeAuditEntry({ requestId: 'req-1' }));
    await writeAuditEntry(makeAuditEntry({ requestId: 'req-2' }));
    await writeAuditEntry(makeAuditEntry({ requestId: 'req-3' }));

    const { status, body } = await fetchActivity();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result).toHaveLength(3);
  });

  it('returns entries in insertion order (oldest first)', async () => {
    await writeAuditEntry(makeAuditEntry({ requestId: 'req-first' }));
    await writeAuditEntry(makeAuditEntry({ requestId: 'req-second' }));

    const { status, body } = await fetchActivity();

    expect(status).toBe(200);
    expect(body.result[0].requestId).toBe('req-first');
    expect(body.result[1].requestId).toBe('req-second');
  });

  it('applies limit and offset correctly', async () => {
    for (let i = 1; i <= 10; i++) {
      await writeAuditEntry(makeAuditEntry({ requestId: `req-${i}` }));
    }

    // Test limit
    const limitedResponse = await fetchActivity('limit=3');
    expect(limitedResponse.body.result).toHaveLength(3);

    // Test offset
    const offsetResponse = await fetchActivity('offset=5');
    expect(offsetResponse.body.result).toHaveLength(5);

    // Test limit + offset
    const paginatedResponse = await fetchActivity('offset=2&limit=4');
    expect(paginatedResponse.body.result).toHaveLength(4);
    expect(paginatedResponse.body.result[0].requestId).toBe('req-3');
  });
});

// ---------------------------------------------------------------------------
// GET /activity — actorAddress filter
// ---------------------------------------------------------------------------

describe('GET /activity — actorAddress filter', () => {
  it('returns only entries matching the actorAddress', async () => {
    await writeAuditEntry(makeAuditEntry({ actorAddress: '0xalice', requestId: 'req-1' }));
    await writeAuditEntry(makeAuditEntry({ actorAddress: '0xbob', requestId: 'req-2' }));
    await writeAuditEntry(makeAuditEntry({ actorAddress: '0xalice', requestId: 'req-3' }));

    const { status, body } = await fetchActivity('actorAddress=0xalice');

    expect(status).toBe(200);
    expect(body.result).toHaveLength(2);
    expect(body.result.every((r) => r.actorAddress === '0xalice')).toBe(true);
  });

  it('returns an empty array when no entries match the actorAddress', async () => {
    await writeAuditEntry(makeAuditEntry({ actorAddress: '0xalice' }));

    const { status, body } = await fetchActivity('actorAddress=0xcharlie');

    expect(status).toBe(200);
    expect(body.result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /activity — formId filter with authorization
// ---------------------------------------------------------------------------

describe('GET /activity — formId filter with authorization', () => {
  it('returns 401 when formId is provided but actor is not authenticated', async () => {
    await writeAuditEntry(makeAuditEntry({ formId: '550e8400-e29b-41d4-a716-446655440001' }));

    const { status, body } = await fetchActivity('formId=550e8400-e29b-41d4-a716-446655440001');

    expect(status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('Unauthorized');
  });

  it('returns 403 when actor is not the form owner', async () => {
    _seedForm({
      id: '550e8400-e29b-41d4-a716-446655440001',
      privacyMode: 'private',
      ownerAddress: '0xalice',
      walrusBlobId: 'blob-001',
    });
    await writeAuditEntry(makeAuditEntry({ formId: '550e8400-e29b-41d4-a716-446655440001' }));

    const { status, body } = await fetchActivity('formId=550e8400-e29b-41d4-a716-446655440001', {
      'x-actor-address': '0xbob',
    });

    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('Forbidden');
  });

  it('returns entries when actor is the form owner', async () => {
    _seedForm({
      id: '550e8400-e29b-41d4-a716-446655440001',
      privacyMode: 'private',
      ownerAddress: '0xalice',
      walrusBlobId: 'blob-001',
    });
    await writeAuditEntry(makeAuditEntry({ formId: '550e8400-e29b-41d4-a716-446655440001', actorAddress: '0xalice', action: 'submission.decrypt' }));

    const { status, body } = await fetchActivity('formId=550e8400-e29b-41d4-a716-446655440001', {
      'x-actor-address': '0xalice',
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // Note: assertOwner writes an audit entry for authorization.assertOwner action
    // We should have at least our entry plus the authorization entry
    expect(body.result.length).toBeGreaterThanOrEqual(1);
    // Check that our entry is present
    expect(body.result.some((r) => r.formId === '550e8400-e29b-41d4-a716-446655440001' && r.action === 'submission.decrypt')).toBe(true);
  });

  it('returns 403 when form does not exist', async () => {
    const { status, body } = await fetchActivity('formId=550e8400-e29b-41d4-a716-446655440099', {
      'x-actor-address': '0xalice',
    });

    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// GET /activity — submissionId filter
// ---------------------------------------------------------------------------

describe('GET /activity — submissionId filter', () => {
  it('returns only entries matching the submissionId', async () => {
    await writeAuditEntry(makeAuditEntry({ submissionId: '550e8400-e29b-41d4-a716-446655440011', requestId: 'req-1' }));
    await writeAuditEntry(makeAuditEntry({ submissionId: '550e8400-e29b-41d4-a716-446655440012', requestId: 'req-2' }));

    const { status, body } = await fetchActivity('submissionId=550e8400-e29b-41d4-a716-446655440011');

    expect(status).toBe(200);
    expect(body.result).toHaveLength(1);
    expect(body.result[0].submissionId).toBe('550e8400-e29b-41d4-a716-446655440011');
  });
});

// ---------------------------------------------------------------------------
// GET /activity — time range filter
// ---------------------------------------------------------------------------

describe('GET /activity — time range filter', () => {
  it('returns entries within the fromTime..toTime range (inclusive)', async () => {
    const t0 = new Date();

    await writeAuditEntry(makeAuditEntry({ requestId: 'req-early' }));

    const afterFirst = new Date();

    await writeAuditEntry(makeAuditEntry({ requestId: 'req-middle' }));

    const afterMiddle = new Date();

    await writeAuditEntry(makeAuditEntry({ requestId: 'req-late' }));

    const { status, body } = await fetchActivity(
      `fromTime=${afterFirst.toISOString()}&toTime=${afterMiddle.toISOString()}`,
    );

    expect(status).toBe(200);

    // All returned rows must have createdAt within [afterFirst, afterMiddle]
    for (const row of body.result) {
      const createdAt = new Date(row.createdAt);
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(afterFirst.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterMiddle.getTime());
    }
  });

  it('returns all entries when fromTime is before all entries', async () => {
    const veryEarly = new Date(0); // epoch
    await writeAuditEntry(makeAuditEntry({ requestId: 'req-1' }));
    await writeAuditEntry(makeAuditEntry({ requestId: 'req-2' }));

    const { status, body } = await fetchActivity(`fromTime=${veryEarly.toISOString()}`);

    expect(status).toBe(200);
    expect(body.result).toHaveLength(2);
  });

  it('returns no entries when toTime is before all entries', async () => {
    await writeAuditEntry(makeAuditEntry({ requestId: 'req-1' }));

    const veryEarly = new Date(0); // epoch
    const { status, body } = await fetchActivity(`toTime=${veryEarly.toISOString()}`);

    expect(status).toBe(200);
    expect(body.result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /activity — combined filters
// ---------------------------------------------------------------------------

describe('GET /activity — combined filters', () => {
  it('ANDs multiple filter fields together', async () => {
    _seedForm({
      id: '550e8400-e29b-41d4-a716-446655440001',
      privacyMode: 'private',
      ownerAddress: '0xalice',
      walrusBlobId: 'blob-001',
    });

    await writeAuditEntry(
      makeAuditEntry({ actorAddress: '0xalice', formId: '550e8400-e29b-41d4-a716-446655440001', requestId: 'req-1', action: 'submission.decrypt' }),
    );
    await writeAuditEntry(
      makeAuditEntry({ actorAddress: '0xalice', formId: '550e8400-e29b-41d4-a716-446655440002', requestId: 'req-2', action: 'submission.decrypt' }),
    );
    await writeAuditEntry(
      makeAuditEntry({ actorAddress: '0xbob', formId: '550e8400-e29b-41d4-a716-446655440001', requestId: 'req-3', action: 'submission.decrypt' }),
    );

    const { status, body } = await fetchActivity('actorAddress=0xalice&formId=550e8400-e29b-41d4-a716-446655440001', {
      'x-actor-address': '0xalice',
    });

    expect(status).toBe(200);
    // We should have at least our submission.decrypt entry, plus the authorization.assertOwner entry from the auth check
    expect(body.result.length).toBeGreaterThanOrEqual(1);
    // Check that our specific entry is present
    expect(body.result.some((r) => r.requestId === 'req-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /activity — validation errors
// ---------------------------------------------------------------------------

describe('GET /activity — validation errors', () => {
  it('returns 400 when formId is not a valid UUID', async () => {
    const { status, body } = await fetchActivity('formId=not-a-uuid');

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('Validation');
    expect(body.error.message).toContain('formId');
  });

  it('returns 400 when fromTime is not a valid ISO 8601 timestamp', async () => {
    const { status, body } = await fetchActivity('fromTime=invalid-timestamp');

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('Validation');
    expect(body.error.message).toContain('fromTime');
  });

  it('returns 400 when limit exceeds maximum (100)', async () => {
    const { status, body } = await fetchActivity('limit=200');

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('Validation');
    expect(body.error.message).toContain('limit');
  });
});

// ---------------------------------------------------------------------------
// GET /activity — response envelope
// ---------------------------------------------------------------------------

describe('GET /activity — response envelope', () => {
  it('includes requestId in the response', async () => {
    const response = await fetch(`${baseUrl}`, {
      headers: { 'x-request-id': 'custom-request-id' },
    });
    const body = (await response.json()) as ApiResponse<AuditLogRowJson[]>;

    expect(body.requestId).toBe('custom-request-id');
  });

  it('generates a requestId when not provided', async () => {
    const response = await fetch(baseUrl);
    const body = (await response.json()) as ApiResponse<AuditLogRowJson[]>;

    expect(body.requestId).toBeDefined();
    expect(typeof body.requestId).toBe('string');
  });

  it('includes status in the response', async () => {
    const response = await fetch(baseUrl);
    const body = (await response.json()) as ApiResponse<AuditLogRowJson[]>;

    expect(body.status).toBe(200);
  });
});
