/**
 * advanced-view.ts — Advanced view toggle module
 *
 * Controls whether raw chain identifiers (Walrus blob IDs, Sui transaction
 * hashes, Seal policy IDs, raw signer addresses) are visible in the UI.
 *
 * When `advancedView = false` (default): primary flows display only
 * UX_Vocabulary terms. Raw chain identifiers are hidden.
 *
 * When `advancedView = true`: metadata views expose Walrus blob ID (with copy
 * affordance), Sui transaction hash, Seal policy ID, and raw signer address.
 *
 * The setting is persisted in `localStorage` per device (not in user metadata).
 *
 * Requirements: 8.3, 8.5
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The localStorage key used to persist the advanced view setting. */
export const ADVANCED_VIEW_KEY = 'swrap:advanced-view';

/**
 * Custom event name dispatched when the advanced view setting changes.
 * Used to synchronize the hook state across multiple mounted components.
 */
const ADVANCED_VIEW_CHANGE_EVENT = 'swrap:advanced-view-change';

// ---------------------------------------------------------------------------
// Core toggle functions
// ---------------------------------------------------------------------------

/**
 * Returns the current advanced view setting.
 *
 * Reads from `localStorage` if available; defaults to `false` (primary-flow
 * mode) when localStorage is unavailable (e.g., SSR) or the key is absent.
 *
 * Requirements: 8.3, 8.5
 *
 * @returns `true` if advanced view is enabled, `false` otherwise.
 */
export function getAdvancedView(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return false;
  }
  try {
    const stored = localStorage.getItem(ADVANCED_VIEW_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
}

/**
 * Sets the advanced view setting, persists it to `localStorage`, and
 * dispatches a custom event so all mounted `useAdvancedView` hooks re-render.
 *
 * Requirements: 8.3, 8.5
 *
 * @param enabled - `true` to enable advanced view, `false` to disable.
 */
export function setAdvancedView(enabled: boolean): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(ADVANCED_VIEW_KEY, String(enabled));
    // Dispatch a custom event so all useAdvancedView hooks synchronize.
    window.dispatchEvent(
      new CustomEvent(ADVANCED_VIEW_CHANGE_EVENT, { detail: enabled }),
    );
  } catch {
    // localStorage may be unavailable in private browsing or quota exceeded.
    // Fail silently — the toggle is a convenience feature, not a security control.
  }
}

/**
 * Toggles the advanced view setting.
 *
 * Requirements: 8.3, 8.5
 *
 * @returns The new value after toggling.
 */
export function toggleAdvancedView(): boolean {
  const next = !getAdvancedView();
  setAdvancedView(next);
  return next;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * React hook for components that need to read and write the advanced view
 * setting. Triggers re-renders when the value changes, including changes
 * made by other components via `setAdvancedView`.
 *
 * Uses a custom DOM event to synchronize state across all mounted instances.
 *
 * Requirements: 8.3, 8.5
 *
 * @returns A tuple of `[isAdvancedView, setAdvancedView]`.
 */
export function useAdvancedView(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(getAdvancedView);

  useEffect(() => {
    // Listen for changes dispatched by setAdvancedView (including from other
    // components or the same component calling the setter).
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setValue(detail);
    };

    window.addEventListener(ADVANCED_VIEW_CHANGE_EVENT, handler);
    return () => {
      window.removeEventListener(ADVANCED_VIEW_CHANGE_EVENT, handler);
    };
  }, []);

  const set = useCallback((next: boolean) => {
    setAdvancedView(next);
    // Also update local state immediately for the calling component.
    setValue(next);
  }, []);

  return [value, set];
}

// ---------------------------------------------------------------------------
// Masking helpers
//
// These helpers are used by primary-flow components to conditionally mask
// raw chain identifiers based on the current advancedView setting.
// ---------------------------------------------------------------------------

/**
 * Masks a Walrus blob ID for display in primary-flow components.
 *
 * When `advancedView = false`: returns a placeholder string that does not
 * contain the raw blob ID.
 * When `advancedView = true`: returns the raw blob ID.
 *
 * Requirements: 8.3
 *
 * @param blobId - The raw Walrus blob ID.
 * @param advancedView - Whether advanced view is enabled.
 * @returns The display string for the blob ID.
 */
export function maskBlobId(blobId: string, advancedView: boolean): string {
  if (!advancedView) {
    return '—';
  }
  return blobId;
}

/**
 * Masks a Sui transaction hash for display in primary-flow components.
 *
 * When `advancedView = false`: returns a placeholder string.
 * When `advancedView = true`: returns the raw transaction hash.
 *
 * Requirements: 8.3
 *
 * @param txHash - The raw Sui transaction hash (0x-prefixed hex).
 * @param advancedView - Whether advanced view is enabled.
 * @returns The display string for the transaction hash.
 */
export function maskTxHash(txHash: string, advancedView: boolean): string {
  if (!advancedView) {
    return '—';
  }
  return txHash;
}

/**
 * Masks a Seal policy ID for display in primary-flow components.
 *
 * When `advancedView = false`: returns a placeholder string.
 * When `advancedView = true`: returns the raw policy ID.
 *
 * Requirements: 8.3
 *
 * @param policyId - The raw Seal policy ID.
 * @param advancedView - Whether advanced view is enabled.
 * @returns The display string for the policy ID.
 */
export function maskPolicyId(policyId: string, advancedView: boolean): string {
  if (!advancedView) {
    return '—';
  }
  return policyId;
}

/**
 * Masks a raw signer address for display in primary-flow components.
 *
 * When `advancedView = false`: returns the UX_Vocabulary label "your account".
 * When `advancedView = true`: returns the raw signer address.
 *
 * Requirements: 8.3, 8.4, 8.6
 *
 * @param address - The raw Sui signer address (0x-prefixed hex).
 * @param advancedView - Whether advanced view is enabled.
 * @returns The display string for the signer address.
 */
export function maskSignerAddress(address: string, advancedView: boolean): string {
  if (!advancedView) {
    return 'your account';
  }
  return address;
}
