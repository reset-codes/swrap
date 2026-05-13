import NextAuth from 'next-auth';
import { edgeAuthConfig } from './edge-config';

/**
 * Edge-compatible NextAuth instance for use in middleware only.
 * Uses the minimal edge config (no firebase-admin dependency).
 */
export const { auth } = NextAuth(edgeAuthConfig);
