'use client';

/**
 * InsertHandle — insert-between affordance for the Canvas.
 *
 * Renders a horizontal rule with a centred "+" button. Visibility is
 * controlled by the parent Canvas's `group` class:
 *   opacity-0  → opacity-100 on parent group-hover
 *
 * Task 10 addition:
 *   `isDropTarget` — when a dnd-kit drag is passing over this position,
 *   replace the faint rule with a 2px accent-colored insertion indicator bar.
 *
 * On click: fires the optional `onInsert` callback.
 *
 * Requirements: 4.7, 4.8, 4.9, 4.10
 */

import * as React from 'react';

interface InsertHandleProps {
  /** Zero-based position index — used for the aria-label. */
  index: number;
  /** Called when the user clicks the insert button. No-op by default. */
  onInsert?: (index: number) => void;
  /**
   * When true, a 2px accent-colored bar is shown to indicate the drop
   * position as a dragged item passes over this gap.
   */
  isDropTarget?: boolean;
}

export function InsertHandle({ index, onInsert, isDropTarget = false }: InsertHandleProps) {
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onInsert?.(index);
  }

  return (
    <div
      className={[
        'flex items-center gap-2 py-0.5 transition-opacity duration-100',
        // Show always if it is a live drop target; otherwise fade in on canvas hover.
        isDropTarget ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
      ].join(' ')}
      aria-hidden="true"
    >
      {isDropTarget ? (
        /* ------------------------------------------------------------------ */
        /* Insertion indicator — 2px accent-colored horizontal bar             */
        /* Shown while a dragged item hovers over this gap position.           */
        /* ------------------------------------------------------------------ */
        <div className="h-0.5 w-full rounded-full bg-accent" />
      ) : (
        /* ------------------------------------------------------------------ */
        /* Normal state — left rule + + button + right rule                    */
        /* ------------------------------------------------------------------ */
        <>
          {/* Left rule */}
          <div className="h-px flex-1 bg-border-subtle" />

          {/* Insert button */}
          <button
            type="button"
            role="button"
            aria-label={`Insert field at position ${index + 1}`}
            onClick={handleClick}
            className={[
              'flex h-6 w-6 items-center justify-center rounded-full border',
              'border-border-subtle bg-bg-surface text-xs font-bold text-text-tertiary',
              'transition-all hover:border-accent hover:bg-accent hover:text-white',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2',
            ].join(' ')}
          >
            +
          </button>

          {/* Right rule */}
          <div className="h-px flex-1 bg-border-subtle" />
        </>
      )}
    </div>
  );
}
