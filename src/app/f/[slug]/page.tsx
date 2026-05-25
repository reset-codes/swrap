/**
 * Public form page — server component with ISR.
 *
 * Fetches the Form_Schema from Walrus via getFormBySlug and renders
 * the appropriate form mode (table or conversational).
 *
 * No authentication required — this page is publicly accessible.
 *
 * Requirements: R6, R14
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFormBySlugOrId } from '@/services/FormService';
import { TableModeForm } from '@/components/forms/public/TableModeForm';
import { ConversationalModeForm } from '@/components/forms/public/ConversationalModeForm';

// ISR: revalidate every 60 seconds
export const revalidate = 60;

interface PublicFormPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicFormPageProps): Promise<Metadata> {
  const { slug } = await params;
  const searchParamsResolved = await searchParams;
  const isPreview = searchParamsResolved.preview === 'true';
  try {
    const schema = await getFormBySlugOrId(slug, isPreview);
    return {
      title: `${schema.title}${isPreview ? ' (Preview)' : ''}`,
      description: schema.description ?? `Fill out ${schema.title} on Swrap`,
    };
  } catch {
    return { title: 'Form Not Found' };
  }
}

export default async function PublicFormPage({
  params,
  searchParams,
}: PublicFormPageProps) {
  const { slug } = await params;
  const searchParamsResolved = await searchParams;
  const isPreview = searchParamsResolved.preview === 'true';

  let schema;
  try {
    schema = await getFormBySlugOrId(slug, isPreview);
  } catch {
    notFound();
  }

  return (
    <div>
      {/* Form title */}
      <div className="mb-6">
        <h1 className="text-h1 text-text-primary">
          {schema.title}
          {isPreview && (
            <span className="ml-3 text-xs font-semibold uppercase tracking-wider text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
              Preview Mode
            </span>
          )}
        </h1>
        {schema.description && (
          <p className="mt-2 text-body text-text-secondary">{schema.description}</p>
        )}
      </div>

      {/* Form card */}
      <div className="rounded-lg border border-border bg-white p-8 shadow-sm">
        {schema.mode === 'conversational' ? (
          <ConversationalModeForm schema={schema} />
        ) : (
          <TableModeForm schema={schema} />
        )}
      </div>
    </div>
  );
}
