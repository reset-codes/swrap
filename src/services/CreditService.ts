/**
 * CreditService — Storage credit management.
 *
 * Manages Storage_Credit balances for admins: deposits, balance checks,
 * deductions tied to Walrus write operations, transaction history,
 * and per-form usage analytics.
 *
 * Engineering Rule 5: Credits MUST be checked before any Walrus write.
 * Requirements: R10, R13
 */

import { prisma } from '@/lib/prisma/client'
import { ServiceError } from './FormService'

// ─── Cost estimation (mirrors StorageService.estimateCost) ────────────────────
// Defined here to avoid a circular dependency with StorageService.
// Formula: 0.001 WAL per KB (1 KB = 1024 bytes), rounded up.
function estimateCost(dataSize: number): number {
  return Math.ceil(dataSize / 1024) * 0.001
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CreditTransactionSummary {
  id: string
  amount: number
  type: string
  walrusBlobId: string | null
  description: string | null
  createdAt: string
}

export interface FormUsageSummary {
  formId: string
  formTitle: string
  totalBytes: number
  estimatedCost: number
  blobCount: number
}

// ─── CreditService ────────────────────────────────────────────────────────────

/**
 * Get the current storage credit balance for an admin.
 *
 * @param adminId  The user ID of the admin.
 * @returns        The current balance (defaults to 100 for new users in MVP).
 */
export async function getBalance(adminId: string): Promise<number> {
  const credit = await prisma.storageCredit.findUnique({
    where: { userId: adminId },
  })
  
  // R10.x: Grant 100 WAL free credits to every user at the initial stage
  if (!credit) {
    return 100;
  }
  
  return credit.balance
}

/**
 * Check whether an admin has sufficient credits to cover an estimated cost.
 *
 * @param adminId        The user ID of the admin.
 * @param estimatedCost  The estimated WAL cost of the operation.
 * @returns              true if balance >= estimatedCost, false otherwise.
 */
export async function checkSufficient(
  adminId: string,
  estimatedCost: number,
): Promise<boolean> {
  // R10.x: Allow bypass for development testing OR if explicitly requested
  if (process.env.DEV_BYPASS_STORAGE === 'true') {
    return true
  }

  const balance = await getBalance(adminId)
  return balance >= estimatedCost
}

/**
 * Deduct credits from an admin's balance after a successful Walrus write.
 *
 * Creates a CreditTransaction record for audit purposes.
 *
 * @param adminId       The user ID of the admin.
 * @param amount        The amount to deduct (must be positive).
 * @param walrusBlobId  The Walrus blob ID that triggered the deduction.
 * @throws ServiceError with code 'INSUFFICIENT_CREDITS' if balance is insufficient.
 */
export async function deduct(
  adminId: string,
  amount: number,
  walrusBlobId: string,
): Promise<void> {
  // R10.x: Allow bypass for development testing
  if (process.env.DEV_BYPASS_STORAGE === 'true') {
    return
  }

  // Ensure a StorageCredit record exists for this user, create it with initial 100 WAL if missing
  let credit = await prisma.storageCredit.findUnique({
    where: { userId: adminId },
  })

  if (!credit) {
    credit = await prisma.storageCredit.create({
      data: {
        userId: adminId,
        balance: 100,
      }
    });
  }

  if (credit.balance < amount) {
    throw new ServiceError(
      'Insufficient storage credits to complete this operation.',
      'INSUFFICIENT_CREDITS',
      402,
    )
  }

  // Deduct balance and record the transaction atomically
  await prisma.$transaction([
    prisma.storageCredit.update({
      where: { userId: adminId },
      data: { balance: { decrement: amount } },
    }),
    prisma.creditTransaction.create({
      data: {
        userId: adminId,
        creditId: credit.id,
        amount: -amount,
        type: 'deduction',
        walrusBlobId,
        description: `Walrus write: ${walrusBlobId}`,
      },
    }),
  ])
}

/**
 * Deposit credits into an admin's balance.
 *
 * Creates or updates the StorageCredit record and logs the transaction.
 *
 * @param adminId  The user ID of the admin.
 * @param amount   The amount to deposit (must be positive).
 */
export async function deposit(adminId: string, amount: number): Promise<void> {
  if (amount <= 0) {
    throw new ServiceError(
      'Deposit amount must be greater than zero.',
      'INVALID_AMOUNT',
      400,
    )
  }

  // Upsert the StorageCredit record
  const credit = await prisma.storageCredit.upsert({
    where: { userId: adminId },
    update: { balance: { increment: amount } },
    create: { userId: adminId, balance: amount },
  })

  // Record the deposit transaction
  await prisma.creditTransaction.create({
    data: {
      userId: adminId,
      creditId: credit.id,
      amount,
      type: 'deposit',
      description: `Credit deposit: ${amount} WAL`,
    },
  })
}

/**
 * Get the low-credit warning threshold in WAL.
 *
 * @returns  10 WAL — the threshold below which a low-credits warning is shown.
 */
export function getLowCreditThreshold(): number {
  return 10
}

/**
 * Check whether an admin's balance is below the low-credit threshold.
 *
 * @param adminId  The user ID of the admin.
 * @returns        true if balance < getLowCreditThreshold(), false otherwise.
 */
export async function isLowBalance(adminId: string): Promise<boolean> {
  const balance = await getBalance(adminId)
  return balance < getLowCreditThreshold()
}

/**
 * Get the credit transaction history for an admin.
 *
 * Returns transactions ordered by most recent first.
 *
 * @param adminId  The user ID of the admin.
 * @param limit    Maximum number of transactions to return. Defaults to 50.
 * @returns        Array of transaction summaries.
 */
export async function getTransactionHistory(
  adminId: string,
  limit?: number,
): Promise<CreditTransactionSummary[]> {
  const transactions = await prisma.creditTransaction.findMany({
    where: { userId: adminId },
    orderBy: { createdAt: 'desc' },
    take: limit ?? 50,
  })

  return transactions.map((tx) => ({
    id: tx.id,
    amount: tx.amount,
    type: tx.type,
    walrusBlobId: tx.walrusBlobId,
    description: tx.description,
    createdAt: tx.createdAt.toISOString(),
  }))
}

/**
 * Get per-form storage usage for an admin.
 *
 * For each form owned by the admin, sums the sizeBytes of all associated
 * BlobReferences and estimates the WAL cost.
 *
 * @param adminId  The user ID of the admin.
 * @returns        Array of form usage summaries.
 */
export async function getPerFormUsage(
  adminId: string,
): Promise<FormUsageSummary[]> {
  const forms = await prisma.form.findMany({
    where: { ownerId: adminId },
    include: {
      blobRefs: {
        select: { sizeBytes: true, blobType: true },
      },
    },
  })

  return forms.map((form) => {
    const totalBytes = form.blobRefs.reduce(
      (sum, ref) => sum + (ref.sizeBytes ?? 0),
      0,
    )
    return {
      formId: form.id,
      formTitle: form.title,
      totalBytes,
      estimatedCost: estimateCost(totalBytes),
      blobCount: form.blobRefs.length,
    }
  })
}
