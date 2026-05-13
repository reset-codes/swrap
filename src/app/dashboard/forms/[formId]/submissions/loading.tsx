import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton for the submissions list table — mirrors the 4-column layout of
 * SubmissionsPage (Blob ID, Submitted, Status, Actions).
 *
 * Next.js App Router automatically wraps this in a Suspense boundary.
 */
function SubmissionsListSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Filters bar skeleton */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <div className="ml-auto">
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
          <table className="w-full border-collapse" aria-label="Loading submissions">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {['w-16', 'w-20', 'w-14', 'w-8'].map((w, i) => (
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
                  {/* Blob ID — monospace, wider */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-40 font-mono" />
                  </td>
                  {/* Submitted timestamp */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-28" />
                  </td>
                  {/* Status badge */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination skeleton */}
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <div className="flex items-center gap-1">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return <SubmissionsListSkeleton />;
}
