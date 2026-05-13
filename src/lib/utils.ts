import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names, resolving conflicts intelligently.
 * Used by shadcn/ui components and throughout the application.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
