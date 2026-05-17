'use client';

/**
 * FieldPalette — categorised field list with search.
 *
 * Responsive:
 *   xl (≥1920px): 240px (w-60) full sidebar with labels + search
 *   md (≥1280px): 40px (w-10) icon-only rail with tooltips
 *   <1280px:     hidden
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { useDraggable } from '@dnd-kit/core';
import {
  Type,
  AlignLeft,
  Mail,
  Link,
  ChevronDown,
  CheckSquare,
  Star,
  Wallet,
  Search,
  ChevronUp,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaletteCategory {
  name: string;
  types: string[];
}

interface FieldTypeMeta {
  label: string;
  icon: React.ElementType;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_TYPE_META: Record<string, FieldTypeMeta> = {
  text: { label: 'Short Text', icon: Type },
  textarea: { label: 'Long Text', icon: AlignLeft },
  email: { label: 'Email', icon: Mail },
  url: { label: 'URL', icon: Link },
  select: { label: 'Dropdown', icon: ChevronDown },
  checkbox: { label: 'Checkbox', icon: CheckSquare },
  star_rating: { label: 'Star Rating', icon: Star },
  wallet_address: { label: 'Wallet Address', icon: Wallet },
};

export const PALETTE_CATEGORIES: PaletteCategory[] = [
  { name: 'Text', types: ['text', 'textarea', 'email', 'url'] },
  { name: 'Choice', types: ['select', 'checkbox'] },
  { name: 'Rating', types: ['star_rating'] },
  { name: 'Crypto', types: ['wallet_address'] },
];

// ---------------------------------------------------------------------------
// Pure filtering function (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Filters palette categories by a search term.
 * A field type is included if its human-readable label OR its category name
 * contains the term (case-insensitive). Empty / blank term returns all.
 */
export function filterPaletteTypes(
  categories: PaletteCategory[],
  searchTerm: string,
): PaletteCategory[] {
  const term = searchTerm.toLowerCase().trim();
  if (!term) return categories;
  return categories
    .map((cat) => ({
      ...cat,
      types: cat.types.filter((t) => {
        const meta = FIELD_TYPE_META[t];
        const labelMatch = meta
          ? meta.label.toLowerCase().includes(term)
          : t.toLowerCase().includes(term);
        const categoryMatch = cat.name.toLowerCase().includes(term);
        return labelMatch || categoryMatch;
      }),
    }))
    .filter((cat) => cat.types.length > 0);
}

// ---------------------------------------------------------------------------
// DraggablePaletteItem — wraps a palette button as a dnd-kit Draggable source
// ---------------------------------------------------------------------------

interface DraggablePaletteItemProps {
  fieldType: string;
  children: React.ReactNode;
}

function DraggablePaletteItem({ fieldType, children }: DraggablePaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${fieldType}`,
    data: {
      source: 'palette',
      fieldType,
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.5 : undefined, touchAction: 'none' }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip wrapper (shown only in icon-rail mode)
// ---------------------------------------------------------------------------

function FieldTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            sideOffset={8}
            className="z-50 rounded-md bg-bg-surface border border-border-subtle px-2.5 py-1.5 text-xs text-text-primary shadow-elevation-md"
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-bg-surface" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FieldPaletteProps {
  /** Called when a field type is clicked. Defaults to no-op; wired to store in Wave 3. */
  onAddField?: (fieldType: string) => void;
}

// ---------------------------------------------------------------------------
// FieldPalette component
// ---------------------------------------------------------------------------

export function FieldPalette({ onAddField }: FieldPaletteProps) {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [collapsedCategories, setCollapsedCategories] = React.useState<
    Record<string, boolean>
  >({});

  const filteredCategories = filterPaletteTypes(PALETTE_CATEGORIES, searchTerm);
  const hasResults = filteredCategories.length > 0;

  function handleAddField(fieldType: string) {
    onAddField?.(fieldType);
  }

  function toggleCategory(categoryName: string) {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryName]: !prev[categoryName],
    }));
  }

  return (
    <aside
      className="hidden shrink-0 border-r border-border-subtle bg-bg-surface md:flex md:w-10 md:flex-col xl:w-60"
      aria-label="Field palette"
    >
      {/* ------------------------------------------------------------------ */}
      {/* Full sidebar — shown only at xl (≥1920px)                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="hidden xl:flex xl:flex-1 xl:flex-col xl:overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-2 px-4 pb-2 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Fields
          </p>
          {/* Search input */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search fields…"
              className="h-8 w-full rounded-md border border-border-subtle bg-bg-app pl-8 pr-3 text-xs text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 transition-colors duration-fast"
              aria-label="Search field types"
            />
          </div>
        </div>

        {/* Scrollable category list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {hasResults ? (
            filteredCategories.map((category) => {
              const isCollapsed = !!collapsedCategories[category.name];
              return (
                <div key={category.name} className="mt-1">
                  {/* Category header — collapsible */}
                  <button
                    type="button"
                    onClick={() => toggleCategory(category.name)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-muted transition-colors duration-fast"
                    aria-expanded={!isCollapsed}
                    aria-label={`${category.name} category`}
                  >
                    <span className="uppercase tracking-wide">{category.name}</span>
                    {isCollapsed ? (
                      <ChevronDown className="h-3 w-3 text-text-tertiary" aria-hidden="true" />
                    ) : (
                      <ChevronUp className="h-3 w-3 text-text-tertiary" aria-hidden="true" />
                    )}
                  </button>

                  {/* Field type items */}
                  {!isCollapsed && (
                    <div className="mt-0.5 flex flex-col">
                      {category.types.map((fieldType) => {
                        const meta = FIELD_TYPE_META[fieldType];
                        if (!meta) return null;
                        const Icon = meta.icon;
                        return (
                          <DraggablePaletteItem key={fieldType} fieldType={fieldType}>
                            <button
                              type="button"
                              onClick={() => handleAddField(fieldType)}
                              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs text-text-primary hover:bg-bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1"
                              aria-label={`Add ${meta.label} field`}
                            >
                              <Icon
                                className="h-3.5 w-3.5 shrink-0 text-text-secondary"
                                aria-hidden="true"
                              />
                              <span>{meta.label}</span>
                            </button>
                          </DraggablePaletteItem>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            /* Empty search state */
            <p className="px-3 pt-6 text-center text-xs text-text-tertiary">
              No fields match
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Icon-only rail — shown at md (1280–1919px), hidden at xl           */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-4 xl:hidden">
        {PALETTE_CATEGORIES.flatMap((category) =>
          category.types.map((fieldType) => {
            const meta = FIELD_TYPE_META[fieldType];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <DraggablePaletteItem key={fieldType} fieldType={fieldType}>
                <FieldTooltip label={meta.label}>
                  <button
                    type="button"
                    onClick={() => handleAddField(fieldType)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-bg-muted hover:text-text-primary transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1"
                    aria-label={`Add ${meta.label} field`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </FieldTooltip>
              </DraggablePaletteItem>
            );
          }),
        )}
      </div>
    </aside>
  );
}
