// @vitest-environment jsdom

/**
 * Unit tests for advanced-view.ts
 *
 * Tests the localStorage persistence, React hook, and cross-component
 * synchronization via custom events.
 *
 * Requirements: 8.3, 8.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// localStorage mock — jsdom in this project doesn't provide .clear()
// ---------------------------------------------------------------------------

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
}

let mockStorage: ReturnType<typeof createLocalStorageMock>;

beforeEach(() => {
  mockStorage = createLocalStorageMock();
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  mockStorage.clear();
});

// Import after mock setup — dynamic import to ensure the module picks up our mock
// Actually, since the module reads localStorage at call time (not import time),
// a static import is fine.
import {
  ADVANCED_VIEW_KEY,
  getAdvancedView,
  setAdvancedView,
  toggleAdvancedView,
  useAdvancedView,
} from './advanced-view';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('advanced-view module', () => {
  // -------------------------------------------------------------------------
  // ADVANCED_VIEW_KEY constant
  // -------------------------------------------------------------------------

  describe('ADVANCED_VIEW_KEY', () => {
    it('exports the localStorage key as "swrap:advanced-view"', () => {
      expect(ADVANCED_VIEW_KEY).toBe('swrap:advanced-view');
    });
  });

  // -------------------------------------------------------------------------
  // getAdvancedView
  // -------------------------------------------------------------------------

  describe('getAdvancedView', () => {
    it('returns false when localStorage has no value', () => {
      expect(getAdvancedView()).toBe(false);
    });

    it('returns false when localStorage value is not "true"', () => {
      mockStorage.setItem(ADVANCED_VIEW_KEY, 'false');
      expect(getAdvancedView()).toBe(false);
    });

    it('returns true when localStorage value is "true"', () => {
      mockStorage.setItem(ADVANCED_VIEW_KEY, 'true');
      expect(getAdvancedView()).toBe(true);
    });

    it('returns false for any non-"true" string', () => {
      mockStorage.setItem(ADVANCED_VIEW_KEY, 'yes');
      expect(getAdvancedView()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // setAdvancedView
  // -------------------------------------------------------------------------

  describe('setAdvancedView', () => {
    it('persists true to localStorage', () => {
      setAdvancedView(true);
      expect(mockStorage.setItem).toHaveBeenCalledWith(ADVANCED_VIEW_KEY, 'true');
    });

    it('persists false to localStorage', () => {
      setAdvancedView(false);
      expect(mockStorage.setItem).toHaveBeenCalledWith(ADVANCED_VIEW_KEY, 'false');
    });

    it('dispatches a custom event with the new value', () => {
      const handler = vi.fn();
      window.addEventListener('swrap:advanced-view-change', handler);
      setAdvancedView(true);
      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe(true);
      window.removeEventListener('swrap:advanced-view-change', handler);
    });
  });

  // -------------------------------------------------------------------------
  // toggleAdvancedView
  // -------------------------------------------------------------------------

  describe('toggleAdvancedView', () => {
    it('toggles from false to true', () => {
      expect(toggleAdvancedView()).toBe(true);
      expect(getAdvancedView()).toBe(true);
    });

    it('toggles from true to false', () => {
      setAdvancedView(true);
      expect(toggleAdvancedView()).toBe(false);
      expect(getAdvancedView()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // useAdvancedView hook
  // -------------------------------------------------------------------------

  describe('useAdvancedView', () => {
    it('returns [false, setter] by default', () => {
      const { result } = renderHook(() => useAdvancedView());
      expect(result.current[0]).toBe(false);
      expect(typeof result.current[1]).toBe('function');
    });

    it('returns [true, setter] when localStorage has "true"', () => {
      mockStorage.setItem(ADVANCED_VIEW_KEY, 'true');
      const { result } = renderHook(() => useAdvancedView());
      expect(result.current[0]).toBe(true);
    });

    it('updates state when setter is called', () => {
      const { result } = renderHook(() => useAdvancedView());
      expect(result.current[0]).toBe(false);

      act(() => {
        result.current[1](true);
      });

      expect(result.current[0]).toBe(true);
      expect(mockStorage.setItem).toHaveBeenCalledWith(ADVANCED_VIEW_KEY, 'true');
    });

    it('syncs across multiple hook instances via custom event', () => {
      const { result: hook1 } = renderHook(() => useAdvancedView());
      const { result: hook2 } = renderHook(() => useAdvancedView());

      expect(hook1.current[0]).toBe(false);
      expect(hook2.current[0]).toBe(false);

      // Update from hook1 — hook2 should also update via the event
      act(() => {
        hook1.current[1](true);
      });

      expect(hook1.current[0]).toBe(true);
      expect(hook2.current[0]).toBe(true);
    });

    it('syncs when setAdvancedView is called externally', () => {
      const { result } = renderHook(() => useAdvancedView());
      expect(result.current[0]).toBe(false);

      act(() => {
        setAdvancedView(true);
      });

      expect(result.current[0]).toBe(true);
    });
  });
});
