/**
 * Public form 404 page — rendered when `notFound()` is called inside the
 * /f/[slug] route segment (e.g. the slug doesn't match any published form).
 *
 * No dashboard links — this is a public-facing page with no auth context.
 *
 * Requirements: R8, R9
 */

import { AlertCircle } from 'lucide-react';

export default function FormNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <AlertCircle className="h-12 w-12 text-error" aria-hidden="true" />

        <div className="space-y-2">
          <h1 className="text-h2 font-semibold text-text-primary">Form not found</h1>
          <p className="text-body text-text-secondary">
            This form may have been removed or the link is incorrect.
          </p>
        </div>
      </div>
    </div>
  );
}
