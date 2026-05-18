import { redirect } from 'next/navigation';

/**
 * /poc/forms/new — redirects to the canonical builder route.
 * The canvas builder now lives at /dashboard/forms/new (inside DashboardShell).
 */
export default function Page() {
  redirect('/dashboard/forms/new');
}
