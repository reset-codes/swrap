/**
 * Unit tests for apps/api/routes/files.ts
 *
 * Tests cover:
 *   - POST /files: validation, submission existence check, duplicate blob ID, success
 *   - GET /files/:id: UUID validation, not-found, success
 *   - ApiResponse<T> envelope shape on all responses
 *
 * Uses a lightweight in-process HTTP server (node:http + express) so tests
 * exercise the full route stack without requiring supertest.
 *
 * Requirements: 5.3, 5.7, 7.1
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { filesRouter, _stubSeedSubmission, _stubClear } from './files';
import type { FileRow, ApiResponse } from './files';

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
      app.use('/files', filesRouter({} as Parameters<typeof filesRouter>[0]));

      server = createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}/files`;
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
// Helpers
// ---------------------------------------------------------------------------

const VALID_SUBMISSION_ID = '11111111-1111-1111-1111-111111111111';
const VALID_BLOB_ID = 'walrus-blob-abc123';
const VALID_BODY = {
  submissionId: VALID_SUBMISSION_ID,
  walrusBlobId: VALID_BLOB_ID,
  contentType: 'image/png',
  sizeBytes: 1024,
  contentDigest: 'a'.repeat(64),
};

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<FileRow> };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: (await res.json()) as ApiResponse<FileRow> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /files', () => {
  beforeEach(() => {
    _stubClear();
    _stubSeedSubmission(VALID_SUBMISSION_ID);
  });

  it('returns 201 with ApiResponse<FileRow> on valid input', async () => {
    const { status, body } = await post('/', VALID_BODY);

    expect(status).toBe(201);
    expect(body.status).toBe(201);
    expect(typeof body.requestId).toBe('string');
    expect(body.error).toBeUndefined();

    const file = body.result!;
    expect(typeof file.id).toBe('string');
    expect(file.submissionId).toBe(VALID_SUBMISSION_ID);
    expect(file.walrusBlobId).toBe(VALID_BLOB_ID);
    expect(file.contentType).toBe('image/png');
    expect(file.sizeBytes).toBe(1024);
    expect(file.contentDigest).toBe('a'.repeat(64));
    expect(file.state).toBe('pending');
    expect(typeof file.createdAt).toBe('string');
  });

  it('returns 400 when submissionId is missing', async () => {
    const { submissionId: _omit, ...body } = VALID_BODY;
    const res = await post('/', body);

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('Validation');
    expect(res.body.result).toBeUndefined();
  });

  it('returns 400 when submissionId is not a UUID', async () => {
    const res = await post('/', { ...VALID_BODY, submissionId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('Validation');
  });

  it('returns 400 when walrusBlobId is empty', async () => {
    const res = await post('/', { ...VALID_BODY, walrusBlobId: '' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('Validation');
  });

  it('returns 400 when contentType is empty', async () => {
    const res = await post('/', { ...VALID_BODY, contentType: '' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('Validation');
  });

  it('returns 400 when sizeBytes is negative', async () => {
    const res = await post('/', { ...VALID_BODY, sizeBytes: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('Validation');
  });

  it('returns 400 when sizeBytes is not an integer', async () => {
    const res = await post('/', { ...VALID_BODY, sizeBytes: 1.5 });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('Validation');
  });

  it('returns 400 when contentDigest is empty', async () => {
    const res = await post('/', { ...VALID_BODY, contentDigest: '' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('Validation');
  });

  it('returns 404 when submissionId does not exist', async () => {
    const unknownId = '22222222-2222-2222-2222-222222222222';
    const res = await post('/', { ...VALID_BODY, submissionId: unknownId });

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('NotFound');
    expect(res.body.result).toBeUndefined();
  });

  it('returns 409 when walrusBlobId is already used', async () => {
    // First insert succeeds
    await post('/', VALID_BODY);

    // Second insert with same walrusBlobId should conflict
    const res = await post('/', { ...VALID_BODY });

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('Conflict');
  });

  it('accepts sizeBytes = 0 (zero-byte file)', async () => {
    const res = await post('/', { ...VALID_BODY, walrusBlobId: 'blob-zero', sizeBytes: 0 });

    expect(res.status).toBe(201);
    expect(res.body.result?.sizeBytes).toBe(0);
  });

  it('response envelope always has requestId', async () => {
    const res = await post('/', VALID_BODY);
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });

  it('uses x-request-id header when provided', async () => {
    const customId = 'my-trace-id-123';
    const res = await post('/', VALID_BODY, { 'x-request-id': customId });

    expect(res.body.requestId).toBe(customId);
  });

  it('initial state is always pending', async () => {
    const res = await post('/', VALID_BODY);
    expect(res.body.result?.state).toBe('pending');
  });
});

describe('GET /files/:id', () => {
  beforeEach(() => {
    _stubClear();
    _stubSeedSubmission(VALID_SUBMISSION_ID);
  });

  it('returns 200 with ApiResponse<FileRow> for an existing file', async () => {
    // Create a file first
    const createRes = await post('/', VALID_BODY);
    const fileId = createRes.body.result!.id;

    const { status, body } = await get(`/${fileId}`);

    expect(status).toBe(200);
    expect(body.status).toBe(200);
    expect(typeof body.requestId).toBe('string');
    expect(body.error).toBeUndefined();

    const file = body.result!;
    expect(file.id).toBe(fileId);
    expect(file.submissionId).toBe(VALID_SUBMISSION_ID);
    expect(file.walrusBlobId).toBe(VALID_BLOB_ID);
    expect(file.contentType).toBe('image/png');
    expect(file.sizeBytes).toBe(1024);
    expect(file.state).toBe('pending');
  });

  it('returns 404 for a non-existent file ID', async () => {
    const unknownId = '33333333-3333-3333-3333-333333333333';
    const { status, body } = await get(`/${unknownId}`);

    expect(status).toBe(404);
    expect(body.error?.code).toBe('NotFound');
    expect(body.result).toBeUndefined();
  });

  it('returns 400 when id is not a valid UUID', async () => {
    const { status, body } = await get('/not-a-uuid');

    expect(status).toBe(400);
    expect(body.error?.code).toBe('BadRequest');
  });

  it('response envelope always has requestId', async () => {
    const unknownId = '44444444-4444-4444-4444-444444444444';
    const { body } = await get(`/${unknownId}`);
    expect(typeof body.requestId).toBe('string');
  });

  it('returned file matches what was created', async () => {
    const customBody = {
      submissionId: VALID_SUBMISSION_ID,
      walrusBlobId: 'blob-custom-999',
      contentType: 'application/pdf',
      sizeBytes: 99999,
      contentDigest: 'b'.repeat(64),
    };
    const createRes = await post('/', customBody);
    const fileId = createRes.body.result!.id;

    const { body } = await get(`/${fileId}`);
    expect(body.result?.contentType).toBe('application/pdf');
    expect(body.result?.sizeBytes).toBe(99999);
    expect(body.result?.contentDigest).toBe('b'.repeat(64));
  });
});
