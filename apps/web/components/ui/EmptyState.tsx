'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const emptyStateVariants = cva(
  'flex flex-col items-center justify-center text-center',
  {
    variants: {
      mode: {
        block: 'py-12 px-6 w-full',
        inline: 'py-6 px-4',
        compact: 'py-4 px-3',
      },
    },
    defaultVariants: {
      mode: 'block',
    },
  },
);

export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof emptyStateVariants> {
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, mode, title, description, action, icon, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(emptyStateVariants({ mode }), className)}
        role="status"
        aria-label={title}
        {...props}
      >
        {icon && (
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg-muted text-text-tertiary">
            {icon}
          </div>
        )}
        <p className="text-token-base font-medium text-text-primary">{title}</p>
        {description && (
          <p className="mt-1 text-token-sm text-text-secondary max-w-xs">{description}</p>
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className={cn(
              'mt-4 inline-flex items-center justify-center rounded-md px-3 h-8 text-token-base font-medium',
              'bg-accent-base text-text-inverse hover:bg-accent-hover active:bg-accent-active',
              'transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2',
            )}
          >
            {action.label}
          </button>
        )}
      </div>
    );
  },
);

EmptyState.displayName = 'EmptyState';

export { EmptyState, emptyStateVariants };
