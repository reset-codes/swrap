// @vitest-environment jsdom
/**
 * Unit tests for FieldPalette — Requirements 3.1–3.5
 *
 * Covers:
 *  - filterPaletteTypes: pure filtering function
 *  - FieldPalette component: rendering and interaction
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import {
  filterPaletteTypes,
  FieldPalette,
  PALETTE_CATEGORIES,
  type PaletteCategory,
} from './FieldPalette';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// filterPaletteTypes — pure function unit tests (Req 3.2, 3.3, 3.4)
// ---------------------------------------------------------------------------

describe('filterPaletteTypes', () => {
  it('returns all categories for empty or whitespace-only term', () => {
    expect(filterPaletteTypes(PALETTE_CATEGORIES, '')).toEqual(PALETTE_CATEGORIES);
    expect(filterPaletteTypes(PALETTE_CATEGORIES, '   ')).toEqual(PALETTE_CATEGORIES);
  });

  it('filters by human-readable label (case-insensitive, partial match)', () => {
    const result = filterPaletteTypes(PALETTE_CATEGORIES, 'email');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Text');
    expect(result[0].types).toContain('email');
    expect(result[0].types).not.toContain('text');
  });

  it('filters by category name (case-insensitive)', () => {
    const crypto = filterPaletteTypes(PALETTE_CATEGORIES, 'CRYPTO');
    expect(crypto).toHaveLength(1);
    expect(crypto[0].name).toBe('Crypto');

    // Category match returns all types in that category
    const text = filterPaletteTypes(PALETTE_CATEGORIES, 'text');
    const textCat = text.find((c) => c.name === 'Text');
    expect(textCat?.types).toEqual(PALETTE_CATEGORIES.find((c) => c.name === 'Text')?.types);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterPaletteTypes(PALETTE_CATEGORIES, 'zzznomatch')).toHaveLength(0);
  });

  it('trims whitespace and does not mutate originals', () => {
    const copy = PALETTE_CATEGORIES.map((c) => ({ ...c, types: [...c.types] }));
    const result = filterPaletteTypes(PALETTE_CATEGORIES, '  wallet  ');
    expect(result).toHaveLength(1);
    expect(result[0].types).toContain('wallet_address');
    expect(PALETTE_CATEGORIES).toEqual(copy);
  });

  it('works with custom categories', () => {
    const custom: PaletteCategory[] = [
      { name: 'Alpha', types: ['foo', 'bar'] },
      { name: 'Beta', types: ['baz'] },
    ];
    const result = filterPaletteTypes(custom, 'alpha');
    expect(result).toHaveLength(1);
    expect(result[0].types).toEqual(['foo', 'bar']);
  });
});

// ---------------------------------------------------------------------------
// FieldPalette component tests (Req 3.1, 3.3, 3.4, 3.5)
// ---------------------------------------------------------------------------

describe('FieldPalette', () => {
  it('renders with correct aria-label and all four category headings', () => {
    render(<FieldPalette />);
    expect(screen.getByRole('complementary').getAttribute('aria-label')).toBe('Field palette');
    expect(screen.getByRole('button', { name: 'Text category' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Choice category' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Rating category' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Crypto category' })).not.toBeNull();
  });

  it('field type buttons exist with correct aria-labels', () => {
    render(<FieldPalette />);
    expect(screen.getAllByRole('button', { name: 'Add Short Text field' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Add Wallet Address field' }).length).toBeGreaterThan(0);
  });

  it('calls onAddField with correct type on click', () => {
    const onAddField = vi.fn();
    render(<FieldPalette onAddField={onAddField} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Short Text field' })[0]);
    expect(onAddField).toHaveBeenCalledWith('text');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Star Rating field' })[0]);
    expect(onAddField).toHaveBeenCalledWith('star_rating');
  });

  it('does not throw when onAddField is omitted', () => {
    render(<FieldPalette />);
    expect(() =>
      fireEvent.click(screen.getAllByRole('button', { name: 'Add Email field' })[0])
    ).not.toThrow();
  });

  it('search input filters results and shows empty state', () => {
    render(<FieldPalette />);
    const input = screen.getByRole('searchbox', { name: 'Search field types' });

    fireEvent.change(input, { target: { value: 'email' } });
    expect(screen.queryByText('No fields match')).toBeNull();

    fireEvent.change(input, { target: { value: 'zzznomatch' } });
    expect(screen.queryByText('No fields match')).not.toBeNull();
  });

  it('categories collapse and re-expand on header click', () => {
    render(<FieldPalette />);
    const btn = screen.getByRole('button', { name: 'Text category' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});
