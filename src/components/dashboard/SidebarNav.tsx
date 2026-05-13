'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Inbox, Database, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Nav Items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    label: 'Forms',
    href: '/dashboard/forms',
    icon: FileText,
  },
  {
    label: 'Submissions',
    href: '/dashboard/submissions',
    icon: Inbox,
  },
  {
    label: 'Storage',
    href: '/dashboard/storage',
    icon: Database,
  },
  {
    label: 'Settings',
    href: '/dashboard/settings',
    icon: Settings,
  },
] as const;

// ─── SidebarNav ───────────────────────────────────────────────────────────────

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard navigation">
      <ul className="space-y-0.5" role="list">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          // Mark active if the pathname starts with the nav item's href
          // (so /dashboard/forms/new is still "Forms" active)
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-body transition-colors',
                  isActive
                    ? 'bg-muted font-medium text-text-primary'
                    : 'text-text-secondary hover:bg-muted hover:text-text-primary',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
