/**
 * Legacy POC metadata route — deprecated.
 * The canonical metadata API is now served by the Express API server.
 * This route returns 410 Gone to signal that the endpoint has moved.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    { error: 'This endpoint has been deprecated. Use the canonical API.' },
    { status: 410 },
  );
}
