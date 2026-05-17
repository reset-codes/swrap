// @vitest-environment jsdom

/**
 * Snapshot test for StatusDashboardPage column order.
 *
 * Validates: Requirements R19.10
 * Asserts that the <thead> column headers match DASHBOARD_COLUMNS verbatim and in exact order.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StatusDashboardPage, DASHBOARD_COLUMNS } from './StatusDashboardPage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// next/font/google is not available in the test environment
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter', className: 'inter' }),
  Geist: () => ({ variable: '--font-geist', className: 'geist' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono', className: 'geist-mono' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../stores/local-store', () => ({
  useLocalStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      forms: {
        'blob-001': {
          blobId: 'blob-001',
          schemaHash: 'abc123',
          title: 'Test Form',
          ownerAddress: '0x123',
          createdAt: '2024-01-01T00:00:00Z',
          isUnlinked: false,
        },
      },
      submissions: {},
      storageError: null,
      skippedEntries: [],
    })
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatusDashboardPage', () => {
  it('renders DASHBOARD_COLUMNS in exact order', () => {
    render(<StatusDashboardPage />);
    const headers = screen.getAllByRole('columnheader');
    const headerTexts = headers.map((h) => h.textContent?.trim());
    expect(headerTexts).toEqual([...DASHBOARD_COLUMNS]);
  });
});
