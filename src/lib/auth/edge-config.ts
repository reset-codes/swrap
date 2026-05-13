import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-compatible auth config — used by the middleware.
 * This config only contains the pages and session settings (no providers
 * that require Node.js-only packages like firebase-admin).
 *
 * The full config with providers is in ./config.ts and is used by the
 * API route handler and server-side auth() calls.
 */
export const edgeAuthConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },

  // Minimal callbacks for the edge — just enough to read the session
  callbacks: {
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as import('@prisma/client').UserRole) ?? 'admin';
      }
      return session;
    },
  },

  providers: [], // Providers are not needed for middleware session checks
};
