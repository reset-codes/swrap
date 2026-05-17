'use client';

import React from 'react';
import { Sidebar } from './Sidebar';
import { MobileSidebarToggle } from './MobileSidebarToggle';
import { SidebarProvider } from './SidebarContext';

interface DashboardShellProps {
  children: React.ReactNode;
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

function ShellContent({ children, user }: DashboardShellProps) {

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Skip to content (keyboard navigation) ────────────────────────── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-white focus:text-sm"
      >
        Skip to content
      </a>

      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:flex-col">
        <Sidebar user={user} />
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden relative">
        {/* Mobile top bar — shows hamburger + wordmark on small screens */}
        <div className="flex h-14 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <MobileSidebarToggle />
          <span className="text-h3 font-semibold tracking-tight text-text-primary">Swrap</span>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-background" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  return (
    <SidebarProvider>
      <ShellContent user={user}>{children}</ShellContent>
    </SidebarProvider>
  );
}
