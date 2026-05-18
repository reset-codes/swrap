'use client';

/**
 * Canvas — the center scrollable panel of the Canvas_Builder.
 *
 * Exports:
 *   - `Canvas`          Presentational component (pure, no internal state).
 *   - `CanvasWithState` Thin wrapper that routes props from CanvasBuilderPage
 *                       into the presentational Canvas.
 *
 * Task 13 (Wave 3):
 *   - `useCanvasState` has been removed. All field state and mutations are
 *     now owned by `useFormBuilderStore` in `CanvasBuilderPage`.
 *   - Canvas title (`title` / `onTitleChange`) is passed as controlled props
 *     and wired to the store's `title` / `setTitle`.
 *
 * Task 18 (Wave 4):
 *   - Reads `theme` from `useFormBuilderStore` directly.
 *   - Applies `THEME_CONFIG[theme].canvas` to the root div.
 *   - Passes `THEME_CONFIG[theme].card` to each `SortableFieldCard` as `themeCardClass`.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 3.5, 10.2, 10.3, 10.4, 10.5
 */

import * as React from 'react';
import { AnimatePresence } from 'framer-motion';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableFieldCard } from './SortableFieldCard';
import type { PocField } from './FieldCard';
import { InsertHandle } from './InsertHandle';
import { useFormBuilderStore } from '../../stores/form-builder-store';
import { THEME_CONFIG } from './themes';
import { BannerEditor } from './BannerEditor';

// ---------------------------------------------------------------------------
// Canvas — presentational component
// ---------------------------------------------------------------------------

export interface CanvasProps {
  fields: PocField[];
  selectedFieldId: string | null;
  /**
   * The dnd-kit `over.id` during an active drag — passed down from
   * CanvasBuilderPage's `onDragOver` handler. Used to render the 2px
   * accent-colored insertion indicator bar at the hover position.
   */
  overId?: string | null;
  /** Controlled form title — wired to store `title`. */
  title?: string;
  /** Called when the inline title changes — wired to store `setTitle`. */
  onTitleChange?: (title: string) => void;
  onSelect: (id: string | null) => void;
  onLabelChange: (id: string, label: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRequiredToggle: (id: string) => void;
  /** Called when an InsertHandle is clicked; index is the insertion position. */
  onInsert: (atIndex: number) => void;
}

export function Canvas({
  fields,
  selectedFieldId,
  overId,
  title = '',
  onTitleChange,
  onSelect,
  onLabelChange,
  onDuplicate,
  onDelete,
  onRequiredToggle,
  onInsert,
}: CanvasProps) {
  // ── Theme — read directly from store; no prop drilling, no context ──────
  const theme = useFormBuilderStore((s) => s.theme);
  const themeConfig = THEME_CONFIG[theme];

  // ── Inline title editing — click to activate, blur/Enter to commit ──────
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  function commitTitle() {
    setIsEditingTitle(false);
  }

  function handleTitleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    onTitleChange?.(e.target.value);
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitTitle();
    if (e.key === 'Escape') setIsEditingTitle(false);
  }

  return (
    /*
     * Outer container:
     *   - h-full fills the grid column
     *   - overflow-y-auto for scrolling long forms
     *   - theme canvas class applied from THEME_CONFIG (task 18)
     *   - `group` enables group-hover: utilities on child InsertHandles
     */
    <div className={['group h-full overflow-y-auto', themeConfig.canvas].join(' ')}>
      {/* Centred content column */}
      <div className="mx-auto max-w-2xl px-4 py-6">

        {/* -------------------------------------------------------------- */}
        {/* BannerEditor — "Add cover" affordance / cover image (task 19)   */}
        {/* -------------------------------------------------------------- */}
        <BannerEditor />

        {/* -------------------------------------------------------------- */}
        {/* Inline title — click-to-edit                                     */}
        {/* -------------------------------------------------------------- */}
        <div className="mb-8">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={handleTitleInputChange}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
              placeholder="Form title"
              aria-label="Form title"
              className={[
                'w-full bg-transparent text-3xl font-bold text-text-primary',
                'placeholder:text-text-tertiary',
                'outline-none focus:outline-none',
                'border-none ring-0',
              ].join(' ')}
            />
          ) : (
            <button
              type="button"
              aria-label="Edit form title"
              onClick={() => setIsEditingTitle(true)}
              className={[
                'w-full cursor-text text-left text-3xl font-bold',
                'focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-border-focus focus-visible:ring-offset-2 rounded-sm',
                title ? 'text-text-primary' : 'text-text-tertiary',
              ].join(' ')}
            >
              {title || 'Form title'}
            </button>
          )}
        </div>

        {/* -------------------------------------------------------------- */}
        {/* Field list with InsertHandles + SortableContext                  */}
        {/* -------------------------------------------------------------- */}
        <SortableContext
          items={fields.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-3">
            {/* Top InsertHandle — inserts at index 0 */}
            <InsertHandle
              index={0}
              onInsert={onInsert}
              isDropTarget={overId === fields[0]?.id}
            />

            <AnimatePresence initial={false}>
              {fields.map((field, index) => (
                <React.Fragment key={field.id}>
                  <SortableFieldCard
                    field={field}
                    isSelected={selectedFieldId === field.id}
                    themeCardClass={themeConfig.card}
                    onSelect={() => onSelect(field.id)}
                    onDuplicate={() => onDuplicate(field.id)}
                    onDelete={() => onDelete(field.id)}
                    onRequiredToggle={() => onRequiredToggle(field.id)}
                    onLabelChange={(label) => onLabelChange(field.id, label)}
                  />

                  {/* InsertHandle after each card — inserts at index + 1.
                      isDropTarget: show accent bar when the drag is hovering
                      over this card's id (the drop position for insertion). */}
                  <InsertHandle
                    index={index + 1}
                    onInsert={onInsert}
                    isDropTarget={
                      overId === field.id ||
                      overId === fields[index + 1]?.id
                    }
                  />
                </React.Fragment>
              ))}
            </AnimatePresence>

            {/* Empty canvas hint — shown when all fields are deleted */}
            {fields.length === 0 && (
              <div className="py-16 text-center text-sm text-text-tertiary">
                <p>No fields yet.</p>
                <p className="mt-1">
                  Drag a field from the palette, click a field type, or use
                  the + handles above.
                </p>
              </div>
            )}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CanvasWithState — props accepted by CanvasBuilderPage
// ---------------------------------------------------------------------------

/**
 * CanvasWithState accepts the same callback-based API as `Canvas` but is
 * named explicitly so CanvasBuilderPage's import is self-documenting. It is a
 * thin re-export alias — the implementation is identical to `Canvas`. In Wave 3
 * this component will be the boundary where the Zustand store is connected.
 */
export type CanvasWithStateProps = CanvasProps;

export function CanvasWithState(props: CanvasWithStateProps) {
  return <Canvas {...props} />;
}
