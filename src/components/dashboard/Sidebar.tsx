'use client';

import { LogOut, Database, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarNav } from './SidebarNav';
import { useSidebar } from './SidebarContext';
import { cn } from '@/lib/utils';
import { signOut } from 'next-auth/react';

// ─── Avatar ───────────────────────────────────────────────────────────────────

function UserAvatar({ name, image }: { name?: string | null; image?: string | null }) {
  const initials = name
    ? name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?';

  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={name ?? 'User avatar'}
        className="h-7 w-7 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-small font-medium text-white"
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function Sidebar({ user }: SidebarProps) {
  const { isOpen, toggle } = useSidebar();

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col border-r border-border bg-surface transition-all duration-300 ease-in-out z-30',
        isOpen ? 'w-60' : 'w-16',
      )}
      aria-label="Sidebar"
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* ── Logo & Toggle ────────────────────────────────────────────────── */}
        <div className={cn(
          "flex h-14 items-center border-b border-border transition-all duration-300",
          isOpen ? "justify-between px-4" : "justify-center px-0"
        )}>
          {isOpen && (
            <div className="flex items-center gap-2.5">
              <img src="/icon.svg" alt="Swrap" className="h-6 w-6" />
              <span className="text-h3 font-semibold tracking-tight text-text-primary whitespace-nowrap">Swrap</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8 text-text-muted hover:text-text-primary", !isOpen && "h-10 w-10")}
            onClick={toggle}
            aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {isOpen ? (
              <ChevronLeft className="h-5 w-5" />
            ) : (
              <img src="/icon.svg" alt="Swrap" className="h-7 w-7" />
            )}
          </Button>
        </div>

        {/* ── Navigation ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto py-4">
          <SidebarNav isOpen={isOpen} />
        </div>

        {/* ── Storage Credits ──────────────────────────────────────────────── */}
        <div className="border-t border-border p-3">
          <div className={cn(
            "flex flex-col gap-2 rounded-md transition-all duration-300",
            isOpen ? "bg-muted px-3 py-2" : "items-center justify-center bg-transparent px-0"
          )}>
            {isOpen ? (
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-small font-medium text-text-secondary whitespace-nowrap">Credits</p>
                  <p className="text-small text-text-muted whitespace-nowrap">
                    <a href="/dashboard/storage" className="hover:underline">View usage →</a>
                  </p>
                </div>
              </div>
            ) : (
              <div title="Storage Credits">
                <Database className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>

        {/* ── User Section (Bottom Left) ───────────────────────────────────── */}
        <div className="border-t border-border p-3">
          <div className={cn(
            "flex items-center gap-2",
            !isOpen && "flex-col justify-center gap-3"
          )}>
            <div title={user?.name ?? 'Unknown'}>
              <UserAvatar name={user?.name} image={user?.image} />
            </div>
            {isOpen && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-medium text-text-primary">
                  {user?.name ?? 'Unknown'}
                </p>
                <p className="truncate text-small text-text-muted">{user?.email ?? ''}</p>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => signOut({ callbackUrl: '/login' })}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
