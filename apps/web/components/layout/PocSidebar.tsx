/**
 * PocSidebar — optional sidebar for POC pages.
 *
 * Passive layout component. Minimal for V1 — the POC dashboard is
 * single-column; this component is a placeholder for future phases.
 *
 * Requirements: R19.1, R19.12
 */
import * as React from 'react';

export interface PocSidebarProps {
  children?: React.ReactNode;
}

/**
 * PocSidebar renders a narrow left-rail navigation area.
 * In V1 it is empty; future phases may populate it with form-list shortcuts.
 */
export function PocSidebar({ children }: PocSidebarProps) {
  if (!children) return null;

  return (
    <aside
      className="hidden lg:flex w-56 shrink-0 flex-col border-r border-border-subtle bg-bg-app"
      aria-label="Sidebar navigation"
    >
      <div className="flex flex-col gap-1 p-3">{children}</div>
    </aside>
  );
}
