'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarNav } from './SidebarNav';

// ─── MobileSidebarToggle ──────────────────────────────────────────────────────
//
// Renders a hamburger button (visible only on mobile/tablet) that opens a
// full-height overlay sidebar. On lg+ screens this component is hidden and the
// static sidebar in the layout takes over.

export function MobileSidebarToggle() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hamburger button — only visible below lg breakpoint */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-sidebar"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>

      {/* Overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-in sidebar panel */}
      <div
        id="mobile-sidebar"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-surface transition-transform duration-200 ease-out lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header row */}
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <span className="text-h3 font-semibold tracking-tight text-text-primary">SEALBASE</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Nav links */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav />
        </div>
      </div>
    </>
  );
}
