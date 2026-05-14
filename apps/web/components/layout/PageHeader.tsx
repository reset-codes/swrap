/**
 * PageHeader — page-level heading area with title and optional description.
 *
 * Passive layout component: no state, no client-side logic.
 *
 * Requirements: R19.1, R19.3
 */
import * as React from 'react';

export interface PageHeaderProps {
  /** Primary page title — rendered as an <h1>. */
  title: string;
  /** Optional supporting description rendered below the title. */
  description?: string;
  /** Optional slot for action buttons rendered to the right of the title. */
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 pb-6 border-b border-border-subtle">
      <div className="flex flex-col gap-1">
        <h1 className="text-token-2xl font-semibold leading-tight text-text-primary">
          {title}
        </h1>
        {description && (
          <p className="text-token-sm text-text-secondary leading-normal">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
