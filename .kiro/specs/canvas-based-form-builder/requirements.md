# Requirements Document

## Introduction

This feature replaces the existing single-column `FormBuilderPage` with a premium canvas-based editor. The new builder adopts a three-panel layout (left field palette, center canvas, right inspector) inspired by Notion, Tally, Typeform, and Framer. It introduces a dedicated `useFormBuilderStore` Zustand store with undo/redo, debounced local draft autosave, five visual themes, banner/cover support, and three new field types (`url`, `star_rating`, `wallet_address`). The canvas replaces the existing route completely; the Walrus/Seal publish pipeline and all shared validators are preserved without modification.

---

## Glossary

- **Canvas_Builder**: The new three-panel form builder page that replaces `FormBuilderPage`.
- **Field_Palette**: The left sidebar panel listing available field types organized by category, with a search input.
- **Canvas**: The center panel where field cards are rendered, reordered via dnd-kit, and edited inline.
- **Inspector**: The right sidebar panel providing contextual field configuration via tabbed sections (Content, Validation, Privacy, Style).
- **Field_Card**: A card-style representation of a single form field rendered on the Canvas; replaces the former table-row `FieldRow` component.
- **Insert_Handle**: A `+` affordance that appears between Field_Cards and at the top and bottom of the Canvas when hovering, allowing field insertion at a specific position.
- **Top_Bar**: The horizontal bar spanning the full width above the Canvas_Builder panels, containing autosave status, preview, save draft, and publish actions.
- **Form_Builder_Store**: The dedicated Zustand store (`useFormBuilderStore`) that owns the complete builder UI state for the Canvas_Builder.
- **Draft**: An unpublished, locally autosaved version of the form stored exclusively in the Form_Builder_Store (Zustand). No Walrus write occurs for a draft.
- **Autosave**: Debounced background persistence of the current builder state to the Form_Builder_Store, triggered 1500 ms after the last state change.
- **Publish**: An explicit user-triggered action that serializes the current form schema and executes the Walrus write pipeline, updating the form's `walrus_blob_id`.
- **Undo_Stack**: An array of historical Form_Builder_Store snapshots maintained for undo operations, capped at 50 entries.
- **Redo_Stack**: An array of forward snapshots used to reapply undone changes, cleared whenever a new edit is made.
- **Theme**: A named visual preset applied to both the Canvas preview and the rendered Public_Form. Five presets: Minimal, Hacker, Soft_Gradient, Corporate, Dark.
- **Banner**: An optional cover image displayed at the top of the form above the title, similar to Notion page covers.
- **PocField**: The existing shared TypeScript interface (`packages/shared/src/validator.ts`) extended with the three new field types.
- **Extended_Field_Type**: One of the nine supported field types after extension: `text`, `textarea`, `email`, `number`, `select`, `checkbox`, `url`, `star_rating`, `wallet_address`.
- **Validator**: The Zod-based validation layer in `packages/shared/src/validator.ts`; extended but not replaced.
- **Local_Store**: The existing `useLocalStore` Zustand store in `apps/web/stores/local-store.ts`; unchanged by this feature.
- **Walrus_Pipeline**: The existing Walrus upload and PostgreSQL indexing flow; unchanged by this feature.
- **Inspector_Tab**: One of the four tabs in the Inspector panel: Content, Validation, Privacy, Style.

---

## Requirements

### Requirement 1: Three-Panel Canvas Layout

**User Story:** As an Admin, I want the form builder to open in a full-screen three-panel editor, so that I have a dedicated workspace that keeps field selection, canvas editing, and field configuration visually separated.

#### Acceptance Criteria

1. THE Canvas_Builder SHALL render a persistent left Field_Palette panel, a scrollable center Canvas panel, and a collapsible right Inspector panel as three distinct layout regions occupying the full viewport height minus the Top_Bar.
2. WHEN the viewport width is 1280px or wider, THE Canvas_Builder SHALL display all three panels simultaneously with the Field_Palette at 240px width, the Inspector at 320px width, and the Canvas occupying the remaining space.
3. WHEN the viewport width is between 768px and 1279px, THE Canvas_Builder SHALL collapse the Inspector into a slide-over drawer triggered by selecting a Field_Card, and the Field_Palette SHALL collapse into an icon-only rail.
4. THE Canvas_Builder SHALL replace the existing `FormBuilderPage` route at the same path; no additional route is created.
5. THE Canvas_Builder SHALL NOT render `AppShell`, `ContentFrame`, or `PageHeader` wrapper components; the Canvas_Builder is a self-contained full-viewport layout.

---

### Requirement 2: Top Bar

**User Story:** As an Admin, I want a persistent top bar above the editor that shows save status and provides publish controls, so that I always know whether my work is saved and can publish in one click.

#### Acceptance Criteria

1. THE Top_Bar SHALL display the draft form title as an editable inline text input at all times.
2. WHEN no unsaved changes exist, THE Top_Bar SHALL display an "All changes saved" autosave status indicator.
3. WHEN unsaved changes exist and the Autosave debounce is in progress, THE Top_Bar SHALL display a "Saving…" autosave status indicator.
4. WHEN Autosave completes, THE Top_Bar SHALL transition the autosave status indicator to "All changes saved" within 300 ms.
5. THE Top_Bar SHALL provide a "Preview" button that opens the current form in a preview mode without navigating away from the Canvas_Builder.
6. THE Top_Bar SHALL provide a "Save Draft" button that immediately persists the current Form_Builder_Store state to Zustand without triggering a Walrus write.
7. THE Top_Bar SHALL provide a "Publish" button that initiates the Walrus_Pipeline for the current form schema.
8. WHEN a Publish operation is in progress, THE Canvas_Builder SHALL disable the Publish button and display a loading indicator on it.
9. IF a Publish operation fails, THEN THE Canvas_Builder SHALL display an error toast with the failure reason and re-enable the Publish button.
10. WHEN a Publish operation succeeds, THE Top_Bar SHALL display a success toast and update the autosave status to reflect the published state.

---

### Requirement 3: Field Palette

**User Story:** As an Admin, I want a searchable field palette on the left side of the editor, so that I can quickly find and add any field type to my form.

#### Acceptance Criteria

1. THE Field_Palette SHALL display all Extended_Field_Types organized into the following categories: Text (text, textarea, email, url), Choice (select, checkbox), Rating (star_rating), Crypto (wallet_address).
2. THE Field_Palette SHALL include a search input at the top of the panel that filters the visible field types by matching the search term against field type names and category names, case-insensitively.
3. WHEN the search input is empty, THE Field_Palette SHALL display all categories with their full field type lists.
4. WHEN the search term matches no field types, THE Field_Palette SHALL display an empty state message within the palette.
5. WHEN an Admin clicks a field type in the Field_Palette, THE Canvas_Builder SHALL append a new Field_Card of that type to the end of the Canvas field list.
6. THE Field_Palette SHALL support drag-initiation so that an Admin may drag a field type from the palette and drop it at a specific position on the Canvas.
7. WHEN a drag from the Field_Palette is dropped onto the Canvas, THE Canvas_Builder SHALL insert a new Field_Card of the dragged type at the drop position.

---

### Requirement 4: Canvas Field Cards

**User Story:** As an Admin, I want form fields to appear as cards on the canvas with inline editing and hover controls, so that editing feels direct and immediate rather than form-row style.

#### Acceptance Criteria

1. THE Canvas SHALL render each field in the Form_Builder_Store field list as a Field_Card component with the field label, type badge, required indicator, and an optional placeholder preview.
2. WHEN an Admin clicks a Field_Card, THE Canvas_Builder SHALL set that field as the selected field in the Form_Builder_Store and open the Inspector panel for it.
3. THE Canvas SHALL visually distinguish the selected Field_Card from unselected ones using a highlight border matching the design token `color.border.focus`.
4. WHEN an Admin hovers over a Field_Card, THE Canvas_Builder SHALL reveal a drag handle, a duplicate action, and a delete action as hover controls without permanently occupying layout space.
5. WHEN the delete action is triggered on a Field_Card, THE Canvas_Builder SHALL remove that field from the Form_Builder_Store field list and push an Undo_Stack snapshot before the removal.
6. WHEN the duplicate action is triggered on a Field_Card, THE Canvas_Builder SHALL insert a copy of that field immediately below the original in the Form_Builder_Store field list.
7. THE Canvas SHALL render Insert_Handles between every adjacent pair of Field_Cards and at the top and bottom of the field list; Insert_Handles SHALL be visible only on Canvas hover.
8. WHEN an Admin clicks an Insert_Handle, THE Canvas_Builder SHALL insert a new field of the default type (`text`) at that position and immediately focus the label input in the Inspector.
9. THE Canvas SHALL support vertical reordering of Field_Cards via dnd-kit drag-and-drop using the `@dnd-kit/sortable` package.
10. WHEN a Field_Card is dropped at a new position, THE Canvas_Builder SHALL update the field order in the Form_Builder_Store and push an Undo_Stack snapshot.

---

### Requirement 5: Inspector Panel

**User Story:** As an Admin, I want a contextual right-side inspector that lets me configure the selected field through organized tabs, so that all configuration options are discoverable without cluttering the canvas.

#### Acceptance Criteria

1. WHEN no field is selected, THE Inspector SHALL display a placeholder state with a prompt to select a field.
2. WHEN a field is selected, THE Inspector SHALL display four tabs: Content, Validation, Privacy, and Style.
3. WHEN the Content tab is active, THE Inspector SHALL display: an editable label input, an optional placeholder text input, an optional help text input, and a required toggle.
4. WHEN the Validation tab is active and the selected field type is `text` or `textarea`, THE Inspector SHALL display min-length and max-length numeric inputs.
5. WHEN the Validation tab is active and the selected field type is `number`, THE Inspector SHALL display min-value and max-value numeric inputs.
6. WHEN the Validation tab is active and the selected field type is `select`, THE Inspector SHALL display a list editor for adding, editing, removing, and reordering option values.
7. WHEN the Validation tab is active and the selected field type is `star_rating`, THE Inspector SHALL display a max-stars selector with values between 3 and 10.
8. WHEN the Privacy tab is active, THE Inspector SHALL display an encryption toggle that, when enabled, marks the field for Seal encryption before Walrus storage.
9. WHEN the Style tab is active, THE Inspector SHALL display a width selector (full, half, third) that controls the rendered width of the field on the Public_Form.
10. WHEN an Admin changes any Inspector input, THE Canvas_Builder SHALL update the corresponding field in the Form_Builder_Store field list and schedule an Autosave.
11. THE Inspector SHALL animate open and closed using Framer Motion with a slide-from-right transition of 200 ms duration using the `motion.easing.standard` token.

---

### Requirement 6: Form Builder Store

**User Story:** As a developer, I want a dedicated Zustand store for the canvas builder, so that all editor state is predictable, undo/redo is reliable, and the existing local-store is not polluted.

#### Acceptance Criteria

1. THE Form_Builder_Store SHALL own exclusively: field list (`PocField[]` with Extended_Field_Types), selected field ID (`string | null`), active Inspector_Tab, active Theme, Undo_Stack, Redo_Stack, draft title (`string`), autosave status (`idle | saving | saved`), and publish status (`idle | publishing | published | error`).
2. THE Form_Builder_Store SHALL NOT duplicate or replace any state owned by the existing `useLocalStore`.
3. WHEN an edit action is dispatched that mutates the field list or title, THE Form_Builder_Store SHALL push the pre-edit snapshot onto the Undo_Stack before applying the change.
4. THE Form_Builder_Store SHALL cap the Undo_Stack at 50 entries; when the cap is exceeded, THE Form_Builder_Store SHALL discard the oldest entry.
5. WHEN a new edit action is dispatched, THE Form_Builder_Store SHALL clear the Redo_Stack.
6. WHEN the undo action is dispatched and the Undo_Stack is non-empty, THE Form_Builder_Store SHALL pop the top snapshot from the Undo_Stack, push the current state onto the Redo_Stack, and restore the popped snapshot.
7. WHEN the redo action is dispatched and the Redo_Stack is non-empty, THE Form_Builder_Store SHALL pop the top snapshot from the Redo_Stack, push the current state onto the Undo_Stack, and restore the popped snapshot.
8. WHEN the Canvas_Builder unmounts, THE Form_Builder_Store SHALL reset to its initial state to prevent stale draft data leaking into subsequent builder sessions.
9. THE Form_Builder_Store SHALL expose a `setAutosaveStatus` action used by the Autosave mechanism to update the autosave status field.

---

### Requirement 7: Draft Autosave

**User Story:** As an Admin, I want my work to be saved automatically as I edit, so that I never lose progress if I navigate away or the browser tab closes.

#### Acceptance Criteria

1. WHEN the Form_Builder_Store field list or draft title changes, THE Canvas_Builder SHALL schedule an Autosave debounce timer of 1500 ms.
2. WHEN the Autosave debounce timer fires, THE Canvas_Builder SHALL set the autosave status to `saving`, persist the current Form_Builder_Store draft state to Zustand in-memory state, and then set the autosave status to `saved`.
3. THE Autosave mechanism SHALL NOT initiate any network request, Walrus write, or API call.
4. WHEN a new change occurs before the Autosave debounce timer fires, THE Canvas_Builder SHALL reset the timer, preventing redundant saves.
5. WHEN the Canvas_Builder mounts and a previously autosaved draft exists in the Form_Builder_Store, THE Canvas_Builder SHALL restore the draft state without prompting the user.

---

### Requirement 8: Undo and Redo

**User Story:** As an Admin, I want keyboard-accessible undo and redo, so that I can confidently experiment with my form structure and reverse mistakes.

#### Acceptance Criteria

1. WHEN the Admin presses Cmd+Z (macOS) or Ctrl+Z (Windows/Linux) while the Canvas_Builder is focused, THE Canvas_Builder SHALL dispatch the undo action to the Form_Builder_Store.
2. WHEN the Admin presses Cmd+Shift+Z (macOS) or Ctrl+Y (Windows/Linux) while the Canvas_Builder is focused, THE Canvas_Builder SHALL dispatch the redo action to the Form_Builder_Store.
3. WHEN the Undo_Stack is empty, THE Canvas_Builder SHALL treat Cmd+Z / Ctrl+Z as a no-op without displaying an error.
4. WHEN the Redo_Stack is empty, THE Canvas_Builder SHALL treat Cmd+Shift+Z / Ctrl+Y as a no-op without displaying an error.

---

### Requirement 9: Extended Field Types

**User Story:** As an Admin, I want to add URL, star rating, and wallet address fields to my forms, so that I can collect Web3-specific and richer data from respondents.

#### Acceptance Criteria

1. THE Validator SHALL extend `FIELD_TYPES` in `packages/shared/src/validator.ts` to include `url`, `star_rating`, and `wallet_address` alongside the existing six types.
2. THE Validator SHALL extend the `PocFieldSchema` Zod schema to accept the three new field types with their respective configuration shapes without breaking validation of existing field types.
3. WHEN the field type is `url`, THE Validator SHALL validate that the field value is a well-formed URL string conforming to the WHATWG URL standard when the field is required or when a non-empty value is provided.
4. WHEN the field type is `star_rating`, THE PocField interface SHALL include a `maxStars` property of type `number` with a valid range of 3 to 10, defaulting to 5.
5. WHEN the field type is `wallet_address`, THE Validator SHALL validate that the field value matches the SUI address format: a 64-character hexadecimal string prefixed with `0x` when the field is required or when a non-empty value is provided.
6. THE `FormSchemaSchema` Zod schema SHALL accept forms containing any combination of the nine Extended_Field_Types and continue to enforce the existing 50-field and title-length constraints.

---

### Requirement 10: Form Themes

**User Story:** As an Admin, I want to choose from a set of visual themes for my form, so that the published form matches my brand or aesthetic without custom CSS.

#### Acceptance Criteria

1. THE Canvas_Builder SHALL provide five named Theme presets: `minimal`, `hacker`, `soft_gradient`, `corporate`, and `dark`.
2. WHEN an Admin selects a Theme, THE Form_Builder_Store SHALL update the active Theme and THE Canvas preview SHALL apply the corresponding visual treatment to the Field_Cards within 200 ms.
3. WHEN an Admin selects the `hacker` Theme, THE Canvas preview SHALL apply a dark background, monospace typography, and a green primary accent color.
4. WHEN an Admin selects the `soft_gradient` Theme, THE Canvas preview SHALL apply a pastel gradient background and rounded field cards.
5. WHEN an Admin selects the `dark` Theme, THE Canvas preview SHALL apply the dark-mode design tokens from `packages/shared/src/design-tokens.ts`.
6. THE active Theme SHALL be serialized as a property of the Form_Schema stored on Walrus during Publish, so that the Public_Form renderer applies the same theme at display time.
7. THE Theme selector SHALL be accessible from the Top_Bar or a dedicated canvas toolbar without opening the Inspector.

---

### Requirement 11: Banner / Cover Image

**User Story:** As an Admin, I want to optionally add a cover image to my form, so that it has a visual identity at the top before the title.

#### Acceptance Criteria

1. THE Canvas_Builder SHALL display an "Add cover" affordance above the form title area when no Banner is set.
2. WHEN an Admin activates the "Add cover" affordance, THE Canvas_Builder SHALL display an image URL input that accepts an HTTPS URL pointing to an image resource.
3. WHEN a valid HTTPS image URL is entered, THE Canvas_Builder SHALL render the Banner as a full-width image above the form title on the Canvas preview.
4. IF the provided URL does not resolve to a valid image or is not an HTTPS URL, THEN THE Canvas_Builder SHALL display an inline error beneath the URL input and not update the Banner.
5. WHEN a Banner is set, THE Canvas_Builder SHALL display a "Remove cover" affordance that clears the Banner URL from the Form_Builder_Store.
6. THE Banner URL SHALL be serialized as a property of the Form_Schema stored on Walrus during Publish.

---

### Requirement 12: Framer Motion Transitions

**User Story:** As an Admin, I want smooth, purposeful animations throughout the canvas editor, so that the tool feels premium and responsive without being distracting.

#### Acceptance Criteria

1. WHEN a Field_Card is added to the Canvas, THE Canvas_Builder SHALL animate the card in using a fade-and-slide-up entrance with 200 ms duration using the `motion.easing.standard` token from `packages/shared/src/design-tokens.ts`.
2. WHEN a Field_Card is removed from the Canvas, THE Canvas_Builder SHALL animate the card out using a fade-and-collapse exit with 140 ms duration using the `motion.easing.accel` token.
3. WHEN the Inspector panel opens, THE Canvas_Builder SHALL animate it sliding in from the right edge with 200 ms duration.
4. WHEN the Inspector panel closes, THE Canvas_Builder SHALL animate it sliding out to the right edge with 140 ms duration.
5. WHEN an Insert_Handle becomes visible, THE Canvas_Builder SHALL animate its appearance with a fade-in of 80 ms duration using the `motion.duration.instant` token.
6. ALL Framer Motion variants used in the Canvas_Builder SHALL reference duration and easing values exclusively from the `motion` token in `packages/shared/src/design-tokens.ts`; no inline numeric duration or easing values are permitted.

---

### Requirement 13: Publish to Walrus

**User Story:** As an Admin, I want to explicitly publish my form to Walrus with a single button click, so that drafting is free and Walrus write costs are only incurred on intentional publish actions.

#### Acceptance Criteria

1. WHEN an Admin clicks the Publish button and the form schema passes validation, THE Canvas_Builder SHALL serialize the Form_Builder_Store field list, title, active Theme, and Banner URL into a `FormSchema` object and invoke the existing Walrus_Pipeline.
2. WHEN the Publish operation is initiated, THE Form_Builder_Store SHALL set publish status to `publishing`.
3. WHEN the Walrus_Pipeline completes successfully, THE Form_Builder_Store SHALL set publish status to `published` and THE Local_Store SHALL be updated with the new `walrus_blob_id` via `upsertForm`.
4. IF the Walrus_Pipeline fails, THEN THE Form_Builder_Store SHALL set publish status to `error` and the Publish button SHALL be re-enabled.
5. THE Canvas_Builder SHALL NOT invoke the Walrus_Pipeline during Autosave or Save Draft operations.
6. WHEN the form schema fails client-side validation before the Publish operation, THE Canvas_Builder SHALL display field-level validation errors on the affected Field_Cards and SHALL NOT invoke the Walrus_Pipeline.

---

### Requirement 14: Accessibility

**User Story:** As an Admin with accessibility needs, I want the canvas builder to be fully keyboard navigable and screen-reader compatible, so that I can use the tool without relying on mouse interactions.

#### Acceptance Criteria

1. ALL interactive elements in the Canvas_Builder — Field_Cards, Inspector inputs, Field_Palette items, Top_Bar buttons, and Insert_Handles — SHALL have descriptive `aria-label` or visible text labels.
2. WHEN keyboard focus is on the Canvas, THE Canvas_Builder SHALL support Tab to cycle through Field_Cards and Enter to select the focused card.
3. THE Inspector panel SHALL support full keyboard navigation within its tabbed interface using standard ARIA tab panel patterns (`role="tablist"`, `role="tab"`, `role="tabpanel"`).
4. WHEN an Inspector tab is focused, THE Canvas_Builder SHALL support left and right arrow keys to navigate between tabs.
5. THE Canvas_Builder SHALL maintain a visible focus ring on all focused elements using the `focusRing` token from `packages/shared/src/design-tokens.ts`.
6. ALL Framer Motion animations in the Canvas_Builder SHALL respect the `prefers-reduced-motion` media query by disabling or reducing motion when the user preference is set.
