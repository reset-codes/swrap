/**
 * AppShell — root layout wrapper for all POC pages.
 *
 * - Server component (no 'use client')
 * - Applies the Inter font variable from `apps/web/fonts.ts`
 * - Uses `motion-safe:` / `motion-reduce:` Tailwind variants so that
 *   `motion.primitives.*` transitions collapse to `transition-none` when
 *   the user has `prefers-reduced-motion: reduce` set (R19.11).
 * - Wraps children in a full-height, token-driven layout.
 *
 * Requirements: R19.1, R19.3, R19.11
 */
import * as React from 'react';
import { appFont } from '../../fonts';

export interface AppShellProps {
  children: React.ReactNode;
}

/**
 * AppShell is a Server Component. It applies the font variable and the
 * base layout structure. All animation classes on child components should
 * use `motion-safe:` / `motion-reduce:` Tailwind variants so that
 * `prefers-reduced-motion: reduce` is respected automatically.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div
      className={[
        appFont.variable,
        'font-sans',
        'min-h-screen',
        'bg-bg-app',
        'text-text-primary',
        // Ensure all descendant transitions respect prefers-reduced-motion.
        // motion-safe: keeps transitions for users who have no preference.
        // motion-reduce: collapses them for users who prefer reduced motion.
        'motion-reduce:[&_*]:transition-none',
        'motion-reduce:[&_*]:animate-none',
      ].join(' ')}
    >
      {children}
    </div>
  );
}
