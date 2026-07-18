import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from './use-reduced-motion.ts';

const QUERY = '(prefers-reduced-motion: reduce)';

function stubMatchMedia(initialMatches: boolean) {
  let changeListener: (() => void) | undefined;
  const mql = {
    matches: initialMatches,
    media: QUERY,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (event === 'change') changeListener = cb;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return {
    fireChange(nextMatches: boolean) {
      mql.matches = nextMatches;
      changeListener?.();
    },
  };
}

describe('useReducedMotion (D3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads prefers-reduced-motion: true on mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('defaults to false when the OS does not request reduced motion', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('updates when the media query change event fires', () => {
    const { fireChange } = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => fireChange(true));
    expect(result.current).toBe(true);
  });
});
