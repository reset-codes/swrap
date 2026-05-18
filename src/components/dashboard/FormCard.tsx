'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Inbox, Trash2 } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { FormMetadata } from '@/types/form';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── FormCard ─────────────────────────────────────────────────────────────────

interface FormCardProps {
  form: FormMetadata;
  /** The authenticated user's ID — used to gate the Delete action. */
  currentUserId: string;
}

/**
 * A single row in the forms table.
 *
 * Displays: title, slug, mode badge, published status badge,
 * submission count, creation date, and per-form action buttons.
 */
export function FormCard({ form, currentUserId }: FormCardProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isOwner = form.ownerId === currentUserId;

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/forms/${form.id}`, { method: 'DELETE' });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message =
          (data as { error?: { message?: string } })?.error?.message ??
          'Failed to delete form. Please try again.';
        setDeleteError(message);
        setIsDeleting(false);
        return;
      }

      setDeleteOpen(false);
      router.refresh();
    } catch {
      setDeleteError('An unexpected error occurred. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <>
      <tr className="border-b border-border hover:bg-muted/40 transition-colors">
        {/* Title */}
        <td className="px-4 py-3">
          <span className="text-body font-medium text-text-primary">{form.title}</span>
        </td>

        {/* Slug */}
        <td className="hidden sm:table-cell px-4 py-3">
          <span className="font-mono text-small text-text-secondary">{form.slug}</span>
        </td>

        {/* Mode */}
        <td className="px-4 py-3">
          <span className="text-small px-2 py-0.5 rounded bg-muted text-text-secondary capitalize">
            {form.mode === 'conversational' ? 'Conversational' : 'Table'}
          </span>
        </td>

        {/* Published status */}
        <td className="px-4 py-3">
          {form.isPublished ? (
            <Badge
              className="border-green-200 bg-green-50 text-green-700"
              aria-label="Published"
            >
              Published
            </Badge>
          ) : (
            <Badge variant="secondary" aria-label="Draft">
              Draft
            </Badge>
          )}
        </td>

        {/* Submission count */}
        <td className="px-4 py-3">
          <span className="text-body text-text-primary font-medium">
            {form.submissionCount ?? 0}
          </span>
        </td>

        {/* Created date */}
        <td className="hidden md:table-cell px-4 py-3">
          <span className="text-small text-text-secondary">{formatDate(form.createdAt)}</span>
        </td>

        {/* Actions */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {/* Edit — canvas builder for drafts, settings page for published */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              asChild
              aria-label={`Edit form "${form.title}"`}
              title="Edit form"
            >
              <Link href={form.isPublished ? `/dashboard/forms/${form.id}` : `/dashboard/forms/new?draft=${form.id}`}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>

            {/* View Submissions */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              asChild
              aria-label={`View submissions for "${form.title}"`}
              title="View submissions"
            >
              <Link href={`/dashboard/forms/${form.id}/submissions`}>
                <Inbox className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>

            {/* Delete — owner only */}
            {isOwner && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-text-secondary hover:text-error hover:bg-error/10"
                aria-label={`Delete form "${form.title}"`}
                title="Delete form"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </td>
      </tr>

      {/* ── Delete confirmation dialog ──────────────────────────────────── */}
      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
              'rounded-lg border border-border bg-white p-6 shadow-lg',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
              'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
            )}
            aria-describedby="delete-dialog-description"
          >
            <Dialog.Title className="text-h3 font-semibold text-text-primary mb-2">
              Delete form?
            </Dialog.Title>
            <Dialog.Description
              id="delete-dialog-description"
              className="text-body text-text-secondary mb-6"
            >
              Are you sure you want to delete{' '}
              <span className="font-medium text-text-primary">&ldquo;{form.title}&rdquo;</span>?
              This action cannot be undone. All submissions will also be removed.
            </Dialog.Description>

            {deleteError && (
              <p role="alert" className="mb-4 text-sm text-error">
                {deleteError}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setDeleteOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
                aria-busy={isDeleting}
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
