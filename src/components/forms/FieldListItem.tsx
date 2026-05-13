'use client';

import { GripVertical, Pencil, Trash2, Lock } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { FieldTypeIcon } from './FieldTypeIcon';
import { FIELD_TYPE_LABELS } from './FieldTypeLabel';
import type { FieldConfig } from '@/types/form';

interface FieldListItemProps {
  field: FieldConfig;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function FieldListItem({ field, onEdit, onDelete }: FieldListItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  function handleDelete() {
    if (window.confirm(`Delete field "${field.label || 'Untitled field'}"? This cannot be undone.`)) {
      onDelete(field.id);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border border-border bg-white px-4 py-3 ${
        isDragging ? 'shadow-md' : ''
      }`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-text-muted active:cursor-grabbing focus:outline-none"
        aria-label="Drag to reorder"
        tabIndex={0}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Field type icon */}
      <span className="shrink-0 text-text-secondary">
        <FieldTypeIcon type={field.type} className="h-4 w-4" />
      </span>

      {/* Label and type badge */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-body font-medium text-text-primary">
          {field.label || 'Untitled field'}
        </span>

        {field.required && (
          <span className="shrink-0 text-small text-error" aria-label="Required field">
            *
          </span>
        )}

        <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-small text-text-muted">
          {FIELD_TYPE_LABELS[field.type]}
        </span>

        {field.encrypted && (
          <span
            className="shrink-0 text-seal-brand"
            aria-label="Encrypted field"
            title="This field is encrypted"
          >
            <Lock className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onEdit(field.id)}
          aria-label={`Edit field "${field.label || 'Untitled field'}"`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-text-secondary hover:text-error"
          onClick={handleDelete}
          aria-label={`Delete field "${field.label || 'Untitled field'}"`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
