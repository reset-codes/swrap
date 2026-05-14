'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const formFieldVariants = cva('flex flex-col', {
  variants: {
    layout: {
      vertical: 'gap-1.5',
      horizontal: 'flex-row items-center gap-3',
    },
  },
  defaultVariants: {
    layout: 'vertical',
  },
});

export interface FormFieldProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof formFieldVariants> {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
}

const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  (
    { className, layout, label, description, error, required, htmlFor, children, ...props },
    ref,
  ) => {
    const fieldId = htmlFor;
    const descriptionId = description ? `${fieldId}-description` : undefined;
    const errorId = error ? `${fieldId}-error` : undefined;

    return (
      <div ref={ref} className={cn(formFieldVariants({ layout }), className)} {...props}>
        {label && (
          <label
            htmlFor={fieldId}
            className={cn(
              'text-token-sm font-medium text-text-primary',
              layout === 'horizontal' && 'min-w-24 flex-shrink-0',
            )}
          >
            {label}
            {required && (
              <span className="ml-0.5 text-status-error" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        <div className="flex flex-col gap-1 flex-1">
          {/* Inject aria-describedby and aria-invalid onto the child control */}
          {React.Children.map(children, (child) => {
            if (!React.isValidElement(child)) return child;
            return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
              id: fieldId,
              'aria-describedby':
                [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
              'aria-invalid': error ? true : undefined,
              'aria-required': required ? true : undefined,
            });
          })}

          {description && !error && (
            <p id={descriptionId} className="text-token-xs text-text-secondary">
              {description}
            </p>
          )}

          {error && (
            <p id={errorId} className="text-token-xs text-status-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  },
);

FormField.displayName = 'FormField';

export { FormField, formFieldVariants };
