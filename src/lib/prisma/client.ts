import { PrismaClient } from '@prisma/client'

// ─── Prisma Client Singleton ──────────────────────────────────────────────────
//
// In development, Next.js hot-reloading would create a new PrismaClient on
// every module reload, quickly exhausting the database connection pool.
// We work around this by caching the client on the global object so it
// survives hot-reloads.
//
// In production, module-level state is not re-initialised between requests,
// so a plain module-level export is sufficient — but we still use the same
// pattern for consistency.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
