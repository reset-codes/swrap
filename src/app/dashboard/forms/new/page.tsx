/**
 * /dashboard/forms/new — Canvas Form Builder
 *
 * Accepts an optional `?draft=:formId` query param to load an existing
 * draft from the database. Used when clicking "Edit" on a draft form
 * from the dashboard.
 *
 * With no query param: shows the template picker for a new form.
 * With ?draft=:id: loads the draft fields from the DB and hydrates the builder.
 *
 * Requirements: R17, Guest Import Flow
 */

import { auth } from '@/lib/auth';
import { CanvasBuilderPage } from '@poc/apps/web/components/form-builder';

export default async function NewFormPage(props: {
  searchParams: Promise<{ draft?: string; import?: string }>;
}) {
  const searchParams = await props.searchParams;
  const session = await auth();
  const draftId = searchParams.draft;
  const isImport = searchParams.import === 'local';

  return (
    <CanvasBuilderPage
      initialDraftFormId={draftId}
      showTemplatePicker={!draftId && !isImport}
      isGuest={!session?.user}
      isImport={isImport}
    />
  );
}
