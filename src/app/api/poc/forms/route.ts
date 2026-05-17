/**
 * Legacy POC forms route — deprecated.
 * The canonical forms API is now served by the Express API server at /api/forms.
 * This route returns 410 Gone to signal that the endpoint has moved.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    { error: 'This endpoint has been deprecated. Use the canonical API at /api/forms.' },
    { status: 410 },
  );
}

export function POST(): NextResponse {
  return NextResponse.json(
    { error: 'This endpoint has been deprecated. Use the canonical API at /api/forms.' },
    { status: 410 },
  );
}
