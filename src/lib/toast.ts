/**
 * Toast utility functions for SEALBASE.
 *
 * Wraps sonner's toast API with typed helpers for all platform events.
 * Import `toasts` and call the relevant method — no need to import sonner directly.
 *
 * Requirements: R18
 */

import { toast } from 'sonner';

export const toasts = {
  // ── Generic helpers ──────────────────────────────────────────────────────

  success: (message: string, description?: string) =>
    toast.success(message, { description }),

  error: (message: string, description?: string) =>
    toast.error(message, { description }),

  info: (message: string, description?: string) =>
    toast(message, { description }),

  warning: (message: string, description?: string) =>
    toast.warning(message, { description }),

  // ── Domain-specific toasts ───────────────────────────────────────────────

  formSaved: () =>
    toasts.success('Form saved', 'Your form has been saved successfully.'),

  formPublished: (publicUrl: string) =>
    toasts.success('Form published', `Your form is live at ${publicUrl}`),

  submissionReceived: () =>
    toasts.success('Submission received', 'Your response has been recorded.'),

  statusUpdated: (newStatus: string) =>
    toasts.success('Status updated', `Status changed to ${newStatus}.`),

  exportDownloaded: () =>
    toasts.success('Export ready', 'Your CSV export has been downloaded.'),

  creditDeposited: (amount: number) =>
    toasts.success(
      'Credits deposited',
      `${amount.toFixed(3)} WAL added to your balance.`,
    ),

  // ── Error states ─────────────────────────────────────────────────────────

  insufficientCredits: () =>
    toasts.error(
      'Insufficient credits',
      'Please deposit more storage credits to continue.',
    ),

  walrusError: () =>
    toasts.error(
      'Storage error',
      'Failed to connect to Walrus. Please try again.',
    ),

  networkError: () =>
    toasts.error(
      'Network error',
      'Please check your connection and try again.',
    ),
};
