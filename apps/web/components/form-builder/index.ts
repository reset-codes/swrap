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
