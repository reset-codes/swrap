import { prisma } from '@/lib/prisma/client';

/**
 * Resolves the canonical database user ID from the NextAuth session.
 * Handles potential mismatches where the session ID might be the Firebase UID
 * or dev email, but the database records use a Prisma CUID.
 */
export async function getCanonicalUserId(session: {
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
  };
} | null): Promise<string | null> {
  if (!session?.user?.id) return null;

  const sessionUserId = session.user.id;
  const sessionUserEmail = session.user.email;
  const sessionUserName = session.user.name ?? null;
  const sessionUserImage = session.user.image ?? null;

  try {
    // 1. Try finding by ID first
    let user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true },
    });

    if (user) return user.id;

    // 2. If not found, check by email
    if (sessionUserEmail) {
      user = await prisma.user.findUnique({
        where: { email: sessionUserEmail },
        select: { id: true },
      });

      if (user) return user.id;

      // 3. User does not exist at all in DB — create record now (auto-creates credit balance)
      return await prisma.$transaction(async (tx) => {
        // Double-check count to assign 'owner' vs 'admin' role
        const count = await tx.user.count();
        const role = count === 0 ? 'owner' : 'admin';

        const created = await tx.user.create({
          data: {
            id: sessionUserId,
            email: sessionUserEmail,
            name: sessionUserName,
            image: sessionUserImage,
            role,
          },
        });

        await tx.storageCredit.create({
          data: { userId: created.id, balance: 100 },
        });

        return created.id;
      });
    }
  } catch (err) {
    console.error('[auth] Failed to resolve canonical user ID:', err);
  }

  return sessionUserId;
}
