'use client';

/**
 * Root error boundary — catches unhandled errors in the root layout segment.
 *
 * IMPORTANT: Never expose `error.message` to users — it may contain internal
 * implementation details, stack traces, or sensitive information.
 *
 * Requirements: R8, R9, R10
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log internally for observability — never surface to the user
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <XCircle className="h-12 w-12 text-error" aria-hidden="true" />

        <div className="space-y-2">
          <h1 className="text-h2 font-semibold text-text-primary">Something went wrong</h1>
          <p className="text-body text-text-secondary">
            Something went wrong. Please try again.
          </p>
        </div>

        <div className="flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" asChild>
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
