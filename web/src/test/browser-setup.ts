// Setup for the real-browser (Vitest browser-mode) e2e lane ONLY. Unlike
// ./setup.ts (happy-dom), it deliberately installs NO fakes for
// navigator.mediaDevices / AudioContext / AudioWorkletNode — the whole point
// of the browser e2e is to exercise the REAL Web Audio + getUserMedia stack
// (fed by Chromium's fake-audio launch flags). It only registers jest-dom
// matchers (toBeDisabled, etc.).
import '@testing-library/jest-dom/vitest';
