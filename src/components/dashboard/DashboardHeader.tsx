import type { ReactNode } from 'react';

// ─── DashboardHeader ──────────────────────────────────────────────────────────

interface DashboardHeaderProps {
  /** Page title displayed on the left side of the header. */
  title: string;
  /** Optional content rendered on the right side (e.g., action buttons). */
  actions?: ReactNode;
}

/**
 * Top header bar for dashboard pages.
 *
 * Usage:
 * ```tsx
 * <DashboardHeader title="Forms" actions={<Button>New Form</Button>} />
 * ```
 */
export function DashboardHeader({ title, actions }: DashboardHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <h1 className="text-h3 font-semibold text-text-primary">{title}</h1>
      {actions && (
        <div className="flex items-center gap-2" role="toolbar" aria-label="Page actions">
          {actions}
        </div>
      )}
    </header>
  );
}
