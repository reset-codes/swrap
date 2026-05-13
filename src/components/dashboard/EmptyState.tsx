import React from 'react';

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}

/**
 * Generic empty state component for use across dashboard pages.
 * Renders a centered icon, title, description, and optional action.
 */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Icon className="h-12 w-12 text-text-muted mb-4" aria-hidden="true" />
      <h2 className="text-h3 font-semibold text-text-primary mb-2">{title}</h2>
      <p className="text-body text-text-secondary mb-6">{description}</p>
      {action}
    </div>
  );
}
