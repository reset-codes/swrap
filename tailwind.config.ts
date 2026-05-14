import type { Config } from 'tailwindcss';

// Direct relative import — tsconfig path aliases (@poc/shared) are not
// resolved at runtime when Tailwind loads this config in Node.
import {
  spacing,
  radius,
  typography,
  color,
  elevation,
  motion,
} from './packages/shared/src/design-tokens';

// ---------------------------------------------------------------------------
// buildTailwindTheme()
// Maps Design_Tokens to Tailwind theme keys. All token-derived values live
// here; the rest of the config is structural (content, plugins, etc.).
// ---------------------------------------------------------------------------
function buildTailwindTheme() {
  // --- spacing ---
  // Spread token spacing keys directly; Tailwind accepts the same shape.
  const spacingTokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(spacing)) {
    spacingTokens[String(k)] = v as string;
  }

  // --- colors ---
  // Token colors are nested (color.bg.app, color.text.primary, etc.).
  // We flatten them into Tailwind-friendly keys AND preserve all existing
  // named keys from the original config so no visual regressions occur.
  const colorTokens = {
    // ── Token-derived keys ──────────────────────────────────────────────
    // bg group
    'bg-app': color.bg.app,
    'bg-app-dark': color.bg.appDark,
    'bg-surface': color.bg.surface,
    'bg-surface-dark': color.bg.surfaceDark,
    'bg-muted': color.bg.muted,
    'bg-muted-dark': color.bg.mutedDark,

    // border group
    'border-subtle': color.border.subtle,
    'border-subtle-dark': color.border.subtleDark,
    'border-strong': color.border.strong,
    'border-strong-dark': color.border.strongDark,
    'border-focus': color.border.focus,

    // text group
    'text-primary-token': color.text.primary,
    'text-primary-dark': color.text.primaryDark,
    'text-secondary-token': color.text.secondary,
    'text-secondary-dark': color.text.secondaryDark,
    'text-tertiary': color.text.tertiary,
    'text-tertiary-dark': color.text.tertiaryDark,
    'text-inverse': color.text.inverse,

    // accent group
    'accent-base': color.accent.base,
    'accent-hover': color.accent.hover,
    'accent-active': color.accent.active,
    'accent-subtle': color.accent.subtle,
    'accent-subtle-dark': color.accent.subtleDark,

    // status group
    'status-success': color.status.success,
    'status-success-bg': color.status.successBg,
    'status-warning': color.status.warning,
    'status-warning-bg': color.status.warningBg,
    'status-error': color.status.error,
    'status-error-bg': color.status.errorBg,
    'status-info': color.status.info,
    'status-info-bg': color.status.infoBg,

    // ── Preserved existing named keys (superset — no regressions) ───────
    background: '#FAFAFA',
    surface: '#FFFFFF',
    border: '#E5E7EB',
    muted: '#F3F4F6',

    'text-primary': '#111827',
    'text-secondary': '#6B7280',
    'text-muted': '#9CA3AF',

    accent: {
      DEFAULT: color.accent.base,
      hover: color.accent.hover,
      light: color.accent.subtle,
    },

    success: '#16A34A',
    warning: '#D97706',
    error: '#DC2626',
    info: '#2563EB',

    'walrus-brand': '#0EA5E9',
    'seal-brand': '#7C3AED',

    primary: {
      DEFAULT: '#2563EB',
      foreground: '#FFFFFF',
    },
    secondary: {
      DEFAULT: '#F3F4F6',
      foreground: '#111827',
    },
    destructive: {
      DEFAULT: '#DC2626',
      foreground: '#FFFFFF',
    },
    card: {
      DEFAULT: '#FFFFFF',
      foreground: '#111827',
    },
    popover: {
      DEFAULT: '#FFFFFF',
      foreground: '#111827',
    },
    input: '#E5E7EB',
    ring: '#2563EB',
    foreground: '#111827',
  };

  // --- borderRadius ---
  const borderRadiusTokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(radius)) {
    borderRadiusTokens[String(k)] = v as string;
  }
  // Preserve existing keys that map to Tailwind's default names
  borderRadiusTokens['lg'] = radius.lg;
  borderRadiusTokens['md'] = radius.md;
  borderRadiusTokens['sm'] = radius.sm;

  // --- boxShadow ---
  const boxShadowTokens = {
    // Token-derived
    'elevation-none': elevation.none,
    'elevation-sm': elevation.sm,
    'elevation-md': elevation.md,
    'elevation-lg': elevation.lg,
    // Preserved existing keys
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  };

  // --- fontFamily ---
  const fontFamilyTokens = {
    // Token-derived
    sans: [typography.family.sans],
    mono: [typography.family.mono],
    // Preserved existing CSS-variable-based keys (used by existing pages)
    'sans-var': ['var(--font-geist)', 'system-ui', 'sans-serif'],
    'mono-var': ['var(--font-geist-mono)', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
  };

  // --- fontSize ---
  // Token sizes are plain px strings; Tailwind fontSize accepts [size, options].
  const fontSizeTokens: Record<string, string | [string, object]> = {
    // Token-derived
    'token-xs': typography.size.xs,
    'token-sm': typography.size.sm,
    'token-base': typography.size.base,
    'token-md': typography.size.md,
    'token-lg': typography.size.lg,
    'token-xl': typography.size.xl,
    'token-2xl': typography.size['2xl'],
    // Preserved existing named keys
    display: ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '700' }],
    h1: ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
    h2: ['1.375rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
    h3: ['1.125rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
    body: ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
    small: ['0.75rem', { lineHeight: '1.5', fontWeight: '400' }],
    mono: ['0.75rem', { lineHeight: '1.5', fontWeight: '400' }],
  };

  // --- transitionDuration ---
  const transitionDurationTokens = {
    instant: motion.duration.instant,
    fast: motion.duration.fast,
    base: motion.duration.base,
    slow: motion.duration.slow,
  };

  return {
    spacingTokens,
    colorTokens,
    borderRadiusTokens,
    boxShadowTokens,
    fontFamilyTokens,
    fontSizeTokens,
    transitionDurationTokens,
  };
}

const {
  spacingTokens,
  colorTokens,
  borderRadiusTokens,
  boxShadowTokens,
  fontFamilyTokens,
  fontSizeTokens,
  transitionDurationTokens,
} = buildTailwindTheme();

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './apps/web/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Breakpoints sourced from Design_Tokens responsive targets (R19.13)
  theme: {
    screens: {
      xs: '360px',   // minimum supported viewport
      sm: '768px',   // tablet / small laptop
      md: '1280px',  // primary developer laptop target
      lg: '1536px',  // large laptop / external monitor
      xl: '1920px',  // maximum targeted viewport
    },
    extend: {
      spacing: spacingTokens,
      colors: colorTokens,
      borderRadius: borderRadiusTokens,
      boxShadow: boxShadowTokens,
      fontFamily: fontFamilyTokens,
      fontSize: fontSizeTokens,
      transitionDuration: transitionDurationTokens,

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },

      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
