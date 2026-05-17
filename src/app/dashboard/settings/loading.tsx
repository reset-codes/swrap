import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Skeleton className="h-7 w-28" />
      </div>

      {/* Content skeleton */}
      <div className="flex-1 p-6 space-y-6">
        {/* Account section */}
        <div className="rounded-lg border border-border p-6 space-y-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-20" />
        </div>

        {/* Workspace section */}
        <div className="rounded-lg border border-border p-6 space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-44" />
        </div>
      </div>
    </div>
  );
}
