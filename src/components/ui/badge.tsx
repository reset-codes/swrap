import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-white',
        secondary: 'border-transparent bg-muted text-text-secondary',
        outline: 'border-border text-text-primary',
        // Status tag variants
        open: 'border-blue-200 bg-blue-50 text-blue-700',
        under_review: 'border-yellow-200 bg-yellow-50 text-yellow-700',
        planned: 'border-purple-200 bg-purple-50 text-purple-700',
        resolved: 'border-green-200 bg-green-50 text-green-700',
        rejected: 'border-red-200 bg-red-50 text-red-700',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
