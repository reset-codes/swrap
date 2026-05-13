import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Empty state shown on the Forms list page when the user has no forms yet.
 */
export function FormsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <FileText
        className="h-12 w-12 text-text-muted mb-4"
        aria-hidden="true"
      />
      <h2 className="text-h3 font-semibold text-text-primary mb-2">No forms yet</h2>
      <p className="text-body text-text-secondary mb-6">
        Create your first form to start collecting feedback.
      </p>
      <Button asChild>
        <Link href="/dashboard/forms/new">Create Form</Link>
      </Button>
    </div>
  );
}
