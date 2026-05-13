// packages/shared/src/design-tokens.ts
// Single source of truth for visual tokens. DO NOT hard-code any of these
// values elsewhere. If you need a value not listed here, add it here first.

export const spacing = {
  0: '0',
  px: '1px',
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;
export type Spacing = keyof typeof spacing;

export const radius = {
  none: '0',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
} as const;
export type Radius = keyof typeof radius;

export const typography = {
  family: {
    sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
    mono: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  // One of these two must be chosen at app bootstrap; see "Typeface" below.
  // Inter is the default for the POC. If the team switches to Geist, change
  // `family.sans` to Geist here and nowhere else.
  size: {
    xs: '12px', // captions, helper text
    sm: '13px', // secondary body, table cells
    base: '14px', // primary body — developer density
    md: '15px', // emphasized body
    lg: '16px', // section intro
    xl: '18px', // page title (small)
    '2xl': '20px', // page title (default — max in POC)
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600, // max weight used in POC — no 700/800/900
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    loose: 1.7,
  },
  letterSpacing: {
    tight: '-0.01em',
    normal: '0',
    wide: '0.02em',
  },
} as const;
export type Typography = typeof typography;

export const color = {
  // Neutral / slate base
  bg: {
    app: 'hsl(0 0% 100%)', // light mode canvas
    appDark: 'hsl(220 13% 9%)', // dark mode canvas
    surface: 'hsl(210 20% 98%)', // light surface (card)
    surfaceDark: 'hsl(220 13% 12%)', // dark surface (card)
    muted: 'hsl(210 20% 96%)',
    mutedDark: 'hsl(220 13% 15%)',
  },
  border: {
    subtle: 'hsl(220 13% 91%)',
    subtleDark: 'hsl(220 13% 20%)',
    strong: 'hsl(220 13% 83%)',
    strongDark: 'hsl(220 13% 30%)',
    focus: 'hsl(217 91% 60%)', // the single blue accent
  },
  text: {
    primary: 'hsl(220 13% 13%)',
    primaryDark: 'hsl(210 20% 98%)',
    secondary: 'hsl(220 9% 46%)',
    secondaryDark: 'hsl(215 14% 65%)',
    tertiary: 'hsl(220 9% 55%)',
    tertiaryDark: 'hsl(215 14% 55%)',
    inverse: 'hsl(0 0% 100%)',
  },
  accent: {
    // Single blue accent — used sparingly for focus, primary CTAs, and links
    base: 'hsl(217 91% 60%)',
    hover: 'hsl(217 91% 54%)',
    active: 'hsl(217 91% 48%)',
    subtle: 'hsl(217 91% 97%)', // background tint for selected rows
    subtleDark: 'hsl(217 91% 18%)',
  },
  status: {
    // Semantic — used only in Badge, Toast, and status pills. Minimal saturation.
    success: 'hsl(142 40% 42%)',
    successBg: 'hsl(142 40% 95%)',
    warning: 'hsl(38 75% 44%)',
    warningBg: 'hsl(38 75% 95%)',
    error: 'hsl(0 65% 48%)',
    errorBg: 'hsl(0 65% 96%)',
    info: 'hsl(217 91% 60%)',
    infoBg: 'hsl(217 91% 97%)',
  },
} as const;
export type Color = typeof color;

export const elevation = {
  none: 'none',
  sm: '0 1px 2px 0 hsl(220 13% 13% / 0.05)',
  md: '0 2px 4px -1px hsl(220 13% 13% / 0.06), 0 1px 2px -1px hsl(220 13% 13% / 0.04)',
  lg: '0 8px 16px -4px hsl(220 13% 13% / 0.08), 0 2px 4px -2px hsl(220 13% 13% / 0.04)',
  // Only three levels. No `xl` / `2xl`. Larger surfaces use layout, not shadows.
} as const;
export type Elevation = keyof typeof elevation;

export const motion = {
  duration: {
    instant: '80ms', // hover, focus ring fade-in
    fast: '140ms', // button press, popover open
    base: '200ms', // modal open, page transition
    slow: '320ms', // rare — only toast entry
  },
  easing: {
    // All POC animations use these two easings. No spring, no bounce.
    standard: 'cubic-bezier(0.2, 0, 0, 1)', // ease-out
    accel: 'cubic-bezier(0.4, 0, 1, 1)', // ease-in for exit
  },
  // Pre-baked primitives — import these, don't hand-roll animations.
  primitives: {
    fadeIn: 'opacity 200ms cubic-bezier(0.2, 0, 0, 1)',
    fadeOut: 'opacity 140ms cubic-bezier(0.4, 0, 1, 1)',
    translateUp: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
  },
} as const;
export type Motion = typeof motion;

export const focusRing = {
  // Every interactive primitive uses exactly this focus treatment.
  outline: `2px solid ${color.border.focus}`,
  outlineOffset: '2px',
} as const;
export type FocusRing = typeof focusRing;
