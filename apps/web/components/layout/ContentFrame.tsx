/**
 * ContentFrame — content wrapper with max-width constraint and consistent padding.
 *
 * Passive layout component: no state, no client-side logic.
 * Provides the standard page-body container used by all POC pages.
 *
 * Requirements: R19.1, R19.13
 */
import * as React from 'react';

export interface ContentFrameProps {
  children: React.ReactNode;
  /**
   * Optional additional className to merge onto the outer container.
   * Must not include hex color literals or arbitrary Tailwind values.
   */
  className?: string;
}

export function ContentFrame({ children, className }: ContentFrameProps) {
  return (
    <main
      className={[
        'mx-auto w-full max-w-screen-xl px-6 py-8',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </main>
  );
}
