import type { Metadata } from 'next';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { MobileSidebarToggle } from '@/components/dashboard/MobileSidebarToggle';

export const metadata: Metadata = {
  title: {
    default: 'Dashboard — Swrap',
    template: '%s — Swrap',
  },
};

// ─── Dashboard Layout ─────────────────────────────────────────────────────────
//
// Structure:
//   ┌──────────────────────────────────────────────────────┐
//   │  Sidebar (240px, hidden on <lg)  │  Main content     │
//   │                                  │                   │
//   │  [Mobile: overlay via toggle]    │  flex-1, scroll   │
//   └──────────────────────────────────────────────────────┘
//
// The static Sidebar is a Server Component that reads the session.
// MobileSidebarToggle is a Client Component that manages open/close state.

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Skip to content (keyboard navigation) ────────────────────────── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-white focus:text-sm"
      >
        Skip to content
      </a>

      {/* ── Static sidebar (lg+) ─────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:flex-col">
        <Sidebar />
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
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
