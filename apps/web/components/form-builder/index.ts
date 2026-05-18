/**
 * form-builder barrel export.
 *
 * Primary export: CanvasBuilderPage — the root three-panel canvas editor.
 * Sub-component exports are provided for testing and parallel task development.
 */

export { CanvasBuilderPage } from './CanvasBuilderPage';
export { TopBar } from './TopBar';
export { FieldPalette } from './FieldPalette';
export { Canvas, CanvasWithState } from './Canvas';
export { SortableFieldCard } from './SortableFieldCard';
export { InspectorPanel } from './InspectorPanel';
export { ThemeSelector } from './ThemeSelector';
export { BannerEditor, validateBannerUrl } from './BannerEditor';
export { THEME_CONFIG, THEME_ORDER } from './themes';
export type { ThemeConfig } from './themes';
export type { PocField } from './FieldCard';
export { FieldPickerModal } from './FieldPickerModal';
export { TemplatePickerModal } from './TemplatePickerModal';
export { getDefaultField, FIELD_REGISTRY, FIELD_CATEGORIES, FIELDS_BY_CATEGORY } from './fieldRegistry';
export type { FieldType, FieldRegistryEntry, FieldCategory } from './fieldRegistry';
export { FORM_TEMPLATES } from './templates';
export type { FormTemplate } from './templates';
