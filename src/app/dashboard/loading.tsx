import { Skeleton } from '@/components/ui/skeleton';

/**
 * Dashboard root loading state — shown while the dashboard layout or
 * nested pages are resolving their async data.
 *
 * Next.js App Router automatically wraps this in a Suspense boundary.
 */
export default function Loading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Content skeleton */}
      <div className="flex-1 p-6 space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
