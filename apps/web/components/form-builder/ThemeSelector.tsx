'use client';

/**
 * ThemeSelector — Radix Popover-based theme picker for the TopBar.
 *
 * Renders a Palette icon button that opens a popover listing all five themes.
 * Each row shows:
 *   - A 12px color swatch circle
 *   - The theme's human-readable label
 *   - A checkmark on the currently active theme
 *
 * Clicking a theme row calls `setTheme(theme)` and closes the popover.
 *
 * Requirements: 10.1, 10.2, 10.7
 */

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, Palette } from 'lucide-react';
import { useFormBuilderStore } from '../../stores/form-builder-store';
import { THEME_CONFIG, THEME_ORDER } from './themes';
import type { FormTheme } from '../../stores/form-builder-store';

// ---------------------------------------------------------------------------
// ThemeSelector
// ---------------------------------------------------------------------------

export function ThemeSelector() {
  const theme = useFormBuilderStore((s) => s.theme);
  const setTheme = useFormBuilderStore((s) => s.setTheme);

  const [open, setOpen] = React.useState(false);

  function handleSelect(selected: FormTheme) {
    setTheme(selected);
    setOpen(false);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* ── Trigger ─────────────────────────────────────────────────── */}
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Select theme"
          aria-haspopup="true"
          aria-expanded={open}
          className={[
            'flex h-8 w-8 items-center justify-center rounded-md',
            'transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-border-focus focus-visible:ring-offset-2',
            open
              ? 'bg-bg-muted text-text-primary'
              : 'text-text-tertiary hover:bg-bg-muted hover:text-text-primary',
          ].join(' ')}
        >
          <Palette className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>

      {/* ── Popover content ──────────────────────────────────────────── */}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className={[
            // Base surface
            'z-50 min-w-[180px] rounded-xl border border-border-subtle',
            'bg-bg-surface p-1.5 shadow-lg',
            // Radix animation (opacity + slide)
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2',
            'data-[side=top]:slide-in-from-bottom-2',
          ].join(' ')}
        >
          {/* Theme list */}
          <ul role="menu" aria-label="Theme options" className="space-y-0.5">
            {THEME_ORDER.map((themeKey) => {
              const config = THEME_CONFIG[themeKey];
              const isActive = theme === themeKey;

              return (
                <li key={themeKey} role="none">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => handleSelect(themeKey)}
                    className={[
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5',
                      'text-sm transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-2',
                      'focus-visible:ring-border-focus focus-visible:ring-inset',
                      isActive
                        ? 'bg-accent-subtle text-text-primary font-medium'
                        : 'text-text-secondary hover:bg-bg-muted hover:text-text-primary',
                    ].join(' ')}
                  >
                    {/* Color swatch — 12px circle */}
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-full border border-border-subtle"
                      style={{ backgroundColor: config.swatchColor }}
                    />

                    {/* Theme label */}
                    <span className="flex-1 text-left">{config.label}</span>

                    {/* Active checkmark */}
                    {isActive && (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-accent-base"
                        aria-hidden="true"
                        strokeWidth={2.5}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
