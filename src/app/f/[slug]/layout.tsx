/**
 * Public form layout — no auth required.
 *
 * Renders:
 *   - Minimal header: Swrap wordmark + form title (passed via slot or title tag)
 *   - Centered content area: max-w-2xl
 *   - "Powered by Swrap" footer
 *
 * Requirements: R6, R14
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: {
    default: 'Form | Swrap',
    template: '%s | Swrap',
  },
};

export default function PublicFormLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Minimal header */}
      <header className="border-b border-border bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center">
          <span className="text-sm font-semibold tracking-tight text-text-primary">Swrap</span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-8">{children}</div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-center">
          <p className="text-small text-text-muted">
            Powered by{' '}
            <span className="font-medium text-text-secondary">Swrap</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
