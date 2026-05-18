/**
 * Theme System — Canvas_Builder
 *
 * Five named visual presets applied as Tailwind class strings directly on
 * the Canvas root div and each FieldCard wrapper. No React Context, no CSS
 * variables — just direct class application from `THEME_CONFIG[theme]`.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import { color, typography } from '../../../../packages/shared/src/design-tokens';
import type { FormTheme } from '../../stores/form-builder-store';

// ---------------------------------------------------------------------------
// ThemeConfig interface
// ---------------------------------------------------------------------------

export interface ThemeConfig {
  /** Tailwind classes applied to the Canvas root `<div>`. */
  canvas: string;
  /** Tailwind classes applied to each FieldCard wrapper `<div>`. */
  card: string;
  /** Font-family value for the theme (informational; card class handles Tailwind font). */
  font: string;
  /** Accent color value used for interactive elements inside the canvas. */
  accent: string;
  /** Human-readable display name shown in the ThemeSelector. */
  label: string;
  /** 12px swatch color shown in the ThemeSelector. */
  swatchColor: string;
}

// ---------------------------------------------------------------------------
// THEME_CONFIG
// ---------------------------------------------------------------------------

export const THEME_CONFIG: Record<FormTheme, ThemeConfig> = {
  // ── Minimal — clean white, no frills ────────────────────────────────────
  minimal: {
    canvas: 'bg-white',
    card: 'bg-white border border-gray-200 shadow-sm',
    font: typography.family.sans,
    accent: color.accent.base,
    label: 'Minimal',
    swatchColor: '#ffffff',
  },

  // ── Hacker — dark terminal aesthetic, green accent, monospace ───────────
  hacker: {
    canvas: 'bg-gray-950',
    card: 'bg-gray-900 border border-green-800 font-mono',
    font: typography.family.mono,
    accent: 'hsl(142 76% 45%)', // green
    label: 'Hacker',
    swatchColor: '#030712', // gray-950
  },

  // ── Soft Gradient — pastel, rounded, airy ───────────────────────────────
  soft_gradient: {
    canvas: 'bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50',
    card: 'bg-white/80 backdrop-blur border border-purple-100 rounded-2xl',
    font: typography.family.sans,
    accent: 'hsl(270 60% 60%)',
    label: 'Soft Gradient',
    swatchColor: '#fdf4ff', // pink-50 representative
  },

  // ── Corporate — structured, sharp edges, slate palette ──────────────────
  corporate: {
    canvas: 'bg-slate-50',
    card: 'bg-white border border-slate-200 shadow-md rounded-none',
    font: typography.family.sans,
    accent: 'hsl(213 90% 38%)',
    label: 'Corporate',
    swatchColor: '#f8fafc', // slate-50
  },

  // ── Dark — full dark mode using static Tailwind classes ──────────────────
  // NOTE: must use static class strings — dynamic template literals with token
  // values are not safe with Tailwind JIT (purged in production builds).
  dark: {
    canvas: 'bg-gray-950',
    card: 'bg-gray-900 border border-gray-700',
    font: typography.family.sans,
    accent: color.accent.base,
    label: 'Dark',
    swatchColor: '#030712', // gray-950
  },
};

// ---------------------------------------------------------------------------
// Ordered list for ThemeSelector rendering (stable display order)
// ---------------------------------------------------------------------------

export const THEME_ORDER: FormTheme[] = [
  'minimal',
  'hacker',
  'soft_gradient',
  'corporate',
  'dark',
];
