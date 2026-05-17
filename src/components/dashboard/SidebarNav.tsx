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

export function SidebarNav({ isOpen = true }: { isOpen?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard navigation">
      <ul className="space-y-0.5 px-3" role="list">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          // Mark active if the pathname starts with the nav item's href
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                title={!isOpen ? label : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md transition-colors',
                  isOpen ? 'px-3 py-2' : 'justify-center p-2',
                  isActive
                    ? 'bg-muted font-medium text-text-primary'
                    : 'text-text-secondary hover:bg-muted hover:text-text-primary',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {isOpen && <span className="whitespace-nowrap">{label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
