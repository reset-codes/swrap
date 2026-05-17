/**
 * apps/web/app/_health/route.ts
 *
 * Next.js App Router health check endpoint for the web container.
 *
 * Used by the Docker Compose healthcheck for the `web` service:
 *   healthcheck:
 *     test: wget -qO- http://localhost:3000/_health
 *
 * Returns HTTP 200 with { ok: true } when the Next.js server is running.
 *
 * Requirements: 10.3
 */

import { NextResponse } from 'next/server';

export function GET(): NextResponse {
  return NextResponse.json({ ok: true }, { status: 200 });
}
