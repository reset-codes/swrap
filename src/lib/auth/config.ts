import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { UserRole } from '@/types/auth';

// ─── Role Assignment Logic ────────────────────────────────────────────────────
//
// Business rule:
//   - First user in the workspace → role: 'owner'
//   - All subsequent users       → role: 'admin'
//
// Wrapped in try/catch because the DB may not be available during build time
// (e.g., Vercel build step without DATABASE_URL set).
async function resolveRoleForNewUser(): Promise<UserRole> {
  try {
    const { prisma } = await import('@/lib/prisma/client');
    const count = await prisma.user.count();
    return count === 0 ? 'owner' : 'admin';
  } catch {
    // DB unavailable (e.g., build time) — default to 'admin'; the upsert
    // below will also fail gracefully in the same scenario.
    return 'admin';
  }
}

// ─── NextAuth Configuration ───────────────────────────────────────────────────

// ─── Providers ────────────────────────────────────────────────────────────────

const providers: NextAuthConfig['providers'] = [
  // Firebase credentials provider — verifies Firebase ID tokens server-side
  Credentials({
    id: 'firebase',
    name: 'Firebase',
    credentials: {
      idToken: { label: 'ID Token', type: 'text' },
    },
    async authorize(credentials) {
      const idToken = credentials?.idToken as string;
      if (!idToken) return null;

      try {
        const { verifyFirebaseToken } = await import('@/lib/firebase/verify-token');
        const decoded = await verifyFirebaseToken(idToken);
        if (!decoded) return null;

        return {
          id: decoded.uid,
          email: decoded.email ?? null,
          name: decoded.name ?? decoded.email?.split('@')[0] ?? null,
          image: decoded.picture ?? null,
        };
      } catch (error) {
        console.error('[auth] Firebase token verification failed:', error);
        return null;
      }
    },
  }),
];

// In development, add a dev credentials provider for quick local testing
if (process.env.NODE_ENV === 'development') {
  providers.push(
    Credentials({
      id: 'dev-login',
      name: 'Dev Login',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'dev@swrap.local' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        if (!email) return null;
        return {
          id: email,
          email,
          name: email.split('@')[0],
        };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,

  pages: {
    signIn: '/login',
    error: '/login',
  },

  callbacks: {
    // ── signIn ──────────────────────────────────────────────────────────────
    // Called after successful credential verification. Creates or retrieves the
    // user record in the database and assigns a role.
    async signIn({ user, account }) {
      // Allow dev credentials provider in development
      if (account?.provider === 'dev-login') {
        if (!user.email) return false;
        try {
          const { prisma } = await import('@/lib/prisma/client');
          const existingUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true, role: true },
          });
          if (existingUser) {
            user.id = existingUser.id;
            user.role = existingUser.role as UserRole;
          } else {
            const role = await resolveRoleForNewUser();
            const created = await prisma.user.create({
              data: {
                email: user.email,
                name: user.name ?? null,
                image: user.image ?? null,
                role,
              },
            });
            user.id = created.id;
            user.role = role;
          }
        } catch (error) {
          console.error('[auth] dev-login signIn error:', error);
          user.role = 'admin';
        }
        return true;
      }

      // Firebase provider
      if (account?.provider === 'firebase') {
        if (!user.email) return false;

        try {
          const { prisma } = await import('@/lib/prisma/client');

          const existingUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true, role: true },
          });

          if (existingUser) {
            // Existing user — carry their persisted role forward
            user.id = existingUser.id;
            user.role = existingUser.role as UserRole;
          } else {
            // New user — assign role based on whether they are the first user
            const role = await resolveRoleForNewUser();
            const created = await prisma.user.create({
              data: {
                email: user.email,
                name: user.name ?? null,
                image: user.image ?? null,
                role,
              },
            });
            user.id = created.id;
            user.role = role;
          }

          return true;
        } catch (error) {
          console.error('[auth] Firebase signIn callback error:', error);
          // Allow sign-in to proceed even if DB is unavailable; the user will
          // get a default 'admin' role from the jwt callback fallback.
          user.role = 'admin';
          return true;
        }
      }

      return false;
    },

    // ── jwt ─────────────────────────────────────────────────────────────────
    // Persist the user's id and role in the JWT token so they survive across
    // requests without hitting the database on every call.
    async jwt({ token, user }) {
      if (user) {
        // First sign-in: copy id and role from the user object into the token.
        token.id = user.id;
        token.role = user.role ?? 'admin';
      } else if (token.email && !token.role) {
        // Token refresh without a fresh user object — re-fetch role from DB
        try {
          const { prisma } = await import('@/lib/prisma/client');
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email },
            select: { id: true, role: true },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role as UserRole;
          }
        } catch {
          // DB unavailable — keep existing token values
        }
      }
      return token;
    },

    // ── session ──────────────────────────────────────────────────────────────
    // Expose the user's id and role on the client-side session object.
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as UserRole) ?? 'admin';
      }
      return session;
    },
  },

  session: {
    strategy: 'jwt',
    // Sessions expire after 30 days; users are redirected to /login on expiry
    maxAge: 30 * 24 * 60 * 60,
  },
};
