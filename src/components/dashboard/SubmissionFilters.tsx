'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import * as Checkbox from '@radix-ui/react-checkbox';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SubmissionStatus } from '@/types/submission';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_STATUSES: { value: SubmissionStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'planned', label: 'Planned' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'rejected', label: 'Rejected' },
];

// ─── SubmissionFilters ────────────────────────────────────────────────────────

interface SubmissionFiltersProps {
  /** Currently active status filters (from URL searchParams). */
  activeStatuses: SubmissionStatus[];
  /** Current sort order (from URL searchParams). */
  sort: 'newest' | 'oldest';
}

/**
 * Client component for filtering and sorting the submissions list.
 *
 * Updates URL searchParams on change so the server component re-fetches
 * with the new filters. Preserves the `page` param reset to 1 on filter change.
 */
export function SubmissionFilters({ activeStatuses, sort }: SubmissionFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /** Build a new URLSearchParams and push to router. */
  const updateParams = useCallback(
    (updates: Record<string, string | string[] | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        params.delete(key);
        if (value === null) continue;
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, v));
        } else {
          params.set(key, value);
        }
      }

      // Reset to page 1 whenever filters change
      params.set('page', '1');

      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const handleStatusToggle = (status: SubmissionStatus, checked: boolean) => {
    const next = checked
      ? [...activeStatuses, status]
      : activeStatuses.filter((s) => s !== status);
    updateParams({ status: next.length > 0 ? next : null });
  };

  const handleSortToggle = () => {
    updateParams({ sort: sort === 'newest' ? 'oldest' : 'newest' });
  };

  const handleClearFilters = () => {
    updateParams({ status: null, sort: null });
  };

  const activeFilterCount = activeStatuses.length + (sort === 'oldest' ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Filter icon + label */}
      <div className="flex items-center gap-1.5 text-small text-text-secondary">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="font-medium">Filters</span>
        {activeFilterCount > 0 && (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white"
            aria-label={`${activeFilterCount} active filter${activeFilterCount > 1 ? 's' : ''}`}
          >
            {activeFilterCount}
          </span>
        )}
      </div>

      {/* Status checkboxes */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by status"
      >
        {ALL_STATUSES.map(({ value, label }) => {
          const isChecked = activeStatuses.includes(value);
          const checkboxId = `status-filter-${value}`;

          return (
            <label
              key={value}
              htmlFor={checkboxId}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-small transition-colors select-none',
                isChecked
                  ? 'border-accent bg-accent/5 text-accent'
                  : 'border-border bg-white text-text-secondary hover:bg-muted',
              )}
            >
              <Checkbox.Root
                id={checkboxId}
                checked={isChecked}
                onCheckedChange={(checked) =>
                  handleStatusToggle(value, checked === true)
                }
                className="sr-only"
                aria-label={`Filter by ${label}`}
              >
                <Checkbox.Indicator>
                  <Check className="h-3 w-3" />
                </Checkbox.Indicator>
              </Checkbox.Root>
              {label}
            </label>
          );
        })}
      </div>

      {/* Sort toggle */}
      <Button
        variant="secondary"
        size="sm"
        onClick={handleSortToggle}
        aria-pressed={sort === 'oldest'}
        aria-label={`Sort by ${sort === 'newest' ? 'oldest' : 'newest'} first`}
        className="h-7 px-2.5 text-small"
      >
        {sort === 'newest' ? '↓ Newest first' : '↑ Oldest first'}
      </Button>

      {/* Clear filters — only shown when filters are active */}
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearFilters}
          className="h-7 px-2.5 text-small text-text-secondary"
          aria-label="Clear all filters"
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
