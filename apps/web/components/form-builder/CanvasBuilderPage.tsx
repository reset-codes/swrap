'use client';

/**
 * CanvasBuilderPage — three-panel canvas form builder.
 *
 * Layout: uses CSS grid (3 fixed columns) to prevent overlap between the
 * center canvas and right inspector panel:
 *   grid-template-columns: 280px minmax(700px, 1fr) 320px
 *
 * Changes from original:
 *   - Fixed 3-column grid layout (no absolute positioning, no overlap).
 *   - "+" InsertHandle opens FieldPickerModal instead of inserting a plain 'text' field.
 *   - FieldPalette item clicks also open the picker (optional) or add via registry.
 *   - Save Draft is wired to a real save flow (localStorage draft with debounce).
 *   - Autosave status shows 'saving' / 'saved' / 'error' states.
 *   - TemplatePickerModal shown on first load when no fields exist (optional prop).
 *
 * Requirements: Phase 1 Tasks 1, 2, 3, 6
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
import { FieldPickerModal } from './FieldPickerModal';
import { TemplatePickerModal } from './TemplatePickerModal';
import type { FormTemplate } from './templates';
import { useFormBuilderStore } from '../../stores/form-builder-store';
import { useDraftSessionStore } from '../../stores/draft-session-store';
import { useAutosave } from './hooks/useAutosave';
import { useUndoRedoKeys } from './hooks/useUndoRedoKeys';
import { usePublish } from './hooks/usePublish';
import { useSaveDraft } from './hooks/useSaveDraft';
import { ErrorBoundary } from '../ui/ErrorBoundary';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CanvasBuilderPageProps {
  /** DB form ID — when provided, loads the draft from the server on mount. */
  formBlobId?: string;
  /** DB form ID for loading an existing draft (from /dashboard/forms/new?draft=:id). */
  initialDraftFormId?: string;
  /** When true, show the template picker on first mount (used from New Form route). */
  showTemplatePicker?: boolean;
}

// ---------------------------------------------------------------------------
// CanvasBuilderPage
// ---------------------------------------------------------------------------

export function CanvasBuilderPage({
  formBlobId: _formBlobId,
  initialDraftFormId,
  showTemplatePicker = false,
}: CanvasBuilderPageProps) {
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
  const loadDraft = useFormBuilderStore((s) => s.loadDraft);
  const autosaveStatus = useFormBuilderStore((s) => s.autosaveStatus);
  const publishStatus = useFormBuilderStore((s) => s.publishStatus);
  const draftFormId = useFormBuilderStore((s) => s.draftFormId);
  const setDraftFormId = useFormBuilderStore((s) => s.setDraftFormId);

  // ── Draft session store (persisted — survives refresh + browser reopen) ─
  const lastDraftFormId = useDraftSessionStore((s) => s.lastDraftFormId);
  // Use a ref so the mount effect closure captures the value without needing it as a dep
  const lastDraftFormIdRef = React.useRef(lastDraftFormId);
  React.useEffect(() => { lastDraftFormIdRef.current = lastDraftFormId; }, [lastDraftFormId]);

  // ── Hooks ───────────────────────────────────────────────────────────────
  useAutosave();
  useUndoRedoKeys();
  const { publish } = usePublish();
  const { saveDraft } = useSaveDraft();

  // ── Derived state ───────────────────────────────────────────────────────
  const selectedField = React.useMemo<PocField | null>(
    () => fields.find((f) => f.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );

  // ── Template picker ─────────────────────────────────────────────────────
  const [showTemplateModal, setShowTemplateModal] = React.useState(
    showTemplatePicker && fields.length === 0,
  );

  function handleTemplateSelect(template: FormTemplate) {
    // Re-assign fresh IDs to avoid collisions if the template is loaded multiple times
    const freshFields: PocField[] = template.fields.map((f) => ({
      ...f,
      id: crypto.randomUUID(),
    }));
    loadDraft({
      fields: freshFields,
      title: template.id !== 'blank' ? template.title : '',
      theme: 'minimal',
      bannerUrl: null,
    });
  }

  // ── Field picker modal ──────────────────────────────────────────────────
  const [fieldPickerOpen, setFieldPickerOpen] = React.useState(false);
  const pendingInsertIndex = React.useRef<number | null>(null);

  function handleInsert(atIndex: number) {
    pendingInsertIndex.current = atIndex;
    setFieldPickerOpen(true);
  }

  function handleFieldPickerSelect(type: string) {
    const idx = pendingInsertIndex.current;
    if (idx !== null) {
      addField(type, idx);
    } else {
      addField(type);
    }
    pendingInsertIndex.current = null;
    setFieldPickerOpen(false);
  }

  function handleFieldPickerClose() {
    pendingInsertIndex.current = null;
    setFieldPickerOpen(false);
  }

  // Palette clicks still open the picker at the end
  function handlePaletteAdd(fieldType: string) {
    pendingInsertIndex.current = null; // append
    // For palette drags we add directly; for clicks open picker with pre-selected type
    // Here we open the picker so the user can confirm the field type
    addField(fieldType);
  }

  // ── Save Draft ──────────────────────────────────────────────────────────
  function handleSaveDraft() {
    saveDraft();
  }

  // ── Load draft on first mount ────────────────────────────────────────────
  React.useEffect(() => {
    // Priority 1: load from DB if initialDraftFormId provided (from ?draft= URL param)
    if (initialDraftFormId) {
      setDraftFormId(initialDraftFormId);
      // Fetch draft from API to restore fields
      fetch(`/api/forms/${initialDraftFormId}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data: { data?: { form?: { title?: string; draftSchema?: { fields?: PocField[]; title?: string } } } } | null) => {
          if (!data?.data?.form) return;
          const form = data.data.form;
          const draft = form.draftSchema;
          if (draft?.fields && draft.fields.length > 0) {
            // Normalize options: draftSchema may have options as string[] (canvas-native)
            // or as {id,label,value}[] (API format from older createFormDraft).
            // Builder needs string[].
            const normalizedFields: PocField[] = draft.fields.map((f) => {
              const rawOptions = (f as PocField & { options?: unknown }).options;
              let options: string[] | undefined;
              if (Array.isArray(rawOptions) && rawOptions.length > 0) {
                // Detect format: if first element is string, it's already string[]
                if (typeof rawOptions[0] === 'string') {
                  options = rawOptions as string[];
                } else {
                  // API format: [{id, label, value}] → extract label strings
                  options = (rawOptions as { label?: string }[]).map((o) => o.label ?? '').filter(Boolean);
                }
              }
              return { ...f, ...(options !== undefined ? { options } : {}) };
            });
            loadDraft({
              fields: normalizedFields,
              title: draft.title ?? form.title ?? '',
              theme: 'minimal',
              bannerUrl: null,
            });
          } else if (form.title) {
            loadDraft({ fields: [], title: form.title, theme: 'minimal', bannerUrl: null });
          }
        })
        .catch(() => {
          // API failed — fall back to localStorage
          loadFromLocalStorage();
        });
      return;
    }

    // Priority 2: restore from persisted draft session (lastDraftFormId in localStorage).
    // This fires when the user navigates to /dashboard/forms/new without a ?draft= param
    // but previously had a draft session (e.g. came back after closing the tab).
    if (lastDraftFormIdRef.current && !showTemplatePicker) {
      const savedId = lastDraftFormIdRef.current;
      setDraftFormId(savedId);
      // Update URL so a subsequent refresh also recovers correctly
      try {
        const url = new URL(window.location.href);
        if (!url.searchParams.get('draft')) {
          url.searchParams.set('draft', savedId);
          window.history.replaceState(null, '', url.toString());
        }
      } catch {
        // non-fatal
      }
      fetch(`/api/forms/${savedId}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data: { data?: { form?: { title?: string; draftSchema?: { fields?: PocField[]; title?: string } } } } | null) => {
          if (!data?.data?.form) {
            // Draft no longer exists in DB — fall back to localStorage
            loadFromLocalStorage();
            return;
          }
          const form = data.data.form;
          const draft = form.draftSchema;
          if (draft?.fields && draft.fields.length > 0) {
            const normalizedFields: PocField[] = draft.fields.map((f) => {
              const rawOptions = (f as PocField & { options?: unknown }).options;
              let options: string[] | undefined;
              if (Array.isArray(rawOptions) && rawOptions.length > 0) {
                if (typeof rawOptions[0] === 'string') {
                  options = rawOptions as string[];
                } else {
                  options = (rawOptions as { label?: string }[]).map((o) => o.label ?? '').filter(Boolean);
                }
              }
              return { ...f, ...(options !== undefined ? { options } : {}) };
            });
            loadDraft({
              fields: normalizedFields,
              title: draft.title ?? form.title ?? '',
              theme: 'minimal',
              bannerUrl: null,
            });
          } else if (form.title) {
            loadDraft({ fields: [], title: form.title, theme: 'minimal', bannerUrl: null });
          }
        })
        .catch(() => {
          // DB fetch failed — fall back to localStorage field data
          loadFromLocalStorage();
        });
      return;
    }

    if (showTemplatePicker && fields.length === 0) return; // let template picker handle it
    if (fields.length > 0) return; // already have content
    loadFromLocalStorage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('swrap-builder-draft@1');
      if (!raw) return;
      const storedDraft = JSON.parse(raw) as { fields: PocField[]; title: string };
      if (storedDraft.fields?.length > 0 || storedDraft.title) {
        loadDraft({
          fields: storedDraft.fields ?? [],
          title: storedDraft.title ?? '',
          theme: 'minimal',
          bannerUrl: null,
        });
      }
    } catch {
      // Corrupt draft — ignore
    }
  }

  // ── Reset store on unmount ───────────────────────────────────────────────
  React.useEffect(() => () => {
    reset();
  }, [reset]);

  // ── DnD state ───────────────────────────────────────────────────────────
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [activeDragSource, setActiveDragSource] = React.useState<'canvas' | 'palette' | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const activeField = React.useMemo<PocField | null>(
    () => (activeDragSource === 'canvas' ? (fields.find((f) => f.id === activeId) ?? null) : null),
    [fields, activeId, activeDragSource],
  );

  // ── dnd-kit sensors ─────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
      const fieldType = activeCurrent.fieldType as string;
      const dropIndex = fields.findIndex((f) => f.id === over.id);
      const insertAt = dropIndex === -1 ? fields.length : dropIndex;
      addField(fieldType, insertAt);
    } else {
      const fromIndex = fields.findIndex((f) => f.id === active.id);
      const toIndex = fields.findIndex((f) => f.id === over.id);
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        reorderFields(fromIndex, toIndex);
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-1 min-h-0 flex-col overflow-hidden bg-bg-app"
      aria-label="Form builder"
    >
      {/* Top bar */}
      <TopBar
        title={title}
        onTitleChange={setTitle}
        autosaveStatus={autosaveStatus}
        onSaveDraft={handleSaveDraft}
        onPublish={publish}
        publishLoading={publishStatus === 'publishing'}
        formBlobId={_formBlobId}
        draftFormId={draftFormId ?? undefined}
      />

      {/* Three-panel DnD context */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/*
         * Three-panel row using CSS grid:
         *   Left  = 260px  (FieldPalette)
         *   Center = flexible, min 500px (Canvas) — reduced min to avoid overflow
         *   Right = 300px  (InspectorPanel)
         *
         * At very small widths, the grid scrolls horizontally rather than clipping.
         * The outer div has overflow-hidden but the inner panels handle their own scroll.
         */}
        <div
          className="relative flex-1 min-h-0 overflow-auto grid"
          style={{
            gridTemplateColumns: '260px minmax(500px, 1fr) 300px',
            minWidth: '1060px', // total minimum: ensures no panel is crushed
          }}
        >
          {/* ── Left: Field Palette ─────────────────────────────────── */}
          <div className="min-h-0 overflow-hidden border-r border-border-subtle">
            <FieldPalette onAddField={handlePaletteAdd} />
          </div>

          {/* ── Center: Canvas ──────────────────────────────────────── */}
          <div className="min-h-0 overflow-hidden">
            <ErrorBoundary label="canvas">
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
                onInsert={handleInsert}
              />
            </ErrorBoundary>
          </div>

          {/* ── Right: Inspector Panel ──────────────────────────────── */}
          <div className="min-h-0 overflow-hidden border-l border-border-subtle">
            <InspectorPanel
              selectedField={selectedField}
              onUpdateField={updateField}
            />
          </div>
        </div>

        {/* DragOverlay */}
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

      {/* ── Field picker modal ─────────────────────────────────────── */}
      <FieldPickerModal
        open={fieldPickerOpen}
        onClose={handleFieldPickerClose}
        onSelect={handleFieldPickerSelect}
      />

      {/* ── Template picker modal (shown on new form) ──────────────── */}
      <TemplatePickerModal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onSelect={handleTemplateSelect}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaletteDragGhost
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
      <div className="h-4 w-32 rounded bg-bg-muted" />
      <div className="mt-2 h-3 w-48 rounded bg-bg-muted opacity-50" />
    </div>
  );
}
