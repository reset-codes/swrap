import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton for the Storage page — mirrors the layout of StoragePage:
 * balance card, per-form usage table, and transaction history table.
 *
 * Next.js App Router automatically wraps this in a Suspense boundary.
 */
function StorageSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Skeleton className="h-7 w-24" />
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* ── Balance Card ─────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-white shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-6 w-36" />
          </div>
          {/* Large balance number */}
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-7 w-12" />
          </div>
          {/* Deposit form */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-40 rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </div>
        </div>

        {/* ── Per-Form Usage ───────────────────────────────────────────────── */}
        <section>
          <Skeleton className="h-6 w-48 mb-3" />
          <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
            <table className="w-full border-collapse" aria-label="Loading storage usage">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {['w-20', 'w-12', 'w-12', 'w-16'].map((w, i) => (
                    <th key={i} className="px-4 py-3">
                      <Skeleton className={`h-3 ${w}`} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 4 }).map((_, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className={`border-b border-border last:border-0 ${
                      rowIdx % 2 === 1 ? 'bg-muted/40' : ''
                    }`}
                  >
                    <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20 ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Transaction History ──────────────────────────────────────────── */}
        <section>
          <Skeleton className="h-6 w-44 mb-1" />
          <Skeleton className="h-4 w-36 mb-3" />
          <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
            <table className="w-full border-collapse" aria-label="Loading transactions">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {['w-16', 'w-12', 'w-16', 'w-20'].map((w, i) => (
                    <th key={i} className="px-4 py-3">
                      <Skeleton className={`h-3 ${w}`} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className={`border-b border-border last:border-0 ${
                      rowIdx % 2 === 1 ? 'bg-muted/40' : ''
                    }`}
                  >
                    <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24 font-mono" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Loading() {
  return <StorageSkeleton />;
}
