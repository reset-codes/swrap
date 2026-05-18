'use client';

/**
 * /dashboard/forms/new — Canvas Form Builder
 *
 * Mounts the CanvasBuilderPage directly. The canvas builder is adapted to
 * coexist with DashboardShell by using flex-1/min-h-0 containment instead
 * of h-screen ownership — see CanvasBuilderPage.tsx for layout details.
 *
 * The legacy FormSettings + FormBuilder components are deprecated and no
 * longer used from this route. See src/components/forms/ for deprecation notes.
 */

import { CanvasBuilderPage } from '@poc/apps/web/components/form-builder';

export default function NewFormPage() {
  return <CanvasBuilderPage />;
}
