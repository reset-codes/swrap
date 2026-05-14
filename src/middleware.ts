import { auth } from '@/lib/auth/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';

/**
 * POC path exemption (R2.3, R14.7):
 * When DEV_BYPASS_STORAGE=true, all /api/poc/* and /poc/* paths bypass
 * NextAuth middleware entirely. This is intentional — the POC has no auth.
 */
function isPocPath(pathname: string): boolean {
  return pathname.startsWith('/api/poc/') || pathname.startsWith('/poc/');
}

function isPocBypassEnabled(): boolean {
  return process.env.DEV_BYPASS_STORAGE?.trim().toLowerCase() === 'true';
}

// The NextAuth `auth` wrapper handles dashboard protection.
const authMiddleware = auth((req: NextAuthRequest) => {
  const { pathname } = req.nextUrl;
  const isDashboardRoute = pathname.startsWith('/dashboard');

  if (isDashboardRoute && !req.auth) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

// Protect all /dashboard/** routes. Unauthenticated users are redirected to
// /login. The `callbackUrl` param lets the login page redirect back after auth.
export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Bypass NextAuth for POC paths when DEV_BYPASS_STORAGE=true.
  if (isPocBypassEnabled() && isPocPath(pathname)) {
    return NextResponse.next();
  }

  // Delegate to NextAuth for all other routes.
  return authMiddleware(req as NextAuthRequest, { params: Promise.resolve({}) });
}

export const config = {
  // Run middleware on dashboard routes, auth API routes, and POC routes.
  // Exclude static assets and Next.js internals.
  matcher: ['/dashboard/:path*', '/api/auth/:path*', '/api/poc/:path*', '/poc/:path*'],
};
