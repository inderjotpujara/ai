import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// happy-dom does not implement matchMedia; ThemeProvider (Task 3) depends on it.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

// Node's (and Bun's) native `--experimental-webstorage` global defines its own
// `localStorage` directly on globalThis, which shadows happy-dom's working
// Storage instance (an own property wins over the inherited getter) — and
// without a `--localstorage-file` backing, its get/setItem/clear throw.
// ThemeProvider (Task 3) persists to localStorage, so give tests a real,
// isolated in-memory implementation instead.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) =>
      store.has(key) ? (store.get(key) as string) : null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  });
});

// @xyflow/react observes node/viewport size via ResizeObserver on mount;
// happy-dom has no implementation. A no-op stub is enough for DagView's smoke
// tests (they assert on rendered nodes/edges, not measured pixel layout).
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

// happy-dom does not implement window.confirm at all (the property is
// `undefined`, not a stub that throws like jsdom's) — SessionDetail's delete
// button (Slice 30b Phase 6 T54) gates on it, and `vi.spyOn(window, 'confirm')`
// requires the property to already be a function to wrap. `window` is the
// same object as `globalThis` under vitest's happy-dom pool, so stubbing the
// global also satisfies `window.confirm`.
beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
});
