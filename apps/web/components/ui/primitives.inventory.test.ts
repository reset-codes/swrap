// @vitest-environment jsdom
/**
 * Primitive inventory + focus-visible snapshot tests
 * Requirements: R19.5, R19.15
 *
 * R19.5  — Every required UI primitive is exported from the barrel index.
 * R19.15 — Every interactive primitive applies the design-token focus ring:
 *           `focusRing.outline = "2px solid hsl(217 91% 60%)"` expressed as
 *           Tailwind classes `focus-visible:ring-2 focus-visible:ring-border-focus`.
 */

import { describe, it, expect } from 'vitest';
import {
  // Components
  Button,
  Input,
  Textarea,
  Card,
  Modal,
  Dropdown,
  Badge,
  Tabs,
  EmptyState,
  LoadingState,
  FormField,
  // Variant maps
  buttonVariants,
  inputVariants,
  textareaVariants,
  cardVariants,
  badgeVariants,
  emptyStateVariants,
  loadingStateVariants,
  formFieldVariants,
} from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for any value that React can render as a component:
 * - plain functions (function components)
 * - objects with $$typeof (forwardRef, memo, Radix primitives, etc.)
 */
function isReactComponent(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (typeof value === 'object' && value !== null && '$$typeof' in value) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 1. Inventory — every required primitive is exported and is a React component
// ---------------------------------------------------------------------------

describe('Primitive inventory (R19.5)', () => {
  const components: [string, unknown][] = [
    ['Button', Button],
    ['Input', Input],
    ['Textarea', Textarea],
    ['Card', Card],
    ['Modal', Modal],
    ['Dropdown', Dropdown],
    ['Badge', Badge],
    ['Tabs', Tabs],
    ['EmptyState', EmptyState],
    ['LoadingState', LoadingState],
    ['FormField', FormField],
  ];

  it.each(components)('%s is a React component (function or forwardRef object)', (_name, component) => {
    expect(isReactComponent(component)).toBe(true);
  });

  const variantMaps: [string, unknown][] = [
    ['buttonVariants', buttonVariants],
    ['inputVariants', inputVariants],
    ['textareaVariants', textareaVariants],
    ['cardVariants', cardVariants],
    ['badgeVariants', badgeVariants],
    ['emptyStateVariants', emptyStateVariants],
    ['loadingStateVariants', loadingStateVariants],
    ['formFieldVariants', formFieldVariants],
  ];

  it.each(variantMaps)('%s is a function (cva variant map)', (_name, variantFn) => {
    // cva() returns a callable function
    expect(typeof variantFn).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 2. Focus-visible snapshot tests (R19.15)
//    Pinned to focusRing.outline = "2px solid hsl(217 91% 60%)"
//    expressed as Tailwind utility classes.
// ---------------------------------------------------------------------------

describe('Focus-visible ring classes match design tokens (R19.15)', () => {
  /**
   * Button — interactive CTA, must carry the full focus ring.
   * focusRing.outline → focus-visible:ring-2 focus-visible:ring-border-focus
   * focusRing.outlineOffset → focus-visible:ring-offset-2
   */
  it('Button has focus-visible ring classes matching design tokens', () => {
    const classes = buttonVariants({ variant: 'primary', size: 'md' });
    expect(classes).toContain('focus-visible:ring-2');
    expect(classes).toContain('focus-visible:ring-border-focus');
    expect(classes).toContain('focus-visible:ring-offset-2');
  });

  it('Button secondary variant also carries focus ring', () => {
    const classes = buttonVariants({ variant: 'secondary', size: 'md' });
    expect(classes).toContain('focus-visible:ring-2');
    expect(classes).toContain('focus-visible:ring-border-focus');
  });

  /**
   * Input — text input, must carry the focus ring.
   */
  it('Input has focus-visible ring classes matching design tokens', () => {
    const classes = inputVariants({ variant: 'default', size: 'md' });
    expect(classes).toContain('focus-visible:ring-2');
    expect(classes).toContain('focus-visible:ring-border-focus');
  });

  it('Input suppresses native outline in favour of ring', () => {
    const classes = inputVariants({ variant: 'default', size: 'md' });
    expect(classes).toContain('focus-visible:outline-none');
  });

  /**
   * Textarea — multi-line input, same focus treatment as Input.
   */
  it('Textarea has focus-visible ring classes matching design tokens', () => {
    const classes = textareaVariants({ variant: 'default', size: 'md' });
    expect(classes).toContain('focus-visible:ring-2');
    expect(classes).toContain('focus-visible:ring-border-focus');
  });

  it('Textarea suppresses native outline in favour of ring', () => {
    const classes = textareaVariants({ variant: 'default', size: 'md' });
    expect(classes).toContain('focus-visible:outline-none');
  });

  /**
   * FormField — layout wrapper (div). It is NOT itself an interactive element;
   * focus-visible styling is delegated to the child Input/Textarea it wraps.
   * This test asserts the correct design: the wrapper has no focus ring of its
   * own, preventing a double-ring when the child is focused.
   */
  it('FormField layout wrapper does not apply focus-visible ring (delegates to child)', () => {
    const classes = formFieldVariants({ layout: 'vertical' });
    // The container must NOT carry focus-visible ring classes — those belong
    // on the child interactive element (Input, Textarea, etc.).
    expect(classes).not.toContain('focus-visible:ring-2');
    expect(classes).not.toContain('focus-visible:ring-border-focus');
  });
});
