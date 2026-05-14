/**
 * scripts/check-contrast.ts
 *
 * WCAG contrast ratio CI check.
 * Validates that design token color pairs meet WCAG AA/AAA contrast requirements.
 *
 * Requirements: R19.15
 *
 * Run via: npm run check:contrast
 */

import { color } from '@poc/shared';
// @ts-ignore — wcag-contrast has no bundled types
import contrast from 'wcag-contrast';

// ---------------------------------------------------------------------------
// HSL → hex conversion
// ---------------------------------------------------------------------------

function hslToHex(hsl: string): string {
  // Parse "hsl(H S% L%)" or "hsl(H S% L% / A)"
  const match = hsl.match(
    /hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/
  );
  if (!match) throw new Error(`Cannot parse HSL: ${hsl}`);

  const h = parseFloat(match[1]) / 360;
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Contrast checks
// ---------------------------------------------------------------------------

interface ContrastCheck {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

const checks: ContrastCheck[] = [
  // Light mode
  {
    name: 'text.primary / bg.app (light)',
    fg: color.text.primary,
    bg: color.bg.app,
    min: 7,
  },
  {
    name: 'text.secondary / bg.app (light)',
    fg: color.text.secondary,
    bg: color.bg.app,
    min: 4.5,
  },
  {
    name: 'accent.base / bg.app (light)',
    fg: color.accent.base,
    bg: color.bg.app,
    min: 4.5,
  },
  // Dark mode
  {
    name: 'text.primaryDark / bg.appDark (dark)',
    fg: color.text.primaryDark,
    bg: color.bg.appDark,
    min: 7,
  },
  {
    name: 'text.secondaryDark / bg.appDark (dark)',
    fg: color.text.secondaryDark,
    bg: color.bg.appDark,
    min: 4.5,
  },
  {
    name: 'accent.baseDark / bg.appDark (dark)',
    fg: color.accent.baseDark,
    bg: color.bg.appDark,
    min: 4.5,
  },
];

// ---------------------------------------------------------------------------
// Run checks
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

console.log('\nWCAG Contrast Check\n' + '='.repeat(50));

for (const check of checks) {
  const fgHex = hslToHex(check.fg);
  const bgHex = hslToHex(check.bg);
  const ratio: number = contrast.hex(fgHex, bgHex);
  const ok = ratio >= check.min;

  if (ok) {
    console.log(`  ✓  ${check.name}`);
    console.log(`       ratio: ${ratio.toFixed(2)}:1  (min ${check.min}:1)`);
    passed++;
  } else {
    console.error(`  ✗  ${check.name}`);
    console.error(
      `       ratio: ${ratio.toFixed(2)}:1  (required ≥ ${check.min}:1)  FAIL`
    );
    failed++;
  }
}

console.log('\n' + '='.repeat(50));
console.log(`Result: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
