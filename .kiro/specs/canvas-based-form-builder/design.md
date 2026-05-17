# Design Document: Canvas-Based Form Builder

## Overview

The Canvas_Builder replaces `FormBuilderPage` with a three-panel, full-viewport editor. The design is centered around a new dedicated Zustand store (`useFormBuilderStore`), an extended shared validator, and a set of composable React components organized under `apps/web/components/form-builder/`. Framer Motion drives all transitions, dnd-kit handles drag-and-drop, and the existing Walrus_Pipeline is invoked unchanged on explicit Publish.

Stack: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Zustand v5, `@dnd-kit/core` + `@dnd-kit/sortable`, Framer Motion 11, Radix UI primitives, `lucide-react`.

---

## Architecture

### Layered Dependency Graph

```
[packages/shared/src/validator.ts]   ← extended (new field types, theme, banner)
        ↓
[apps/web/stores/form-builder-store.ts]   ← new Zustand store (no persist)
        ↓
[apps/web/components/form-builder/]   ← all Canvas_Builder components
        ↓
[apps/web/pages/FormBuilderPage.tsx]  ← replaced (re-exports CanvasBuilderPage)
```

`useLocalStore` is never imported by the store or the components directly — only the Publish hook calls `useLocalStore.getState().upsertForm(...)` after a successful Walrus write, matching the existing pattern in the old `FormBuilderPage`.

---

## Extended Shared Validator

**File:** `packages/shared/src/validator.ts`

The existing six field types are extended to nine. All existing Zod schemas remain valid; backward compatibility is preserved by making new fields additive (new literal variants in the union, new optional shape properties).

### Extended Field Types

```typescript
export const FIELD_TYPES = [
  'text', 'textarea', 'email', 'number', 'select', 'checkbox',
  'url', 'star_rating', 'wallet_address',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
```

### Extended PocField Interface

```typescript
export interface PocField {
  id: string;              // stable UUID, generated on field creation
  type: FieldType;
  label: string;           // 1–100 chars
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];      // 'select' only
  maxStars?: number;       // 'star_rating' only; 3–10, default 5
  encrypted?: boolean;     // Privacy: Seal encryption flag
  width?: 'full' | 'half' | 'third';  // Style: rendered width on public form
  validation?: {
    minLength?: number;    // 'text' | 'textarea'
    maxLength?: number;
    minValue?: number;     // 'number'
    maxValue?: number;
  };
}
```

The `id` field is new and critical for stable React keys, dnd-kit item identity, and undo/redo snapshot diffing.

### Extended FormSchema Interface

```typescript
export interface FormSchema {
  title: string;
  fields: PocField[];
  version: 1;
  created_at: string;
  theme?: FormTheme;       // serialized on Publish
  bannerUrl?: string;      // serialized on Publish
}

export type FormTheme =
  | 'minimal' | 'hacker' | 'soft_gradient' | 'corporate' | 'dark';
```

### Extended Zod Schemas

```typescript
// Validate SUI wallet address: 0x + 64 lowercase hex chars
const suiAddressRegex = /^0x[0-9a-f]{64}$/;

export const PocFieldSchema: z.ZodType<PocField> = z.object({
  id: z.string().uuid(),
  type: z.enum(FIELD_TYPES),
  label: z.string().min(1).max(100),
  required: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  helpText: z.string().max(500).optional(),
  options: z.array(z.string().min(1)).optional(),
  maxStars: z.number().int().min(3).max(10).optional(),
  encrypted: z.boolean().optional(),
  width: z.enum(['full', 'half', 'third']).optional(),
  validation: z.object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
  }).optional(),
});

export const FormSchemaSchema: z.ZodType<FormSchema> = z.object({
  title: z.string().min(1).max(200),
  fields: z.array(PocFieldSchema).max(50),
  version: z.literal(1),
  created_at: z.string().datetime(),
  theme: z.enum(['minimal','hacker','soft_gradient','corporate','dark']).optional(),
  bannerUrl: z.string().url().startsWith('https://').optional(),
});
```

**Field-level value validation** (url, wallet_address) lives in `packages/shared/src/field-validators.ts` — a separate module from the schema, because schema validation covers structure while value validation covers runtime answer correctness:

```typescript
// packages/shared/src/field-validators.ts
export function validateUrlAnswer(value: string): boolean {
  try { new URL(value); return true; } catch { return false; }
}

export const SUI_ADDRESS_REGEX = /^0x[0-9a-f]{64}$/;
export function validateWalletAddressAnswer(value: string): boolean {
  return SUI_ADDRESS_REGEX.test(value);
}
```

---

## Form Builder Store

**File:** `apps/web/stores/form-builder-store.ts`

A non-persisted (in-memory only) Zustand store. No `persist` middleware — state lives only for the lifetime of the builder session. On unmount, the page component calls `reset()`.

### State Shape

```typescript
// The snapshot stored in undo/redo stacks — only mutable data
export interface FormBuilderSnapshot {
  fields: PocField[];
  title: string;
  theme: FormTheme;
  bannerUrl: string | null;
}

export type AutosaveStatus = 'idle' | 'saving' | 'saved';
export type PublishStatus = 'idle' | 'publishing' | 'published' | 'error';
export type InspectorTab = 'content' | 'validation' | 'privacy' | 'style';

export interface FormBuilderState {
  // --- Mutable form content (snapshotted for undo/redo) ---
  fields: PocField[];
  title: string;
  theme: FormTheme;
  bannerUrl: string | null;

  // --- Editor UI state (not snapshotted) ---
  selectedFieldId: string | null;
  activeTab: InspectorTab;
  autosaveStatus: AutosaveStatus;
  publishStatus: PublishStatus;
  publishError: string | null;

  // --- Undo/Redo stacks ---
  undoStack: FormBuilderSnapshot[];  // max 50
  redoStack: FormBuilderSnapshot[];

  // --- Actions ---
  // Field mutations (all push undo snapshot before change)
  addField(type: FieldType, atIndex?: number): void;
  updateField(id: string, patch: Partial<PocField>): void;
  deleteField(id: string): void;
  duplicateField(id: string): void;
  reorderFields(sourceIndex: number, destinationIndex: number): void;

  // Title / theme / banner mutations (push undo snapshot)
  setTitle(title: string): void;
  setTheme(theme: FormTheme): void;
  setBannerUrl(url: string | null): void;

  // Selection / UI
  selectField(id: string | null): void;
  setActiveTab(tab: InspectorTab): void;

  // Autosave / Publish status
  setAutosaveStatus(status: AutosaveStatus): void;
  setPublishStatus(status: PublishStatus, error?: string): void;

  // Undo / Redo
  undo(): void;
  redo(): void;

  // Lifecycle
  reset(): void;
  loadDraft(snapshot: FormBuilderSnapshot): void;
}
```

### Snapshot Mechanics

```typescript
// Internal helper — NOT exported
function takeSnapshot(state: FormBuilderState): FormBuilderSnapshot {
  return {
    fields: state.fields.map(f => ({ ...f })),
    title: state.title,
    theme: state.theme,
    bannerUrl: state.bannerUrl,
  };
}

function pushUndo(state: FormBuilderState): Pick<FormBuilderState, 'undoStack' | 'redoStack'> {
  const snapshot = takeSnapshot(state);
  const undoStack = [snapshot, ...state.undoStack].slice(0, 50); // cap at 50
  return { undoStack, redoStack: [] }; // any new edit clears redo
}
```

Every mutating action (`addField`, `updateField`, `deleteField`, `duplicateField`, `reorderFields`, `setTitle`, `setTheme`, `setBannerUrl`) calls `pushUndo` before applying the change.

### Undo / Redo Implementation

```typescript
undo() {
  const { undoStack, redoStack } = get();
  if (undoStack.length === 0) return;
  const [top, ...rest] = undoStack;
  const current = takeSnapshot(get());
  set({
    ...top,
    undoStack: rest,
    redoStack: [current, ...redoStack],
  });
},

redo() {
  const { undoStack, redoStack } = get();
  if (redoStack.length === 0) return;
  const [top, ...rest] = redoStack;
  const current = takeSnapshot(get());
  set({
    ...top,
    undoStack: [current, ...undoStack],
    redoStack: rest,
  });
},
```

---

## Component Architecture

All Canvas_Builder-specific components live in a new folder:

```
apps/web/components/form-builder/
  index.ts                    ← barrel export
  CanvasBuilderPage.tsx       ← root component (replaces FormBuilderPage)
  TopBar.tsx
  FieldPalette.tsx
  Canvas.tsx
  FieldCard.tsx
  InsertHandle.tsx
  InspectorPanel.tsx
  InspectorTabs/
    ContentTab.tsx
    ValidationTab.tsx
    PrivacyTab.tsx
    StyleTab.tsx
  ThemeSelector.tsx
  BannerEditor.tsx
  PreviewModal.tsx
  hooks/
    useAutosave.ts
    useUndoRedoKeys.ts
    usePublish.ts
```

### CanvasBuilderPage

The root component. Renders the full-viewport three-panel layout directly (no `AppShell`, `ContentFrame`, or `PageHeader`). Owns the keyboard listener (delegates to `useUndoRedoKeys`) and mounts/unmounts the store reset via `useEffect`.

```typescript
// apps/web/components/form-builder/CanvasBuilderPage.tsx
'use client';

export function CanvasBuilderPage({ formBlobId }: { formBlobId?: string }) {
  const reset = useFormBuilderStore(s => s.reset);

  useEffect(() => {
    // Restore draft if one exists (formBlobId-keyed load logic in usePublish hook)
    return () => reset(); // cleanup on unmount
  }, [reset]);

  useAutosave();
  useUndoRedoKeys();

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-bg-app"
      aria-label="Form builder"
    >
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <FieldPalette />
        <Canvas />
        <InspectorPanel />
      </div>
    </div>
  );
}
```

**Route integration:** `apps/web/pages/FormBuilderPage.tsx` is replaced in its entirety — it simply re-exports `CanvasBuilderPage`:

```typescript
// apps/web/pages/FormBuilderPage.tsx  (full file replacement)
export { CanvasBuilderPage as FormBuilderPage } from '../components/form-builder';
```

### TopBar

```typescript
// Inputs: reads from useFormBuilderStore
// Width: 100vw, fixed height h-14
// Key elements:
//   - Inline title <input> (editable, value=title)
//   - Autosave status badge (idle='', saving='Saving…', saved='All changes saved')
//   - ThemeSelector (popover trigger)
//   - Preview button → opens PreviewModal
//   - Save Draft button → calls setAutosaveStatus('saved') synchronously
//   - Publish button → calls usePublish().publish()
```

### FieldPalette

Organized into category groups. Supports a local `searchTerm` state (React `useState` — not in the store, as it's ephemeral UI state). Each field type item is a dnd-kit `Draggable` source.

```typescript
const PALETTE_CATEGORIES: PaletteCategory[] = [
  { name: 'Text',   types: ['text', 'textarea', 'email', 'url'] },
  { name: 'Choice', types: ['select', 'checkbox'] },
  { name: 'Rating', types: ['star_rating'] },
  { name: 'Crypto', types: ['wallet_address'] },
];

// Filtering function (pure, testable):
export function filterPaletteTypes(
  categories: PaletteCategory[],
  searchTerm: string,
): PaletteCategory[] {
  const term = searchTerm.toLowerCase().trim();
  if (!term) return categories;
  return categories
    .map(cat => ({
      ...cat,
      types: cat.types.filter(
        t => t.includes(term) || cat.name.toLowerCase().includes(term),
      ),
    }))
    .filter(cat => cat.types.length > 0);
}
```

**Responsive collapse:** At `< 1280px`, the palette renders icon-only (40px rail). Icons are lucide-react icons mapped per field type.

### Canvas

Uses `@dnd-kit/sortable` (`SortableContext` with `verticalListSortingStrategy`). Also accepts drop events from FieldPalette drags (`DndContext` wraps both palette and canvas at `CanvasBuilderPage` level).

```typescript
// Canvas renders:
// 1. Optional BannerEditor (when bannerUrl set or on hover for "Add cover")
// 2. Inline title display (mirrors TopBar title)
// 3. InsertHandle (index 0)
// 4. For each field: <SortableFieldCard /> + <InsertHandle index={i+1} />
// 5. AnimatePresence wraps the field list for enter/exit animations
```

**Insert handles** are rendered as siblings of `FieldCard` components and are only visible (`opacity-0 → opacity-100`) when the Canvas receives a hover event (managed via CSS `group-hover:` or a parent hover state).

### FieldCard

Each `FieldCard` is a dnd-kit sortable item. Hover state is managed locally with React state (not the store).

```typescript
// Key visual states:
// isSelected: border color.border.focus (ring-2 ring-border-focus)
// isHovered: reveals drag handle (GripVertical icon), DuplicateButton, DeleteButton
// isDragging: opacity reduced, placeholder shown

// Framer Motion variant:
const fieldCardVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1, y: 0,
    transition: { duration: 0.2, ease: [0.2, 0, 0, 1] } // motion.easing.standard
  },
  exit: {
    opacity: 0, y: -4,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } // motion.easing.accel
  },
};
// All values sourced from motion token — no inline literals in final code.
```

### InspectorPanel

Framer Motion `motion.div` slides in from the right. At `>= 1280px`, it occupies a fixed 320px column. At `768–1279px`, it renders as a slide-over drawer (absolute positioned, z-50).

```typescript
const inspectorVariants: Variants = {
  hidden:  { x: '100%', opacity: 0 },
  visible: {
    x: 0, opacity: 1,
    transition: { duration: 0.2, ease: [0.2, 0, 0, 1] }
  },
  exit: {
    x: '100%', opacity: 0,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] }
  },
};
```

Uses Radix UI `Tabs` primitive internally (`role="tablist"`, `role="tab"`, `role="tabpanel"`) with left/right arrow key navigation already built into Radix.

#### Inspector Tabs Content

| Tab | Controls rendered |
|---|---|
| Content | label input, placeholder input, help text input, required toggle |
| Validation | type-conditional: minLength/maxLength (text/textarea), minValue/maxValue (number), option list editor (select), maxStars 3–10 (star_rating) |
| Privacy | encryption toggle (`encrypted: boolean`) |
| Style | width selector: full / half / third |

---

## Autosave Hook

**File:** `apps/web/components/form-builder/hooks/useAutosave.ts`

```typescript
export function useAutosave() {
  const fields = useFormBuilderStore(s => s.fields);
  const title = useFormBuilderStore(s => s.title);
  const setAutosaveStatus = useFormBuilderStore(s => s.setAutosaveStatus);

  useEffect(() => {
    setAutosaveStatus('saving');
    const timer = setTimeout(() => {
      // Pure in-memory — Zustand state IS the persisted state for drafts.
      // No localStorage write, no network call.
      setAutosaveStatus('saved');
    }, 1500);
    return () => clearTimeout(timer);
  }, [fields, title, setAutosaveStatus]);
}
```

The autosave status is purely cosmetic — the source of truth is the Zustand store's in-memory state, which persists across React renders but is cleared on page unload (intentional: Walrus is the durable store).

---

## Undo/Redo Keyboard Hook

**File:** `apps/web/components/form-builder/hooks/useUndoRedoKeys.ts`

```typescript
export function useUndoRedoKeys() {
  const undo = useFormBuilderStore(s => s.undo);
  const redo = useFormBuilderStore(s => s.redo);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);
}
```

---

## Publish Hook

**File:** `apps/web/components/form-builder/hooks/usePublish.ts`

Orchestrates the Walrus publish pipeline. The form builder store does not directly know about `useLocalStore` — that dependency is isolated here.

```typescript
export function usePublish() {
  const { fields, title, theme, bannerUrl, setPublishStatus } = useFormBuilderStore();
  const upsertForm = useLocalStore(s => s.upsertForm);

  async function publish() {
    // 1. Client-side validation
    const schema: FormSchema = {
      title,
      fields,
      version: 1,
      created_at: new Date().toISOString(),
      theme: theme ?? undefined,
      bannerUrl: bannerUrl ?? undefined,
    };

    const parseResult = FormSchemaSchema.safeParse(schema);
    if (!parseResult.success) {
      // Surface field-level errors — dispatch via store or local error state
      return;
    }

    setPublishStatus('publishing');
    try {
      const result = await createForm(
        { formDefinition: schema, privacyMode: 'public' },
        '', // session token wired via auth
      );
      if (!result.ok) {
        setPublishStatus('error', result.error.message);
        return;
      }
      const formRow = result.result;
      upsertForm({
        blobId: formRow.walrusBlobId,
        schemaHash: formRow.contentDigest,
        title,
        ownerAddress: formRow.ownerAddress,
        createdAt: formRow.createdAt,
      });
      setPublishStatus('published');
    } catch (err) {
      setPublishStatus('error', err instanceof Error ? err.message : 'Publish failed');
    }
  }

  return { publish };
}
```

---

## Theme System

**File:** `apps/web/components/form-builder/themes.ts`

Each theme maps to a set of CSS classes applied at the Canvas root, overriding design token defaults for the preview context only (does not affect the rest of the app).

```typescript
export const THEME_CONFIG: Record<FormTheme, ThemeConfig> = {
  minimal: {
    canvas: 'bg-white',
    card: 'bg-white border border-gray-200 shadow-sm',
    font: typography.family.sans,
    accent: color.accent.base,
  },
  hacker: {
    canvas: 'bg-gray-950',
    card: 'bg-gray-900 border border-green-800 font-mono',
    font: typography.family.mono,
    accent: 'hsl(142 76% 45%)', // green
  },
  soft_gradient: {
    canvas: 'bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50',
    card: 'bg-white/80 backdrop-blur border border-purple-100 rounded-xl',
    font: typography.family.sans,
    accent: 'hsl(270 60% 60%)',
  },
  corporate: {
    canvas: 'bg-slate-50',
    card: 'bg-white border border-slate-200 shadow-md rounded-none',
    font: typography.family.sans,
    accent: 'hsl(213 90% 38%)',
  },
  dark: {
    canvas: `bg-[${color.bg.appDark}]`,
    card: `bg-[${color.bg.surfaceDark}] border border-[${color.border.subtleDark}]`,
    font: typography.family.sans,
    accent: color.accent.baseDark,
  },
};
```

The `theme` property is passed via React context (`ThemeContext`) at the Canvas root so all nested components can read it without prop drilling.

---

## Banner / Cover Image

**File:** `apps/web/components/form-builder/BannerEditor.tsx`

The banner URL is validated client-side before updating the store:

```typescript
function validateBannerUrl(url: string): { valid: boolean; error?: string } {
  if (!url.startsWith('https://')) {
    return { valid: false, error: 'Banner URL must use HTTPS.' };
  }
  try { new URL(url); } catch {
    return { valid: false, error: 'Enter a valid URL.' };
  }
  return { valid: true };
}
```

Image load verification uses an `<img>` element with `onError` to detect invalid image URLs. The store is only updated on successful load.

---

## Drag and Drop Architecture

A single `DndContext` wraps both `FieldPalette` and `Canvas`. Two sensor sets are configured:

- `PointerSensor` (with activation constraint `distance: 8`) for mouse/touch
- `KeyboardSensor` for accessibility

**Two drag scenarios:**

1. **Palette → Canvas drop:** The draggable item carries `{ source: 'palette', fieldType: FieldType }`. The `onDragEnd` handler detects this and calls `addField(fieldType, dropIndex)`.

2. **Canvas ↔ Canvas sort:** Uses `@dnd-kit/sortable`'s `arrayMove` utility. The `onDragEnd` handler calls `reorderFields(sourceIndex, destinationIndex)`.

```typescript
function onDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (!over) return;

  if (active.data.current?.source === 'palette') {
    // Insert new field at drop position
    const dropIndex = getDropIndex(over, fields);
    addField(active.data.current.fieldType, dropIndex);
  } else {
    // Reorder existing field
    const from = fields.findIndex(f => f.id === active.id);
    const to = fields.findIndex(f => f.id === over.id);
    if (from !== to) reorderFields(from, to);
  }
}
```

---

## Responsive Layout

| Breakpoint | Field Palette | Canvas | Inspector |
|---|---|---|---|
| `>= 1280px` (xl) | 240px fixed sidebar | flex-1 | 320px fixed sidebar |
| `768–1279px` (md–lg) | 40px icon rail | flex-1 | Slide-over drawer (triggered by field selection) |
| `< 768px` (sm) | Hidden (bottom sheet trigger) | Full width | Bottom sheet |

Layout implementation uses Tailwind responsive prefixes on a flex container. The Inspector at medium breakpoints uses `AnimatePresence` + `motion.div` positioned absolutely.

---

## Accessibility Architecture

- All interactive elements carry `aria-label` or visible text.
- `FieldCard` uses `role="article"` with `aria-label={field.label || 'Unnamed field'}`.
- `FieldPalette` items use `role="button"` with `aria-label={`Add ${fieldType} field`}`.
- `InsertHandle` uses `role="button"` with `aria-label={`Insert field at position ${index + 1}`}`.
- Inspector tabs use Radix UI `Tabs` which implements `role="tablist"` / `role="tab"` / `role="tabpanel"` with arrow-key navigation built in.
- Focus rings: every interactive element applies the `focusRing` token via `focus-visible:outline-[${focusRing.outline}] focus-visible:outline-offset-[${focusRing.outlineOffset}]` — mapped in Tailwind config as `focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2`.
- `prefers-reduced-motion`: all Framer Motion `Variants` objects check `window.matchMedia('(prefers-reduced-motion: reduce)')` via a shared hook `useReducedMotion()` (from `framer-motion`). When active, duration values are set to 0.

---

## Error Handling

| Scenario | Handling |
|---|---|
| Publish API failure | `setPublishStatus('error', message)` → Toast (error) via existing `Toast` component |
| Publish validation failure | Field-level errors rendered on affected `FieldCard` components, no API call made |
| Invalid banner URL | Inline error beneath URL input, store not updated |
| Autosave (in-memory) | Cannot fail; autosave is a state transition only |
| dnd-kit keyboard DnD | Native Radix/dnd-kit announcements handle screen reader feedback |

---

## Data Flow Summary

```
User edits field label in Inspector
  → updateField(id, { label: '...' })
    → pushUndo(state) into undoStack
    → set new fields in store
    → useAutosave detects fields change
    → after 1500ms debounce: setAutosaveStatus('saved')

User presses Cmd+Z
  → useUndoRedoKeys fires undo()
    → pops undoStack, pushes to redoStack, restores snapshot

User clicks Publish
  → usePublish.publish()
    → FormSchemaSchema.safeParse(schema)
    → createForm(schema) → Walrus pipeline
    → on success: upsertForm(blobId) in useLocalStore
    → setPublishStatus('published')
```

---

## File Structure

```
packages/shared/src/
  validator.ts            ← extended (FIELD_TYPES, PocField, FormSchema, Zod schemas)
  field-validators.ts     ← new: validateUrlAnswer, validateWalletAddressAnswer

apps/web/
  stores/
    form-builder-store.ts ← new: useFormBuilderStore
  components/
    form-builder/
      index.ts
      CanvasBuilderPage.tsx
      TopBar.tsx
      FieldPalette.tsx
      Canvas.tsx
      FieldCard.tsx
      InsertHandle.tsx
      InspectorPanel.tsx
      InspectorTabs/
        ContentTab.tsx
        ValidationTab.tsx
        PrivacyTab.tsx
        StyleTab.tsx
      ThemeSelector.tsx
      BannerEditor.tsx
      PreviewModal.tsx
      themes.ts
      hooks/
        useAutosave.ts
        useUndoRedoKeys.ts
        usePublish.ts
  pages/
    FormBuilderPage.tsx   ← replaced (re-exports CanvasBuilderPage)
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: Field Palette Search Filter Completeness

*For any* search term applied to the palette, the set of visible field types is exactly those whose type name or category name contains the term (case-insensitively) — no more, no less.

**Validates: Requirements 3.2, 3.3, 3.4**

---

### Property 2: Palette Click Appends Correct Field Type

*For any* Extended_Field_Type clicked in the Field_Palette, the resulting field list contains exactly one more field than before, the new field appears at the last index, and its `type` matches the clicked type.

**Validates: Requirements 3.5**

---

### Property 3: Palette Drag-and-Drop Inserts at Correct Position

*For any* field list of length `n` and any drop index `i` in `[0, n]`, dragging a field type from the palette and dropping it at position `i` results in a field list of length `n + 1` where `fields[i].type` matches the dragged type and all other fields are unchanged in their relative order.

**Validates: Requirements 3.6, 3.7**

---

### Property 4: Field Card Rendering Invariant

*For any* valid `PocField`, rendering it as a `FieldCard` produces a DOM element containing the field's label text and a type badge identifying the field type.

**Validates: Requirements 4.1**

---

### Property 5: Field Selection Is Exclusive

*For any* field list and any field index `i`, clicking `fields[i]` results in `selectedFieldId === fields[i].id` and no other field is simultaneously selected.

**Validates: Requirements 4.2**

---

### Property 6: Delete Removes Field and Grows Undo Stack

*For any* field list of length `n > 0` and any field `f` in that list, after `deleteField(f.id)`: the field list has length `n - 1`, does not contain `f`, and `undoStack.length` has increased by exactly 1.

**Validates: Requirements 4.5, 6.3**

---

### Property 7: Duplicate Inserts Copy Immediately Below Original

*For any* field list and any field at index `i`, after `duplicateField(fields[i].id)`: the list has length `n + 1`, `fields[i].label === fields[i+1].label`, `fields[i].type === fields[i+1].type`, and `fields[i].id !== fields[i+1].id`.

**Validates: Requirements 4.6**

---

### Property 8: Insert Handle Creates Text Field at Correct Position

*For any* field list of length `n` and any insert index `i` in `[0, n]`, clicking the insert handle at position `i` results in a field list of length `n + 1` where `fields[i].type === 'text'` and all previously existing fields retain their relative order.

**Validates: Requirements 4.8**

---

### Property 9: Canvas Reorder Moves Field and Grows Undo Stack

*For any* field list and any valid source index `src` and destination index `dst` where `src !== dst`, after `reorderFields(src, dst)`: the field previously at `src` is now at `dst`, the list length is unchanged, and `undoStack.length` has increased by exactly 1.

**Validates: Requirements 4.9, 4.10, 6.3**

---

### Property 10: Inspector Renders All Four Tabs for Any Selected Field

*For any* valid `PocField`, rendering the `InspectorPanel` with that field selected produces exactly four tab triggers labelled "Content", "Validation", "Privacy", and "Style".

**Validates: Requirements 5.2**

---

### Property 11: Inspector Content Tab Renders All Four Controls

*For any* `PocField`, the Inspector Content tab renders a label input (with the field's current label as value), a placeholder input, a help text input, and a required toggle.

**Validates: Requirements 5.3**

---

### Property 12: Inspector Validation Tab Controls Are Type-Conditional

*For any* `PocField` with type `'text'` or `'textarea'`, the Validation tab renders `minLength` and `maxLength` inputs and no value-range inputs. *For any* field with type `'number'`, it renders `minValue` and `maxValue` inputs. *For any* field with type `'select'`, it renders an option list editor. *For any* field with type `'star_rating'`, it renders a maxStars selector. These conditions are mutually exclusive per type.

**Validates: Requirements 5.4, 5.5, 5.6, 5.7**

---

### Property 13: Inspector Privacy and Style Tabs Render for All Field Types

*For any* `PocField` of any Extended_Field_Type, the Privacy tab renders an encryption toggle and the Style tab renders a width selector with exactly the options `['full', 'half', 'third']`.

**Validates: Requirements 5.8, 5.9**

---

### Property 14: Undo / Redo Round Trip Restores State Exactly

*For any* sequence of edit operations applied to the store, calling `undo()` once immediately after any single edit restores the field list and title to their exact pre-edit values. *For any* state where `undo()` was just called, calling `redo()` restores the field list and title to the values they had immediately after the undone edit.

**Validates: Requirements 6.6, 6.7, 8.1, 8.2**

---

### Property 15: Undo Stack Is Capped at 50 Entries

*For any* sequence of `n` edit operations where `n > 50`, `undoStack.length === 50` holds at all times after the 50th operation, and the oldest entry is the one discarded.

**Validates: Requirements 6.4**

---

### Property 16: Any New Edit Clears the Redo Stack

*For any* store state where `redoStack.length > 0`, dispatching any mutating action (`addField`, `updateField`, `deleteField`, `duplicateField`, `reorderFields`, `setTitle`, `setTheme`, `setBannerUrl`) results in `redoStack.length === 0`.

**Validates: Requirements 6.5**

---

### Property 17: Autosave Status Lifecycle with No Network Side Effects

*For any* sequence of field or title changes, the autosave hook must: set status to `'saving'` when a change is detected, then set status to `'saved'` after the 1500 ms debounce fires — and must not initiate any network request, Walrus write, or API call during this process. Rapid successive changes reset the timer, producing only one `'saved'` transition after the last change.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

---

### Property 18: Extended Field Type Schema Validation Round Trip

*For any* valid `PocField` using any of the nine Extended_Field_Types (including the three new ones: `url`, `star_rating`, `wallet_address`) with well-formed properties, `PocFieldSchema.safeParse(field).success === true`.

**Validates: Requirements 9.1, 9.2**

---

### Property 19: URL Answer Validation Matches WHATWG URL Standard

*For any* non-empty string `s`, `validateUrlAnswer(s)` returns `true` if and only if `new URL(s)` does not throw (WHATWG URL standard parse succeeds).

**Validates: Requirements 9.3**

---

### Property 20: Star Rating maxStars Invariant

*For any* `star_rating` field in the store, `maxStars` must be an integer in the closed range `[3, 10]`. Any `addField` or `updateField` call that would set `maxStars` outside this range must be rejected or clamped.

**Validates: Requirements 9.4**

---

### Property 21: Wallet Address Validation Matches SUI Format

*For any* string `s`, `validateWalletAddressAnswer(s)` returns `true` if and only if `s` matches the regex `/^0x[0-9a-f]{64}$/`.

**Validates: Requirements 9.5**

---

### Property 22: FormSchema Accepts Any Valid Combination of Nine Field Types

*For any* `FormSchema` containing any combination of the nine Extended_Field_Types with field count `≤ 50`, title length `1–200`, valid `created_at` ISO datetime, and a valid optional `theme` and `bannerUrl`, `FormSchemaSchema.safeParse(schema).success === true`.

**Validates: Requirements 9.6, 13.1**

---

### Property 23: Publish Payload Serializes Active Theme and Banner

*For any* Form_Builder_Store state with active `theme` and `bannerUrl`, the `FormSchema` produced by `usePublish` contains `theme === activeTheme` and `bannerUrl === activeBannerUrl`.

**Validates: Requirements 10.6, 11.6, 13.1**

---

### Property 24: Banner URL Validation Accepts HTTPS Only

*For any* string `url`, the banner URL validation function returns `valid: true` if and only if `url.startsWith('https://')` and `new URL(url)` does not throw.

**Validates: Requirements 11.2, 11.4**

---

### Property 25: All Field Cards Carry Non-Empty Accessible Labels

*For any* `PocField` rendered as a `FieldCard`, the root interactive element of the card has a non-empty `aria-label` attribute.

**Validates: Requirements 14.1**

---

### Property 26: Framer Motion Variants Use Only Design Token Duration and Easing Values

*For any* Framer Motion `Variants` object used in the Canvas_Builder, all `duration` values are members of `Object.values(motion.duration)` (expressed as seconds parsed from the token ms strings) and all `ease` values are members of `Object.values(motion.easing)`. No inline numeric literals are permitted outside of this derivation.

**Validates: Requirements 12.6**

---

## Data Models

### FormBuilderSnapshot

```typescript
interface FormBuilderSnapshot {
  fields: PocField[];
  title: string;
  theme: FormTheme;
  bannerUrl: string | null;
}
```

Stored in `undoStack` and `redoStack`. Deep-copied on every push so mutations to the live store do not corrupt historical snapshots.

### PocField (Extended)

```typescript
interface PocField {
  id: string;                  // UUID v4 — stable identity for dnd-kit and React keys
  type: FieldType;             // one of 9 Extended_Field_Types
  label: string;               // 1–100 chars
  required?: boolean;
  placeholder?: string;        // up to 200 chars
  helpText?: string;           // up to 500 chars
  options?: string[];          // 'select' only — min 1 char each
  maxStars?: number;           // 'star_rating' only — integer 3–10, default 5
  encrypted?: boolean;         // Privacy: Seal encryption flag for Walrus write
  width?: 'full' | 'half' | 'third';  // Style: public form rendered width
  validation?: {
    minLength?: number;        // 'text' | 'textarea'
    maxLength?: number;
    minValue?: number;         // 'number'
    maxValue?: number;
  };
}
```

### FormSchema (Extended)

```typescript
interface FormSchema {
  title: string;          // 1–200 chars
  fields: PocField[];     // max 50
  version: 1;
  created_at: string;     // ISO 8601 UTC
  theme?: FormTheme;      // serialized on Publish; applied by Public_Form renderer
  bannerUrl?: string;     // HTTPS URL; serialized on Publish
}

type FormTheme = 'minimal' | 'hacker' | 'soft_gradient' | 'corporate' | 'dark';
```

### FormBuilderState (Zustand store)

```typescript
interface FormBuilderState extends FormBuilderSnapshot {
  // UI state (not snapshotted)
  selectedFieldId: string | null;
  activeTab: 'content' | 'validation' | 'privacy' | 'style';
  autosaveStatus: 'idle' | 'saving' | 'saved';
  publishStatus: 'idle' | 'publishing' | 'published' | 'error';
  publishError: string | null;
  undoStack: FormBuilderSnapshot[];
  redoStack: FormBuilderSnapshot[];
  // Actions (see Form Builder Store section above)
}
```

### PaletteCategory

```typescript
interface PaletteCategory {
  name: string;            // Display name, e.g. "Text", "Crypto"
  types: FieldType[];      // Ordered list of field types in this category
}
```

### ThemeConfig

```typescript
interface ThemeConfig {
  canvas: string;    // Tailwind class(es) for the canvas root background
  card: string;      // Tailwind class(es) for FieldCard styling
  font: string;      // CSS font-family value from design token
  accent: string;    // CSS color string for primary accent
}
```

---

## Components and Interfaces

### CanvasBuilderPage

```typescript
interface CanvasBuilderPageProps {
  formBlobId?: string;  // When editing an existing form; undefined for new forms
}

function CanvasBuilderPage(props: CanvasBuilderPageProps): JSX.Element
```

Full-viewport root component. Renders `TopBar`, `FieldPalette`, `Canvas`, `InspectorPanel` in a flex layout. Mounts `useAutosave`, `useUndoRedoKeys`. Calls `reset()` on unmount.

### TopBar

```typescript
// No props — reads all state from useFormBuilderStore
function TopBar(): JSX.Element
```

Renders: inline title input, autosave status text, `ThemeSelector`, Preview button, Save Draft button, Publish button (with loading/disabled state).

### FieldPalette

```typescript
// No props — reads field types from PALETTE_CATEGORIES constant
function FieldPalette(): JSX.Element

// Pure helper (exported for testing)
function filterPaletteTypes(
  categories: PaletteCategory[],
  searchTerm: string,
): PaletteCategory[]
```

### Canvas

```typescript
// No props — reads fields from useFormBuilderStore
function Canvas(): JSX.Element
```

Wraps field list in `SortableContext`. Renders `BannerEditor`, inline title mirror, `AnimatePresence`-wrapped `FieldCard` list with interleaved `InsertHandle` components.

### FieldCard

```typescript
interface FieldCardProps {
  field: PocField;
  index: number;
  isSelected: boolean;
}

function FieldCard(props: FieldCardProps): JSX.Element
```

Sortable dnd-kit item. Manages local hover state. Renders label, type badge, required indicator. On hover: drag handle, duplicate button, delete button.

### InsertHandle

```typescript
interface InsertHandleProps {
  index: number;   // Position in the field list where a new field would be inserted
}

function InsertHandle(props: InsertHandleProps): JSX.Element
```

Visible only during Canvas hover (CSS group-hover). Calls `addField('text', index)` on click.

### InspectorPanel

```typescript
// No props — reads selectedFieldId from useFormBuilderStore
function InspectorPanel(): JSX.Element
```

`AnimatePresence` + `motion.div` for slide-in/out. Contains Radix `Tabs` with `ContentTab`, `ValidationTab`, `PrivacyTab`, `StyleTab`.

### ContentTab

```typescript
interface ContentTabProps {
  field: PocField;
  onChange: (patch: Partial<PocField>) => void;
}

function ContentTab(props: ContentTabProps): JSX.Element
```

### ValidationTab

```typescript
interface ValidationTabProps {
  field: PocField;
  onChange: (patch: Partial<PocField>) => void;
}

function ValidationTab(props: ValidationTabProps): JSX.Element
```

Renders type-conditional controls based on `field.type`.

### PrivacyTab / StyleTab

```typescript
// Same Props shape as ValidationTab — field + onChange
```

### ThemeSelector

```typescript
// No props — reads/writes theme from useFormBuilderStore
function ThemeSelector(): JSX.Element
```

Popover (Radix `Popover`) with five theme buttons. Each shows theme name and a color swatch.

### BannerEditor

```typescript
// No props — reads/writes bannerUrl from useFormBuilderStore
function BannerEditor(): JSX.Element
```

Shows "Add cover" when no banner set. Shows banner image + "Remove cover" when set. Inline URL input with HTTPS validation and image load verification.

### PreviewModal

```typescript
// No props — reads all form state from useFormBuilderStore
function PreviewModal(): JSX.Element
```

Full-screen modal rendering the current form using the existing public form renderer with the active theme applied.

### useAutosave

```typescript
function useAutosave(): void
// Side effects: schedules 1500ms debounced setAutosaveStatus transitions
// Dependencies: fields, title
```

### useUndoRedoKeys

```typescript
function useUndoRedoKeys(): void
// Side effects: registers/unregisters window keydown listener
```

### usePublish

```typescript
function usePublish(): {
  publish: () => Promise<void>;
}
```

### filterPaletteTypes (exported pure function)

```typescript
function filterPaletteTypes(
  categories: PaletteCategory[],
  searchTerm: string,
): PaletteCategory[]
```

### validateBannerUrl (exported pure function)

```typescript
function validateBannerUrl(url: string): { valid: boolean; error?: string }
```

### validateUrlAnswer / validateWalletAddressAnswer (packages/shared)

```typescript
function validateUrlAnswer(value: string): boolean
function validateWalletAddressAnswer(value: string): boolean
const SUI_ADDRESS_REGEX: RegExp
```

---

## Testing Strategy

### Unit / Property Tests

Each correctness property maps to a vitest test (with `fast-check` for property-based tests). Tests are co-located in the component/store directories:

- `apps/web/stores/form-builder-store.pbt.test.ts` — Properties 6, 7, 8, 9, 14, 15, 16
- `apps/web/components/form-builder/FieldPalette.pbt.test.ts` — Properties 1, 2, 3
- `apps/web/components/form-builder/FieldCard.pbt.test.ts` — Properties 4, 5, 25
- `apps/web/components/form-builder/InspectorPanel.pbt.test.ts` — Properties 10, 11, 12, 13
- `apps/web/components/form-builder/hooks/useAutosave.pbt.test.ts` — Property 17
- `packages/shared/src/validator.pbt.test.ts` — Properties 18, 19, 20, 21, 22
- `apps/web/components/form-builder/hooks/usePublish.pbt.test.ts` — Properties 23, 24
- `apps/web/components/form-builder/themes.test.ts` — Property 26 (variant token verification)

**Property test configuration:** Minimum 100 runs per property via `fast-check` `fc.assert(fc.property(...), { numRuns: 100 })`.

### Example / Integration Tests

- `CanvasBuilderPage.test.tsx` — three-panel layout, responsive breakpoints, AppShell/ContentFrame/PageHeader absent, keyboard shortcuts (8.1–8.4)
- `TopBar.test.tsx` — autosave status text, publish button states
- `InspectorPanel.test.tsx` — empty state, tab ARIA roles
- `usePublish.integration.test.ts` — mock Walrus pipeline, verify `upsertForm` called on success, error toast on failure
- `form-builder-store.test.ts` — store reset on unmount, initial state shape, `setAutosaveStatus` callable

### Accessibility Tests

`@axe-core/react` (or `jest-axe`) is used in `CanvasBuilderPage.test.tsx` to run automated ARIA compliance checks. Full WCAG validation requires manual testing with a screen reader.
