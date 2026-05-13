import NextAuth from 'next-auth';
import { authConfig } from './config';

// Export the NextAuth handler and helpers for use throughout the app.
// - `auth`     → server-side session getter (use in Server Components / API routes)
// - `handlers` → { GET, POST } route handlers for /api/auth/[...nextauth]
// - `signIn`   → server action to initiate sign-in
// - `signOut`  → server action to sign out
export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
