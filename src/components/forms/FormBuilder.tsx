'use client';

import { useState, useCallback } from 'react';
import { AddFieldButton } from './AddFieldButton';
import { FieldList } from './FieldList';
import { FieldConfigPanel } from './FieldConfigPanel';
import type { FieldConfig, FieldType } from '@/types/form';

// ─── useFormBuilder hook ──────────────────────────────────────────────────────

interface UseFormBuilderOptions {
  initialFields?: FieldConfig[];
  onFieldsChange?: (fields: FieldConfig[]) => void;
}

export function useFormBuilder({ initialFields = [], onFieldsChange }: UseFormBuilderOptions = {}) {
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
        encrypted: false,
        order: fields.length,
      };
      const next = [...fields, newField];
      updateFields(next);
      // Immediately open the new field for editing
      setEditingFieldId(newField.id);
    },
    [fields, updateFields],
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
}

export function FormBuilder({ initialFields, onFieldsChange }: FormBuilderProps) {
  const {
    fields,
    editingFieldId,
    setEditingFieldId,
    addField,
    removeField,
    reorderFields,
    updateField,
  } = useFormBuilder({ initialFields, onFieldsChange });

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
      />

      {/* Field config panel */}
      <FieldConfigPanel
        field={editingField}
        onSave={handleSave}
        onClose={() => setEditingFieldId(null)}
      />
    </div>
  );
}
