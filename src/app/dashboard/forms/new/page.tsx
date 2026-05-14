'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FormSettings, type FormSettingsValues } from '@/components/forms/FormSettings';
import { FormBuilder } from '@/components/forms/FormBuilder';
import type { FieldConfig } from '@/types/form';

// ─── New Form Page ────────────────────────────────────────────────────────────
//
// Two-column layout on lg+:
//   Left  — FormSettings panel (title, description, slug, mode, encryption)
//   Right — FormBuilder panel (field list + config)
//
// Auth is handled by the parent dashboard layout.

export default function NewFormPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track settings (like encryptionMode) to pass to FormBuilder
  const [encryptionMode, setEncryptionMode] = useState<string>('none');

  // Track fields from the FormBuilder
  const [fields, setFields] = useState<FieldConfig[]>([]);

  const handleFieldsChange = useCallback((updated: FieldConfig[]) => {
    setFields(updated);
  }, []);

  const handleSave = async (settings: FormSettingsValues) => {
    setSaveError(null);
    setIsSaving(true);

    try {
      const response = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: settings.title,
          description: settings.description || undefined,
          slug: settings.slug || undefined,
          mode: settings.mode,
          encryptionMode: settings.encryptionMode,
          fields: fields.map(({ id: _id, order: _order, ...rest }) => rest),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message =
          (data as { error?: { message?: string } })?.error?.message ??
          'Failed to create form. Please try again.';
        setSaveError(message);
        return;
      }

      const data = (await response.json()) as { data?: { id?: string } };
      const formId = data?.data?.id;

      // Navigate to the form editor or forms list
      if (formId) {
        router.push(`/dashboard/forms/${formId}`);
      } else {
        router.push('/dashboard/forms');
      }
    } catch {
      setSaveError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6 lg:p-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-h1 font-semibold text-text-primary">New Form</h1>
        <p className="text-body text-text-secondary mt-1">
          Configure your form settings and add fields to get started.
        </p>
      </div>

      {/* Error banner */}
      {saveError && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {saveError}
        </div>
      )}

      {/* Two-column layout on lg+ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {/* Left — Settings */}
        <FormSettings 
          onSave={handleSave} 
          isSaving={isSaving} 
          onChange={(v) => v.encryptionMode && setEncryptionMode(v.encryptionMode)}
        />

        {/* Right — Builder */}
        <div className="rounded-lg border border-border bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-h3 font-semibold text-text-primary">Form Fields</h2>
            {encryptionMode === 'full_submission' && (
              <div className="flex items-center gap-1.5 rounded-full bg-accent-light/50 px-2.5 py-1 text-xs font-medium text-accent border border-accent/20">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                Fully Secured
              </div>
            )}
          </div>
          <FormBuilder 
            onFieldsChange={handleFieldsChange} 
            encryptionMode={encryptionMode}
          />
        </div>
      </div>
    </div>
  );
}
