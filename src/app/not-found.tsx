/**
 * Root 404 page — rendered when `notFound()` is called or a route doesn't exist.
 *
 * Requirements: R8, R9
 */

import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <AlertCircle className="h-12 w-12 text-error" aria-hidden="true" />

        <div className="space-y-2">
          <h1 className="text-h2 font-semibold text-text-primary">Page not found</h1>
          <p className="text-body text-text-secondary">
            The page you&apos;re looking for doesn&apos;t exist.
          </p>
        </div>

        <Button variant="secondary" asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
