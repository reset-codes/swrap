import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

export const metadata: Metadata = {
  title: {
    default: 'Dashboard — Swrap',
    template: '%s — Swrap',
  },
};

// ─── Dashboard Layout ─────────────────────────────────────────────────────────
//
// Refactored to use DashboardShell (Client Component) for collapsible sidebar
// logic while maintaining server-side session fetching.

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <DashboardShell user={session?.user}>
      {children}
    </DashboardShell>
  );
}
