'use client';

/**
 * @deprecated LEGACY — No longer the active form builder.
 *
 * Replaced by: apps/web/components/form-builder/CanvasBuilderPage.tsx
 * Active route: /dashboard/forms/new → CanvasBuilderPage
 *
 * This file is retained for reference only. Do not import it from any
 * new route or feature. It will be deleted in a future cleanup pass.
 */

import { useState, useCallback } from 'react';
import { AddFieldButton } from './AddFieldButton';
import { FieldList } from './FieldList';
import { FieldConfigPanel } from './FieldConfigPanel';
import type { FieldConfig, FieldType } from '@/types/form';

// ─── useFormBuilder hook ──────────────────────────────────────────────────────

interface UseFormBuilderOptions {
  initialFields?: FieldConfig[];
  onFieldsChange?: (fields: FieldConfig[]) => void;
  encryptionMode?: string;
}

export function useFormBuilder({ 
  initialFields = [], 
  onFieldsChange,
  encryptionMode 
}: UseFormBuilderOptions = {}) {
  const [fields, setFields] = useState<FieldConfig[]>(initialFields);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

  const updateFields = useCallback(
    (next: FieldConfig[]) => {
      setFields(next);
      onFieldsChange?.(next);
    },
    [onFieldsChange],
  );

  const addField = useCallback(
    (type: FieldType) => {
      const newField: FieldConfig = {
        id: crypto.randomUUID(),
        type,
        label: '',
        required: false,
        // Only default to encrypted if full_submission is selected.
        // If 'none' or 'field_level', the initial state should be false.
        encrypted: encryptionMode === 'full_submission',
        order: fields.length,
      };
      const next = [...fields, newField];
      updateFields(next);
      // Immediately open the new field for editing
      setEditingFieldId(newField.id);
    },
    [fields, updateFields, encryptionMode],
  );

  const removeField = useCallback(
    (id: string) => {
      const next = fields
        .filter((f) => f.id !== id)
        .map((f, index) => ({ ...f, order: index }));
      updateFields(next);
      if (editingFieldId === id) {
        setEditingFieldId(null);
      }
    },
    [fields, editingFieldId, updateFields],
  );

  const reorderFields = useCallback(
    (reordered: FieldConfig[]) => {
      updateFields(reordered);
    },
    [updateFields],
  );

  const updateField = useCallback(
    (id: string, updates: Partial<Omit<FieldConfig, 'id'>>) => {
      const next = fields.map((f) => (f.id === id ? { ...f, ...updates } : f));
      updateFields(next);
    },
    [fields, updateFields],
  );

  return {
    fields,
    editingFieldId,
    setEditingFieldId,
    addField,
    removeField,
    reorderFields,
    updateField,
  };
}

// ─── FormBuilder component ────────────────────────────────────────────────────

interface FormBuilderProps {
  initialFields?: FieldConfig[];
  onFieldsChange?: (fields: FieldConfig[]) => void;
  encryptionMode?: string;
}

export function FormBuilder({ initialFields, onFieldsChange, encryptionMode }: FormBuilderProps) {
  const {
    fields,
    editingFieldId,
    setEditingFieldId,
    addField,
    removeField,
    reorderFields,
    updateField,
  } = useFormBuilder({ initialFields, onFieldsChange, encryptionMode });

  const editingField = editingFieldId ? (fields.find((f) => f.id === editingFieldId) ?? null) : null;

  const handleSave = useCallback(
    (updates: Partial<Omit<FieldConfig, 'id' | 'order'>>) => {
      if (editingFieldId) {
        updateField(editingFieldId, updates);
        setEditingFieldId(null);
      }
    },
    [editingFieldId, updateField, setEditingFieldId],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <AddFieldButton onAddField={addField} />
      </div>

      {/* Field list */}
      <FieldList
        fields={fields}
        onReorder={reorderFields}
        onEdit={setEditingFieldId}
        onDelete={removeField}
        encryptionMode={encryptionMode}
      />

      {/* Field config panel */}
      <FieldConfigPanel
        field={editingField}
        onSave={handleSave}
        onClose={() => setEditingFieldId(null)}
        encryptionMode={encryptionMode}
      />
    </div>
  );
}
