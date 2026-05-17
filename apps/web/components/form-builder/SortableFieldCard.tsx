'use client';

/**
 * SortableFieldCard — wraps FieldCard with dnd-kit's useSortable hook.
 *
 * Responsibilities:
 *   - Registers the card as a sortable item keyed by field.id
 *   - Applies transform / transition CSS for smooth drag animation
 *   - Reduces opacity to 0.3 while the card is being actively dragged
 *     (the DragOverlay ghost shows the "full" card instead)
 *   - Attaches the drag handle listeners to the GripVertical element
 *
 * The drag handle (GripVertical) is wired separately via `attributes` and
 * `listeners` so only the handle initiates a drag, not the whole card.
 *
 * Requirements: 4.9, 4.10
 */

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FieldCard, type FieldCardProps } from './FieldCard';

// ---------------------------------------------------------------------------
// SortableFieldCard
// ---------------------------------------------------------------------------

export function SortableFieldCard(props: FieldCardProps) {
  const { field } = props;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: field.id,
    data: {
      // Mark this as a canvas card (not a palette source)
      source: 'canvas',
      fieldId: field.id,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // While dragging, the original position shows a faint placeholder.
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <FieldCard
        {...props}
        // Pass the drag handle ref + listeners so the GripVertical handle
        // initiates the drag (not the whole card).
        dragHandleRef={setActivatorNodeRef}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
      />
    </div>
  );
}
