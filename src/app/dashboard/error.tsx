'use client';

/**
 * Dashboard error boundary — catches unhandled errors within the /dashboard
 * route segment and its children.
 *
 * IMPORTANT: Never expose `error.message` to users — it may contain internal
 * implementation details, stack traces, or sensitive information.
 *
 * Requirements: R8, R9, R10, R16
 */

import { useEffect } from 'react';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log internally for observability — never surface to the user
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-16">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <XCircle className="h-12 w-12 text-error" aria-hidden="true" />

        <div className="space-y-2">
          <h1 className="text-h2 font-semibold text-text-primary">Something went wrong</h1>
          <p className="text-body text-text-secondary">
            Something went wrong loading this page. Please try again.
          </p>
        </div>

        <div className="flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" asChild>
            <a href="/dashboard">Back to Dashboard</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
