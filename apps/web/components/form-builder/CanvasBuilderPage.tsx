'use client';

/**
 * CanvasBuilderPage — three-panel canvas form builder.
 *
 * Full-viewport self-contained layout. Does NOT use AppShell, ContentFrame,
 * or PageHeader — this component owns the entire viewport.
 *
 * Task 13 (Wave 3) — Zustand store migration:
 *   - All field state (fields, selectedFieldId, mutations) comes from
 *     `useFormBuilderStore` instead of the now-removed `useCanvasState`.
 *   - TopBar title input is wired to store `title` / `setTitle`.
 *   - FieldPalette item clicks are wired to store `addField`.
 *   - FieldCard duplicate/delete/required/label are wired to store actions.
 *   - InsertHandle clicks are wired to store `addField(type, index)`.
 *   - InspectorPanel controls call store `updateField`.
 *   - `reset()` is called on unmount via useEffect cleanup.
 *   - DnD state (activeId, activeDragSource, overId) stays as local React
 *     state — it is purely ephemeral UI and does not belong in the store.
 *
 * Task 10 — DnD wiring:
 *   - A single DndContext wraps the three-panel row so palette→canvas drags
 *     work across component boundaries.
 *   - PointerSensor with distance:8 activation + KeyboardSensor for a11y.
 *   - onDragStart: records active.id and drag source type ('palette'|'canvas').
 *   - onDragOver: tracks over.id for the insertion indicator in Canvas.
 *   - onDragEnd:
 *       palette source  → addField(fieldType, dropIndex)
 *       canvas source   → reorderFields(from, to) via arrayMove
 *   - DragOverlay renders a ghost card (opacity 0.8, scale 1.02) in a portal.
 *
 * Layout structure:
 *   <root: flex h-screen flex-col overflow-hidden>
 *     <TopBar />
 *     <DndContext>
 *       <row: flex flex-1 overflow-hidden>
 *         <FieldPalette />     ← Draggable sources
 *         <CanvasWithState />  ← SortableContext + SortableFieldCards
 *         <InspectorPanel />
 *       </row>
 *       <DragOverlay />
 *     </DndContext>
 *   </root>
 *
 * Requirements: 1.1–1.5, 3.6, 3.7, 4.9, 4.10, 6.1, 6.2, 6.8
 */

import * as React from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { TopBar } from './TopBar';
import { FieldPalette } from './FieldPalette';
import { CanvasWithState } from './Canvas';
import { InspectorPanel } from './InspectorPanel';
import { FieldCard, type PocField } from './FieldCard';
import { useFormBuilderStore } from '../../stores/form-builder-store';
import { useAutosave } from './hooks/useAutosave';
import { useUndoRedoKeys } from './hooks/useUndoRedoKeys';
import { usePublish } from './hooks/usePublish';

interface CanvasBuilderPageProps {
  /** Optional blob ID for loading an existing draft form. Wired in Wave 3. */
  formBlobId?: string;
}

export function CanvasBuilderPage({ formBlobId: _formBlobId }: CanvasBuilderPageProps) {
  // ── Zustand store selectors ─────────────────────────────────────────────
  const fields = useFormBuilderStore((s) => s.fields);
  const selectedFieldId = useFormBuilderStore((s) => s.selectedFieldId);
  const title = useFormBuilderStore((s) => s.title);
  const addField = useFormBuilderStore((s) => s.addField);
  const updateField = useFormBuilderStore((s) => s.updateField);
  const deleteField = useFormBuilderStore((s) => s.deleteField);
  const duplicateField = useFormBuilderStore((s) => s.duplicateField);
  const reorderFields = useFormBuilderStore((s) => s.reorderFields);
  const selectField = useFormBuilderStore((s) => s.selectField);
  const setTitle = useFormBuilderStore((s) => s.setTitle);
  const reset = useFormBuilderStore((s) => s.reset);
  const autosaveStatus = useFormBuilderStore((s) => s.autosaveStatus);
  const publishStatus = useFormBuilderStore((s) => s.publishStatus);

  // ── Hooks: autosave + undo/redo keyboard shortcuts ──────────────────────
  useAutosave();
  useUndoRedoKeys();

  const { publish } = usePublish();

  /** The currently selected PocField object, or null. */
  const selectedField = React.useMemo<PocField | null>(
    () => fields.find((f) => f.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );

  // ── Reset store on unmount to prevent stale state in subsequent sessions ─
  React.useEffect(() => () => reset(), [reset]);

  // ── DnD overlay / indicator state ───────────────────────────────────────
  /** ID of the currently dragged item (field.id for canvas, palette-{type} for palette) */
  const [activeId, setActiveId] = React.useState<string | null>(null);
  /** 'canvas' | 'palette' — which surface initiated the drag */
  const [activeDragSource, setActiveDragSource] = React.useState<'canvas' | 'palette' | null>(null);
  /** over.id tracked during drag for the insertion indicator in Canvas */
  const [overId, setOverId] = React.useState<string | null>(null);

  /** The actual PocField being dragged (null for palette drags) */
  const activeField = React.useMemo<PocField | null>(
    () => (activeDragSource === 'canvas' ? (fields.find((f) => f.id === activeId) ?? null) : null),
    [fields, activeId, activeDragSource],
  );

  // ── dnd-kit sensors ─────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ── DnD handlers ────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    setActiveId(String(active.id));
    setOverId(null);
    const src = active.data.current?.source;
    setActiveDragSource(src === 'palette' ? 'palette' : 'canvas');
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    setOverId(over ? String(over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    setActiveId(null);
    setOverId(null);
    setActiveDragSource(null);

    if (!over) return;

    const activeCurrent = active.data.current as Record<string, unknown> | undefined;

    if (activeCurrent?.source === 'palette') {
      // ── Palette → Canvas: insert new field at drop position ──────────
      const fieldType = activeCurrent.fieldType as string;
      const dropIndex = fields.findIndex((f) => f.id === over.id);
      // -1 means dropped onto empty canvas or non-field area → append
      const insertAt = dropIndex === -1 ? fields.length : dropIndex;
      addField(fieldType, insertAt);
    } else {
      // ── Canvas → Canvas: reorder via arrayMove ────────────────────────
      const fromIndex = fields.findIndex((f) => f.id === active.id);
      const toIndex = fields.findIndex((f) => f.id === over.id);
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        reorderFields(fromIndex, toIndex);
      }
    }
  }

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-bg-app"
      aria-label="Form builder"
    >
      {/* Top bar — full width, fixed h-14 */}
      <TopBar
        title={title}
        onTitleChange={setTitle}
        autosaveStatus={autosaveStatus}
        onPublish={publish}
        publishLoading={publishStatus === 'publishing'}
      />

      {/*
       * Single DndContext wrapping the three-panel row.
       * Placing it here (not at root) keeps the TopBar outside DnD scope,
       * which is correct — TopBar has no droppable areas.
       */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Three-panel row — fills remaining viewport height */}
        <div className="relative flex flex-1 overflow-hidden">
          {/*
           * FieldPalette — each field type item is a dnd-kit Draggable source
           * with data: { source: 'palette', fieldType }.
           * Clicking still fires addField (Wave 2 wiring preserved).
           */}
          <FieldPalette onAddField={(fieldType) => addField(fieldType)} />

          {/*
           * Canvas — SortableContext wraps the field list.
           * overId drives the insertion indicator (2px accent bar).
           */}
          <CanvasWithState
            fields={fields}
            selectedFieldId={selectedFieldId}
            overId={overId}
            title={title}
            onTitleChange={setTitle}
            onSelect={selectField}
            onLabelChange={(id: string, label: string) => updateField(id, { label })}
            onDuplicate={duplicateField}
            onDelete={deleteField}
            onRequiredToggle={(id: string) => {
              const field = fields.find((f: PocField) => f.id === id);
              if (field) updateField(id, { required: !field.required });
            }}
            onInsert={(atIndex: number) => addField('text', atIndex)}
          />

          {/*
           * InspectorPanel — right panel.
           * selectedField drives what controls are shown.
           * onUpdateField patches the field in local state → live card update.
           */}
          <InspectorPanel
            selectedField={selectedField}
            onUpdateField={updateField}
          />
        </div>

        {/* -------------------------------------------------------------- */}
        {/* DragOverlay — ghost rendered in a portal above all panels       */}
        {/*                                                                  */}
        {/* Canvas card drag:   real FieldCard at opacity-80 / scale-[1.02] */}
        {/* Palette item drag:  lightweight skeleton ghost                   */}
        {/* -------------------------------------------------------------- */}
        <DragOverlay dropAnimation={null}>
          {activeId !== null && activeDragSource === 'canvas' && activeField !== null ? (
            <div className="scale-[1.02] opacity-80">
              <FieldCard field={activeField} isSelected={false} />
            </div>
          ) : activeId !== null && activeDragSource === 'palette' ? (
            <PaletteDragGhost />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaletteDragGhost — lightweight skeleton shown when dragging from palette
// ---------------------------------------------------------------------------

function PaletteDragGhost() {
  return (
    <div
      className={[
        'pointer-events-none select-none',
        'rounded-xl border border-border-subtle bg-bg-surface px-5 py-4 shadow-md',
        'opacity-80 scale-[1.02]',
      ].join(' ')}
    >
      {/* Simulated label bar */}
      <div className="h-4 w-32 rounded bg-bg-muted" />
      {/* Simulated placeholder text */}
      <div className="mt-2 h-3 w-48 rounded bg-bg-muted opacity-50" />
    </div>
  );
}
