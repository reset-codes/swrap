'use client';

import * as React from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

// Re-export the sonner toast function as the canonical toast API
export const toast = sonnerToast;

// Variant map for custom toast styling (used when rendering custom toast content)
const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md border p-3 shadow-elevation-md transition-all',
  {
    variants: {
      variant: {
        default: 'border-border-subtle bg-bg-surface text-text-primary',
        success: 'border-transparent bg-status-success-bg text-status-success',
        warning: 'border-transparent bg-status-warning-bg text-status-warning',
        error: 'border-transparent bg-status-error-bg text-status-error',
        info: 'border-transparent bg-status-info-bg text-status-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface ToastProps extends VariantProps<typeof toastVariants> {
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Toaster — place once in the app root layout.
 * Uses sonner's Toaster with design-token-aligned styling.
 */
export interface ToasterProps {
  position?: 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-right' | 'bottom-center';
  richColors?: boolean;
  closeButton?: boolean;
  duration?: number;
}

const Toaster = ({
  position = 'bottom-right',
  richColors = false,
  closeButton = true,
  duration = 4000,
}: ToasterProps) => {
  return (
    <SonnerToaster
      position={position}
      richColors={richColors}
      closeButton={closeButton}
      duration={duration}
      toastOptions={{
        classNames: {
          toast: cn(
            'group flex w-full items-start gap-3 rounded-md border border-border-subtle bg-bg-surface p-3 shadow-elevation-md text-token-sm text-text-primary',
          ),
          title: 'font-medium text-text-primary text-token-sm',
          description: 'text-text-secondary text-token-sm',
          actionButton: 'bg-accent-base text-text-inverse text-token-sm rounded px-2 py-1',
          cancelButton: 'bg-bg-muted text-text-secondary text-token-sm rounded px-2 py-1',
          closeButton: 'text-text-tertiary hover:text-text-primary',
          error: 'border-status-error-bg bg-status-error-bg text-status-error',
          success: 'border-status-success-bg bg-status-success-bg text-status-success',
          warning: 'border-status-warning-bg bg-status-warning-bg text-status-warning',
          info: 'border-status-info-bg bg-status-info-bg text-status-info',
        },
      }}
    />
  );
};

Toaster.displayName = 'Toaster';

export { Toaster, toastVariants };
