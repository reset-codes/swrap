'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const loadingStateVariants = cva('flex items-center', {
  variants: {
    mode: {
      inline: 'gap-2',
      block: 'flex-col gap-3 justify-center py-12 px-6 w-full',
      compact: 'gap-1.5 py-4 px-3',
    },
  },
  defaultVariants: {
    mode: 'inline',
  },
});

export interface LoadingStateProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof loadingStateVariants> {
  /** User-facing label — must be encryption-agnostic (see ux-copy.ts) */
  label: string;
  progress?: number; // 0..1, optional
}

const LoadingState = React.forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ className, mode, label, progress, ...props }, ref) => {
    const isBlock = mode === 'block';

    return (
      <div
        ref={ref}
        className={cn(loadingStateVariants({ mode }), className)}
        role="status"
        aria-label={label}
        aria-live="polite"
        {...props}
      >
        {/* Spinner */}
        <svg
          className={cn(
            'animate-spin text-accent-base flex-shrink-0',
            isBlock ? 'h-6 w-6' : 'h-4 w-4',
          )}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>

        <div className={cn('flex flex-col', isBlock ? 'items-center gap-2' : 'gap-0.5')}>
          <span
            className={cn(
              'text-text-secondary',
              isBlock ? 'text-token-base' : 'text-token-sm',
            )}
          >
            {label}
          </span>

          {/* Progress bar — only shown when progress is provided */}
          {typeof progress === 'number' && (
            <div
              className="h-1 w-48 rounded-full bg-bg-muted overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-accent-base transition-all duration-base"
                style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  },
);

LoadingState.displayName = 'LoadingState';

export { LoadingState, loadingStateVariants };
