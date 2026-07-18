import '@testing-library/jest-dom/vitest';
import { beforeEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// vitest-axe's `toHaveNoViolations` matcher (D4) — registered once, globally,
// alongside jest-dom's matchers, so every `.test.tsx` file in `web/` can call
// `expect(await axe(container)).toHaveNoViolations()` without per-file setup.
// (The TS-side `declare module 'vitest'` augmentation lives in
// `./vitest-axe.d.ts` — vitest-axe@0.1.0 only ships the pre-v2
// `declare global { namespace Vi }` form, which vitest 4's own `Assertion`
// type no longer merges with; see that file for detail.)
expect.extend(axeMatchers);

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

// --- Web Audio / getUserMedia fixtures (Slice 30b Phase 7 voice input) ---
// happy-dom implements neither `navigator.mediaDevices` nor any Web Audio
// API (no AudioContext/AudioWorkletNode). These are deliberately minimal,
// REAL (not `vi.fn()` no-ops) fakes: a track whose `.stop()` flips
// `readyState` to 'ended' so lifecycle tests can assert genuine teardown
// (spec §7.2(c)), and an AudioContext/AudioWorkletNode pair whose methods
// are spies. `audio-capture.test.ts` grabs the constructed node via
// `getLastAudioWorkletNode()` to simulate a worklet `port.onmessage` chunk —
// the ONLY way to drive `createAudioCapture`'s chunk/level fan-out under
// happy-dom, since the real worklet can't run here (Task 5/6 split: the
// resample math is tested directly against `createDownsampler`, never
// through this fake).
export class FakeMediaStreamTrack {
  readyState: 'live' | 'ended' = 'live';
  stop() {
    this.readyState = 'ended';
  }
}

export class FakeMediaStream {
  private tracks = [new FakeMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeAudioWorklet {
  addModule = vi.fn().mockResolvedValue(undefined);
}

export class FakeAudioWorkletNode {
  port: {
    onmessage: ((event: MessageEvent) => void) | null;
    close: () => void;
  } = { onmessage: null, close: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    public context: unknown,
    public name: string,
    public options?: unknown,
  ) {
    lastAudioWorkletNode = this;
  }
}

export class FakeAudioContext {
  sampleRate = 48000;
  audioWorklet = new FakeAudioWorklet();
  close = vi.fn().mockResolvedValue(undefined);
  createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  constructor() {
    lastAudioContext = this;
  }
}

let lastAudioWorkletNode: FakeAudioWorkletNode | undefined;
export function getLastAudioWorkletNode(): FakeAudioWorkletNode | undefined {
  return lastAudioWorkletNode;
}

let lastAudioContext: FakeAudioContext | undefined;
export function getLastAudioContext(): FakeAudioContext | undefined {
  return lastAudioContext;
}

let lastGetUserMediaConstraints: unknown;
export function getLastGetUserMediaConstraints(): unknown {
  return lastGetUserMediaConstraints;
}

let lastMediaStream: FakeMediaStream | undefined;
export function getLastMediaStream(): FakeMediaStream | undefined {
  return lastMediaStream;
}

beforeEach(() => {
  lastAudioWorkletNode = undefined;
  lastAudioContext = undefined;
  lastGetUserMediaConstraints = undefined;
  lastMediaStream = undefined;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn((constraints: unknown) => {
        lastGetUserMediaConstraints = constraints;
        lastMediaStream = new FakeMediaStream();
        return Promise.resolve(lastMediaStream);
      }),
    },
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
});
