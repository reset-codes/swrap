'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const textareaVariants = cva(
  'flex w-full rounded-md border bg-bg-surface text-text-primary text-token-base placeholder:text-text-tertiary transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-y min-h-20',
  {
    variants: {
      variant: {
        default: 'border-border-subtle hover:border-border-strong',
        error: 'border-status-error focus-visible:ring-status-error',
      },
      size: {
        sm: 'px-2.5 py-1.5 text-token-sm',
        md: 'px-3 py-2 text-token-base',
        lg: 'px-3.5 py-2.5 text-token-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <textarea
        className={cn(textareaVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);

Textarea.displayName = 'Textarea';

export { Textarea, textareaVariants };
