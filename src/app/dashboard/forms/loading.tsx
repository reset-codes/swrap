import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton for the forms list table — mirrors the 7-column layout of
 * FormsPage (Title, Slug, Mode, Status, Submissions, Created, Actions).
 *
 * Next.js App Router automatically wraps this in a Suspense boundary.
 */
function FormsListSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden">
          <table className="w-full border-collapse" aria-label="Loading forms">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {/* Column header skeletons */}
                {['w-16', 'w-12', 'w-14', 'w-16', 'w-24', 'w-16', 'w-8'].map(
                  (w, i) => (
                    <th key={i} className="px-4 py-3">
                      <Skeleton className={`h-3 ${w}`} />
                    </th>
                  ),
                )}
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
                  {/* Title */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-32" />
                  </td>
                  {/* Slug */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-24" />
                  </td>
                  {/* Mode */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-20" />
                  </td>
                  {/* Status */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </td>
                  {/* Submissions */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-8" />
                  </td>
                  {/* Created */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-24" />
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return <FormsListSkeleton />;
}
