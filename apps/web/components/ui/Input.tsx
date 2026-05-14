'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const inputVariants = cva(
  'flex w-full rounded-md border bg-bg-surface text-text-primary text-token-base placeholder:text-text-tertiary transition-colors duration-fast file:border-0 file:bg-transparent file:text-token-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-border-subtle hover:border-border-strong',
        error: 'border-status-error focus-visible:ring-status-error',
      },
      size: {
        sm: 'h-7 px-2.5 text-token-sm',
        md: 'h-8 px-3 text-token-base',
        lg: 'h-9 px-3.5 text-token-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';

export { Input, inputVariants };
