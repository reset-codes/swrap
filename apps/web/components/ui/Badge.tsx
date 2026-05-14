'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border-subtle bg-bg-muted text-text-secondary',
        primary: 'border-transparent bg-accent-base text-text-inverse',
        secondary: 'border-border-subtle bg-bg-surface text-text-primary',
        success: 'border-transparent bg-status-success-bg text-status-success',
        warning: 'border-transparent bg-status-warning-bg text-status-warning',
        error: 'border-transparent bg-status-error-bg text-status-error',
        info: 'border-transparent bg-status-info-bg text-status-info',
        outline: 'border-border-strong bg-transparent text-text-primary',
      },
      size: {
        sm: 'px-2 py-0.5 text-token-xs',
        md: 'px-2.5 py-0.5 text-token-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  ),
);

Badge.displayName = 'Badge';

export { Badge, badgeVariants };
