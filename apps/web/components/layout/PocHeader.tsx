/**
 * PocHeader — top navigation bar for all POC pages.
 *
 * Passive layout component: no state, no client-side logic.
 * Navigation links to `/poc` (dashboard) and `/poc/forms/new` (new form).
 *
 * Requirements: R19.1, R19.3
 */
import * as React from 'react';
import Link from 'next/link';

export function PocHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-subtle bg-bg-app">
      <div className="mx-auto flex h-12 max-w-screen-xl items-center justify-between px-6">
        {/* Brand */}
        <Link
          href="/poc"
          className="flex items-center gap-2 text-token-base font-semibold text-text-primary hover:text-accent-base transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 rounded-sm"
        >
          <span className="text-accent-base" aria-hidden="true">■</span>
          <span>Swrap</span>
          <span className="text-token-xs font-medium text-text-secondary uppercase tracking-wide">
            POC
          </span>
        </Link>

        {/* Navigation */}
        <nav aria-label="Primary navigation">
          <ul className="flex items-center gap-1" role="list">
            <li>
              <Link
                href="/poc"
                className="inline-flex items-center rounded-md px-3 py-1.5 text-token-sm text-text-secondary hover:bg-bg-muted hover:text-text-primary transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
              >
                Dashboard
              </Link>
            </li>
            <li>
              <Link
                href="/poc/forms/new"
                className="inline-flex items-center rounded-md px-3 py-1.5 text-token-sm font-medium text-text-inverse bg-accent-base hover:bg-accent-hover active:bg-accent-active transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
              >
                New form
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
