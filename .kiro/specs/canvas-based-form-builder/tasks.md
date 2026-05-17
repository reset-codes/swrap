# Implementation Plan: Canvas-Based Form Builder

## Overview

Replace `FormBuilderPage` with a premium three-panel canvas editor optimised for a 24–48 hour sprint. **Execution is reordered to maximise visible product transformation first.** The visual shell, field cards, and interaction feel ship before any backend or validator work. Spacing and typography quality are treated as first-class concerns throughout every wave.

Key implementation rules:
- **No `contentEditable`** — use click-to-input inline editing everywhere (click text → replace with `<input>` → blur to save)
- **Themes stay lightweight** — simple Tailwind class swaps on the canvas root div, driven directly by store state. No context, no CSS variable system.
- **Spacing and typography first** — disproportionate attention on whitespace, card padding, font hierarchy, and hover states. This is where perceived quality comes from.

---

## Tasks

### WAVE 1 — Visual Shell (ship the transformation immediately)

- [x] 1. Build the three-panel layout shell and replace FormBuilderPage
  - Create `apps/web/components/form-builder/` directory with `index.ts` barrel export
  - Create `CanvasBuilderPage.tsx`: full-viewport `flex h-screen flex-col overflow-hidden` root; renders `TopBar` + a `flex flex-1 overflow-hidden` row with `FieldPalette`, `Canvas`, `InspectorPanel` as siblings
  - Do NOT import `AppShell`, `ContentFrame`, or `PageHeader` — this is a self-contained full-viewport layout
  - Replace `apps/web/pages/FormBuilderPage.tsx` in its entirety so it re-exports `CanvasBuilderPage as FormBuilderPage`
  - Responsive layout: `xl:` (≥1280px) → all three panels visible; `md:` (768–1279px) → palette collapses to 40px icon rail, inspector becomes slide-over drawer; `< 768px` → palette hidden, inspector bottom sheet
  - Apply generous spacing from the start: canvas has `px-8 md:px-16 xl:px-24` horizontal padding, `py-10` vertical breathing room
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Implement TopBar — static shell with correct visual design
  - Create `TopBar.tsx` with fixed `h-14` height, full-width sticky bar, subtle bottom border (`border-b border-border-subtle`)
  - Left: back navigation icon + editable form title `<input>` (plain text input, no chrome, large `text-lg font-medium` weight, placeholder "Untitled form")
  - Center: autosave status badge — three visual states: idle (hidden), saving ("Saving…" with pulse dot), saved ("All changes saved" with check icon); use soft `text-text-tertiary` color
  - Right: theme selector placeholder button, "Preview" link button (opens existing preview route in new tab), "Save Draft" ghost button, "Publish" solid primary button
  - For now, wire title input to local React state only (store wired in Wave 3)
  - TopBar must feel calm and premium — not toolbar-heavy. Generous horizontal padding, aligned baselines.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 3. Implement FieldPalette — categorised field list with search
  - Create `FieldPalette.tsx` with `w-60` fixed width at xl, `w-10` icon-only rail at md
  - Panel has `bg-bg-surface border-r border-border-subtle`, scrollable content area
  - Header: "Fields" label + search `<input>` with magnifier icon; input filters types case-insensitively against type name and category name
  - Categories rendered as collapsible sections (open by default): **Text** (Short Text, Long Text, Email, URL), **Choice** (Dropdown, Checkbox), **Rating** (Star Rating), **Crypto** (Wallet Address)
  - Each field type item: `lucide-react` icon + human-readable label + subtle hover state (`hover:bg-bg-hover rounded-md`); generous `py-2 px-3` padding
  - Empty search state: "No fields match" message in `text-text-tertiary`
  - On click: fires `addField(fieldType)` — wired to store in Wave 3; for now call a local no-op placeholder
  - At `< 1280px`: render 40px icon-only rail with tooltip on hover
  - `aria-label="Add {label} field"` on each item
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Implement InspectorPanel — vertical scroll panel shell
  - Create `InspectorPanel.tsx` with `w-80` fixed width at xl
  - Panel has `bg-bg-surface border-l border-border-subtle`, scrollable content with `px-4 py-6` padding
  - Empty state: centered icon + "Select a field to configure" in `text-text-tertiary text-sm`
  - When a field is selected (hard-code a mock selected field for now): render ONE scrollable vertical panel with stacked controls using `space-y-5` rhythm:
    1. **Label** — `<label>` + text `<input>` with `w-full` styling
    2. **Placeholder** — same pattern
    3. **Help text** — same pattern
    4. **Required** — label + Radix `Switch` toggle
    5. **Encryption** — label + Radix `Switch` toggle with lock icon
  - Each control group uses `<label className="text-xs font-medium text-text-secondary uppercase tracking-wide">` for section labels — this creates clear visual hierarchy
  - Framer Motion slide-in from right 200ms on open, slide-out 140ms on close; `useReducedMotion()` guard
  - Wire to real store state in Wave 3
  - _Requirements: 5.1, 5.2, 5.3, 5.8, 5.10, 5.11_

- [x] 5. Implement Canvas — layout, spacing, and static field cards
  - Create `Canvas.tsx`: `flex-1 overflow-y-auto bg-bg-app` container; center content with `max-w-2xl mx-auto px-4 py-10`
  - Render "Add cover" affordance above title (just the button for now — wired in Wave 4)
  - Inline title area: large `text-3xl font-bold` placeholder text "Form title" that becomes a plain `<input>` on click (click-to-edit pattern); bind to local state for now
  - Below title: a static list of 2–3 placeholder FieldCard stubs so the canvas looks populated immediately
  - Between each card and at top/bottom: `InsertHandle` stub (renders `+` button, visible on Canvas hover)
  - Apply `group` class to Canvas container so `group-hover:` utilities work on InsertHandles
  - Canvas must feel spacious: `gap-3` between cards, `py-10` top/bottom padding, no dense borders
  - _Requirements: 4.1, 4.7, 4.8_

- [x] 6. Implement FieldCard — visual design, spacing, hover controls
  - Create `FieldCard.tsx`: card with `bg-bg-surface rounded-xl border border-border-subtle shadow-sm px-5 py-4` — generous padding, soft shadow, not a table row
  - Card header row: field **label** (click-to-edit `<input>` inline — click label text → replace with input → blur to save; do NOT use `contentEditable`), **type badge** (small pill `text-xs px-2 py-0.5 rounded-full bg-bg-muted text-text-secondary`), **required asterisk** (red `*` when required)
  - Card body: muted placeholder preview text in `text-text-tertiary text-sm italic`
  - Selected state: `ring-2 ring-border-focus ring-offset-2`
  - Hover state (local `useState`): reveal right-side control strip — `GripVertical` drag handle, `Copy` duplicate icon, `Trash2` delete icon, required `*` toggle; all icon buttons `text-text-tertiary hover:text-text-primary transition-colors`
  - Hover controls appear/disappear with `opacity-0 group-hover:opacity-100 transition-opacity duration-150` — never occupy permanent space
  - Framer Motion `initial={{ opacity:0, y:8 }}` → `animate={{ opacity:1, y:0 }}` 200ms; `exit={{ opacity:0, y:-4 }}` 140ms; respect `useReducedMotion()`
  - `role="article"` with `aria-label={field.label || 'Unnamed field'}`, `tabIndex={0}`
  - For now use hardcoded mock field data; wire to store in Wave 2
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 12.1, 12.2_

- [x] 7. Implement InsertHandle — insert-between affordance
  - Create `InsertHandle.tsx`: `opacity-0 group-hover:opacity-100 transition-opacity duration-100` visibility
  - Renders a horizontal line with centered `+` circle button: `flex items-center gap-2` → `<div className="h-px flex-1 bg-border-subtle" />` + `<button>+</button>` + matching right line
  - Button: `w-6 h-6 rounded-full border border-border-subtle bg-bg-surface text-text-tertiary hover:bg-accent hover:text-white hover:border-accent transition-all text-xs font-bold`
  - `role="button"` with `aria-label="Insert field at position {index + 1}"`
  - On click: fire `addField('text', index)` — no-op stub for now; wired in Wave 2
  - _Requirements: 4.7, 4.8_

- [x] 8. Typography and spacing audit pass
  - Review every component built in tasks 1–7 for visual consistency
  - Ensure heading hierarchy: form title `text-3xl font-bold`, section labels `text-xs font-semibold uppercase tracking-wide text-text-secondary`, body `text-sm text-text-primary`, help/meta `text-xs text-text-tertiary`
  - Ensure consistent spacing rhythm: `space-y-3` within cards, `gap-3` between cards, `px-4 py-6` panel padding, `px-5 py-4` card internal padding
  - Remove any remaining cramped layouts, unnecessary borders, or visual noise from wrapper components that bled through
  - Verify the overall canvas feels calm, spacious, and premium — like Notion, not a dashboard
  - _Requirements: 1.1, 1.2_


### WAVE 2 — Core Canvas Experience (highest perceived-value layer)

- [x] 9. Wire FieldCard interactions with minimal local state
  - Replace mock field data in Canvas with a local `useState<PocField[]>` array (not the Zustand store yet — that comes in Wave 3)
  - Each FieldCard click sets a `selectedFieldId` local state; selected card gets `ring-2 ring-border-focus ring-offset-2`
  - Duplicate action: insert shallow copy of field with new UUID immediately after original
  - Delete action: filter field out of local array; animate exit via `AnimatePresence`
  - Required toggle: flip `field.required` in local state, re-render asterisk
  - Clicking an InsertHandle inserts a new `text` field at the correct index with a generated UUID; immediately set it as selected
  - Clicking a FieldPalette item appends a new field of that type to the end of the local array; set as selected
  - Inline label editing: click label text → swap to `<input type="text">` with current value → on blur/Enter save back to local state
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 3.5_

- [x] 10. Wire drag-and-drop with dnd-kit
  - Wrap `CanvasBuilderPage` content in a single `DndContext` with `PointerSensor` (activation constraint `distance: 8`) and `KeyboardSensor`
  - Wrap Canvas field list in `SortableContext` with `verticalListSortingStrategy`; make each `FieldCard` a `useSortable` item keyed by `field.id`
  - Wire `FieldPalette` field type items as dnd-kit `Draggable` sources with `data: { source: 'palette', fieldType }`
  - `onDragEnd` handler at root: if `active.data.current.source === 'palette'` → insert new field at drop position via `addField`; else → reorder via `arrayMove` on local state
  - Add `DragOverlay` with a lightweight ghost card that mirrors the dragged FieldCard appearance (opacity 0.8, slight scale 1.02)
  - Insertion indicator: highlight the gap between cards as the dragged item passes over using dnd-kit's `over` state — render a `2px` accent-colored horizontal bar
  - _Requirements: 4.9, 4.10, 3.6, 3.7_

- [x] 11. Wire InspectorPanel to selected field
  - When a field is selected in local state, pass it to `InspectorPanel` as a prop
  - Bind all Inspector controls to the selected field:
    - Label input → updates field label in local state (also syncs to the FieldCard inline display)
    - Placeholder input → updates `field.placeholder`
    - Help text input → updates `field.helpText`
    - Required toggle → flips `field.required`
    - Encryption toggle → flips `field.encrypted`
  - Add type-conditional Validation section (shown below required toggle, only for relevant types):
    - `text` / `textarea` → Min length + Max length number inputs
    - `number` → Min value + Max value number inputs
    - `select` → Option list editor: list of text inputs with add/remove per row
    - `star_rating` → Max stars select (3–10)
    - `url` → Static note: "URL format validated on submit"
    - `wallet_address` → Static note: "SUI wallet address validated on submit"
  - Inspector label changes must reflect immediately on the corresponding FieldCard (no save button)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_


### WAVE 3 — State + Autosave

- [x] 12. Create the Form Builder Zustand store
  - Create `apps/web/stores/form-builder-store.ts` (no `persist` middleware — in-memory only)
  - Define types: `FormBuilderSnapshot`, `AutosaveStatus` (`'idle' | 'saving' | 'saved'`), `PublishStatus` (`'idle' | 'publishing' | 'published' | 'error'`), `InspectorTab`
  - State shape: `fields: PocField[]`, `title: string`, `theme: FormTheme`, `bannerUrl: string | null`, `selectedFieldId: string | null`, `autosaveStatus`, `publishStatus`, `publishError: string | null`, `undoStack: FormBuilderSnapshot[]` (max 50), `redoStack: FormBuilderSnapshot[]`
  - Implement all actions: `addField(type, atIndex?)`, `updateField(id, patch)`, `deleteField(id)`, `duplicateField(id)`, `reorderFields(from, to)`, `setTitle`, `setTheme`, `setBannerUrl`, `selectField`, `setAutosaveStatus`, `setPublishStatus`, `undo`, `redo`, `reset`, `loadDraft`
  - Internal `takeSnapshot` + `pushUndo` helpers: every mutating action calls `pushUndo` before applying; undo stack capped at 50 (`[snapshot, ...prev].slice(0, 50)`); any new edit clears redo stack
  - `reset()` restores full initial state (called on CanvasBuilderPage unmount)
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [x] 13. Migrate Wave 2 local state to the Zustand store
  - Replace all `useState` arrays and selected field state in `CanvasBuilderPage`, `Canvas`, and `FieldCard` with selectors from `useFormBuilderStore`
  - Wire TopBar title `<input>` to store `title` via `setTitle`
  - Wire FieldPalette item clicks to store `addField`
  - Wire FieldCard duplicate/delete/required to store `duplicateField` / `deleteField` / `updateField`
  - Wire InsertHandle clicks to store `addField(type, index)`
  - Wire InspectorPanel controls to store `updateField`
  - `CanvasBuilderPage` calls `reset()` on unmount via `useEffect(() => () => reset(), [reset])`
  - _Requirements: 6.1, 6.2, 6.8_

- [x] 14. Implement autosave hook and undo/redo keyboard shortcuts
  - Create `hooks/useAutosave.ts`: `useEffect` subscribing to `fields` and `title`; on change call `setAutosaveStatus('saving')`, schedule `setTimeout(1500)`, on fire call `setAutosaveStatus('saved')`; cancel timer on re-change; no network calls, no localStorage writes
  - Create `hooks/useUndoRedoKeys.ts`: `window.addEventListener('keydown')`; `Ctrl/Cmd+Z` → `undo()`; `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` → `redo()`; `removeEventListener` on unmount
  - Mount both hooks inside `CanvasBuilderPage`
  - Wire TopBar autosave badge to `autosaveStatus` from store (idle → hidden, saving → "Saving…" with pulse, saved → "All changes saved")
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4_

- [x] 15. Checkpoint — verify full interactive loop works
  - Add a field from palette → appears on canvas with animation
  - Click field → inspector populates
  - Edit label in inspector → card label updates live
  - Drag to reorder → fields reorder smoothly
  - Hover between fields → insert handle appears; click → inserts text field
  - Autosave status cycles: idle → saving → saved
  - Cmd+Z undoes last action; Cmd+Shift+Z redoes
  - Run `vitest --run`; fix type errors; ask the user if questions arise


### WAVE 4 — Publish, Validation, Themes, and Banner

- [x] 16. Extend shared validator with new field types
  - In `packages/shared/src/validator.ts`: add `url`, `star_rating`, `wallet_address` to `FIELD_TYPES` const and `FieldType` union
  - Extend `PocField` interface: add `id: string`, `helpText?: string`, `maxStars?: number`, `encrypted?: boolean`
  - Extend `FormSchema` interface: add `theme?: FormTheme` and `bannerUrl?: string`; define `FormTheme` type
  - Update `PocFieldSchema` Zod schema: `id` as `z.string().uuid()`, `maxStars` as `z.number().int().min(3).max(10).optional()`
  - Update `FormSchemaSchema` to accept `theme` and `bannerUrl` optionals; leave all existing constraints intact
  - Create `packages/shared/src/field-validators.ts`: export `validateUrlAnswer` (WHATWG URL parse), `validateWalletAddressAnswer` (SUI regex `/^0x[0-9a-f]{64}$/`), `SUI_ADDRESS_REGEX`
  - Changes are purely additive — all existing six field types must continue to parse correctly
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 17. Implement usePublish hook and wire Publish button
  - Create `hooks/usePublish.ts`: read `fields`, `title`, `theme`, `bannerUrl`, `setPublishStatus` from `useFormBuilderStore`; read `upsertForm` from `useLocalStore`
  - Assemble `FormSchema` from store state; run `FormSchemaSchema.safeParse(schema)`; if invalid return early (no Walrus call)
  - Call `setPublishStatus('publishing')`; invoke `createForm({ formDefinition: schema, privacyMode: 'public' }, sessionToken)` from existing metadata-client
  - On success: call `upsertForm(blobRow)` then `setPublishStatus('published')`; show success toast
  - On failure: call `setPublishStatus('error', message)`; show error toast; Publish button re-enables automatically
  - Wire Publish button in TopBar to `usePublish().publish()`; disable + show spinner when `publishStatus === 'publishing'`
  - Do NOT call Walrus during autosave or Save Draft
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 2.7, 2.8, 2.9, 2.10_

- [x] 18. Implement five-theme system
  - Create `apps/web/components/form-builder/themes.ts`: `ThemeConfig` interface + `THEME_CONFIG` record for all five themes
    - `minimal`: `bg-white` canvas, `bg-white border border-gray-200 shadow-sm` card
    - `hacker`: `bg-gray-950` canvas, `bg-gray-900 border border-green-800 font-mono` card, green accent
    - `soft_gradient`: `bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50` canvas, `bg-white/80 backdrop-blur border border-purple-100 rounded-2xl` card
    - `corporate`: `bg-slate-50` canvas, `bg-white border border-slate-200 shadow-md rounded-none` card
    - `dark`: dark mode token classes canvas + card
  - Apply theme: read `theme` from store in `Canvas.tsx`, look up `THEME_CONFIG[theme]`, apply `.canvas` class to canvas root div and `.card` class to each `FieldCard` wrapper — no context, no abstraction
  - Create `ThemeSelector.tsx`: Radix `Popover` in TopBar; five button rows each with theme name + a `12px` color swatch circle; clicking calls `setTheme(theme)` and closes popover
  - Wire `ThemeSelector` into TopBar (replacing the placeholder from task 2)
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [x] 19. Implement BannerEditor
  - Create `BannerEditor.tsx`: when `bannerUrl === null` render "Add cover" button (`text-sm text-text-tertiary hover:text-text-primary`) above the form title area in Canvas
  - When activated: render an `<input type="url">` with placeholder `https://...`; validate on blur: reject if not starting with `https://` or if `new URL(url)` throws; show inline error beneath input
  - On valid URL: verify image loads via hidden `<img>` with `onLoad` / `onError`; on load success call `setBannerUrl(url)`; on error show "Couldn't load image" inline error
  - When banner is set: render `<img>` full-width with `h-48 object-cover rounded-xl mb-6`; show "Remove cover" text button overlaid on hover
  - Wire `BannerEditor` into `Canvas.tsx` above the inline title
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 20. Final checkpoint — end-to-end verification
  - Run `vitest --run` and `tsc --noEmit`
  - Verify: Publish flow works with mock pipeline; theme switching visually updates Canvas; banner accepts HTTPS only; validator changes are additive (existing field types still parse); Walrus/Seal pipeline routes untouched
  - Ask the user if questions arise

---

## Notes

- **No `contentEditable`** anywhere — click-to-edit uses a controlled `<input>` swap pattern throughout
- **Themes** are simple Tailwind class lookups from `THEME_CONFIG` — applied directly in Canvas and FieldCard via `theme` value from store; no React Context, no CSS variables
- **Spacing and typography** get dedicated attention in task 8 and are embedded into every component from task 1 onward — this is where demo quality comes from
- **Tests** — all PBT sub-tasks from the previous plan are omitted from the wave structure; add them back if time permits after Wave 4 ships
- `FormBuilderPage` route path is preserved — only the component body is replaced via re-export
- All existing `useLocalStore`, Walrus pipeline, and API routes are never modified
- Validator changes in task 16 are additive — backward compatibility guaranteed
- `PocField.id` (UUID) is new and required; generate with `crypto.randomUUID()` in `addField`

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "3", "4", "5", "6", "7"] },
    { "id": 1, "tasks": ["8"] },
    { "id": 2, "tasks": ["9", "10", "11"] },
    { "id": 3, "tasks": ["12"] },
    { "id": 4, "tasks": ["13", "14"] },
    { "id": 5, "tasks": ["15"] },
    { "id": 6, "tasks": ["16", "17", "18", "19"] },
    { "id": 7, "tasks": ["20"] }
  ]
}
```
