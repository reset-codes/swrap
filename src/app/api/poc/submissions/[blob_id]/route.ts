/**
 * Legacy POC submissions by blob_id route — deprecated.
 * The canonical submissions API is now served by the Express API server at /api/submissions.
 * This route returns 410 Gone to signal that the endpoint has moved.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    { error: 'This endpoint has been deprecated. Use the canonical API at /api/submissions.' },
    { status: 410 },
  );
}
