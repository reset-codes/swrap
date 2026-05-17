/**
 * FormBuilderPage — route component entry point.
 *
 * The canonical form builder implementation lives in:
 *   apps/web/components/form-builder/CanvasBuilderPage.tsx
 *
 * This file preserves the existing route path and export contract while
 * delegating to the new canvas-based builder.
 *
 * Requirements: 1.4 — Canvas_Builder replaces existing FormBuilderPage route
 * at the same path; no additional route is created.
 */

export { CanvasBuilderPage as FormBuilderPage } from '../components/form-builder';
