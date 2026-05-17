// @vitest-environment jsdom
/**
 * Unit tests for UploadProgress component.
 *
 * Validates:
 * - Renders UX vocabulary labels (never internal state names)
 * - Shows retry affordance when state === 'failed'
 * - Shows reconcile/discard affordances when isOrphan(job) is true
 * - Accessible markup (role, aria attributes)
 *
 * Requirements: 6.11, 6.12, 8.8
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { UploadProgress } from './UploadProgress';
import type { UploadJob } from '../../lib/upload/upload-state-machine';
import { ORPHAN_TIMEOUT_MS } from '../../lib/upload/upload-state-machine';
import { uploadPhase } from '../../lib/copy/ux-copy';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<UploadJob> = {}): UploadJob {
  return {
    id: 'test-job-1',
    artifactKind: 'submission',
    formId: 'form-1',
    privacyMode: 'public',
    state: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: UX vocabulary rendering (Requirement 8.8)
// ---------------------------------------------------------------------------

describe('UploadProgress — UX vocabulary rendering', () => {
  const states = ['pending', 'encrypting', 'uploading', 'uploaded', 'indexed', 'failed'] as const;

  it.each(states)('renders UX label for state "%s" — never the raw state name', (state) => {
    const job = makeJob({ state });
    const { container } = render(<UploadProgress job={job} />);
    const text = container.textContent ?? '';

    // The UX label should be present
    expect(text).toContain(uploadPhase(state));

    // The raw internal state name should NOT appear as a standalone word in the output
    // (unless the UX label happens to contain it, like "Uploading" contains "upload" concept)
    // We check that the raw state string is not rendered verbatim
    if (state !== 'uploading') {
      // "uploading" is a substring of "Uploading" so we skip that specific case
      // For all others, the raw state name should not appear
      expect(text.toLowerCase()).not.toContain(state);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Retry affordance (Requirement 6.11)
// ---------------------------------------------------------------------------

describe('UploadProgress — retry affordance', () => {
  it('shows Retry button when state is "failed"', () => {
    const onRetry = vi.fn();
    render(<UploadProgress job={makeJob({ state: 'failed' })} onRetry={onRetry} />);

    const retryButton = screen.getByRole('button', { name: /retry/i });
    expect(retryButton).toBeDefined();
  });

  it('calls onRetry when Retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<UploadProgress job={makeJob({ state: 'failed' })} onRetry={onRetry} />);

    const retryButton = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show Retry button when state is not "failed"', () => {
    render(<UploadProgress job={makeJob({ state: 'uploading' })} onRetry={vi.fn()} />);

    const retryButton = screen.queryByRole('button', { name: /retry/i });
    expect(retryButton).toBeNull();
  });

  it('does not show Retry button when onRetry is not provided', () => {
    render(<UploadProgress job={makeJob({ state: 'failed' })} />);

    const retryButton = screen.queryByRole('button', { name: /retry/i });
    expect(retryButton).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: Orphan reconcile/discard affordances (Requirement 6.11, 6.13)
// ---------------------------------------------------------------------------

describe('UploadProgress — orphan affordances', () => {
  function makeOrphanJob(): UploadJob {
    return makeJob({
      state: 'uploaded',
      updatedAt: Date.now() - ORPHAN_TIMEOUT_MS - 1000, // past the timeout
    });
  }

  it('shows Reconcile and Discard buttons for orphaned jobs', () => {
    const onReconcile = vi.fn();
    const onDiscard = vi.fn();
    render(
      <UploadProgress
        job={makeOrphanJob()}
        onReconcile={onReconcile}
        onDiscard={onDiscard}
      />,
    );

    expect(screen.getByRole('button', { name: /reconcile/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /discard/i })).toBeDefined();
  });

  it('calls onReconcile when Reconcile button is clicked', () => {
    const onReconcile = vi.fn();
    const onDiscard = vi.fn();
    render(
      <UploadProgress
        job={makeOrphanJob()}
        onReconcile={onReconcile}
        onDiscard={onDiscard}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /reconcile/i }));
    expect(onReconcile).toHaveBeenCalledTimes(1);
  });

  it('calls onDiscard when Discard button is clicked', () => {
    const onReconcile = vi.fn();
    const onDiscard = vi.fn();
    render(
      <UploadProgress
        job={makeOrphanJob()}
        onReconcile={onReconcile}
        onDiscard={onDiscard}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('does not show orphan buttons for non-orphaned "uploaded" jobs', () => {
    // Job in 'uploaded' state but NOT past the orphan timeout
    const recentJob = makeJob({
      state: 'uploaded',
      updatedAt: Date.now(), // just now — not orphaned
    });
    render(
      <UploadProgress
        job={recentJob}
        onReconcile={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /reconcile/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /discard/i })).toBeNull();
  });

  it('does not show orphan buttons for failed jobs', () => {
    render(
      <UploadProgress
        job={makeJob({ state: 'failed' })}
        onReconcile={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /reconcile/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /discard/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: Accessibility
// ---------------------------------------------------------------------------

describe('UploadProgress — accessibility', () => {
  it('has role="status" for live region announcements', () => {
    const { container } = render(<UploadProgress job={makeJob({ state: 'uploading' })} />);
    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl).not.toBeNull();
  });

  it('has aria-live="polite" for non-intrusive updates', () => {
    const { container } = render(<UploadProgress job={makeJob({ state: 'uploading' })} />);
    const statusEl = container.querySelector('[aria-live="polite"]');
    expect(statusEl).not.toBeNull();
  });

  it('has aria-label matching the UX phase label', () => {
    const job = makeJob({ state: 'encrypting' });
    const { container } = render(<UploadProgress job={job} />);
    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl?.getAttribute('aria-label')).toBe(uploadPhase('encrypting'));
  });

  it('retry button has accessible aria-label', () => {
    render(<UploadProgress job={makeJob({ state: 'failed' })} onRetry={vi.fn()} />);
    const retryButton = screen.getByRole('button', { name: /retry upload/i });
    expect(retryButton).toBeDefined();
  });

  it('orphan action group has accessible aria-label', () => {
    const orphanJob = makeJob({
      state: 'uploaded',
      updatedAt: Date.now() - ORPHAN_TIMEOUT_MS - 1000,
    });
    const { container } = render(
      <UploadProgress job={orphanJob} onReconcile={vi.fn()} onDiscard={vi.fn()} />,
    );
    const group = container.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Orphan recovery actions');
  });
});
