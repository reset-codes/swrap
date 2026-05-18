'use client';

/**
 * /dashboard/forms/new — Canvas Form Builder
 *
 * Accepts an optional `?draft=:formId` query param to load an existing
 * draft from the database. Used when clicking "Edit" on a draft form
 * from the dashboard.
 *
 * With no query param: shows the template picker for a new form.
 * With ?draft=:id: loads the draft fields from the DB and hydrates the builder.
 */

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CanvasBuilderPage } from '@poc/apps/web/components/form-builder';

function NewFormPageContent() {
  const searchParams = useSearchParams();
  const draftId = searchParams.get('draft');

  if (draftId) {
    return <CanvasBuilderPage initialDraftFormId={draftId} />;
  }

  return <CanvasBuilderPage showTemplatePicker />;
}

export default function NewFormPage() {
  return (
    <Suspense fallback={null}>
      <NewFormPageContent />
    </Suspense>
  );
}
