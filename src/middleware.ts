import { auth } from '@/lib/auth/middleware';
import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';

// Protect all /dashboard/** routes. Unauthenticated users are redirected to
// /login. The `callbackUrl` param lets the login page redirect back after auth.
export default auth((req: NextAuthRequest) => {
  const { pathname } = req.nextUrl;

  const isDashboardRoute = pathname.startsWith('/dashboard');

  if (isDashboardRoute && !req.auth) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Run middleware on dashboard routes and auth API routes.
  // Exclude static assets and Next.js internals.
  matcher: ['/dashboard/:path*', '/api/auth/:path*'],
};
