'use client';

/**
 * PendingImportRunner — runs a pending Airtable import after the user signs in.
 *
 * When an unauthenticated user uses the landing page import hero:
 *   1. The API returns 401
 *   2. The hero saves the URL to sessionStorage at 'swrap-pending-import-url'
 *   3. The user is redirected to /login
 *   4. After sign-in, the dashboard mounts this component
 *   5. This component picks up the pending URL, runs the import, and navigates
 *      to the builder
 *
 * This is a "fire once" component — it clears the sessionStorage key immediately.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toasts } from '@/lib/toast';

const STORAGE_KEY = 'swrap-pending-import-url';

export function PendingImportRunner() {
  const router = useRouter();

  useEffect(() => {
    const pendingUrl = sessionStorage.getItem(STORAGE_KEY);
    if (!pendingUrl) return;

    // Clear immediately so we don't re-run on subsequent mounts
    sessionStorage.removeItem(STORAGE_KEY);

    async function runImport() {
      try {
        const res = await fetch('/api/import/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: pendingUrl }),
        });

        const data = await res.json().catch(() => ({})) as {
          success?: boolean;
          data?: { redirectUrl?: string; title?: string };
          error?: { message?: string };
        };

        if (res.ok && data.success && data.data?.redirectUrl) {
          toasts.success('Airtable form imported', `"${data.data.title ?? 'Imported Form'}" is ready in the builder.`);
          router.push(data.data.redirectUrl);
        } else {
          toasts.error('Import failed', data?.error?.message ?? 'Could not import the Airtable form.');
        }
      } catch {
        toasts.error('Import failed', 'Could not reach the server. Please try again.');
      }
    }

    // Small delay to let the dashboard fully mount
    const timer = setTimeout(runImport, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
