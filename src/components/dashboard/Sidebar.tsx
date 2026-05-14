import { auth, signOut } from '@/lib/auth';
import { LogOut, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarNav } from './SidebarNav';

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

export async function Sidebar() {
  const session = await auth();
  const user = session?.user;

  return (
    <aside
      className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface"
      aria-label="Sidebar"
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <span className="text-h3 font-semibold tracking-tight text-text-primary">Swrap</span>
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <SidebarNav />
      </div>

      {/* ── Storage Credits ──────────────────────────────────────────────── */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
          <Database className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-small font-medium text-text-secondary">Storage Credits</p>
            <p className="text-small text-text-muted">— credits remaining</p>
          </div>
        </div>
      </div>

      {/* ── User Section ─────────────────────────────────────────────────── */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <UserAvatar name={user?.name} image={user?.image} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-small font-medium text-text-primary">
              {user?.name ?? 'Unknown'}
            </p>
            <p className="truncate text-small text-text-muted">{user?.email ?? ''}</p>
          </div>
          {/* Sign-out form action */}
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}
