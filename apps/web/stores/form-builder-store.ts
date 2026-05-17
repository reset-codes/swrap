/**
 * Form_Builder_Store — Zustand (in-memory only, no persist middleware)
 *
 * Owns the complete Canvas_Builder editor state for a single builder session.
 * State is cleared on unmount via `reset()` to prevent stale draft data from
 * leaking into subsequent sessions.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 */

import { create } from 'zustand';
import type { PocField } from '../components/form-builder/FieldCard';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FormTheme =
  | 'minimal'
  | 'hacker'
  | 'soft_gradient'
  | 'corporate'
  | 'dark';

export type AutosaveStatus = 'idle' | 'saving' | 'saved';

export type PublishStatus = 'idle' | 'publishing' | 'published' | 'error';

export type InspectorTab = 'content' | 'validation' | 'privacy' | 'style';

/**
 * The subset of store state that is mutable and therefore snapshotted for
 * undo/redo. Editor-only UI state (selectedFieldId, autosaveStatus, etc.)
 * is deliberately excluded — undo only restores form content.
 */
export interface FormBuilderSnapshot {
  fields: PocField[];
  title: string;
  theme: FormTheme;
  bannerUrl: string | null;
}

// ---------------------------------------------------------------------------
// State + actions interface
// ---------------------------------------------------------------------------

export interface FormBuilderState {
  // --- Mutable form content (snapshotted for undo/redo) ---
  fields: PocField[];
  title: string;
  theme: FormTheme;
  bannerUrl: string | null;

  // --- Editor UI state (not snapshotted) ---
  selectedFieldId: string | null;
  autosaveStatus: AutosaveStatus;
  publishStatus: PublishStatus;
  publishError: string | null;

  // --- Undo / Redo stacks ---
  undoStack: FormBuilderSnapshot[]; // max 50 entries
  redoStack: FormBuilderSnapshot[];

  // --- Field mutation actions (all push undo snapshot before change) ---
  addField(type: string, atIndex?: number): void;
  updateField(id: string, patch: Partial<PocField>): void;
  deleteField(id: string): void;
  duplicateField(id: string): void;
  reorderFields(sourceIndex: number, destinationIndex: number): void;

  // --- Title / theme / banner mutations (push undo snapshot) ---
  setTitle(title: string): void;
  setTheme(theme: FormTheme): void;
  setBannerUrl(url: string | null): void;

  // --- Selection / UI actions ---
  selectField(id: string | null): void;

  // --- Autosave / Publish status ---
  setAutosaveStatus(status: AutosaveStatus): void;
  setPublishStatus(status: PublishStatus, error?: string): void;

  // --- Undo / Redo ---
  undo(): void;
  redo(): void;

  // --- Lifecycle ---
  reset(): void;
  loadDraft(snapshot: FormBuilderSnapshot): void;
}

// ---------------------------------------------------------------------------
// Initial state (used by reset() — defined once for DRY reuse)
// ---------------------------------------------------------------------------

const INITIAL_STATE: Pick<
  FormBuilderState,
  | 'fields'
  | 'title'
  | 'theme'
  | 'bannerUrl'
  | 'selectedFieldId'
  | 'autosaveStatus'
  | 'publishStatus'
  | 'publishError'
  | 'undoStack'
  | 'redoStack'
> = {
  fields: [],
  title: '',
  theme: 'minimal',
  bannerUrl: null,
  selectedFieldId: null,
  autosaveStatus: 'idle',
  publishStatus: 'idle',
  publishError: null,
  undoStack: [],
  redoStack: [],
};

// ---------------------------------------------------------------------------
// Internal snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Captures the current mutable-content slice of state into a snapshot.
 * Field objects are shallow-cloned to prevent mutation aliasing.
 */
function takeSnapshot(
  state: Pick<FormBuilderState, 'fields' | 'title' | 'theme' | 'bannerUrl'>,
): FormBuilderSnapshot {
  return {
    fields: state.fields.map((f) => ({ ...f })),
    title: state.title,
    theme: state.theme,
    bannerUrl: state.bannerUrl,
  };
}

/**
 * Returns the undo/redo stack update that should be applied BEFORE any
 * mutating action:
 *   - prepends the current snapshot to undoStack
 *   - caps undoStack at 50 entries (oldest discarded — R6.4)
 *   - clears redoStack (any new edit clears redo — R6.5)
 */
function pushUndo(
  state: Pick<
    FormBuilderState,
    'fields' | 'title' | 'theme' | 'bannerUrl' | 'undoStack'
  >,
): Pick<FormBuilderState, 'undoStack' | 'redoStack'> {
  const snapshot = takeSnapshot(state);
  const undoStack = [snapshot, ...state.undoStack].slice(0, 50);
  return { undoStack, redoStack: [] };
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useFormBuilderStore = create<FormBuilderState>()(
  (set, get) => ({
    ...INITIAL_STATE,

    // -----------------------------------------------------------------------
    // Field mutations
    // -----------------------------------------------------------------------

    addField(type: string, atIndex?: number) {
      const state = get();
      const undoRedo = pushUndo(state);

      const newField: PocField = {
        id: crypto.randomUUID(),
        type,
        label: '',
      };

      const fields = [...state.fields];
      if (atIndex !== undefined && atIndex >= 0 && atIndex <= fields.length) {
        fields.splice(atIndex, 0, newField);
      } else {
        fields.push(newField);
      }

      // Automatically select the newly added field so the inspector opens.
      set({ ...undoRedo, fields, selectedFieldId: newField.id });
    },

    updateField(id: string, patch: Partial<PocField>) {
      const state = get();
      const undoRedo = pushUndo(state);

      const fields = state.fields.map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      );

      set({ ...undoRedo, fields });
    },

    deleteField(id: string) {
      const state = get();
      const undoRedo = pushUndo(state);

      const fields = state.fields.filter((f) => f.id !== id);
      // Deselect if the deleted field was selected
      const selectedFieldId =
        state.selectedFieldId === id ? null : state.selectedFieldId;

      set({ ...undoRedo, fields, selectedFieldId });
    },

    duplicateField(id: string) {
      const state = get();
      const undoRedo = pushUndo(state);

      const sourceIndex = state.fields.findIndex((f) => f.id === id);
      if (sourceIndex === -1) return;

      const source = state.fields[sourceIndex];
      const duplicate: PocField = { ...source, id: crypto.randomUUID() };

      const fields = [...state.fields];
      fields.splice(sourceIndex + 1, 0, duplicate);

      set({ ...undoRedo, fields });
    },

    reorderFields(sourceIndex: number, destinationIndex: number) {
      const state = get();
      if (sourceIndex === destinationIndex) return;

      const undoRedo = pushUndo(state);

      const fields = [...state.fields];
      const [moved] = fields.splice(sourceIndex, 1);
      fields.splice(destinationIndex, 0, moved);

      set({ ...undoRedo, fields });
    },

    // -----------------------------------------------------------------------
    // Title / theme / banner mutations
    // -----------------------------------------------------------------------

    setTitle(title: string) {
      const state = get();
      const undoRedo = pushUndo(state);
      set({ ...undoRedo, title });
    },

    setTheme(theme: FormTheme) {
      const state = get();
      const undoRedo = pushUndo(state);
      set({ ...undoRedo, theme });
    },

    setBannerUrl(url: string | null) {
      const state = get();
      const undoRedo = pushUndo(state);
      set({ ...undoRedo, bannerUrl: url });
    },

    // -----------------------------------------------------------------------
    // Selection / UI actions (no undo snapshot needed)
    // -----------------------------------------------------------------------

    selectField(id: string | null) {
      set({ selectedFieldId: id });
    },

    // -----------------------------------------------------------------------
    // Autosave / Publish status (no undo snapshot needed)
    // -----------------------------------------------------------------------

    setAutosaveStatus(status: AutosaveStatus) {
      set({ autosaveStatus: status });
    },

    setPublishStatus(status: PublishStatus, error?: string) {
      set({
        publishStatus: status,
        publishError: error ?? null,
      });
    },

    // -----------------------------------------------------------------------
    // Undo — R6.6
    // -----------------------------------------------------------------------

    undo() {
      const { undoStack, redoStack } = get();
      if (undoStack.length === 0) return;

      const [top, ...rest] = undoStack;
      const current = takeSnapshot(get());

      set({
        // Restore snapshotted content
        fields: top.fields,
        title: top.title,
        theme: top.theme,
        bannerUrl: top.bannerUrl,
        // Update stacks
        undoStack: rest,
        redoStack: [current, ...redoStack],
      });
    },

    // -----------------------------------------------------------------------
    // Redo — R6.7
    // -----------------------------------------------------------------------

    redo() {
      const { undoStack, redoStack } = get();
      if (redoStack.length === 0) return;

      const [top, ...rest] = redoStack;
      const current = takeSnapshot(get());

      set({
        // Restore snapshotted content
        fields: top.fields,
        title: top.title,
        theme: top.theme,
        bannerUrl: top.bannerUrl,
        // Update stacks
        undoStack: [current, ...undoStack],
        redoStack: rest,
      });
    },

    // -----------------------------------------------------------------------
    // Lifecycle — R6.8
    // -----------------------------------------------------------------------

    /**
     * Fully restores the store to its initial state.
     * Called on CanvasBuilderPage unmount to prevent stale draft data
     * from leaking into subsequent builder sessions.
     */
    reset() {
      set({ ...INITIAL_STATE });
    },

    /**
     * Restores snapshot content (fields, title, theme, bannerUrl) without
     * pushing to the undo stack. Used when loading a saved draft.
     */
    loadDraft(snapshot: FormBuilderSnapshot) {
      set({
        fields: snapshot.fields.map((f) => ({ ...f })),
        title: snapshot.title,
        theme: snapshot.theme,
        bannerUrl: snapshot.bannerUrl,
      });
    },
  }),
);
