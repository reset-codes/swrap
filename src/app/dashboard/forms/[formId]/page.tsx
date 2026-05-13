'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { FormSettings, type FormSettingsValues } from '@/components/forms/FormSettings';
import { FormBuilder } from '@/components/forms/FormBuilder';
import type { FieldConfig, FormMetadata, FormSchema } from '@/types/form';
import type { ApiSuccess, ApiError } from '@/types/api';

// ─── Edit Form Page ───────────────────────────────────────────────────────────

export default function EditFormPage() {
  const router = useRouter();
  const { formId } = useParams() as { formId: string };

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormMetadata | null>(null);
  const [, setSchema] = useState<FormSchema | null>(null);
  const [fields, setFields] = useState<FieldConfig[]>([]);

  // ── Load form data ──────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadForm() {
      try {
        // Fetch metadata and schema from API
        const res = await fetch(`/api/forms/${formId}`);
        if (!res.ok) throw new Error('Failed to load form data');
        
        const json = (await res.json()) as ApiSuccess<{ 
          form: FormMetadata; 
          schema: FormSchema 
        }>;
        
        const { form: formMeta, schema: formSchema } = json.data;
        
        setForm(formMeta);
        setSchema(formSchema);
        setFields(formSchema.fields || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      } finally {
        setIsLoading(false);
      }
    }

    if (formId) loadForm();
  }, [formId]);

  const handleFieldsChange = useCallback((updated: FieldConfig[]) => {
    setFields(updated);
  }, []);

  const handleSave = async (settings: FormSettingsValues) => {
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/forms/${formId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: settings.title,
          description: settings.description || undefined,
          mode: settings.mode,
          encryptionMode: settings.encryptionMode,
          fields: fields,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message =
          (data as ApiError).error?.message ??
          'Failed to save form. Please try again.';
        setError(message);
        return;
      }

      router.refresh();
      // Optionally show a success toast here
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-h2 font-semibold text-text-primary">Form not found</h1>
        <p className="text-body text-text-secondary mt-2">
          The form you are looking for does not exist or you do not have permission to view it.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1 font-semibold text-text-primary">Edit Form</h1>
          <p className="text-body text-text-secondary mt-1">
            {form.title} — {form.isPublished ? 'Published' : 'Draft'}
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {error}
        </div>
      )}

      {/* Two-column layout on lg+ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {/* Left — Settings */}
        <FormSettings
          initialValues={{
            title: form.title,
            description: form.description,
            slug: form.slug,
            mode: form.mode,
            encryptionMode: form.encryptionMode,
          }}
          isPublished={form.isPublished}
          onSave={handleSave}
          isSaving={isSaving}
        />

        {/* Right — Builder */}
        <div className="rounded-lg border border-border bg-white p-6 shadow-sm">
          <h2 className="text-h3 font-semibold text-text-primary mb-6">Form Fields</h2>
          <FormBuilder
            initialFields={fields}
            onFieldsChange={handleFieldsChange}
          />
        </div>
      </div>
    </div>
  );
}
