import { handlers } from '@/lib/auth';

// Expose NextAuth's GET and POST handlers at /api/auth/[...nextauth]
export const { GET, POST } = handlers;
