// ─── SEALBASE — Database Seed Script ─────────────────────────────────────────
//
// Seeds a development admin user. Safe to run multiple times (upsert).
// Run via: npx prisma db seed
//
// This creates a single dev owner account with an initial storage credit
// balance for local development and testing.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Upsert a dev owner user — first user gets the 'owner' role
  const user = await prisma.user.upsert({
    where: { email: 'dev@sealbase.app' },
    update: {},
    create: {
      email: 'dev@sealbase.app',
      name: 'Dev Owner',
      role: 'owner',
      storageCredit: {
        create: { balance: 1000 },
      },
    },
  })

  console.log(`Upserted user: ${user.email} (role: ${user.role})`)
  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
