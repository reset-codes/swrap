import type { DefaultSession } from 'next-auth';
import type { DefaultJWT } from '@auth/core/jwt';
// Re-export the Prisma-generated UserRole enum so the rest of the codebase
// has a single source of truth. The local string-union type below is kept as
// a fallback type alias for contexts where @prisma/client is not available
// (e.g., edge runtime, build-time type checking without a generated client).
export type { UserRole } from '@prisma/client';

// ─── Session Augmentation ────────────────────────────────────────────────────

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      role: import('@prisma/client').UserRole;
    } & DefaultSession['user'];
  }

  interface User {
    role?: import('@prisma/client').UserRole;
  }
}

declare module '@auth/core/jwt' {
  interface JWT extends DefaultJWT {
    id?: string;
    role?: import('@prisma/client').UserRole;
  }
}
