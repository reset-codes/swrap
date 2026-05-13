'use client';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useState } from 'react';
import { FieldListItem } from './FieldListItem';
import type { FieldConfig } from '@/types/form';

interface FieldListProps {
  fields: FieldConfig[];
  onReorder: (fields: FieldConfig[]) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function FieldList({ fields, onReorder, onEdit, onDelete }: FieldListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(fields, oldIndex, newIndex).map((field, index) => ({
      ...field,
      order: index,
    }));

    onReorder(reordered);
  }

  if (fields.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-border py-12 text-body text-text-muted">
        No fields yet. Add your first field above.
      </div>
    );
  }

  const activeField = activeId ? fields.find((f) => f.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {fields.map((field) => (
            <FieldListItem
              key={field.id}
              field={field}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeField ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-white px-4 py-3 shadow-md opacity-90">
            <span className="text-text-muted">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="9" cy="12" r="1" />
                <circle cx="9" cy="5" r="1" />
                <circle cx="9" cy="19" r="1" />
                <circle cx="15" cy="12" r="1" />
                <circle cx="15" cy="5" r="1" />
                <circle cx="15" cy="19" r="1" />
              </svg>
            </span>
            <span className="text-body font-medium text-text-primary">
              {activeField.label || 'Untitled field'}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
