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
