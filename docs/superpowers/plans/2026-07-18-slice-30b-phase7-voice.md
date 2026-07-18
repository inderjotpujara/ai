# Slice 30b Phase 7 — Browser Voice Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hands-free dictation to the web chat — speaking fills the Composer with transcribed text (per-segment finals; the user still presses Send). Entirely client-side: `getUserMedia`(AEC) → AudioWorklet downsample → transformers.js Moonshine + Silero VAD in a Web Worker → transcript into the composer's own `value`. No server route, no TTS, no barge-in.

**Architecture:** Built in 6 increments across 18 tasks. Increment 1 lifts the CLI's `VoiceFrames`/`CaptureSource` contract into `src/contracts/` (shared, no Node import into web), adds `AGENT_WEB_VOICE_*` config + served window globals, and the Settings toggle/model-tier selector. Increment 2 builds the pure carry-state downsampler (the §7.1 correctness surface) + `createAudioCapture`. Increment 3 opens with the **D10 browser spike** (prove transformers.js loads Moonshine+Silero under the app's real COOP/COEP headers; pick the lowest working rung of the fallback ladder) then builds the STT Web Worker. Increment 4 builds the pure VAD segmentation state machine + the `use-voice-input` orchestrator hook (both gestures, worker lifecycle, concurrent-gesture guard, MediaStream teardown). Increment 5 adds the Composer-mounted mic buttons + waveform. Increment 6 does the four doc surfaces + live-verify + partial-slice land. The engine choice **overrides parent-spec D8** (transformers.js + Moonshine + Silero, not sherpa-onnx WASM) per the spec's re-validation.

**Tech Stack:** TypeScript, Bun (`bun:test`, root workspace), Vite 8 + Vitest 4 + Testing Library + happy-dom (`web/` workspace), React 19, `@huggingface/transformers` (transformers.js) v4.2.0 + `onnxruntime-web`, Web Audio API (`AudioContext`/`AudioWorkletNode`), Web Workers.

## Global Constraints

- **Use `bun`, not `npm`**, for every install/run command (repo-wide CLAUDE.md).
- **`VoiceFrames` is a plain type, NOT a zod schema** — a deliberate, documented exception (spec D5): it never crosses an HTTP wire this phase (audio never leaves the browser tab), so there is no round-trip to validate.
- **`CaptureSource` string values are PRESERVED as-is** (`Mic = 'mic'`, `File = 'file'`) when lifted into `src/contracts/enums.ts` — do NOT change the casing (the `voice.transcribe` span's `voice.capture.source` attribute value must not change). The lift is source-relocation only; `src/voice/types.ts` re-exports from the contract. (Supersedes the earlier interfaces-doc note that showed `'Mic'/'File'` — that was a controller error, corrected here.)
- **Naming/signatures are VERBATIM from the locked canonical interfaces** — do not rename exported functions/types across tasks. (One correction to that doc: `CaptureSource` values stay lowercase per the constraint above.)
- **Per-task gate (every task, no exceptions):** `bun run typecheck` + `bun run lint` + the task's own focused test(s), run inline by the implementer. Web-touching tasks additionally run `cd web && bun run typecheck && bun run test`.
- **Controller gate:** full `bun run check` (docs:check · typecheck · lint · check:web · test) at each increment boundary — after **Task 9** (Increment 3), after **Task 13** (Increment 4), and after **Task 18** (final). `docs/architecture.md`/README/ROADMAP/ledger changes land in Increment 6 (Task 16), satisfying the pre-push slice-landing gate at whole-slice landing (prior 30b phases sequenced the same way); if `docs:check` flags the new `web/src/features/voice/` dir as undocumented at the Task 9/13 checkpoints, that is a known, tracked gap closed by Task 16, not a regression.
- **No new server routes this phase** — everything is isomorphic contracts, config, or client-only (`web/src/features/voice/`). `src/server/main.ts` gains only two more injected window globals.
- **HARD tasks → ultracode adversarial-verify Workflow** (not a single reviewer): the §7.1 pieces (Task 5 downsample carry-state, Tasks 10–11 VAD segmentation) and the §7.2 piece (Task 12 worker lifecycle + gesture guard + teardown). Task 13 is a dedicated review-only checkpoint enumerating the §7.1/§7.2 requirements for that Workflow.
- **Conventional commits:** `feat(voice): ...` / `test(voice): ...` per task.
- **Interim transcript is a busy indicator, not word-streaming:** `SttEngine.transcribe()` returns `Promise<string>` (a per-segment final). "interim→final" UX = a "transcribing…" state while a segment decodes, then the final text appended; tap-to-toggle appends progressively per VAD segment. Documented as a limitation in Task 16's architecture.md section.
- **MicButton renders TWO explicit affordances** (a hold-to-talk button + a tap-to-toggle button), not one press-duration-disambiguated button (the spec left that unspecified; two buttons are unambiguous + testable).

---
### Task 1: Lift `VoiceFrames` into `src/contracts/voice.ts` (plain type, non-zod)

**Files:**
- Create: `src/contracts/voice.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/voice/types.ts:1-5`
- Test: `tests/contracts/voice.test.ts`

**Interfaces:**
- Consumes: nothing (this is the first task; `Float32Array` is a built-in).
- Produces: `VoiceFrames` type (`{ samples: Float32Array; sampleRate: 16000 }`), importable from `src/contracts/voice.ts`, `src/contracts/index.ts` (via `@contracts` in `web/`), and re-exported (not redefined) from `src/voice/types.ts` for every existing CLI import site (`src/voice/capture.ts`, `src/voice/transcribe.ts`, `src/telemetry/spans.ts`, and their tests).

- [ ] **Step 1: Write the failing test**

Create `tests/contracts/voice.test.ts`:

```ts
import { expect, test } from 'bun:test';
import type { VoiceFrames } from '../../src/contracts/voice.ts';

test('VoiceFrames is a plain {samples,sampleRate:16000} shape (contracts, no zod — D5 exception)', () => {
  const frames: VoiceFrames = {
    samples: new Float32Array([0.1, -0.2, 0.3]),
    sampleRate: 16000,
  };
  expect(frames.sampleRate).toBe(16000);
  expect(frames.samples).toBeInstanceOf(Float32Array);
  expect(frames.samples.length).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/voice.test.ts`
Expected: FAIL — `error: Cannot find module '../../src/contracts/voice.ts'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/contracts/voice.ts`:

```ts
/**
 * Raw audio ready for the STT engine: mono Float32 in [-1,1] at 16 kHz.
 * Lifted from `src/voice/types.ts` (Slice 30b Phase 7, D5) so the browser
 * voice code (`web/src/features/voice/`) and the CLI (`src/voice/`) share
 * ONE definition — `src/voice/types.ts` re-exports this rather than
 * redefining it.
 *
 * Deliberate exception to the "every contract is a zod schema" convention
 * every other file in this directory follows: `VoiceFrames` never crosses
 * an HTTP wire in this phase (audio never leaves the browser tab — there is
 * no server-side voice route), so there is no round-trip to validate and a
 * zod schema for a `Float32Array` field would add ceremony with nothing to
 * protect.
 */
export type VoiceFrames = {
  samples: Float32Array;
  sampleRate: 16000;
};
```

Modify `src/contracts/index.ts` (add the new re-export, alphabetically before `./enums.ts` would read oddly — keep the existing four lines and simply append):

```ts
export * from './dto.ts';
export * from './enums.ts';
export * from './events.ts';
export * from './requests.ts';
export * from './voice.ts';
```

Modify `src/voice/types.ts` — replace the local `VoiceFrames` definition (lines 1-5) with a re-export:

```ts
/** Re-exported from contracts (Slice 30b Phase 7, D5) — the browser voice
 *  code needs the IDENTICAL shape and `src/voice/` is Node-only, so
 *  `src/contracts/voice.ts` is now the single source of truth; this file
 *  re-exports rather than redefines. */
export type { VoiceFrames } from '../contracts/voice.ts';
```

(Leave the rest of `src/voice/types.ts` — `CaptureSource`, `VoiceOutcome`, `VoiceError`, `VoiceConfig`, `Transcriber` — untouched for this task; `CaptureSource` moves in Task 2.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/contracts/voice.test.ts`
Expected: PASS (1 test).

Then confirm the CLI voice code still compiles against the re-export:

Run: `bun run typecheck`
Expected: PASS, no errors in `src/voice/**`, `src/telemetry/spans.ts`, or their tests.

Also run the full existing voice test suite to confirm nothing broke:

Run: `bun test tests/voice/`
Expected: PASS (all pre-existing voice tests, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/contracts/voice.ts src/contracts/index.ts src/voice/types.ts tests/contracts/voice.test.ts
git commit -m "feat(voice): lift VoiceFrames into src/contracts as a plain non-zod type (D5)"
```

### Task 2: Mirror `CaptureSource` into `src/contracts/enums.ts` with a parity test

**Files:**
- Modify: `src/contracts/enums.ts`
- Modify: `src/voice/types.ts:7-10` (the local `CaptureSource` definition, now removed → re-export)
- Test: `tests/contracts/capture-source-parity.test.ts`

**Interfaces:**
- Consumes: `src/contracts/enums.ts`'s existing enum-file conventions (mirrors `RuntimeKind`'s "wire mirror + parity test" pattern, `enums.ts:146-154`).
- Produces: `CaptureSource` enum (`Mic = 'mic'`, `File = 'file'` — values UNCHANGED from the CLI's current definition) importable from `src/contracts/enums.ts`, `src/contracts/index.ts`, and re-exported (not redefined) from `src/voice/types.ts` for `src/voice/transcribe.ts` and `src/telemetry/spans.ts`'s existing import sites.

**⚠ Values preserved (no rename):** the CLI's `CaptureSource` uses lowercase values (`Mic = 'mic'`, `File = 'file'`). This lift is a source-RELOCATION only — the enum values stay byte-identical, so the `voice.transcribe` span's `voice.capture.source` attribute value does NOT change and no existing test needs updating. (The earlier `phase7-interfaces.md` note showing `'Mic'/'File'` was a controller error; preserve `'mic'/'file'`.) `src/voice/transcribe.ts`/`tests/voice/spans.test.ts`/`tests/voice/transcribe.test.ts` reference the enum members (`CaptureSource.Mic`), never the raw string, and `tests/voice/types.test.ts` already asserts `'mic'` — all keep passing unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/contracts/capture-source-parity.test.ts` (mirrors `tests/contracts/runtime-kind-parity.test.ts`):

```ts
import { expect, test } from 'bun:test';
import { CaptureSource as ContractCaptureSource } from '../../src/contracts/enums.ts';
import { CaptureSource as VoiceCaptureSource } from '../../src/voice/types.ts';

test('contract CaptureSource values stay isomorphic with voice (single-sourced post-lift, D5)', () => {
  expect(Object.values(ContractCaptureSource).sort()).toEqual(
    Object.values(VoiceCaptureSource).sort(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/capture-source-parity.test.ts`
Expected: FAIL — `src/contracts/enums.ts` has no export named `CaptureSource`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/contracts/enums.ts` (after the `McpAuthKind` block, before `McpServerStatus`, or simply at the end of the file — appending at the end is simplest and matches the file's existing "append new enums as features land" pattern):

```ts
/** Wire mirror of `src/voice/types.ts` CaptureSource (isomorphic rule — no
 *  `src/voice/` import; that module is Node-only, pulling Bun spawn/ffmpeg
 *  glue). Lifted to be the SINGLE source of truth (Slice 30b Phase 7, D5) —
 *  `src/voice/types.ts` re-exports this rather than redefining it, so this
 *  parity test is a regression guard against future redefinition drift, not
 *  a live divergence check. Needed as a `voice.transcribe` span attribute
 *  value (`src/telemetry/spans.ts` `VOICE_CAPTURE_SOURCE`) from the browser
 *  path. `tests/contracts/capture-source-parity.test.ts` guards value
 *  parity. */
export enum CaptureSource {
  Mic = 'mic',
  File = 'file',
}
```

Modify `src/voice/types.ts` — replace the local `CaptureSource` enum (lines 7-10) with a re-export, right below the `VoiceFrames` re-export from Task 1:

```ts
/** Re-exported from contracts (Slice 30b Phase 7, D5) — see the VoiceFrames
 *  re-export above for the rationale. */
export { CaptureSource } from '../contracts/enums.ts';
```

No test change is needed — `tests/voice/types.test.ts` already asserts `CaptureSource.Mic` is `'mic'`, which stays true (values preserved).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/contracts/capture-source-parity.test.ts tests/voice/`
Expected: PASS (parity test + all pre-existing voice tests, unchanged).

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contracts/enums.ts src/voice/types.ts tests/contracts/capture-source-parity.test.ts
git commit -m "feat(voice): mirror CaptureSource into contracts with a parity test (D5)"
```

### Task 3: `AGENT_WEB_VOICE_*` config entries + `renderIndexHtml` window globals

**Files:**
- Modify: `src/config/schema.ts` (append two entries to `CONFIG_SPEC`, after the `AGENT_WEB_NOTIFY_MIN_DURATION_MS` entry at line 511)
- Modify: `src/server/main.ts:62-101,200-203` (`NotifyConfig`/`DEFAULT_NOTIFY_CONFIG` neighbors gain a `VoiceWindowConfig`/`DEFAULT_VOICE_CONFIG` pair; `renderIndexHtml` gains a 4th parameter; the `startWebServer` call site threads `cfg.AGENT_WEB_VOICE_*` through)
- Test: `tests/config/schema.test.ts` (append), `tests/server/main.test.ts` (append)

**Interfaces:**
- Consumes: `ConfigEntry`/`CONFIG_SPEC`/`loadConfig` (`src/config/schema.ts`, unchanged shape); `renderIndexHtml`'s existing `token`/`distIndexHtml`/`notify` parameters and `tokenScript` string-building mechanism (`src/server/main.ts:69-80`).
- Produces: `AGENT_WEB_VOICE_DEFAULT_MODEL` (string, default `'moonshine-base'`) and `AGENT_WEB_VOICE_VAD_SILENCE_MS` (number, default `800`) config keys; `window.__AGENT_VOICE_DEFAULT_MODEL__` / `window.__AGENT_VOICE_VAD_SILENCE_MS__` injected globals, read later by `web/src/features/settings/index.tsx` (Task 4) and `web/src/features/voice/*` (Tasks 5-9, Part B).

- [ ] **Step 1: Write the failing tests**

Append to `tests/config/schema.test.ts`:

```ts
test('AGENT_WEB_VOICE_DEFAULT_MODEL defaults to moonshine-base', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_WEB_VOICE_DEFAULT_MODEL).toBe('moonshine-base');
  expect(sources.AGENT_WEB_VOICE_DEFAULT_MODEL).toBe('default');
});
test('AGENT_WEB_VOICE_VAD_SILENCE_MS defaults to 800', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_WEB_VOICE_VAD_SILENCE_MS).toBe(800);
  expect(sources.AGENT_WEB_VOICE_VAD_SILENCE_MS).toBe('default');
});
```

Append to `tests/server/main.test.ts`:

```ts
test('renderIndexHtml also injects the voice config (defaults) alongside the token', () => {
  const html = renderIndexHtml('tok-999');
  expect(html).toContain('window.__AGENT_VOICE_DEFAULT_MODEL__="moonshine-base"');
  expect(html).toContain('window.__AGENT_VOICE_VAD_SILENCE_MS__=800');
});

test('renderIndexHtml threads an explicit voice config through', () => {
  const html = renderIndexHtml('tok-1000', undefined, undefined, {
    defaultModel: 'moonshine-tiny',
    vadSilenceMs: 1200,
  });
  expect(html).toContain('window.__AGENT_VOICE_DEFAULT_MODEL__="moonshine-tiny"');
  expect(html).toContain('window.__AGENT_VOICE_VAD_SILENCE_MS__=1200');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/config/schema.test.ts tests/server/main.test.ts`
Expected: FAIL — `values.AGENT_WEB_VOICE_DEFAULT_MODEL` is `undefined` (no such config entry yet); `renderIndexHtml` doesn't accept/inject a 4th param yet (the two new assertions on `html` fail — the strings aren't present).

- [ ] **Step 3: Write minimal implementation**

In `src/config/schema.ts`, append two entries to `CONFIG_SPEC` immediately after the `AGENT_WEB_NOTIFY_MIN_DURATION_MS` entry (before the closing `];` at line 512):

```ts
  {
    env: 'AGENT_WEB_VOICE_DEFAULT_MODEL',
    kind: 'string',
    def: 'moonshine-base',
    doc: "Default Moonshine model tier for browser voice input (web/src/features/voice/stt-engine.ts): 'moonshine-base' (~120-150MB, default, better accuracy) or 'moonshine-tiny' (~76MB, faster/lighter). Injected into the served page as window.__AGENT_VOICE_DEFAULT_MODEL__ (server/main.ts renderIndexHtml). Slice 30b Phase 7.",
  },
  {
    env: 'AGENT_WEB_VOICE_VAD_SILENCE_MS',
    kind: 'number',
    def: 800,
    doc: 'Sustained silence (ms) that closes a tap-to-toggle voice segment (web/src/features/voice/vad.ts Segmenter). Injected into the served page as window.__AGENT_VOICE_VAD_SILENCE_MS__ (server/main.ts renderIndexHtml). Slice 30b Phase 7.',
  },
```

In `src/server/main.ts`, add a `VoiceWindowConfig` type + default next to `NotifyConfig`/`DEFAULT_NOTIFY_CONFIG` (around line 62-67):

```ts
export type NotifyConfig = { pollMs: number; minDurationMs: number };

const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  pollMs: 5_000,
  minDurationMs: 60_000,
};

export type VoiceWindowConfig = { defaultModel: string; vadSilenceMs: number };

const DEFAULT_VOICE_CONFIG: VoiceWindowConfig = {
  defaultModel: 'moonshine-base',
  vadSilenceMs: 800,
};
```

Update `renderIndexHtml`'s signature and `tokenScript` build (lines 69-80) to accept and inject a 4th parameter:

```ts
export function renderIndexHtml(
  token: string,
  distIndexHtml?: string,
  notify: NotifyConfig = DEFAULT_NOTIFY_CONFIG,
  voice: VoiceWindowConfig = DEFAULT_VOICE_CONFIG,
): string {
  // JSON.stringify does not escape `</`, so a token value could break out of
  // the <script> tag; escape `<` to a unicode escape before interpolating.
  const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
  const tokenScript =
    `<script>window.__AGENT_TOKEN__=${safeToken};` +
    `window.__AGENT_NOTIFY_POLL_MS__=${JSON.stringify(notify.pollMs)};` +
    `window.__AGENT_NOTIFY_MIN_DURATION_MS__=${JSON.stringify(notify.minDurationMs)};` +
    `window.__AGENT_VOICE_DEFAULT_MODEL__=${JSON.stringify(voice.defaultModel)};` +
    `window.__AGENT_VOICE_VAD_SILENCE_MS__=${JSON.stringify(voice.vadSilenceMs)};</script>`;
```

(The rest of `renderIndexHtml`'s body — the `distIndexHtml` branch and the Phase-1 stub fallback — is unchanged; both already just concatenate `tokenScript` wherever it was used, so the extra globals ride along automatically.)

Update the `startWebServer` call site (around line 200-203) to thread the real config values through:

```ts
    indexHtml: renderIndexHtml(
      token,
      distIndexHtml,
      {
        pollMs: cfg.AGENT_WEB_NOTIFY_POLL_MS as number,
        minDurationMs: cfg.AGENT_WEB_NOTIFY_MIN_DURATION_MS as number,
      },
      {
        defaultModel: cfg.AGENT_WEB_VOICE_DEFAULT_MODEL as string,
        vadSilenceMs: cfg.AGENT_WEB_VOICE_VAD_SILENCE_MS as number,
      },
    ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/config/schema.test.ts tests/server/main.test.ts`
Expected: PASS (all existing + new assertions, including the pre-existing notify-config tests which must still pass unchanged since `notify`/`voice` are independent parameters).

Run: `bun run typecheck && bun run lint:file -- "src/config/schema.ts" "src/server/main.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/server/main.ts tests/config/schema.test.ts tests/server/main.test.ts
git commit -m "feat(voice): add AGENT_WEB_VOICE_* config + renderIndexHtml window globals (D7)"
```

### Task 4: Settings UI — voice-enable toggle + model-tier selector

**Files:**
- Modify: `web/src/features/settings/index.tsx` (full new content shown below)
- Test: `web/src/features/settings/index.test.tsx` (append new `describe` block)

**Interfaces:**
- Consumes: `Button` (`web/src/shared/ui/button.tsx`, unchanged); `window.__AGENT_VOICE_DEFAULT_MODEL__` (Task 3, read as a fallback default; absent/undefined in tests, which is fine — falls back to `'moonshine-base'`).
- Produces: `isVoiceInputEnabled(): boolean` and `voiceModelTier(): ModelTier` accessors (mirroring `isOsNotifyEnabled()`), consumed later by `mic-button.tsx` (Part B). **`ModelTier` is defined HERE temporarily** (`'moonshine-base' | 'moonshine-tiny'`) since `web/src/features/voice/stt-engine.ts` doesn't exist until Task 8; Task 8 makes `stt-engine.ts` the canonical home and updates this file to import it from there instead (documented in Task 8's steps — no permanent duplicate).

- [ ] **Step 1: Write the failing test**

Append to `web/src/features/settings/index.test.tsx` (after the existing `describe('SettingsArea', ...)` block, same file, new `describe`; add `isVoiceInputEnabled, voiceModelTier` to the existing import line):

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import { isOsNotifyEnabled, isVoiceInputEnabled, voiceModelTier } from './index.tsx';
```

```tsx
describe('SettingsArea — voice input', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the voice-input toggle, initially off, defaulting the model tier to moonshine-base', async () => {
    renderAt('/settings');
    expect(await screen.findByTestId('voice-input-toggle')).toHaveTextContent(
      'Enable voice input',
    );
    expect(isVoiceInputEnabled()).toBe(false);
    expect(voiceModelTier()).toBe('moonshine-base');
  });

  it('turns voice input on when clicked and persists the choice', async () => {
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('voice-input-toggle'));
    expect(await screen.findByText('Voice input: on')).toBeInTheDocument();
    expect(isVoiceInputEnabled()).toBe(true);
  });

  it('toggles voice input back off when clicked again while already on', async () => {
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('voice-input-toggle'));
    expect(await screen.findByText('Voice input: on')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('voice-input-toggle'));
    expect(await screen.findByText('Enable voice input')).toBeInTheDocument();
    expect(isVoiceInputEnabled()).toBe(false);
  });

  it('changes and persists the model tier selection', async () => {
    renderAt('/settings');
    const select = await screen.findByTestId('voice-model-tier');
    fireEvent.change(select, { target: { value: 'moonshine-tiny' } });
    expect(voiceModelTier()).toBe('moonshine-tiny');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- settings/index.test.tsx`
Expected: FAIL — `isVoiceInputEnabled`/`voiceModelTier` are not exported from `./index.tsx`; `findByTestId('voice-input-toggle')` never resolves (element doesn't exist).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `web/src/features/settings/index.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';

const STORAGE_KEY = 'agent.notifyOsEnabled';
const VOICE_ENABLED_KEY = 'agent.voiceInputEnabled';
const VOICE_MODEL_TIER_KEY = 'agent.voiceModelTier';

/** Temporary home for `ModelTier` (Slice 30b Phase 7 Task 4) — Task 8 makes
 *  `web/src/features/voice/stt-engine.ts` the canonical definition and this
 *  file switches to importing it from there instead of redefining it. */
export type ModelTier = 'moonshine-base' | 'moonshine-tiny';

function storedPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Read by `use-run-notifications`'s AppShell wiring (T62) to decide whether
 *  a qualifying notification should ALSO fire a browser `Notification`, on
 *  top of the always-on in-app toast. */
export function isOsNotifyEnabled(): boolean {
  return storedPreference();
}

function isModelTier(value: string | null): value is ModelTier {
  return value === 'moonshine-base' || value === 'moonshine-tiny';
}

/** Falls back to the server-injected default (Task 3's
 *  `window.__AGENT_VOICE_DEFAULT_MODEL__`), then to `'moonshine-base'` if
 *  that global is absent (e.g. in tests, or the Phase-1 stub page). */
function defaultModelTier(): ModelTier {
  const fromWindow = (
    globalThis as { __AGENT_VOICE_DEFAULT_MODEL__?: string }
  ).__AGENT_VOICE_DEFAULT_MODEL__;
  return isModelTier(fromWindow ?? null) ? (fromWindow as ModelTier) : 'moonshine-base';
}

function storedVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(VOICE_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function storedVoiceModelTier(): ModelTier {
  try {
    const raw = localStorage.getItem(VOICE_MODEL_TIER_KEY);
    return isModelTier(raw) ? raw : defaultModelTier();
  } catch {
    return defaultModelTier();
  }
}

/** Read by `mic-button.tsx` (Part B) to decide whether to mount/enable the
 *  voice-capture affordance at all. */
export function isVoiceInputEnabled(): boolean {
  return storedVoiceEnabled();
}

/** Read by `mic-button.tsx`/`use-voice-input.ts` (Part B) to pick which
 *  Moonshine checkpoint `stt-engine.ts` loads. */
export function voiceModelTier(): ModelTier {
  return storedVoiceModelTier();
}

/** Settings' first real control (replacing the Phase-1 placeholder): an
 *  opt-in toggle for browser `Notification` API alerts, layered on top of
 *  the always-on in-app toast (spec D11 — toast is the fallback, this is
 *  additive). Slice 30b Phase 7 adds a second, independent control block:
 *  voice input enable + model tier (D7), no engine wiring yet — that's
 *  `mic-button.tsx` (Part B). */
export function SettingsArea() {
  const [enabled, setEnabled] = useState(storedPreference);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );
  const [voiceEnabled, setVoiceEnabled] = useState(storedVoiceEnabled);
  const [modelTier, setModelTier] = useState<ModelTier>(storedVoiceModelTier);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // ignore persistence failure — the toggle still applies for the session
    }
  }, [enabled]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_ENABLED_KEY, String(voiceEnabled));
    } catch {
      // ignore persistence failure — the toggle still applies for the session
    }
  }, [voiceEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_MODEL_TIER_KEY, modelTier);
    } catch {
      // ignore persistence failure — the selection still applies for the session
    }
  }, [modelTier]);

  async function handleToggle() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return; // user declined — stay off
    } else if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'denied'
    ) {
      return; // previously denied outright — nothing to prompt again
    }
    setEnabled(true);
  }

  return (
    <section data-testid="area-settings" className="p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Settings</h1>
      <div className="mt-4 flex items-center gap-3">
        <Button
          data-testid="notify-os-toggle"
          variant={enabled ? 'accent' : 'default'}
          onClick={handleToggle}
        >
          {enabled ? 'OS notifications: on' : 'Enable OS notifications'}
        </Button>
        {permission === 'denied' && (
          <span className="text-xs text-[var(--color-muted)]">
            Browser permission was denied — enable it in your browser's site
            settings.
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        In-app toasts always fire; OS notifications are an optional extra for
        when this tab isn't focused.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button
          data-testid="voice-input-toggle"
          variant={voiceEnabled ? 'accent' : 'default'}
          onClick={() => setVoiceEnabled((v) => !v)}
        >
          {voiceEnabled ? 'Voice input: on' : 'Enable voice input'}
        </Button>
        <select
          data-testid="voice-model-tier"
          value={modelTier}
          disabled={!voiceEnabled}
          onChange={(e) => setModelTier(e.target.value as ModelTier)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]"
        >
          <option value="moonshine-base">Moonshine base (accurate, ~130MB)</option>
          <option value="moonshine-tiny">Moonshine tiny (fast, ~76MB)</option>
        </select>
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Voice input transcribes speech into the composer locally in your
        browser; nothing is sent to a server for transcription. Models
        download on first use.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- settings/index.test.tsx`
Expected: PASS (all pre-existing OS-notify tests + the 4 new voice-input tests).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx
git commit -m "feat(voice): Settings voice-enable toggle + model-tier selector (D7)"
```

---

## Increment 2: Audio capture + downsampler (Tasks 5–6)

### Task 5: `createDownsampler` — the pure, carry-state 48k→16k resampler (§7.1 correctness surface)

This is the single most correctness-critical function in Phase 7 (spec §7.1(a)). It must carry fractional-sample state across arbitrary `process()` call boundaries (the AudioWorklet's 128-frame native quanta) with **no dropped or duplicated samples** — mirroring `src/voice/capture.ts`'s `carryPcmChunk` leftover-byte-carry pattern, adapted from byte-alignment to continuous-time linear-interpolation resampling.

**The algorithm (so the implementer doesn't have to re-derive it):** output samples sit on a continuous grid `p_k = k * ratio` (where `ratio = inputRate / 16000`), in GLOBAL input-sample-index units, starting at `k=0`. State carried between calls: `nextP` (the next `k*ratio` position to compute), `globalOffsetSoFar` (total input samples consumed across all previous calls — i.e., the global index of the FIRST sample in the quantum about to be processed), and `prevLast` (the last sample value of the previous quantum, needed only when an output position's lower interpolation index falls exactly on the previous quantum's last sample). Per call: `idxLow = floor(nextP) - globalOffsetSoFar` is provably always `>= -1` (an inductive invariant — the loop only ever stops once `nextP` is within one sample of running out of the CURRENT quantum's data, so the next call can never need to look back more than one sample); `idxLow === -1` means "use `prevLast`", otherwise index directly into the current quantum. This makes the function's output **provably invariant to how the same total input is chunked** — re-chunking differently only changes which call computes which output sample, never the sequence of floating-point operations performed (same `nextP` value, same formula), so chunked output is bit-identical to a single-call reference.

**Files:**
- Create: `web/src/features/voice/audio-capture.ts` (this task only adds `createDownsampler`; `createAudioCapture` is Task 6, appended to the same file)
- Test: `web/src/features/voice/audio-capture.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no imports beyond `Float32Array`).
- Produces: `export type DownsampleState = { carry: number };` (documented but not directly constructed by callers — internal shape note per `phase7-interfaces.md`) and `export function createDownsampler(inputRate: number): { process(quantum: Float32Array): Float32Array; flush(): Float32Array };`. Consumed by `downsample-worklet.ts` (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/voice/audio-capture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDownsampler } from './audio-capture.ts';

describe('createDownsampler', () => {
  it('produces exact expected samples for a 3:1 ratio (48k→16k) single-call ramp, zero floating error', () => {
    // x[i] = 3*i so every interpolated point lands exactly on an integer
    // sample with frac=0 — the arithmetic has no rounding, so exact
    // equality (not toBeCloseTo) is a meaningful assertion.
    const downsampler = createDownsampler(48000);
    const input = new Float32Array([0, 3, 6, 9, 12, 15]);
    const output = downsampler.process(input);
    expect(Array.from(output)).toEqual([0, 9]);
  });

  it('carries state correctly across a chunk boundary: two chunks of the same ramp equal one big chunk', () => {
    const oneShot = createDownsampler(48000);
    const wholeInput = new Float32Array([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33]);
    const referenceOutput = Array.from(oneShot.process(wholeInput));

    const chunked = createDownsampler(48000);
    const chunk1 = wholeInput.subarray(0, 6);
    const chunk2 = wholeInput.subarray(6, 12);
    const chunkedOutput = [
      ...chunked.process(chunk1),
      ...chunked.process(chunk2),
    ];

    expect(chunkedOutput).toEqual(referenceOutput);
    expect(referenceOutput).toEqual([0, 9, 18, 27]);
  });

  it('is invariant to arbitrary non-aligned chunk sizes, including a boundary that requires the carried prevLast sample (a fractional 1.5:1 ratio)', () => {
    // x[i] = i, ratio 24000/16000 = 1.5. Chunked as [2, 1, 3] deliberately
    // straddles an output position that falls exactly on the boundary
    // between chunk1's last sample and chunk2's first sample — this is the
    // one case that requires `prevLast`, not just direct quantum indexing.
    const wholeInput = new Float32Array([0, 1, 2, 3, 4, 5]);

    const oneShot = createDownsampler(24000);
    const referenceOutput = Array.from(oneShot.process(wholeInput));
    expect(referenceOutput).toEqual([0, 1.5, 3, 4.5]);

    const chunked = createDownsampler(24000);
    const out1 = chunked.process(wholeInput.subarray(0, 2)); // [0, 1]
    const out2 = chunked.process(wholeInput.subarray(2, 3)); // [2] — triggers prevLast
    const out3 = chunked.process(wholeInput.subarray(3, 6)); // [3, 4, 5]
    const chunkedOutput = [...out1, ...out2, ...out3];

    expect(chunkedOutput).toEqual(referenceOutput);
  });

  it('is invariant to arbitrary non-128-aligned AudioWorklet-style quantum sizes over a longer signal', () => {
    // A realistic 48k→16k conversion over exactly 1 second (48000 samples),
    // once as native 128-frame render quanta, once chopped into deliberately
    // odd, non-aligned sizes. Same total length, different boundaries.
    const total = 48000;
    const signal = new Float32Array(total);
    for (let i = 0; i < total; i++) signal[i] = Math.sin(i * 0.01);

    const asQuanta128 = createDownsampler(48000);
    const quantaOutput: number[] = [];
    for (let i = 0; i < total; i += 128) {
      quantaOutput.push(...asQuanta128.process(signal.subarray(i, i + 128)));
    }

    const oddSizes = [37, 91, 5, 200, 1, 333, 128, 4001];
    const asOddChunks = createDownsampler(48000);
    const oddOutput: number[] = [];
    let offset = 0;
    for (const size of oddSizes) {
      oddOutput.push(...asOddChunks.process(signal.subarray(offset, offset + size)));
      offset += size;
    }
    // Drain the remainder in one final chunk so both partitions cover the
    // exact same total length.
    oddOutput.push(...asOddChunks.process(signal.subarray(offset, total)));

    expect(oddOutput).toEqual(quantaOutput);
    // 48000 input samples at a 3:1 ratio yields exactly 16000 output samples
    // (k ranges 0..15999, since 15999*3 = 47997 < 47999 = total-1, and
    // 16000*3 = 48000 is not < 47999).
    expect(quantaOutput.length).toBe(16000);
  });

  it('flush() returns empty (no output sample is ever withheld beyond what process() already emitted) and resets state for reuse', () => {
    const downsampler = createDownsampler(48000);
    downsampler.process(new Float32Array([0, 3, 6, 9, 12, 15]));
    const residual = downsampler.flush();
    expect(Array.from(residual)).toEqual([]);

    // After flush, a fresh sequence must behave identically to a brand-new
    // instance — no leftover state bleeds into the next capture session.
    const reused = downsampler.process(new Float32Array([0, 3, 6, 9, 12, 15]));
    const fresh = createDownsampler(48000).process(
      new Float32Array([0, 3, 6, 9, 12, 15]),
    );
    expect(Array.from(reused)).toEqual(Array.from(fresh));
  });

  it('never throws and returns empty on a zero-length quantum', () => {
    const downsampler = createDownsampler(48000);
    expect(Array.from(downsampler.process(new Float32Array(0)))).toEqual([]);
    // A real quantum after the empty one still works normally.
    expect(
      Array.from(downsampler.process(new Float32Array([0, 3, 6, 9, 12, 15]))),
    ).toEqual([0, 9]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: FAIL — `error: Cannot find module './audio-capture.ts'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `web/src/features/voice/audio-capture.ts`:

```ts
const OUTPUT_RATE = 16000;

/** Fractional carry state a `createDownsampler` instance threads across
 *  `process()` calls (documented shape; callers never construct one
 *  directly — it lives inside the closure returned by `createDownsampler`). */
export type DownsampleState = { carry: number };

/**
 * Streaming linear-interpolation resampler from `inputRate` down to the
 * fixed 16 kHz `VoiceFrames` rate. Carries continuous state across
 * `process()` calls so an AudioWorklet render-quantum boundary (128 frames,
 * arbitrary with respect to the resample ratio — Web Audio spec) never
 * drops or duplicates a sample (spec §7.1). Mirrors `src/voice/capture.ts`'s
 * `carryPcmChunk` leftover-byte-carry pattern, adapted from byte-alignment
 * to continuous-time resampling.
 *
 * Output samples sit on the continuous grid `p_k = k * ratio` (in GLOBAL
 * input-sample-index units, k = 0, 1, 2, ...). `nextP` is the next `p_k` to
 * compute; `globalOffsetSoFar` is the global index of the first sample in
 * the quantum about to be processed; `prevLast` is the previous quantum's
 * final sample, needed only when an output position's lower interpolation
 * index falls exactly on that boundary sample (`idxLow === -1`). This makes
 * the function's output PROVABLY invariant to how the same total input is
 * chunked: re-chunking only changes which call computes which output
 * sample, never the sequence of floating-point operations performed.
 */
export function createDownsampler(inputRate: number): {
  process(quantum: Float32Array): Float32Array;
  flush(): Float32Array;
} {
  const ratio = inputRate / OUTPUT_RATE;
  let nextP = 0;
  let globalOffsetSoFar = 0;
  let prevLast: number | undefined;

  function process(quantum: Float32Array): Float32Array {
    const n = quantum.length;
    if (n === 0) return new Float32Array(0);
    const out: number[] = [];
    const upperBound = globalOffsetSoFar + n - 1;
    while (nextP < upperBound) {
      const floorP = Math.floor(nextP);
      const frac = nextP - floorP;
      const idxLow = floorP - globalOffsetSoFar;
      // Invariant (proven in the doc comment above): idxLow is always >= -1
      // here, and idxLow+1 is always a valid index into `quantum` — so
      // these reads are safe despite `noUncheckedIndexedAccess`.
      const s0 = idxLow === -1 ? (prevLast as number) : (quantum[idxLow] as number);
      const s1 = idxLow === -1 ? (quantum[0] as number) : (quantum[idxLow + 1] as number);
      out.push(s0 + (s1 - s0) * frac);
      nextP += ratio;
    }
    globalOffsetSoFar += n;
    prevLast = quantum[n - 1];
    return new Float32Array(out);
  }

  function flush(): Float32Array {
    // No output sample is ever withheld beyond what `process()` already
    // emitted: a point is only produced once BOTH its bracketing input
    // samples are known, so there is nothing left to synthesize at stop
    // without extrapolating audio that was never captured. Reset state so
    // the instance is safe to reuse for a fresh capture session.
    nextP = 0;
    globalOffsetSoFar = 0;
    prevLast = undefined;
    return new Float32Array(0);
  }

  return { process, flush };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: PASS (7 tests).

Run: `cd web && bun run typecheck`
Expected: PASS (verify the `noUncheckedIndexedAccess`-driven casts above compile cleanly).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/audio-capture.ts web/src/features/voice/audio-capture.test.ts
git commit -m "feat(voice): pure carry-state 48k downsampler with chunk-invariance tests (D3, spec §7.1)"
```

### Task 6: `createAudioCapture` (getUserMedia + AudioWorklet wiring) + `downsample-worklet.ts` + `setup.ts` stubs

The worklet processor itself (`downsample-worklet.ts`) runs inside the browser's real-time audio-rendering thread — it cannot execute under happy-dom/Vitest. This task tests `createAudioCapture`'s **lifecycle** (getUserMedia call shape, start/stop, chunk/level fan-out, track teardown) against fixture Web Audio globals added to the shared test setup; the worklet file's actual resample behavior is already fully covered by Task 5's direct `createDownsampler` tests (it is a thin wrapper with no logic of its own beyond calling `process()`/`flush()`).

**Files:**
- Modify: `web/src/features/voice/audio-capture.ts` (append `createAudioCapture` below `createDownsampler`)
- Create: `web/src/features/voice/downsample-worklet.ts`
- Modify: `web/src/test/setup.ts` (append Web Audio / getUserMedia fixtures)
- Modify: `web/src/features/voice/audio-capture.test.ts` (append `describe('createAudioCapture', ...)`)

**Interfaces:**
- Consumes: `createDownsampler` (Task 5, same file, used only inside `downsample-worklet.ts`).
- Produces: `export type AudioCapture = { start(): Promise<void>; stop(): Promise<void>; onChunk(cb): () => void; onLevel(cb): () => void; readonly active: boolean };` and `export function createAudioCapture(): AudioCapture;`. Consumed by `use-voice-input.ts` (Part B, Task 10+). Also exports `FakeMediaStream`/`FakeAudioContext`/`FakeAudioWorkletNode`/`getLastAudioWorkletNode` fixtures from `web/src/test/setup.ts`, reused by any future voice test needing to simulate a worklet message.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/test/setup.ts`:

```ts
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
```

Modify the top of `web/src/features/voice/audio-capture.test.ts` — add a new import line for the `setup.ts` fixtures, and merge `createAudioCapture` into the existing `./audio-capture.ts` import from Task 5 (so there is one import statement per module, not two):

```ts
import { describe, expect, it } from 'vitest';
import {
  getLastAudioContext,
  getLastAudioWorkletNode,
  getLastGetUserMediaConstraints,
  getLastMediaStream,
} from '../../test/setup.ts';
import { createAudioCapture, createDownsampler } from './audio-capture.ts';
```

Then append the new `describe` block at the bottom of the same file:

```ts
describe('createAudioCapture', () => {
  it('start() requests AEC/noise-suppression/AGC getUserMedia, opens an AudioContext + worklet, and flips active', async () => {
    const capture = createAudioCapture();
    expect(capture.active).toBe(false);
    await capture.start();
    expect(capture.active).toBe(true);
    expect(getLastGetUserMediaConstraints()).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(getLastAudioWorkletNode()).toBeDefined();
  });

  it('forwards worklet chunks to onChunk subscribers and a computed RMS level to onLevel subscribers', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const chunks: Float32Array[] = [];
    const levels: number[] = [];
    capture.onChunk((c) => chunks.push(c));
    capture.onLevel((l) => levels.push(l));

    const node = getLastAudioWorkletNode();
    const chunk = new Float32Array([1, -1, 1, -1]); // RMS = 1
    node?.port.onmessage?.({ data: chunk } as MessageEvent);

    expect(chunks).toEqual([chunk]);
    expect(levels).toEqual([1]);
  });

  it('onChunk/onLevel unsubscribe stops further callbacks', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const chunks: Float32Array[] = [];
    const unsubscribe = capture.onChunk((c) => chunks.push(c));
    unsubscribe();

    const node = getLastAudioWorkletNode();
    node?.port.onmessage?.({ data: new Float32Array([0.5]) } as MessageEvent);

    expect(chunks).toEqual([]);
  });

  it('stop() stops every MediaStream track, closes the AudioContext, and flips active off', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const stream = getLastMediaStream();
    const ctx = getLastAudioContext();
    await capture.stop();
    expect(capture.active).toBe(false);
    for (const track of stream?.getTracks() ?? []) {
      expect(track.readyState).toBe('ended');
    }
    expect(ctx?.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: FAIL — `createAudioCapture` is not exported from `./audio-capture.ts`; `getLastAudioWorkletNode`/`getLastGetUserMediaConstraints` are not exported from `../../test/setup.ts`.

- [ ] **Step 3: Write minimal implementation**

Append to `web/src/features/voice/audio-capture.ts` (below `createDownsampler`):

```ts
const WORKLET_MODULE_URL = new URL('./downsample-worklet.ts', import.meta.url);
const WORKLET_PROCESSOR_NAME = 'downsample-processor';

export type AudioCapture = {
  start(): Promise<void>;
  stop(): Promise<void>;
  onChunk(cb: (chunk16k: Float32Array) => void): () => void;
  onLevel(cb: (rms: number) => void): () => void;
  readonly active: boolean;
};

function rms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let sumSquares = 0;
  for (const v of chunk) sumSquares += v * v;
  return Math.sqrt(sumSquares / chunk.length);
}

/**
 * Wraps `getUserMedia` (with AEC/noise-suppression/AGC — the real acoustic
 * echo cancellation Slice 29's CLI never had, D3) and an `AudioWorkletNode`
 * running `downsample-worklet.ts`. 16 kHz mono chunks arrive via
 * `node.port.onmessage` and fan out to `onChunk` subscribers; an RMS level
 * (0..1-ish for a normalized signal) fans out to `onLevel` subscribers for
 * `waveform.tsx` (Part B).
 */
export function createAudioCapture(): AudioCapture {
  let stream: MediaStream | undefined;
  let ctx: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let active = false;
  const chunkListeners = new Set<(chunk16k: Float32Array) => void>();
  const levelListeners = new Set<(rms: number) => void>();

  async function start(): Promise<void> {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule(WORKLET_MODULE_URL);
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, WORKLET_PROCESSOR_NAME, {
      processorOptions: { inputRate: ctx.sampleRate },
    });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const chunk = event.data;
      for (const cb of chunkListeners) cb(chunk);
      const level = rms(chunk);
      for (const cb of levelListeners) cb(level);
    };
    source.connect(node);
    active = true;
  }

  async function stop(): Promise<void> {
    for (const track of stream?.getTracks() ?? []) track.stop();
    source?.disconnect();
    node?.disconnect();
    await ctx?.close();
    stream = undefined;
    ctx = undefined;
    source = undefined;
    node = undefined;
    active = false;
  }

  return {
    start,
    stop,
    onChunk(cb) {
      chunkListeners.add(cb);
      return () => chunkListeners.delete(cb);
    },
    onLevel(cb) {
      levelListeners.add(cb);
      return () => levelListeners.delete(cb);
    },
    get active() {
      return active;
    },
  };
}
```

Create `web/src/features/voice/downsample-worklet.ts`:

```ts
// Runs inside the browser's real-time AudioWorkletGlobalScope — NOT
// unit-testable under happy-dom/Vitest (no such runtime exists there). The
// only logic here is wiring `createDownsampler` (Task 5, fully unit-tested
// in isolation) to the Web Audio `process()` callback; verified for real in
// the Part B live-verify increment (Task 18).
//
// `AudioWorkletProcessor`/`registerProcessor` are not part of any standard
// TypeScript lib (`dom` does not include the worklet global scope) — these
// two ambient declarations stand in for the real browser globals so this
// file typechecks; they are never actually defined at compile time, only at
// runtime inside a real AudioWorkletGlobalScope.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

import { createDownsampler } from './audio-capture.ts';

class DownsampleProcessor extends AudioWorkletProcessor {
  private readonly downsampler: ReturnType<typeof createDownsampler>;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const inputRate =
      (options?.processorOptions as { inputRate: number } | undefined)
        ?.inputRate ?? 48000;
    this.downsampler = createDownsampler(inputRate);
  }

  override process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      const chunk16k = this.downsampler.process(channel);
      if (chunk16k.length > 0) {
        this.port.postMessage(chunk16k, [chunk16k.buffer]);
      }
    }
    return true; // keep the processor alive across renders
  }
}

registerProcessor('downsample-processor', DownsampleProcessor);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: PASS (11 tests total: 7 from Task 5 + 4 new `createAudioCapture` tests).

Run: `cd web && bun run typecheck`
Expected: PASS — confirms `downsample-worklet.ts`'s ambient `AudioWorkletProcessor`/`registerProcessor` declarations and the `override process()` compile cleanly, and that `createAudioCapture`'s `AudioContext`/`AudioWorkletNode`/`MediaStreamAudioSourceNode` usage matches the DOM lib types.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/audio-capture.ts web/src/features/voice/downsample-worklet.ts web/src/features/voice/audio-capture.test.ts web/src/test/setup.ts
git commit -m "feat(voice): createAudioCapture (getUserMedia+AudioWorklet) + downsample-worklet processor (D3/D4)"
```

---

## Increment 3: STT worker + lazy load (Tasks 7–9)

### Task 7: D10 browser spike (manual) + `stt.worker.ts` scaffold (message protocol + transformers.js wiring)

**This task OPENS with the spec's mandated D10 spike — a real-browser check that must happen BEFORE any of this task's code is considered final.** The spec's own words (§3, D10): "Increment 3 therefore OPENS with a ≤1-hour spike: in a real Chrome tab served with the app's actual headers, load `moonshine-tiny` + `silero-vad` through transformers.js and transcribe a buffer... The spike picks the lowest rung that works; the plan records which." This is a manual verification step, not an automated test — the worker code below is written to the best-known shape of the transformers.js v4.2.0 API and is the artifact the spike proves (or requires correcting).

**Files:**
- Create: `web/src/features/voice/stt.worker.ts`
- No automated test this task (see the manual spike checklist in Step 1 — this file runs inside a Web Worker with a real ONNX/WASM runtime, which cannot execute under happy-dom/Vitest; `stt-engine.ts`'s message-protocol handling, the part that IS unit-testable, is Task 8).

**Interfaces:**
- Consumes: `ModelTier` (defined here, Task 7, as the canonical home — Task 8 imports it from here; Task 4's Settings temporary local `ModelTier` gets superseded in Task 8, not this task).
- Produces: `SttWorkerRequest` / `SttWorkerResponse` message-protocol types (`{kind:'load'|'detectSpeech'|'transcribe', ...}` / `{kind:'progress'|'ready'|'detectSpeechResult'|'transcribeResult'|'error', ...}`), consumed by `stt-engine.ts` (Task 8) on the main-thread side of the same `postMessage` contract.

- [ ] **Step 1: Run the D10 spike (manual verification — do this FIRST, before trusting the code below)**

1. Build and serve the app with its real production-shaped headers:
   ```bash
   cd web && bun run build && bun run preview
   ```
   (`bun run preview` serves the built app with `web/vite.config.ts`'s `preview.headers` — the same `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy: require-corp` pair the production server (`src/server/isolation-headers.ts`) uses.)
2. Open the served URL (printed by `bun run preview`, typically `http://localhost:4173`) in a **real Chrome tab** using the native `/chrome` integration (per this repo's CLAUDE.md: prefer native Chrome over Playwright for anything needing a real browser).
3. Open DevTools → Console, and paste in a scratch script that mirrors exactly what `stt.worker.ts` (Step 3 below) does:
   ```js
   const { AutoModel, AutoProcessor, env } = await import('@huggingface/transformers');
   env.useBrowserCache = true;
   console.log('crossOriginIsolated:', window.crossOriginIsolated);
   const model = await AutoModel.from_pretrained('onnx-community/moonshine-tiny-ONNX', { device: 'wasm' });
   const vad = await AutoModel.from_pretrained('onnx-community/silero-vad', { device: 'wasm' });
   console.log('loaded ok', model, vad);
   ```
4. **Decide the outcome** against D10's fallback ladder:
   - **Rung 1 (expected default):** the script above completes with no CORS/CORP console errors and `loaded ok` prints → the model CDN fetch works unchanged under `require-corp`. **No header changes needed.** Proceed to Step 3 below as written.
   - **Rung 2:** if Rung 1 fails with a CORP-related network error, change `Cross-Origin-Embedder-Policy` from `require-corp` to `credentialless` in BOTH `web/vite.config.ts`'s `isolation` object and `src/server/isolation-headers.ts`'s `ISOLATION_HEADERS`, rebuild/re-preview, and re-run the script.
   - **Rung 3:** if Rung 2 also fails (browser lacks `credentialless` support), self-hosting the model files (a `bun run setup:voice-web` provisioning script, mirroring the CLI's `scripts/setup-voice.ts`) is required — this is a larger follow-up NOT built in this task; flag it to the controller for a dedicated task insertion before Part B's live-verify (Task 18).
5. **Record the outcome** as a one-line code comment at the top of `stt.worker.ts` (Step 3 below already includes a placeholder line for this — fill in the actual rung reached) — this is the plan's/ledger's record per the spec's "the plan records which."

- [ ] **Step 2: (No failing-test step for this task — see the Files note above.)**

- [ ] **Step 3: Write the worker implementation**

Create `web/src/features/voice/stt.worker.ts`:

```ts
// D10 SPIKE OUTCOME (Task 7, filled in at execution time — see Step 1 above):
// Rung reached: ___ (1 = unchanged require-corp; 2 = credentialless; 3 =
// self-hosted models). Fill this in before this task's commit.
//
// Runs inside a dedicated Web Worker (D4) — transformers.js's heavier
// VAD+ASR inference stays off the main UI thread. This file is NOT
// unit-tested directly (no WASM/ONNX runtime under happy-dom/Vitest);
// `stt-engine.ts` (Task 8) tests the main-thread side of this exact message
// protocol against a fully mocked `Worker` global. The transformers.js API
// call shapes below reflect the D10 spike's proven-working invocation —
// adjust them to match whatever the spike actually found, if it differs.
import {
  AutoModel,
  AutoProcessor,
  env,
  type PreTrainedModel,
  type Processor,
} from '@huggingface/transformers';

export type ModelTier = 'moonshine-base' | 'moonshine-tiny';

export type SttWorkerRequest =
  | { kind: 'load'; model: ModelTier }
  | { kind: 'detectSpeech'; id: number; chunk: Float32Array }
  | { kind: 'transcribe'; id: number; samples: Float32Array };

export type SttWorkerResponse =
  | { kind: 'progress'; loaded: number; total: number }
  | { kind: 'ready' }
  | { kind: 'detectSpeechResult'; id: number; isSpeech: boolean }
  | { kind: 'transcribeResult'; id: number; text: string }
  | { kind: 'error'; id?: number; message: string };

const MODEL_IDS: Record<ModelTier, string> = {
  'moonshine-base': 'onnx-community/moonshine-base-ONNX',
  'moonshine-tiny': 'onnx-community/moonshine-tiny-ONNX',
};
const VAD_MODEL_ID = 'onnx-community/silero-vad';

env.useBrowserCache = true; // D1/D7: Cache-API persistence, skip re-download on reload

let asrModel: PreTrainedModel | undefined;
let asrProcessor: Processor | undefined;
let vadModel: PreTrainedModel | undefined;

function post(msg: SttWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

async function detectWebGpuDevice(): Promise<'webgpu' | 'wasm'> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return 'wasm';
  try {
    const adapter = await gpu.requestAdapter();
    return adapter !== null ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm'; // D9: never crash on a capability-detection failure
  }
}

async function load(model: ModelTier): Promise<void> {
  const device = await detectWebGpuDevice();
  const modelId = MODEL_IDS[model];
  const progress = (info: { loaded: number; total: number }) => {
    post({ kind: 'progress', loaded: info.loaded, total: info.total });
  };
  asrModel = (await AutoModel.from_pretrained(modelId, {
    device,
    progress_callback: progress,
  })) as PreTrainedModel;
  asrProcessor = (await AutoProcessor.from_pretrained(modelId, {})) as Processor;
  vadModel = (await AutoModel.from_pretrained(VAD_MODEL_ID, { device })) as PreTrainedModel;
  post({ kind: 'ready' });
}

async function detectSpeech(chunk: Float32Array): Promise<boolean> {
  if (!vadModel) throw new Error('VAD model not loaded — call load() first');
  const result = (await vadModel({ input: chunk })) as {
    output?: { data?: ArrayLike<number> };
  };
  const score = Number(result.output?.data?.[0] ?? 0);
  return score > 0.5;
}

async function transcribe(samples: Float32Array): Promise<string> {
  if (!asrModel || !asrProcessor) {
    throw new Error('ASR model not loaded — call load() first');
  }
  const inputs = await asrProcessor(samples);
  const output = await asrModel.generate({ ...inputs, max_new_tokens: 256 });
  const [text] = asrProcessor.batch_decode(output, { skip_special_tokens: true });
  return text ?? '';
}

self.onmessage = (event: MessageEvent<SttWorkerRequest>) => {
  const msg = event.data;
  if (msg.kind === 'load') {
    load(msg.model).catch((err: unknown) => {
      post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    });
    return;
  }
  if (msg.kind === 'detectSpeech') {
    detectSpeech(msg.chunk)
      .then((isSpeech) => post({ kind: 'detectSpeechResult', id: msg.id, isSpeech }))
      .catch((err: unknown) => {
        post({
          kind: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }
  if (msg.kind === 'transcribe') {
    transcribe(msg.samples)
      .then((text) => post({ kind: 'transcribeResult', id: msg.id, text }))
      .catch((err: unknown) => {
        post({
          kind: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }
};
```

Note: the worker message protocol deliberately carries a bare `samples: Float32Array`, not the full `VoiceFrames` shape — `sampleRate` is always the fixed `16000` (`VoiceFrames`'s literal type), so `stt-engine.ts` (Task 8) unpacks `frames.samples` before posting, and this file never needs to import `VoiceFrames` itself.

- [ ] **Step 4: Verify it compiles (no automated behavioral test — see Files note)**

Run: `cd web && bun run typecheck`
Expected: PASS. This confirms the transformers.js import shapes and message-protocol types are internally consistent; it does NOT prove the model actually loads in a browser — that's what Step 1's spike already proved (or corrected) before this step.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/stt.worker.ts
git commit -m "feat(voice): stt.worker.ts — transformers.js Moonshine+Silero worker, D10 spike outcome recorded"
```

### Task 8: `createSttEngine` (main-thread Web Worker host) + mocked-worker tests + canonicalize `ModelTier`

**Files:**
- Create: `web/src/features/voice/stt-engine.ts`
- Test: `web/src/features/voice/stt-engine.test.ts`
- Modify: `web/src/features/settings/index.tsx` (replace the Task 4 temporary local `ModelTier` with an import from `stt-engine.ts` — single source of truth from here on)

**Interfaces:**
- Consumes: `ModelTier` / `SttWorkerRequest` / `SttWorkerResponse` (Task 7, `stt.worker.ts`); `VoiceFrames` (`@contracts`, Task 1).
- Produces (VERBATIM per `phase7-interfaces.md`): `export type LoadProgress = { loaded: number; total: number };`, `export type SttEngine = { ready(): Promise<void>; onProgress(cb): () => void; detectSpeech(chunk16k): Promise<boolean>; transcribe(frames): Promise<string>; close(): void };`, `export function createSttEngine(cfg: { model: ModelTier }): SttEngine;`. Consumed by `use-voice-input.ts` (Part B, Task 10+).

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/voice/stt-engine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSttEngine } from './stt-engine.ts';
import type { SttWorkerResponse } from './stt.worker.ts';

/** Minimal fake standing in for the real `Worker` global — captures every
 *  `postMessage` call and lets the test drive `onmessage` manually to
 *  simulate a worker response. Real transformers.js/WASM behavior is never
 *  exercised here (see Task 7's spike + Part B's live-verify for that);
 *  this suite only asserts the message PROTOCOL is correct. */
class FakeSttWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(response: SttWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent);
  }
}

let lastWorker: FakeSttWorker | undefined;

beforeEach(() => {
  lastWorker = undefined;
  vi.stubGlobal(
    'Worker',
    class {
      constructor(..._args: unknown[]) {
        const fake = new FakeSttWorker();
        lastWorker = fake;
        return fake as unknown as Worker;
      }
    },
  );
});

describe('createSttEngine', () => {
  it('posts a load request for the configured model tier on construction', () => {
    createSttEngine({ model: 'moonshine-tiny' });
    expect(lastWorker?.posted).toEqual([{ kind: 'load', model: 'moonshine-tiny' }]);
  });

  it('ready() resolves only once the worker reports ready, not before', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    let resolved = false;
    void engine.ready().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    lastWorker?.emit({ kind: 'ready' });
    await engine.ready();
    expect(resolved).toBe(true);
  });

  it('forwards progress messages to onProgress subscribers', () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const onProgress = vi.fn();
    engine.onProgress(onProgress);
    lastWorker?.emit({ kind: 'progress', loaded: 50, total: 100 });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 50, total: 100 });
  });

  it('onProgress unsubscribe stops further callbacks', () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const onProgress = vi.fn();
    const unsubscribe = engine.onProgress(onProgress);
    unsubscribe();
    lastWorker?.emit({ kind: 'progress', loaded: 1, total: 2 });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('detectSpeech() resolves with the matching response by request id', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const resultPromise = engine.detectSpeech(new Float32Array([0.1, 0.2]));
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    expect(posted.kind).toBe('detectSpeech');
    lastWorker?.emit({ kind: 'detectSpeechResult', id: posted.id, isSpeech: true });
    expect(await resultPromise).toBe(true);
  });

  it('transcribe() resolves with the matching response by request id', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const resultPromise = engine.transcribe({
      samples: new Float32Array([0.1]),
      sampleRate: 16000,
    });
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    expect(posted.kind).toBe('transcribe');
    lastWorker?.emit({ kind: 'transcribeResult', id: posted.id, text: 'hello world' });
    expect(await resultPromise).toBe('hello world');
  });

  it('two concurrent requests resolve independently, matched by their own id', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const first = engine.transcribe({ samples: new Float32Array([0.1]), sampleRate: 16000 });
    const second = engine.transcribe({ samples: new Float32Array([0.2]), sampleRate: 16000 });
    const [firstPosted, secondPosted] = lastWorker!.posted.slice(-2) as {
      id: number;
    }[];
    // Emit out of order to prove matching is by id, not arrival order.
    lastWorker?.emit({ kind: 'transcribeResult', id: secondPosted.id, text: 'second' });
    lastWorker?.emit({ kind: 'transcribeResult', id: firstPosted.id, text: 'first' });
    expect(await first).toBe('first');
    expect(await second).toBe('second');
  });

  it('a request-scoped error rejects only that pending call, not ready()', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    lastWorker?.emit({ kind: 'ready' });
    await engine.ready();
    const resultPromise = engine.transcribe({
      samples: new Float32Array([0.1]),
      sampleRate: 16000,
    });
    const posted = lastWorker?.posted.at(-1) as { id: number };
    lastWorker?.emit({ kind: 'error', id: posted.id, message: 'decode failed' });
    await expect(resultPromise).rejects.toThrow('decode failed');
  });

  it('close() terminates the worker', () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    engine.close();
    expect(lastWorker?.terminated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/stt-engine.test.ts`
Expected: FAIL — `error: Cannot find module './stt-engine.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/features/voice/stt-engine.ts`:

```ts
import type { VoiceFrames } from '@contracts';
import type { ModelTier, SttWorkerRequest, SttWorkerResponse } from './stt.worker.ts';

export type { ModelTier };
export type LoadProgress = { loaded: number; total: number };

export type SttEngine = {
  ready(): Promise<void>;
  onProgress(cb: (p: LoadProgress) => void): () => void;
  detectSpeech(chunk16k: Float32Array): Promise<boolean>;
  transcribe(frames: VoiceFrames): Promise<string>;
  close(): void;
};

type Pending<T> = { resolve: (v: T) => void; reject: (err: Error) => void };

/**
 * Main-thread host for the STT Web Worker (D4): spawns `stt.worker.ts`,
 * posts a `load` request for the configured model tier immediately, and
 * exposes a request/response-matched (by numeric id) API over
 * `postMessage`. `ready()` resolves only once the worker's `ready` message
 * arrives — callers (`use-voice-input.ts`, Part B) gate capture start on
 * this, never on construction alone (spec §7.2).
 */
export function createSttEngine(cfg: { model: ModelTier }): SttEngine {
  const worker = new Worker(new URL('./stt.worker.ts', import.meta.url), {
    type: 'module',
  });

  const progressListeners = new Set<(p: LoadProgress) => void>();
  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  let nextId = 1;
  const pendingDetect = new Map<number, Pending<boolean>>();
  const pendingTranscribe = new Map<number, Pending<string>>();

  worker.onmessage = (event: MessageEvent<SttWorkerResponse>) => {
    const msg = event.data;
    if (msg.kind === 'progress') {
      for (const cb of progressListeners) cb({ loaded: msg.loaded, total: msg.total });
      return;
    }
    if (msg.kind === 'ready') {
      readyResolve();
      return;
    }
    if (msg.kind === 'detectSpeechResult') {
      pendingDetect.get(msg.id)?.resolve(msg.isSpeech);
      pendingDetect.delete(msg.id);
      return;
    }
    if (msg.kind === 'transcribeResult') {
      pendingTranscribe.get(msg.id)?.resolve(msg.text);
      pendingTranscribe.delete(msg.id);
      return;
    }
    if (msg.kind === 'error') {
      if (msg.id !== undefined) {
        pendingDetect.get(msg.id)?.reject(new Error(msg.message));
        pendingDetect.delete(msg.id);
        pendingTranscribe.get(msg.id)?.reject(new Error(msg.message));
        pendingTranscribe.delete(msg.id);
      } else {
        readyReject(new Error(msg.message));
      }
    }
  };

  worker.postMessage({ kind: 'load', model: cfg.model } satisfies SttWorkerRequest);

  function ready(): Promise<void> {
    return readyPromise;
  }

  function onProgress(cb: (p: LoadProgress) => void): () => void {
    progressListeners.add(cb);
    return () => progressListeners.delete(cb);
  }

  function detectSpeech(chunk16k: Float32Array): Promise<boolean> {
    const id = nextId++;
    return new Promise<boolean>((resolve, reject) => {
      pendingDetect.set(id, { resolve, reject });
      worker.postMessage(
        { kind: 'detectSpeech', id, chunk: chunk16k } satisfies SttWorkerRequest,
        [chunk16k.buffer],
      );
    });
  }

  function transcribe(frames: VoiceFrames): Promise<string> {
    const id = nextId++;
    return new Promise<string>((resolve, reject) => {
      pendingTranscribe.set(id, { resolve, reject });
      worker.postMessage(
        { kind: 'transcribe', id, samples: frames.samples } satisfies SttWorkerRequest,
        [frames.samples.buffer],
      );
    });
  }

  function close(): void {
    worker.terminate();
    pendingDetect.clear();
    pendingTranscribe.clear();
    progressListeners.clear();
  }

  return { ready, onProgress, detectSpeech, transcribe, close };
}
```

Update `web/src/features/settings/index.tsx` to canonicalize `ModelTier` (remove the Task 4 temporary local definition, import it instead):

```tsx
import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import type { ModelTier } from '../voice/stt-engine.ts';
```

(Delete the `export type ModelTier = 'moonshine-base' | 'moonshine-tiny';` block and its preceding doc comment from Task 4 — everything else in the file is unchanged, since `ModelTier`'s literal values are identical, just now imported rather than locally declared. Re-export it so existing/future importers of `settings/index.tsx`'s `ModelTier` keep working:)

```tsx
export type { ModelTier };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- features/voice/stt-engine.test.ts features/settings/index.test.tsx`
Expected: PASS (9 `stt-engine` tests + all pre-existing + Task 4's `settings` tests, now sourcing `ModelTier` from `stt-engine.ts`).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/stt-engine.ts web/src/features/voice/stt-engine.test.ts web/src/features/settings/index.tsx
git commit -m "feat(voice): createSttEngine — mocked-worker-tested message protocol host (D1/D4/D7)"
```

### Task 9: `@huggingface/transformers` as a direct `web/` dep + Vite worker/optimizeDeps config + isolation-headers.ts comment update

**Files:**
- Modify: `web/package.json` (add the dependency)
- Modify: `web/vite.config.ts` (add `optimizeDeps.exclude`; update the `isolation` comment)
- Modify: `src/server/isolation-headers.ts` (update the stale "sherpa WASM" comment per D1/D10)
- Test: none new (config-only task — verified via `typecheck` + a full install/build smoke, per Steps 2/4 below); this task closes Increment 3, so it ends with the controller's full `bun run check` (see the note after Step 5).

**Interfaces:**
- Consumes: nothing new.
- Produces: a resolvable `@huggingface/transformers` import from within `web/` (previously only resolvable via the root workspace's hoisted install — see below), and Vite build config that keeps transformers.js's WASM binaries out of esbuild's dependency pre-bundling pass.

- [ ] **Step 1: Confirm the current (broken) state**

Run: `cd web && bun run typecheck`
Expected at this point: PASS (type-only imports still resolve via the root workspace's hoisted `node_modules/@huggingface/transformers`, since `web` is a `bun` workspace member and the root `package.json:43` already lists `"@huggingface/transformers": "^4.2.0"` as a dependency — hoisting makes the package resolvable even without `web/package.json` listing it directly). This step exists to make explicit that the FOLLOWING step is about explicitness/correctness (a workspace member should declare what it directly imports), not about fixing a current type error.

- [ ] **Step 2: Add the direct dependency**

Modify `web/package.json`'s `"dependencies"` block (insert alphabetically, matching the existing sort order):

```json
  "dependencies": {
    "@ai-sdk/react": "^3",
    "@base-ui-components/react": "1.0.0-rc.0",
    "@fontsource-variable/geist": "^5",
    "@fontsource-variable/geist-mono": "^5",
    "@huggingface/transformers": "^4.2.0",
    "@tanstack/react-router": "^1",
    "@visx/axis": "^4.0.0",
    "@visx/group": "^4.0.0",
    "@visx/scale": "^4.0.0",
    "@visx/shape": "^4.0.0",
    "@visx/tooltip": "^4.0.0",
    "@xyflow/react": "^12.11.2",
    "ai": "^6.0.217",
    "react": "^19",
    "react-dom": "^19",
    "streamdown": "^2.5.0",
    "zod": "^4.4.3"
  },
```

Run (from the repo root, since this is a `bun` workspace):
```bash
bun install
```
Expected: lockfile updates to record `web`'s now-direct dependency on `@huggingface/transformers` (already present at the root, so this should not change which version is resolved — just which `package.json` declares it).

Modify `web/vite.config.ts` to keep transformers.js's WASM binaries out of esbuild's dev-server dependency pre-bundling pass (a commonly-needed exclusion for this package — large binary assets confuse the pre-bundler):

```ts
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// COOP/COEP so the frontend can use transformers.js's threaded WASM backend
// (SharedArrayBuffer) for STT/VAD inference (Slice 30b Phase 7, D1/D8 —
// originally put in place for a since-rejected sherpa-onnx WASM plan, see
// docs/architecture.md's Voice section). The model-weight CDN fetch under
// `require-corp` was proven/adjusted by the Task 7 D10 spike — see
// `web/src/features/voice/stt.worker.ts`'s header comment for which rung of
// the fallback ladder this repo actually ships on.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts'),
    },
  },
  server: { headers: isolation, fs: { allow: ['..'] } },
  preview: { headers: isolation },
  optimizeDeps: {
    // transformers.js ships its own WASM/ONNX binaries; excluding it from
    // esbuild's dependency pre-bundling avoids the dev server trying (and
    // failing) to pre-process large binary assets as JS.
    exclude: ['@huggingface/transformers'],
  },
});
```

Modify `src/server/isolation-headers.ts`'s stale comment (per D10: "the isolation-headers.ts comment gets updated off its stale 'sherpa' wording either way"):

```ts
/**
 * COOP/COEP so the frontend can use transformers.js's threaded WASM backend
 * (SharedArrayBuffer) for browser STT/VAD inference (Slice 30b Phase 7).
 * Originally put in place for a sherpa-onnx WASM plan the phase later
 * rejected (see docs/architecture.md's Voice section, D1) — the isolation
 * requirement carried over unchanged to transformers.js.
 * Lives in its own module (not `app.ts`) so route handlers under
 * `src/server/chat/**` can import it without a circular dependency on `app.ts`
 * (which imports those handlers to register routes).
 */
export const ISOLATION_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};
```

(If Task 7's D10 spike landed on Rung 2 instead of Rung 1, change both `'require-corp'` values above — here AND in `web/vite.config.ts`'s `isolation` object — to `'credentialless'` instead, per the spec's fallback ladder. As written, this task assumes Rung 1; adjust if the spike said otherwise.)

- [ ] **Step 3: (No new failing test — config-only task, see Files note.)**

- [ ] **Step 4: Run verification**

Run: `cd web && bun run typecheck`
Expected: PASS.

Run: `cd web && bun run build`
Expected: PASS — a successful production build proves `@huggingface/transformers` resolves cleanly through Vite's bundler as a direct `web/` dependency (not just via workspace hoisting) and that `stt.worker.ts`/`downsample-worklet.ts` (referenced only via `new URL(...)`, never statically imported at the top level) don't break the main bundle.

Run: `cd web && bun run test`
Expected: PASS — full `web/` suite (every test from Tasks 4-8, plus all pre-existing Phase 1-6 tests), confirming this config change didn't regress anything already shipped.

- [ ] **Step 5: Commit**

```bash
git add web/package.json bun.lock web/vite.config.ts src/server/isolation-headers.ts
git commit -m "feat(voice): @huggingface/transformers as a direct web/ dep + Vite worker config (D10)"
```

---

## Increment 3 boundary — controller gate

**After Task 9, the controller runs the full `bun run check`** (from the repo root):

```bash
bun run check
```

This runs, in order: `docs:check` (expected to PASS — Part A has made no `docs/architecture.md`-requiring change since no new `src/<subsystem>` directory was added outside already-documented `src/contracts`/`src/config`/`src/server`, and `web/src/features/voice/` is a NEW subsystem directory that Part B's Task 18 documents; if `docs:check` flags `web/src/features/voice/` as undocumented at this checkpoint, that is expected and the controller should treat it as a known, tracked gap closed by Part B, not a Part A regression) → `typecheck` (root) → `lint` (repo-wide biome) → `check:web` (`cd web && bun run typecheck && bun run test`) → `test` (root `bun test`, excluding `web/**`). All nine tasks' individual per-task gates already passed; this is the aggregate confirmation before Part B (Tasks 10-18: `use-voice-input` hook + gestures + VAD gating, composer wiring, docs + live-verify + partial-slice land) begins.

---

---


## Increment 4 — `vad.ts` segmenter + `use-voice-input` hook + both gestures

### Task 10: `vad.ts` — pure segmenter, hold-to-talk (non-gated) mode

**Files:**
- Create: `web/src/features/voice/vad.ts`
- Test: `web/src/features/voice/vad.test.ts`

**Interfaces:**
- Consumes: `VoiceFrames` (`{ samples: Float32Array; sampleRate: 16000 }`) from `@contracts` (Part A Task 1 — the lifted contract; `src/voice/types.ts` re-exports the same type for the CLI side, so this import is the one, single source).
- Produces (locked, verbatim — used by Task 11 in the same file, and by Task 12's `use-voice-input.ts`):
  ```ts
  export type SegmenterOpts = { silenceMs: number; gated: boolean; frameMs: number };
  export type Segmenter = {
    pushFrame(chunk: Float32Array, isSpeech: boolean): void;
    flush(): void;
    onSegment(cb: (frames: VoiceFrames) => void): () => void;
    reset(): void;
  };
  export function createSegmenter(opts: SegmenterOpts): Segmenter;
  ```

- [ ] **Step 1: Write the failing tests (hold-to-talk / `gated: false`)**

Create `web/src/features/voice/vad.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSegmenter } from './vad.ts';

function tone(length: number, fill = 0.5): Float32Array {
  return new Float32Array(length).fill(fill);
}

describe('createSegmenter — hold-to-talk (gated: false)', () => {
  it('buffers every pushed frame regardless of isSpeech, emitting nothing until flush()', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512), true);
    segmenter.pushFrame(tone(256), false); // ignored isSpeech — hold mode never gates
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('flush() emits exactly one segment concatenating every buffered chunk in push order', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4, 0.1), true);
    segmenter.pushFrame(tone(4, 0.2), false);
    segmenter.pushFrame(tone(4, 0.3), false);
    segmenter.flush();
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0][0];
    expect(frames.sampleRate).toBe(16000);
    expect(Array.from(frames.samples as Float32Array)).toEqual([
      0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.3, 0.3, 0.3, 0.3,
    ]);
  });

  it('does not truncate a frame pushed immediately before flush() (the release-boundary residual, §7.1 c)', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(2, 0.9), true);
    segmenter.pushFrame(tone(2, 0.8), true); // the trailing "residual" flushed at release
    segmenter.flush();
    const frames = onSegment.mock.calls[0][0];
    expect(Array.from(frames.samples as Float32Array)).toEqual([0.9, 0.9, 0.8, 0.8]);
  });

  it('flush() with nothing buffered emits nothing (no phantom empty segment)', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('reset() clears buffered audio without emitting a segment', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4), true);
    segmenter.reset();
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('a second flush() after an emit is a no-op (buffer already drained)', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(4), true);
    segmenter.flush();
    segmenter.flush();
    expect(onSegment).toHaveBeenCalledTimes(1);
  });

  it('onSegment() returns an unsubscribe function', () => {
    const segmenter = createSegmenter({ silenceMs: 500, gated: false, frameMs: 32 });
    const onSegment = vi.fn();
    const off = segmenter.onSegment(onSegment);
    off();
    segmenter.pushFrame(tone(4), true);
    segmenter.flush();
    expect(onSegment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun run test -- vad.test.ts`
Expected: FAIL — `Cannot find module './vad.ts'` (or all assertions fail once a stub exists). No implementation exists yet.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/voice/vad.ts`:

```ts
import type { VoiceFrames } from '@contracts';

export type SegmenterOpts = { silenceMs: number; gated: boolean; frameMs: number };

export type Segmenter = {
  pushFrame(chunk: Float32Array, isSpeech: boolean): void;
  flush(): void;
  onSegment(cb: (frames: VoiceFrames) => void): () => void;
  reset(): void;
};

/**
 * Pure segmentation state machine (spec §7.1) — no real VAD model, no
 * timers. `isSpeech` is supplied by the caller (the worker's Silero pass
 * per pushed chunk, Task 12). Silence duration is tracked from each
 * chunk's *actual* sample-derived duration (`chunk.length / 16000 * 1000`
 * ms), falling back to `frameMs` only for a zero-length "heartbeat" chunk
 * (a VAD tick with no new audio attached) — this keeps the silence clock
 * correct regardless of the AudioWorklet's real chunk sizing, rather than
 * assuming every pushed chunk is exactly `frameMs` long.
 *
 * Two modes (`gated`):
 *  - `false` (hold-to-talk): every pushed frame belongs to the one
 *    segment, `isSpeech` is ignored entirely — the key/pointer gesture
 *    itself IS the segment boundary. Only `flush()` closes it, and it
 *    closes with everything buffered so far (no truncation of the
 *    release-boundary residual, §7.1 c).
 *  - `true` (tap-to-toggle): `isSpeech` flips gate segment boundaries —
 *    a speech frame (re)starts/extends the current segment and resets the
 *    silence clock; a silent frame is buffered (kept, in case speech
 *    resumes) and accumulates against `silenceMs`; once sustained silence
 *    reaches `silenceMs`, the segment closes, with the trailing silent
 *    chunks trimmed back off the emitted audio (they are not speech).
 *    A tap-to-toggle session can close/reopen many segments in a row
 *    (§7.1 b — exactly one transcribe call per speech/silence cycle).
 */
export function createSegmenter(opts: SegmenterOpts): Segmenter {
  const { silenceMs, gated, frameMs } = opts;
  let buffer: Float32Array[] = [];
  let inSegment = false;
  let silentMsAccumulated = 0;
  const listeners = new Set<(frames: VoiceFrames) => void>();

  function chunkDurationMs(chunk: Float32Array): number {
    return chunk.length > 0 ? (chunk.length / 16000) * 1000 : frameMs;
  }

  function concat(chunks: Float32Array[]): Float32Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function emit(): void {
    inSegment = false;
    silentMsAccumulated = 0;
    if (buffer.length === 0) return;
    const samples = concat(buffer);
    buffer = [];
    const frames: VoiceFrames = { samples, sampleRate: 16000 };
    for (const cb of listeners) cb(frames);
  }

  function closeSustainedSilence(): void {
    // Trim the trailing silent chunks themselves back off the emitted
    // audio: walk back from the end, summing each chunk's duration, until
    // the accumulated trim matches the silence total we tracked — that
    // boundary is exactly the end of the last speech-bearing chunk.
    let trimmedMs = 0;
    let cut = buffer.length;
    for (let i = buffer.length - 1; i >= 0; i -= 1) {
      trimmedMs += chunkDurationMs(buffer[i]);
      cut = i;
      if (trimmedMs >= silentMsAccumulated) break;
    }
    buffer = buffer.slice(0, cut);
    emit();
  }

  function pushFrame(chunk: Float32Array, isSpeech: boolean): void {
    if (!gated) {
      buffer.push(chunk);
      inSegment = true;
      return;
    }
    if (isSpeech) {
      buffer.push(chunk);
      inSegment = true;
      silentMsAccumulated = 0;
      return;
    }
    if (!inSegment) return; // silence before any speech started this cycle
    buffer.push(chunk);
    silentMsAccumulated += chunkDurationMs(chunk);
    if (silentMsAccumulated >= silenceMs) closeSustainedSilence();
  }

  function flush(): void {
    emit();
  }

  function reset(): void {
    buffer = [];
    inSegment = false;
    silentMsAccumulated = 0;
  }

  function onSegment(cb: (frames: VoiceFrames) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return { pushFrame, flush, onSegment, reset };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun run test -- vad.test.ts`
Expected: PASS — 7/7 (the 6 hold-to-talk tests above; Task 11 appends tap-toggle tests to the same file).

- [ ] **Step 5: Gate + commit**

Run: `cd web && bun run typecheck && cd web && bun run lint`

```bash
git add web/src/features/voice/vad.ts web/src/features/voice/vad.test.ts
git commit -m "feat(voice): add createSegmenter pure state machine (hold-to-talk mode)"
```

---

### Task 11: `vad.ts` — tap-to-toggle (gated) mode: multi-segment, jitter, short-utterance

**Files:**
- Modify: `web/src/features/voice/vad.ts` (already correct from Task 10 — the `gated: true` branch was implemented there; this task only ADDS tests, no code change, unless a test finds a real bug)
- Modify: `web/src/features/voice/vad.test.ts` (append)

**Interfaces:**
- Consumes/Produces: unchanged from Task 10 (`createSegmenter`/`Segmenter`/`SegmenterOpts`).

- [ ] **Step 1: Write the failing tests (tap-to-toggle / `gated: true`)**

Append to `web/src/features/voice/vad.test.ts`:

```ts
describe('createSegmenter — tap-to-toggle (gated: true)', () => {
  const CHUNK_MS_32 = new Float32Array(512); // 512 samples @ 16kHz = 32ms

  it('closes a segment after sustained silence >= silenceMs, trimming the trailing silence off the emitted audio', () => {
    const segmenter = createSegmenter({ silenceMs: 100, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0.5), true); // 32ms speech
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms
    segmenter.pushFrame(tone(512, 0), false); // 96ms
    expect(onSegment).not.toHaveBeenCalled(); // not yet sustained
    segmenter.pushFrame(tone(512, 0), false); // 128ms >= 100ms — closes
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0][0];
    // only the one speech chunk survives trimming — no silent tail.
    expect(frames.samples.length).toBe(512);
  });

  it('does not double-transcribe on a jittery VAD flip that never sustains past silenceMs (§7.1 b)', () => {
    const segmenter = createSegmenter({ silenceMs: 100, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512), true);
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent — jitter
    segmenter.pushFrame(tone(512), true); // speech resumes — silence clock resets
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512), true);
    expect(onSegment).not.toHaveBeenCalled(); // never sustained 100ms of silence
  });

  it('a very short utterance (a single speech chunk) still emits once sustained silence follows (§7.1 b — no missed segment)', () => {
    const segmenter = createSegmenter({ silenceMs: 64, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512), true); // one 32ms speech chunk
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms — closes
    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(onSegment.mock.calls[0][0].samples.length).toBe(512);
  });

  it('a tap-to-toggle session spans multiple speech/silence cycles, each closing its own segment independently', () => {
    const segmenter = createSegmenter({ silenceMs: 64, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    // cycle 1
    segmenter.pushFrame(tone(512, 0.1), true);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false); // closes cycle 1
    // cycle 2 (re-armed automatically — no explicit re-arm call needed)
    segmenter.pushFrame(tone(512, 0.2), true);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false); // closes cycle 2
    expect(onSegment).toHaveBeenCalledTimes(2);
    expect(onSegment.mock.calls[0][0].samples[0]).toBeCloseTo(0.1);
    expect(onSegment.mock.calls[1][0].samples[0]).toBeCloseTo(0.2);
  });

  it('leading silence before any speech is ignored (never buffered, never closes an empty segment)', () => {
    const segmenter = createSegmenter({ silenceMs: 64, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false);
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('flush() during an open (not-yet-silence-closed) tap-toggle segment closes it immediately with whatever is buffered', () => {
    const segmenter = createSegmenter({ silenceMs: 1000, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0.4), true);
    segmenter.flush(); // manual stop before silence would ever have closed it
    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(onSegment.mock.calls[0][0].samples[0]).toBeCloseTo(0.4);
  });
});
```

Remove the unused `CHUNK_MS_32` local (it documents intent inline but isn't referenced) — keep the file lint-clean by deleting that line before running tests.

- [ ] **Step 2: Run the tests to verify they fail (or pass vacuously) before trusting them**

Run: `cd web && bun run test -- vad.test.ts`
Expected: all 6 new tap-toggle tests already PASS against Task 10's implementation (the `gated: true` branch was written in Task 10) — this step is a verification, not a red step, since the code pre-exists. If any fails, the failure is a REAL bug in Task 10's gated branch — fix `vad.ts` before proceeding (do not weaken the test).

- [ ] **Step 3: (only if Step 2 found a failure) fix `vad.ts`, else skip**

No change expected. If `closeSustainedSilence`'s trim-walk under- or over-trims for a specific edge case surfaced by these tests, fix the loop in `web/src/features/voice/vad.ts` and re-run Step 2 until green — do not adjust the tests' assertions to match a wrong implementation.

- [ ] **Step 4: Run the full file to verify all 13 tests pass**

Run: `cd web && bun run test -- vad.test.ts`
Expected: PASS — 13/13 (7 from Task 10 + 6 from Task 11).

- [ ] **Step 5: Gate + commit**

Run: `cd web && bun run typecheck && cd web && bun run lint`

```bash
git add web/src/features/voice/vad.test.ts
git commit -m "test(voice): cover tap-to-toggle segmentation (multi-cycle, jitter, short-utterance)"
```

---

### Task 12: `use-voice-input.ts` — orchestrator hook (worker lifecycle, both gestures, concurrent-gesture guard, teardown)

**Files:**
- Create: `web/src/features/voice/use-voice-input.ts`
- Test: `web/src/features/voice/use-voice-input.test.ts`

**Interfaces:**
- Consumes:
  - `AudioCapture`, `createAudioCapture` from `web/src/features/voice/audio-capture.ts` (Part A Task ~5/6).
  - `SttEngine`, `ModelTier`, `createSttEngine` from `web/src/features/voice/stt-engine.ts` (Part A Task ~8/9).
  - `createSegmenter` from `./vad.ts` (Task 10/11, this file's own directory).
- Produces (locked, verbatim — consumed by Task 14's `mic-button.tsx`):
  ```ts
  export type VoiceStatus = 'disabled' | 'loading' | 'ready' | 'listening' | 'transcribing' | 'error';
  export type UseVoiceInput = {
    status: VoiceStatus;
    ready: boolean;
    level: number;
    interim: string;
    error?: string;
    startHold(): void;
    stopHold(): void;
    toggleTap(): void;
    cancel(): void;
  };
  export type UseVoiceInputOpts = {
    enabled: boolean;
    model: ModelTier;
    silenceMs: number;
    onFinal: (text: string) => void;
    onInterim?: (text: string) => void;
  };
  export type VoiceInputDeps = {
    createCapture: () => AudioCapture;
    createEngine: (cfg: { model: ModelTier }) => SttEngine;
  };
  export function useVoiceInput(opts: UseVoiceInputOpts, deps?: VoiceInputDeps): UseVoiceInput;
  ```
  The `deps` second parameter (defaulting to the real `createAudioCapture`/`createSttEngine`) is the test seam — no test in this task ever touches a real `getUserMedia`/`Worker`/`AudioContext`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/voice/use-voice-input.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AudioCapture } from './audio-capture.ts';
import type { ModelTier, SttEngine } from './stt-engine.ts';
import { useVoiceInput } from './use-voice-input.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFakeCapture() {
  const chunkListeners = new Set<(chunk: Float32Array) => void>();
  const levelListeners = new Set<(rms: number) => void>();
  const startMock = vi.fn(async () => {});
  const stopMock = vi.fn(async () => {});
  const capture: AudioCapture = {
    start: startMock,
    stop: stopMock,
    onChunk: (cb) => {
      chunkListeners.add(cb);
      return () => chunkListeners.delete(cb);
    },
    onLevel: (cb) => {
      levelListeners.add(cb);
      return () => levelListeners.delete(cb);
    },
    active: true,
  };
  return {
    capture,
    startMock,
    stopMock,
    emitChunk: (chunk: Float32Array) => {
      for (const cb of chunkListeners) cb(chunk);
    },
    chunkListenerCount: () => chunkListeners.size,
  };
}

function makeFakeEngine() {
  const readyGate = deferred<void>();
  const transcribeMock = vi.fn(async () => 'hello world');
  const detectSpeechMock = vi.fn(async () => false);
  const closeMock = vi.fn();
  const engine: SttEngine = {
    ready: () => readyGate.promise,
    onProgress: () => () => {},
    detectSpeech: detectSpeechMock,
    transcribe: transcribeMock,
    close: closeMock,
  };
  return { engine, readyGate, transcribeMock, detectSpeechMock, closeMock };
}

const MODEL: ModelTier = 'moonshine-base';

describe('useVoiceInput', () => {
  it('a mic press before the engine reports ready is a no-op (§7.2 a)', () => {
    const { engine } = makeFakeEngine();
    const { capture, startMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    expect(result.current.status).toBe('loading');
    act(() => result.current.startHold());
    expect(startMock).not.toHaveBeenCalled();
  });

  it('engine.ready() resolving flips status to ready; a hold press then begins real capture', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture, startMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.ready).toBe(true);
    act(() => result.current.startHold());
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe('listening'));
  });

  it('rejects an overlapping gesture: a hold press while a tap-toggle session is already listening starts no second capture (§7.2 b)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture, startMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => result.current.startHold());
    expect(startMock).toHaveBeenCalledTimes(1); // second gesture ignored, not a second capture
  });

  it('a second toggleTap() while already listening (tap mode) stops the session instead of starting another', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture, startMock, stopMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(stopMock).toHaveBeenCalledTimes(1));
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('stopHold flushes the segmenter and hands the transcribed final text to onFinal', async () => {
    const { engine, readyGate, transcribeMock } = makeFakeEngine();
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(transcribeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('hello world'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('cancel() discards buffered audio without ever calling transcribe', async () => {
    const { engine, readyGate, transcribeMock } = makeFakeEngine();
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('disabling voice tears the session down: capture.stop() + engine.close() both fire, and a stray post-teardown chunk never reaches onFinal (§7.2 c)', async () => {
    const { engine, readyGate, closeMock } = makeFakeEngine();
    const { capture, stopMock, emitChunk, chunkListenerCount } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useVoiceInput(
          { enabled, model: MODEL, silenceMs: 500, onFinal },
          { createCapture: () => capture, createEngine: () => engine },
        ),
      { initialProps: { enabled: true } },
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    rerender({ enabled: false });
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(chunkListenerCount()).toBe(0);
    act(() => emitChunk(new Float32Array(512)));
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('unmounting mid-session also tears capture + engine down (same teardown path as disable)', async () => {
    const { engine, readyGate, closeMock } = makeFakeEngine();
    const { capture, stopMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    unmount();
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('a model-load failure degrades to an error status with a message, never a stuck loading state (§7.2 d)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.reject(new Error('WebGPU unsupported')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('WebGPU unsupported');
  });

  it('a capture.start() rejection (mic permission denied) degrades to an error status, not a crash', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture, startMock } = makeFakeCapture();
    startMock.mockRejectedValueOnce(new Error('Permission denied'));
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Permission denied');
  });

  it('when enabled is false from the start, status is disabled and no engine/capture is ever created', () => {
    const createEngine = vi.fn();
    const createCapture = vi.fn();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: false, model: MODEL, silenceMs: 500, onFinal },
        { createCapture, createEngine },
      ),
    );
    expect(result.current.status).toBe('disabled');
    expect(createEngine).not.toHaveBeenCalled();
    expect(createCapture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun run test -- use-voice-input.test.ts`
Expected: FAIL — `Cannot find module './use-voice-input.ts'`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/voice/use-voice-input.ts`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioCapture, type AudioCapture } from './audio-capture.ts';
import { createSttEngine, type ModelTier, type SttEngine } from './stt-engine.ts';
import { createSegmenter, type Segmenter } from './vad.ts';

export type VoiceStatus =
  | 'disabled'
  | 'loading'
  | 'ready'
  | 'listening'
  | 'transcribing'
  | 'error';

export type UseVoiceInput = {
  status: VoiceStatus;
  ready: boolean;
  level: number;
  interim: string;
  error?: string;
  startHold(): void;
  stopHold(): void;
  toggleTap(): void;
  cancel(): void;
};

export type UseVoiceInputOpts = {
  enabled: boolean;
  model: ModelTier;
  silenceMs: number;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
};

/** Injected factories — the test seam. Real callers get the module
 *  defaults; tests substitute fakes so no test ever touches a real
 *  `getUserMedia`/`Worker`/`AudioContext`. */
export type VoiceInputDeps = {
  createCapture: () => AudioCapture;
  createEngine: (cfg: { model: ModelTier }) => SttEngine;
};

const DEFAULT_DEPS: VoiceInputDeps = {
  createCapture: createAudioCapture,
  createEngine: createSttEngine,
};

/** Nominal VAD analysis window (Silero's own default) — used only as
 *  `vad.ts`'s zero-length-chunk fallback duration, never as a hardcoded
 *  silence threshold (that's `opts.silenceMs`, config-sourced). */
const FRAME_MS = 32;

export function useVoiceInput(
  opts: UseVoiceInputOpts,
  deps: VoiceInputDeps = DEFAULT_DEPS,
): UseVoiceInput {
  const [status, setStatus] = useState<VoiceStatus>(
    opts.enabled ? 'loading' : 'disabled',
  );
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const engineRef = useRef<SttEngine | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const segmenterRef = useRef<Segmenter | null>(null);
  const gestureRef = useRef<'hold' | 'tap' | null>(null);
  const readyRef = useRef(false);
  const unsubRef = useRef<() => void>(() => {});

  // Worker lifecycle (§7.2): spawn once per enable, terminate on
  // disable/unmount. Re-running only on `opts.enabled` is deliberate —
  // changing the model tier while enabled requires a disable/enable
  // round-trip (Settings, Task 15), not a live in-place model swap in v1.
  useEffect(() => {
    if (!opts.enabled) {
      setStatus('disabled');
      readyRef.current = false;
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(undefined);
    readyRef.current = false;
    const engine = deps.createEngine({ model: opts.model });
    engineRef.current = engine;
    engine
      .ready()
      .then(() => {
        if (cancelled) return;
        readyRef.current = true;
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(
          err instanceof Error ? err.message : 'voice model failed to load',
        );
      });
    return () => {
      cancelled = true;
      readyRef.current = false;
      unsubRef.current();
      unsubRef.current = () => {};
      if (captureRef.current) void captureRef.current.stop();
      captureRef.current = null;
      segmenterRef.current = null;
      gestureRef.current = null;
      engine.close();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  const endGesture = useCallback((nextStatus: VoiceStatus) => {
    unsubRef.current();
    unsubRef.current = () => {};
    if (captureRef.current) void captureRef.current.stop();
    captureRef.current = null;
    segmenterRef.current = null;
    gestureRef.current = null;
    setLevel(0);
    setStatus(nextStatus);
  }, []);

  const startGesture = useCallback(
    (kind: 'hold' | 'tap') => {
      if (!readyRef.current || gestureRef.current) return; // §7.2 (a) + (b)
      const engine = engineRef.current;
      if (!engine) return;
      gestureRef.current = kind;

      const segmenter = createSegmenter({
        silenceMs: opts.silenceMs,
        gated: kind === 'tap',
        frameMs: FRAME_MS,
      });
      segmenterRef.current = segmenter;

      const offSegment = segmenter.onSegment((frames) => {
        setStatus('transcribing');
        setInterim('…');
        opts.onInterim?.('…');
        engine
          .transcribe(frames)
          .then((text) => {
            if (text) opts.onFinal(text);
          })
          .catch(() => setError('transcription failed'))
          .finally(() => {
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          });
      });

      const capture = deps.createCapture();
      captureRef.current = capture;
      const offChunk = capture.onChunk((chunk) => {
        engine
          .detectSpeech(chunk)
          .then((isSpeech) => segmenter.pushFrame(chunk, isSpeech))
          .catch(() => segmenter.pushFrame(chunk, false));
      });
      const offLevel = capture.onLevel((rms) => setLevel(rms));
      unsubRef.current = () => {
        offSegment();
        offChunk();
        offLevel();
      };

      capture
        .start()
        .then(() => setStatus('listening'))
        .catch((err: unknown) => {
          endGesture(readyRef.current ? 'ready' : 'error');
          setError(
            err instanceof Error ? err.message : 'microphone unavailable',
          );
        });
    },
    [opts.silenceMs, opts.onFinal, opts.onInterim, endGesture],
  );

  const startHold = useCallback(() => startGesture('hold'), [startGesture]);

  const stopHold = useCallback(() => {
    if (gestureRef.current !== 'hold') return;
    segmenterRef.current?.flush(); // §7.1 (c): never drop the release-boundary residual
    endGesture('ready');
  }, [endGesture]);

  const toggleTap = useCallback(() => {
    if (gestureRef.current === 'tap') {
      segmenterRef.current?.flush();
      endGesture('ready');
      return;
    }
    if (gestureRef.current === null) startGesture('tap');
    // gestureRef.current === 'hold': ignored — concurrent-gesture guard.
  }, [endGesture, startGesture]);

  const cancel = useCallback(() => {
    if (gestureRef.current === null) return;
    segmenterRef.current?.reset(); // discard buffered audio — never transcribe
    endGesture('ready');
  }, [endGesture]);

  return {
    status,
    ready: readyRef.current,
    level,
    interim,
    error,
    startHold,
    stopHold,
    toggleTap,
    cancel,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun run test -- use-voice-input.test.ts`
Expected: PASS — 12/12.

- [ ] **Step 5: Gate + commit**

Run: `cd web && bun run typecheck && cd web && bun run lint`

```bash
git add web/src/features/voice/use-voice-input.ts web/src/features/voice/use-voice-input.test.ts
git commit -m "feat(voice): add useVoiceInput orchestrator hook (both gestures, ready-gating, teardown)"
```

---

### Task 13 (HARD — ULTRACODE ADVERSARIAL-VERIFY, not a code task): §7.1/§7.2 whole-mechanism review

**This is a review checkpoint, not an implementation step.** Per the spec's
build order ("the VAD-gated segmentation state machine... is the hard
reasoning piece → ultracode Workflow (adversarial-verify)" and "the worker
lifecycle + lazy-load race... is the reasoning-heavy piece → ultracode
Workflow (adversarial-verify)") and the user's standing budget-aware
model-tiering directive ("reviews are never downgraded to save budget"),
**the controller must route this task through the Workflow-tool multi-agent
orchestration** (2 independent Opus-or-better lenses), not a single-pass
Sonnet review.

**Files under review:**
- `web/src/features/voice/vad.ts` + `vad.test.ts` (Tasks 10–11)
- `web/src/features/voice/use-voice-input.ts` + `use-voice-input.test.ts` (Task 12)
- (Cross-reference only, not re-reviewed here) Part A's `web/src/features/voice/audio-capture.ts` downsample carry-state — §7.1 (a) is Part A's task, already gated there; this task's scope is §7.1 (b)/(c) and §7.2 (a)–(d) only.

**Exact requirements to adversarially verify (verbatim from spec §7.1/§7.2):**
- [ ] §7.1 (b) — A tap-to-toggle segment transcribes **exactly once** per speech/silence cycle: no double-transcribe on a jittery VAD flip, no missed segment on a very short utterance. Verify against `vad.ts`'s `closeSustainedSilence`/`pushFrame` gated branch and the Task-11 jitter/short-utterance tests — do the tests actually exercise a flip that's close to but under the threshold, and one that's over it, with distinguishable assertions (not just "doesn't throw")?
- [ ] §7.1 (c) — The hold-to-talk release boundary does not truncate trailing audio still buffered at the exact moment of `stopHold()`: verify `use-voice-input.ts`'s `stopHold` calls `segmenterRef.current?.flush()` **before** `endGesture` tears down the capture/listeners, and that no chunk emitted between the last real audio frame and the `flush()` call can be silently dropped (i.e., the AudioCapture's `onChunk` listener is still subscribed at the moment `stopHold` runs — `endGesture` unsubscribes only after the flush already read whatever was in the segmenter's buffer).
- [ ] §7.2 (a) — A mic-button press before the engine reports ready is a genuine no-op (`startGesture`'s `!readyRef.current` guard), never a buffered-and-later-replayed capture — verify there is no code path that queues a pending gesture to auto-start once `ready` flips.
- [ ] §7.2 (b) — Overlapping gestures (hold while tap is active, tap while hold is active, a second hold while the first hasn't released) cannot start two concurrent capture sessions against one worker/worklet pair — verify `startGesture`'s `gestureRef.current` guard covers all three orderings, and that `toggleTap()`'s own "already tap, stop it" branch cannot itself be reached while `gestureRef.current === 'hold'` (trace: it can't — the `if (gestureRef.current === 'tap')` check is false, and the `if (gestureRef.current === null)` check is also false, so the function falls through to the ignored case, exactly as commented).
- [ ] §7.2 (c) — Disabling voice or unmounting genuinely stops the `MediaStream` (via `capture.stop()`, called exactly once by the effect cleanup) and terminates the worker (`engine.close()`, called exactly once) — verify there is no double-stop/double-close race if a gesture is active at teardown time (the effect cleanup calls `unsubRef.current()` + `captureRef.current.stop()` directly, NOT via `endGesture`, so `endGesture`'s own capture-stop never double-fires against the same capture instance after the effect's own cleanup already nulled `captureRef.current` — confirm the ordering in the code is actually cleanup-first, not both racing).
- [ ] §7.2 (d) — A model-load failure (`engine.ready()` rejecting) and a capture-start failure (`capture.start()` rejecting, e.g. mic permission denied) both degrade to `status: 'error'` with a message, never a stuck `'loading'`/`'listening'` state — verify both catch paths reach `setStatus('error')` unconditionally (the capture-start catch's `endGesture(readyRef.current ? 'ready' : 'error')` — confirm `readyRef.current` is still `true` at that point, since only the *gesture*, not the engine, failed, so the correct branch is `'ready'`, not `'error'` — **this is exactly the kind of subtle branch a fresh reviewer should double-check, not assume**).

- [ ] **Step 1: Dispatch the Workflow-tool adversarial-verify**

Two independent Opus-or-better lenses, each given the exact requirement list above plus the two source files + two test files, asked to answer, per requirement, `HOLD` or `VIOLATION FOUND` with a concrete trace (not a restatement of the code).

- [ ] **Step 2: Record the outcome**

If both lenses return `HOLD` on all 6 requirements: proceed to Increment 5 (Task 14) with no code change. If either lens finds a violation: fix `vad.ts` and/or `use-voice-input.ts`, re-run the Task 10/11/12 test suites (`cd web && bun run test -- vad.test.ts use-voice-input.test.ts`) to confirm the fix is green, then re-run the adversarial-verify on the changed requirement(s) only (not the whole list) before proceeding.

- [ ] **Step 3: Commit the review outcome to the SDD ledger inline (not a code commit)**

No `git commit` here — the review outcome is recorded once, in Task 16's ledger update (`.superpowers/sdd/progress.md`, "SLICE 30b — PHASE 7" section), alongside every other task's summary. Do not create an intermediate ledger commit for this task alone.

---

## Increment 4 boundary gate

Run: `bun run check` (root — chains `docs:check && typecheck && lint && check:web && test`).
Expected: GREEN. `web/src/features/voice/{vad,use-voice-input}.ts` are additive-only files (no existing file outside `web/src/features/voice/` is touched yet) — nothing outside this new directory should be affected.

---

## Increment 5 — Composer mic button + waveform UI

### Task 14: `waveform.tsx` + `mic-button.tsx` — the composer-mounted voice affordance

**Files:**
- Create: `web/src/features/voice/waveform.tsx`
- Test: `web/src/features/voice/waveform.test.tsx`
- Create: `web/src/features/voice/mic-button.tsx`
- Test: `web/src/features/voice/mic-button.test.tsx`

**Interfaces:**
- Consumes:
  - `useVoiceInput`, `UseVoiceInputOpts` from `./use-voice-input.ts` (Task 12) — **mocked** in `mic-button.test.tsx` (the same "mock the hook itself" pattern `chat/index.test.tsx` uses for `useChat` — this task tests MicButton's *rendering* against every `VoiceStatus`, not the hook's internals, which Task 12 already covers).
  - `isVoiceInputEnabled`, `voiceModelTier` from `../settings/index.tsx` (Part A — the settings accessors) — also mocked in the test.
- Produces (locked, verbatim):
  ```ts
  // waveform.tsx
  export function Waveform(props: { level: number }): JSX.Element;

  // mic-button.tsx
  export type MicButtonProps = {
    onFinal: (text: string) => void;
    onInterim?: (text: string) => void;
  };
  export function MicButton(props: MicButtonProps): JSX.Element | null;
  ```
  Consumed by Task 15's `composer.tsx` wiring.

- [ ] **Step 1: Write the failing tests — `waveform.tsx`**

Create `web/src/features/voice/waveform.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Waveform } from './waveform.tsx';

describe('Waveform', () => {
  it('renders a bar scaled to the given level', () => {
    render(<Waveform level={0.5} />);
    const bar = screen.getByTestId('voice-waveform')
      .firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('50%');
  });

  it('clamps a level above 1 to 100%', () => {
    render(<Waveform level={2} />);
    const bar = screen.getByTestId('voice-waveform')
      .firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('clamps a negative level to 0%', () => {
    render(<Waveform level={-1} />);
    const bar = screen.getByTestId('voice-waveform')
      .firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- waveform.test.ts`
Expected: FAIL — `Cannot find module './waveform.tsx'`.

- [ ] **Step 3: Implement `waveform.tsx`**

Create `web/src/features/voice/waveform.tsx`:

```tsx
type Props = { level: number };

/**
 * A lightweight live level indicator — a single CSS-width-driven bar
 * scaled by `level` (0..1), redrawn on every `useVoiceInput` level tick
 * while listening. No canvas/SVG waveform history in v1 (a forward-item)
 * — a single scaled bar is enough signal that the mic is picking up sound.
 */
export function Waveform({ level }: Props) {
  const clamped = Math.max(0, Math.min(1, level));
  return (
    <div
      data-testid="voice-waveform"
      role="presentation"
      className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border)]"
    >
      <div
        className="h-full bg-[var(--color-accent)] transition-[width] duration-75"
        style={{ width: `${Math.round(clamped * 100)}%` }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && bun run test -- waveform.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 5: Write the failing tests — `mic-button.tsx`**

Create `web/src/features/voice/mic-button.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useVoiceInputMock = vi.fn();
vi.mock('./use-voice-input.ts', () => ({
  useVoiceInput: (...args: unknown[]) => useVoiceInputMock(...args),
}));

const isVoiceInputEnabledMock = vi.fn();
const voiceModelTierMock = vi.fn();
vi.mock('../settings/index.tsx', () => ({
  isVoiceInputEnabled: () => isVoiceInputEnabledMock(),
  voiceModelTier: () => voiceModelTierMock(),
}));

import { MicButton } from './mic-button.tsx';

function baseVoice(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready',
    ready: true,
    level: 0,
    interim: '',
    error: undefined,
    startHold: vi.fn(),
    stopHold: vi.fn(),
    toggleTap: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe('MicButton', () => {
  beforeEach(() => {
    isVoiceInputEnabledMock.mockReturnValue(true);
    voiceModelTierMock.mockReturnValue('moonshine-base');
    useVoiceInputMock.mockReset();
  });

  it('renders nothing when voice input is disabled in Settings', () => {
    isVoiceInputEnabledMock.mockReturnValue(false);
    useVoiceInputMock.mockReturnValue(baseVoice());
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.queryByTestId('mic-button')).not.toBeInTheDocument();
  });

  it('shows a disabled loading state while the model is loading', () => {
    useVoiceInputMock.mockReturnValue(baseVoice({ status: 'loading' }));
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('mic-hold-button')).toBeDisabled();
    expect(screen.getByText('Loading voice model…')).toBeInTheDocument();
  });

  it('shows an inline error (permission denied / load-fail) and disables both buttons', () => {
    useVoiceInputMock.mockReturnValue(
      baseVoice({ status: 'error', error: 'microphone unavailable' }),
    );
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('mic-hold-button')).toBeDisabled();
    expect(screen.getByTestId('mic-tap-toggle-button')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'microphone unavailable',
    );
  });

  it('calls startHold/stopHold on pointerdown/pointerup of the hold button', () => {
    const voice = baseVoice();
    useVoiceInputMock.mockReturnValue(voice);
    render(<MicButton onFinal={vi.fn()} />);
    const button = screen.getByTestId('mic-hold-button');
    fireEvent.pointerDown(button);
    expect(voice.startHold).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button);
    expect(voice.stopHold).toHaveBeenCalledTimes(1);
  });

  it('calls startHold/stopHold on keydown(Space)/keyup(Space) of the hold button, ignoring key-repeat', () => {
    const voice = baseVoice();
    useVoiceInputMock.mockReturnValue(voice);
    render(<MicButton onFinal={vi.fn()} />);
    const button = screen.getByTestId('mic-hold-button');
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: ' ', repeat: true });
    expect(voice.startHold).toHaveBeenCalledTimes(1); // repeat ignored
    fireEvent.keyUp(button, { key: ' ' });
    expect(voice.stopHold).toHaveBeenCalledTimes(1);
  });

  it('calls toggleTap on a click of the tap-toggle button', () => {
    const voice = baseVoice();
    useVoiceInputMock.mockReturnValue(voice);
    render(<MicButton onFinal={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mic-tap-toggle-button'));
    expect(voice.toggleTap).toHaveBeenCalledTimes(1);
  });

  it('renders the waveform while listening, driven by the hook level', () => {
    useVoiceInputMock.mockReturnValue(
      baseVoice({ status: 'listening', level: 0.7 }),
    );
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('voice-waveform')).toBeInTheDocument();
  });

  it('shows a subtle CPU-mode hint when WebGPU is absent (D9 — invisible-beyond-load degrade)', () => {
    vi.stubGlobal('navigator', {});
    useVoiceInputMock.mockReturnValue(baseVoice());
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByText('(CPU mode)')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd web && bun run test -- mic-button.test.ts`
Expected: FAIL — `Cannot find module './mic-button.tsx'`.

- [ ] **Step 7: Implement `mic-button.tsx`**

Create `web/src/features/voice/mic-button.tsx`:

```tsx
import type { KeyboardEvent, PointerEvent } from 'react';
import { isVoiceInputEnabled, voiceModelTier } from '../settings/index.tsx';
import { useVoiceInput } from './use-voice-input.ts';
import { Waveform } from './waveform.tsx';

export type MicButtonProps = {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
};

const DEFAULT_SILENCE_MS = 800;
const HOLD_KEYS = new Set([' ', 'Enter']);

function configuredSilenceMs(): number {
  const raw = (
    globalThis as { __AGENT_VOICE_VAD_SILENCE_MS__?: unknown }
  ).__AGENT_VOICE_VAD_SILENCE_MS__;
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_SILENCE_MS;
}

function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Composer-mounted voice affordance (spec D2). Two independent elements —
 * deliberately NOT one button trying to disambiguate hold-vs-tap by press
 * duration (undocumented in the design, and genuinely ambiguous): the
 * primary button is real hold-to-talk (`pointerdown`/`up` +
 * `keydown`/`up` on a focusable button), and a small adjacent button
 * starts/stops a VAD-gated tap-to-toggle session. Renders nothing when
 * voice input is disabled in Settings (D7).
 */
export function MicButton({ onFinal, onInterim }: MicButtonProps) {
  const enabled = isVoiceInputEnabled();
  const voice = useVoiceInput({
    enabled,
    model: voiceModelTier(),
    silenceMs: configuredSilenceMs(),
    onFinal,
    onInterim,
  });

  if (!enabled) return null;

  function handleHoldKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!HOLD_KEYS.has(event.key) || event.repeat) return;
    event.preventDefault();
    voice.startHold();
  }

  function handleHoldKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    voice.stopHold();
  }

  function handleHoldPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    voice.startHold();
  }

  function handleHoldPointerUp(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    voice.stopHold();
  }

  const busy = voice.status === 'loading';
  const broken = voice.status === 'error';
  const disabled = busy || broken;

  return (
    <div
      data-testid="mic-button"
      aria-label="Voice input"
      className="flex items-center gap-2"
    >
      <button
        type="button"
        data-testid="mic-hold-button"
        aria-label="Hold to talk"
        disabled={disabled}
        onPointerDown={handleHoldPointerDown}
        onPointerUp={handleHoldPointerUp}
        onPointerLeave={handleHoldPointerUp}
        onKeyDown={handleHoldKeyDown}
        onKeyUp={handleHoldKeyUp}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)] disabled:opacity-50"
      >
        {voice.status === 'listening' ? '● Listening' : '🎤 Hold'}
      </button>
      <button
        type="button"
        data-testid="mic-tap-toggle-button"
        aria-label="Toggle hands-free listening"
        disabled={disabled}
        onClick={() => voice.toggleTap()}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)] disabled:opacity-50"
      >
        Tap
      </button>
      {voice.status === 'listening' && <Waveform level={voice.level} />}
      {busy && (
        <span className="text-xs text-[var(--color-muted)]">
          Loading voice model…
        </span>
      )}
      {broken && (
        <span role="alert" className="text-xs text-[var(--color-muted)]">
          {voice.error ?? 'Voice input unavailable'}
        </span>
      )}
      {!disabled && !hasWebGpu() && (
        <span className="text-[10px] text-[var(--color-muted)]">
          (CPU mode)
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd web && bun run test -- mic-button.test.ts`
Expected: PASS — 8/8.

- [ ] **Step 9: Gate + commit**

Run: `cd web && bun run typecheck && cd web && bun run lint`

```bash
git add web/src/features/voice/waveform.tsx web/src/features/voice/waveform.test.tsx web/src/features/voice/mic-button.tsx web/src/features/voice/mic-button.test.tsx
git commit -m "feat(voice): add MicButton (hold + tap-toggle affordances) and Waveform"
```

---

### Task 15: Wire `MicButton` into `composer.tsx`

**Files:**
- Modify: `web/src/features/chat/composer.tsx`
- Test (new): `web/src/features/chat/composer.test.tsx`

**Interfaces:**
- Consumes: `MicButton` from `../voice/mic-button.tsx` (Task 14).
- Produces: no new exports — `composer.tsx`'s existing `Composer` component signature (`Props { onSend, disabled?, initialValue? }`) is unchanged (D2: voice never touches `onSend`).

- [ ] **Step 1: Write the failing test**

Create `web/src/features/chat/composer.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../voice/mic-button.tsx', () => ({
  MicButton: ({ onFinal }: { onFinal: (text: string) => void }) => (
    <button type="button" onClick={() => onFinal('voice transcript')}>
      fixture-mic
    </button>
  ),
}));

import { Composer } from './composer.tsx';

describe('Composer — voice wiring (Slice 30b Phase 7)', () => {
  it('appends a final voice transcript into the value via setValue', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    fireEvent.click(screen.getByText('fixture-mic'));
    const textarea = screen.getByPlaceholderText(/./i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('voice transcript');
  });

  it('appends onto EXISTING typed text with a separating space rather than replacing it', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/./i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('fixture-mic'));
    expect(textarea.value).toBe('hello voice transcript');
  });

  it('leaves the existing Send/onSend submit path completely untouched', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/./i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'typed message' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('typed message', []);
    expect(textarea.value).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- composer.test.tsx`
Expected: FAIL — the mocked `MicButton` fixture button ("fixture-mic") does not appear anywhere yet, since `composer.tsx` doesn't import/render `MicButton`.

- [ ] **Step 3: Wire `MicButton` into `composer.tsx`**

In `web/src/features/chat/composer.tsx`, add the import (alongside the existing `uploadImage` import):

```ts
import { MicButton } from '../voice/mic-button.tsx';
```

Add a handler next to `handleSubmit` (same component body, before the `return`):

```ts
function handleVoiceFinal(text: string) {
  setValue((v) => (v ? `${v} ${text}` : text));
}
```

Insert `<MicButton onFinal={handleVoiceFinal} />` inside the existing
`composer-dropzone` `<section>`, after the attachments block and before
`<PromptInput>` — i.e. the section's returned JSX becomes:

```tsx
  return (
    <section
      data-testid="composer-dropzone"
      aria-label="Message composer (drop or paste an image to attach it)"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-2">
          {attachments.map((a) => (
            <li
              key={a.uploadId}
              className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-fg)]"
            >
              <span>{a.name}</span>
              <button
                type="button"
                aria-label={`remove ${a.name}`}
                onClick={() => removeAttachment(a.uploadId)}
                className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 px-3 pt-2">
        <MicButton onFinal={handleVoiceFinal} />
      </div>
      <PromptInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        disabled={disabled}
        placeholder="Message the agent…"
      />
    </section>
  );
```

(Only the `<div>` wrapping `<MicButton>` and the `handleVoiceFinal` function
+ import are new — every other line in `composer.tsx` is byte-identical to
before this task, per D2's "zero changes to `handleSubmit`/`onSend`"
contract.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && bun run test -- composer.test.tsx`
Expected: PASS — 3/3.

- [ ] **Step 5: Run the full web suite to confirm no regression on the existing Composer/ChatArea tests**

Run: `cd web && bun run test`
Expected: PASS — every pre-existing test file (`chat/index.test.tsx`, `chat/attachments.test.tsx`, `chat/confirm-prompt.test.tsx`, `chat/session.test.tsx`, etc.) still passes; the `MicButton` mock in `composer.test.tsx` is scoped to that file only (Vitest module mocks are per-test-file), so `chat/index.test.tsx` renders the REAL `MicButton`, which itself renders nothing when `isVoiceInputEnabled()` is false (the real Settings accessor's default, since no test in that file enables voice) — confirm this holds, i.e. `chat/index.test.tsx` needs no change.

- [ ] **Step 6: Gate + commit**

Run: `cd web && bun run typecheck && cd web && bun run lint`

```bash
git add web/src/features/chat/composer.tsx web/src/features/chat/composer.test.tsx
git commit -m "feat(voice): wire MicButton into the Composer (D2 — value-only, submit path untouched)"
```

---

## Increment 5 boundary gate

Run: `bun run check` (root — chains `docs:check && typecheck && lint && check:web && test`).
Expected: GREEN. Note for the controller: `scripts/docs-check.ts`'s
"every subsystem documented" gate only walks root `src/<subsystem>`
(`readdirSync('src')`) — it does **not** scan `web/src/features/*` — so the
new, still-undocumented `web/src/features/voice/` directory does **not**
trip `docs:check` at this boundary. `docs/architecture.md` still needs its
new `## Voice (web UI — Slice 30b Phase 7)` section before Task 18 lands
(the repo's hard documentation line applies at the *slice-landing* gate,
which Task 16 satisfies), but nothing blocks `bun run check` from passing
green here, at the Increment 5 boundary, without it.

---

## Increment 6 — Docs + live-verify + partial-slice land

### Task 16: Update all four living-doc surfaces (`architecture.md`, `README.md`, `ROADMAP.md`, SDD ledger)

**Files:**
- Modify: `docs/architecture.md` (append a new `## Voice (web UI — Slice 30b Phase 7)` section at end of file)
- Modify: `README.md` (top narrative blockquote + slice-status table row)
- Modify: `docs/ROADMAP.md` (gap-table "TUI / local web UI" row + recommended-sequence item 21's Phase-7 bullet)
- Modify: `.superpowers/sdd/progress.md` (new "SLICE 30b — PHASE 7" ledger section)

**Interfaces:** none (documentation only — no code, no test cycle; verified via `bun run docs:check` + a manual read-through against the real merged diff, per the repo's "presence is enforced by tooling; truth is the review's job" rule).

- [ ] **Step 1: `docs/architecture.md` — append the new Phase 7 section**

Append at the very end of the file (after the existing `## Builders + Library (web UI — Slice 30b Phase 5)` section's `### What's still deferred (explicit, not Phase-5 debt)` — i.e. the current last line of the file):

```markdown

## Voice (web UI — Slice 30b Phase 7)

Browser voice **input** — hands-free dictation into the Composer's own
text state — completing the promise §23 explicitly deferred: "Voice-out,
barge-in, streaming, and true hold-to-talk... belong to Slice 30's browser
UI, where `getUserMedia` gives real AEC and `keydown`/`keyup` give a real
hold-to-talk gesture." Dictation only: interim/final transcript text lands
in the Composer's `value` state, exactly where a typed character would —
the user still presses Send. No TTS, no barge-in, no interrupting an
in-flight assistant turn — voice never touches `sendMessage`/`handleSend`.

**D1 — engine choice overrides the parent spec's D8.** The parent Slice-30
design assumed sherpa-onnx WASM, mirroring §23's CLI engine. Re-validated
at Phase-7 design time: sherpa-onnx ships no first-party browser package,
so a working build would mean an Emscripten build from source plus a
*second* ONNX runtime alongside the one `@huggingface/transformers`
(transformers.js) already pulls into the tree for other subsystems. Phase
7 instead runs Moonshine ASR + Silero VAD through transformers.js's own
`AutoModel`/pipeline — one runtime, already a dependency. The `VoiceFrames`
contract (mono `Float32Array` @ 16kHz) and the `voice.transcribe` span
vocabulary carry over from §23 unchanged; only the concrete engine differs.

### Module map (`web/src/features/voice/`)

| File | Responsibility |
|---|---|
| `audio-capture.ts` | `createAudioCapture()` — `getUserMedia({audio:{echoCancellation,noiseSuppression,autoGainControl}})` + an `AudioWorkletProcessor` (`downsample-worklet.ts`) downsampling the browser's native rate to 16kHz mono; `createDownsampler(inputRate)` is the pure, carry-state resample core (mirrors §23's `carryPcmChunk` byte-carry idiom, adapted to fractional-sample carry rather than byte alignment) |
| `stt-engine.ts` | `createSttEngine({model})` — boots a dedicated Web Worker (`stt.worker.ts`) hosting transformers.js's Moonshine (ASR) + Silero (VAD) pipeline, Cache-API-persisted, WebGPU-preferred/WASM-fallback; `ready()`/`onProgress()`/`detectSpeech()`/`transcribe()`/`close()` |
| `vad.ts` | `createSegmenter({silenceMs, gated, frameMs})` — the pure, no-real-model segmentation state machine: hold-to-talk (`gated:false`) buffers every pushed frame regardless of `isSpeech` and closes only on `flush()`; tap-to-toggle (`gated:true`) tracks sustained silence from each chunk's actual sample-derived duration (not a naive frame-count) to close/reopen a segment per speech/silence cycle, trimming the trailing silent frames back off the emitted audio |
| `use-voice-input.ts` | `useVoiceInput(opts, deps?)` — the orchestrator hook: worker lifecycle (spawn on enable, terminate on disable/unmount), a concurrent-gesture guard (a second gesture while one is active is a no-op), ready-gating (a press before `engine.ready()` resolves is a no-op), `startHold`/`stopHold`/`toggleTap`/`cancel` wired to `audio-capture.ts` + `stt-engine.ts` + `vad.ts` |
| `mic-button.tsx` | Composer-mounted affordance (D2) — two elements: a genuine hold-to-talk button (`pointerdown`/`up` + `keydown`/`up`) and a small tap-to-toggle button (`onClick`); inline degrade states (loading/error) plus a subtle WebGPU-absent hint |
| `waveform.tsx` | A live level bar driven by `useVoiceInput`'s `level` stream while listening |

### Contracts + config

`src/contracts/voice.ts` lifts `VoiceFrames` (D5 — a documented, deliberate
exception to the isomorphic zod-only convention: it never crosses an HTTP
wire in this phase, so there is no round-trip to validate); `src/voice/
types.ts` re-exports it rather than redefining it — one definition, two
importers, no drift. `CaptureSource` is mirrored into
`src/contracts/enums.ts` with a parity test
(`tests/contracts/capture-source-parity.test.ts`).
`AGENT_WEB_VOICE_DEFAULT_MODEL`/`AGENT_WEB_VOICE_VAD_SILENCE_MS` follow the
`AGENT_WEB_NOTIFY_*` env-fallback convention (`src/config/schema.ts`),
plumbed to the browser as
`window.__AGENT_VOICE_DEFAULT_MODEL__`/`window.__AGENT_VOICE_VAD_SILENCE_MS__`
by `renderIndexHtml` (`src/server/main.ts`) — the same injection point the
notify globals already use, no new mechanism.

### Composer + Settings wiring

`mic-button.tsx` mounts inside `composer.tsx`'s existing
`composer-dropzone` `<section>`, beside the attachment chips; its
`onFinal` callback appends the transcript into the Composer's own `value`
state (`setValue(v => v ? \`${v} ${text}\` : text)`) —
`handleSubmit`/`onSend`/`sendMessage` are byte-for-byte unchanged (D2).
`settings/index.tsx` gains `isVoiceInputEnabled()`/`voiceModelTier()`
accessors mirroring `isOsNotifyEnabled()`, plus the enable toggle +
model-tier selector.

### Telemetry

No new span. The browser has no server-side span writer of its own for the
transcription step in this phase; the transcript rides the normal
`/api/chat` turn as ordinary composer text, already spanned end-to-end
(`handleChat`'s existing instrumentation). A dedicated browser-emitted
`voice.transcribe` beacon is a tracked forward-item — it would need a new
ingestion route purely for telemetry, which this phase's
zero-new-server-routes scope deliberately avoids.

### D10 outcome (browser spike, Part A Increment 3)

<!-- IMPLEMENTER: replace this paragraph with the ACTUAL rung of the D10
     fallback ladder that Part A's Task ~7/8 browser spike proved works,
     read from that task's commit message / ledger entry / code comments
     in `web/vite.config.ts` + `src/server/isolation-headers.ts`. Do not
     ship this file with this placeholder comment still present — pick
     ONE of the three candidate sentences below (or write the true one if
     none match exactly), then DELETE this comment block entirely. -->

- If the spike proved the same-origin-WASM-runtime + cross-origin-CORS
  model-fetch story works unchanged under `require-corp`: "The D10 spike
  confirmed the lazy-CDN-download + Cache-API-persist story works
  unchanged under the existing `require-corp` header — no isolation-header
  change was needed."
- If `credentialless` was required: "The D10 spike found the cross-origin
  HuggingFace CDN model fetch blocked under `require-corp`; `web/vite.config.ts`
  and `src/server/isolation-headers.ts` both moved `Cross-Origin-Embedder-Policy`
  to `credentialless` (still `crossOriginIsolated`, still `SharedArrayBuffer`-capable)
  to unblock it."
- If self-hosting was required: "The D10 spike found even `credentialless`
  insufficient; `bun run setup:voice-web` self-hosts the Moonshine/Silero
  model files into the served static dir, and `stt-engine.ts` points
  transformers.js at them via `env.allowRemoteModels=false` +
  `env.localModelPath` — fully same-origin, fully offline-capable."

### Two documented limitations, not bugs

- **No live streaming interim transcript.** `SttEngine.transcribe()`
  returns only a final string (no partial-result callback in this phase's
  worker protocol); `useVoiceInput`'s `interim`/`onInterim` surface a
  transient "…" busy indicator while a segment is transcribing, not a
  word-by-word live partial. A true streaming ASR partial is a forward-item.
- **`mic-button.tsx` exposes hold-to-talk and tap-to-toggle as two
  separate buttons**, not one button that disambiguates a quick tap from a
  deliberate hold by press duration — the design docs left that
  disambiguation heuristic unspecified, and inventing an undocumented
  timing threshold was judged riskier than two unambiguous affordances.
  Consolidating them into one smarter control is a forward-item if real
  usage shows the two-button layout is confusing.
```

Note: this section deliberately does NOT flip the 30b capability marker
anywhere else in the file — Phase 7 landing is a partial-slice landing
(Phase 8 polish/a11y/live-verify remains).

- [ ] **Step 2: `README.md` — top narrative blockquote**

Find the sentence (near the end of the top "Where this is going" blockquote):

```
> my crew/workflow run finish." Next: **Slice 30b Phase 7**.
> **Slices 23/24/25 remain held** on the `ai@7` provider blocker. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md).
```

Replace with (inserting a Phase-7 clause before the "Next:" pointer, and
advancing "Next:" to Phase 8, mirroring exactly how the Phase-5/Phase-6
clauses were appended earlier in this same paragraph):

```
> my crew/workflow run finish." **Phase 7 — Browser voice input — has now
> landed too**: a mic button in the Composer offers real hold-to-talk
> (`pointerdown`/`up` + `keydown`/`up`) and tap-to-toggle (VAD-gated
> auto-stop) dictation, transcribed client-side via transformers.js +
> Moonshine + Silero VAD (overriding the parent design's sherpa-onnx-WASM
> assumption, D1) — the transcript lands in the same composer text box a
> typed message would, then the user still presses Send. This is a
> **partial-slice landing**: the 30b capability stays 🟡 (Phase 8
> polish/a11y/live-verify remains). Next: **Slice 30b Phase 8**.
> **Slices 23/24/25 remain held** on the `ai@7` provider blocker. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md).
```

- [ ] **Step 3: `README.md` — slice-status table row**

Find the `| **30b** | ... | 🚧 In progress — Phases 1, 1b, 2, 3, 4, 5 & 6 landed |`
row (the long single-line table row documenting every 30b phase). Two edits
to that one row:
1. Insert one more sentence before the trailing `See [docs/architecture.md]...`
   citation, following the exact style of the existing Phase 5/Phase 6
   sentences in that row: `**Phase 7:** a Composer mic button (hold-to-talk
   + VAD-gated tap-to-toggle) transcribes speech client-side via
   transformers.js + Moonshine + Silero VAD (D1 — overriding the parent
   spec's sherpa-onnx-WASM assumption), writing interim/final text into the
   existing composer \`value\` state; no new server route, no new
   telemetry span (the transcript rides the resulting chat turn's existing
   span).`
2. Append `, §"Voice (web UI — Slice 30b Phase 7)"` to that row's trailing
   `See [docs/architecture.md](docs/architecture.md) §...` citation list.
3. Change the trailing status cell from
   `🚧 In progress — Phases 1, 1b, 2, 3, 4, 5 & 6 landed` to
   `🚧 In progress — Phases 1, 1b, 2, 3, 4, 5, 6 & 7 landed`.

- [ ] **Step 4: `docs/ROADMAP.md` — gap-table "TUI / local web UI" row**

In the gap table (the row starting `| **TUI / local web UI** | 🟡 **in
progress (Slice 30b) — Phases 1 ... 6 (Persistence...) landed; voice/polish
phases pending.**`), apply two edits:
1. Change `... 6 (Persistence: SessionStore, chat recall/auto-ingest,
   Sessions UI, notifications) landed; voice/polish phases pending.` to
   `... 6 (Persistence: SessionStore, chat recall/auto-ingest, Sessions UI,
   notifications) + 7 (Browser voice — Composer hold-to-talk + tap-toggle
   dictation via transformers.js/Moonshine/Silero, overriding the parent
   spec's sherpa-onnx-WASM D8 with D1) landed; polish/a11y phase pending.`
2. Do **not** change the leading `🟡 **in progress**` marker — Phase 7
   landing does not flip this capability to ✅ (Phase 8 remains).

- [ ] **Step 5: `docs/ROADMAP.md` — recommended-sequence item 21, Phase-7 bullet**

Find the line:

```
        - **Phases 7–8 — Browser voice, polish/a11y/live-verify** — **not yet started.**
```

Replace with two separate bullets (Phase 7 landed, Phase 8 still pending),
in the exact style of the preceding Phase 1–6 bullets in this same list:

```
        - **Phase 7 — Browser voice** — ✅ **shipped.** Hands-free
          dictation: interim/final transcript text lands in the Composer's
          own `value` state (D2) — the user still presses Send, no
          barge-in, no TTS. A new `web/src/features/voice/` module
          (`audio-capture.ts`'s `getUserMedia`+AEC → AudioWorklet 48k→16k
          downsampler; `stt-engine.ts`'s Web-Worker-hosted transformers.js
          Moonshine+Silero pipeline, Cache-API-persisted,
          WebGPU-preferred/WASM-fallback; `vad.ts`'s pure hold-to-talk/
          tap-to-toggle segmentation state machine; `use-voice-input.ts`'s
          orchestrator hook — ready-gating, a concurrent-gesture guard, and
          clean `MediaStream`/worker teardown; `mic-button.tsx` +
          `waveform.tsx`) wires into the Composer beside the existing
          attachment affordances. **D1 overrides the parent spec's
          sherpa-onnx-WASM assumption**: transformers.js (already a root
          dependency) runs Moonshine ASR + Silero VAD through one
          `AutoModel`/pipeline instead of a second ONNX runtime.
          `VoiceFrames`/`CaptureSource` are lifted into `src/contracts/` (a
          documented, deliberate non-zod exception for `VoiceFrames` — it
          never crosses an HTTP wire) and re-exported by §23's
          `src/voice/types.ts`, so the CLI and the browser share one
          definition. No new server route (client-side only); no new
          telemetry span (the transcript rides the resulting `/api/chat`
          turn's existing span). This is a **partial-slice landing** — the
          30b capability stays 🟡 (Phase 8 polish/a11y/live-verify
          remains). Spec: `docs/superpowers/specs/2026-07-18-slice-30b-phase7-voice-design.md`;
          ledger: `.superpowers/sdd/progress.md` (§"SLICE 30b — PHASE 7").
          See `docs/architecture.md` §Contracts, §"Voice input (STT)",
          §"Voice (web UI — Slice 30b Phase 7)".
        - **Phase 8 — Polish/a11y/live-verify** — **not yet started.**
```

(Implementer note: if a Part-A plan file exists at a different filename
than assumed above, or the real HEAD commit/date differs, use the actual
values — the sentence structure and every technical claim above is
accurate to this plan's design and should not otherwise change.)

- [ ] **Step 6: `.superpowers/sdd/progress.md` — new ledger section**

Append a new top-level section, mirroring the exact heading/PROGRESS/
increment-boundary/completion-banner conventions the Phase 5/6 sections
already use (see `## SLICE 30b — PHASE 6 (Persistence + Product)` for the
template this mirrors):

```
## SLICE 30b — PHASE 7 (Browser Voice Input)
Branch `slice-30b-phase7-voice` off `main` (base `6d1d06c`). Spec `docs/superpowers/specs/2026-07-18-slice-30b-phase7-voice-design.md`; plans `docs/superpowers/plans/<part-a-filename>.md` (Tasks 1–9, Increments 1–3) + `docs/superpowers/plans/<part-b-filename>.md` (Tasks 10–18, Increments 4–6). Executing via subagent-driven SDD (Sonnet floor; ultracode adversarial-verify for the D10 browser-spike/worker-lifecycle-race task (Part A) and Task 13 (§7.1 segmentation + §7.2 worker-lifecycle, Part B); Fable/Opus = whole-branch final-review reserve). Usage paced against /usage weekly All-models % (NOT ccusage — see feedback-usage-meter-authority).
Task-numbering map (Part A drafted Increments 1–3, Part B drafted Increments 4–6 — execute strictly top-to-bottom): Inc 1 (contract lift + config + settings scaffold) = **Task 1–?**; Inc 2 (audio capture + downsample worklet) = **Task ?–?**; Inc 3 (STT worker + lazy load, opens with the D10 spike) = **Task ?–9**; Inc 4 (vad.ts segmenter + use-voice-input hook + both gestures) = **Task 10–13**; Inc 5 (Composer mic button + waveform) = **Task 14–15**; Inc 6 (docs + live-verify + land) = **Task 16–18**.
HARD → ultracode adversarial-verify: the D10 browser spike / STT-worker lifecycle race (Part A, Increment 3) + **Task 13** (spec §7.1 (b)/(c) segmentation correctness + §7.2 (a)–(d) worker-lifecycle/concurrent-gesture/teardown/model-load-fail correctness, Part B, Increment 4).
Global constraints (govern every task): bun (never npm); web tests `vitest` (`cd web && bun run test`) — never mixed with root `bun:test`; per-task gate = `bun run typecheck` + `bun run lint:file -- <files>` + focused tests (web adds `cd web && bun run typecheck && bun run test`); `type` over `interface`, `enum` over string-literal unions; `VoiceFrames` is a documented non-zod contracts exception (D5); never hardcode voice tunables (env fallback-only: AGENT_WEB_VOICE_DEFAULT_MODEL, AGENT_WEB_VOICE_VAD_SILENCE_MS); full `bun run check` at each increment boundary.
Reconciliation notes (Part B, baked into this plan's preamble): (1) MicButton renders TWO separate elements (hold + tap-toggle), not one button disambiguating gesture-by-press-duration — the design docs left that heuristic unspecified; (2) `useVoiceInput`'s `interim`/`onInterim` surface only a "…" busy indicator, not a real streaming partial (the `SttEngine.transcribe()` contract returns a final string only); (3) `vad.ts`'s tap-toggle silence clock uses each chunk's actual sample-derived duration, not a naive frame-count × `frameMs` estimate, so it stays correct regardless of the AudioWorklet's real chunk sizing.

PROGRESS (resume at first task not marked complete):
[... Part A's Increment 1–3 entries land here first, written by whichever
session executes Part A ...]
Increment 4 — vad.ts segmenter + use-voice-input hook + both gestures:
- [ ] Task 10: vad.ts hold-to-talk (gated:false) mode + reset/no-phantom-emit tests.
- [ ] Task 11: vad.ts tap-to-toggle (gated:true) mode — multi-cycle, jitter, short-utterance tests.
- [ ] Task 12: use-voice-input.ts orchestrator hook (ready-gating, concurrent-gesture guard, teardown, model-load-fail degrade) + 12 tests against fake AudioCapture/SttEngine.
- [ ] Task 13: HARD — ULTRACODE adversarial-verify (§7.1 b/c + §7.2 a–d). [record outcome here: both lenses HOLD, or violation found + fix commit ref]
=== INCREMENT 4 (Tasks 10-13) [complete once all four checked + T13's review outcome recorded] ===
Increment 5 — Composer mic button + waveform:
- [ ] Task 14: waveform.tsx (3 tests) + mic-button.tsx (8 tests, mocked useVoiceInput + settings accessors).
- [ ] Task 15: Wire MicButton into composer.tsx (3 new composer.test.tsx tests) — submit path unchanged, full web suite green.
=== INCREMENT 5 (Tasks 14-15) [complete once both checked + full web suite green] ===
Increment 6 — Docs + live-verify + land:
- [ ] Task 16: architecture.md (new §"Voice (web UI — Slice 30b Phase 7)") + README (top blockquote + slice table) + ROADMAP (gap table + recommended-sequence Phase-7 bullet) + this ledger section.
- [ ] Task 17: whole-branch fan-out review (Opus/Fable — correctness/security/docs) + LIVE-VERIFY (real Chrome + real mic).
- [ ] Task 18: partial-slice LAND (merge --no-ff main + push, all 4 surfaces same push, capability stays 🟡) + Artifact regen.

=== [fill in as executed] ===
```

- [ ] **Step 7: Verify + commit**

Run: `bun run docs:check` (expected: PASS — `web/` is out of this gate's
scope per Step-1's implementation note above; the gate only checks that
every root `src/<subsystem>` is named in `docs/architecture.md`, and
`src/voice/` already is, per §23).

Run: `cd web && bun run typecheck` (docs changes touch no `.ts`/`.tsx`,
expected unaffected — run anyway as a smoke check that nothing else broke
in parallel).

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs: Slice 30b Phase 7 — architecture.md + README + ROADMAP + SDD ledger (all 4 surfaces)"
```

---

### Task 17: Whole-branch fan-out review, then LIVE-VERIFY (real Chrome + real mic)

**Files:** none created/modified by this task itself (a review + manual
verification gate) — its output is a fix-wave of commits if any finding
requires one, applied on top of Tasks 10–16's work before Task 18 lands.

**Interfaces:** none.

- [ ] **Step 1: Dispatch the whole-branch fan-out review**

Three parallel reviewers over the full `main...HEAD` diff (Part A + Part B
combined), mirroring the exact pattern every prior 30b phase used
(Phase 6's "3 parallel Opus reviewers over full main...HEAD"):
1. **Correctness** (Opus or better) — re-confirm §7.1/§7.2 hold on the
   *merged whole* (not just Task 13's isolated files — does anything in
   Increment 5/6 reintroduce a race, e.g. does `mic-button.tsx` ever call
   `useVoiceInput` with an `opts` object literal recreated every render in
   a way that defeats the hook's `useCallback` memoization and causes a
   stale-closure bug?).
2. **Security** — this phase adds no new server route and no new
   filesystem/network write surface beyond what Part A's model-download
   caching already does; confirm there genuinely is no new attack surface
   (e.g. confirm `stt-engine.ts`'s Cache-API usage doesn't read/write
   outside its own cache name, confirm no user-supplied string reaches a
   `new Function`/`eval`-like sink in the transformers.js wiring).
3. **Docs-accuracy** — re-verify Task 16's `architecture.md`/README/ROADMAP
   claims against the REAL merged diff (not the plan's *intended* diff):
   does the D10-outcome paragraph in `architecture.md` actually match what
   Part A's spike really proved (not a leftover placeholder)? Does the
   module-map table's file list match what actually exists in
   `web/src/features/voice/`? Does README/ROADMAP's "🟡 stays in progress,
   Phase 8 remains" framing match every other surface?

- [ ] **Step 2: Apply any fix wave**

If any of the 3 reviewers reports a finding: fix it, re-run the affected
task's focused tests + `cd web && bun run typecheck && bun run lint`, and
commit the fix separately (conventional message, e.g. `fix(voice): ...` or
`docs: ...` for a doc-only correction) — do not silently fold a fix into
an earlier task's commit via amend.

- [ ] **Step 3: LIVE-VERIFY checklist (real Chrome + real mic, not mocks)**

Using the `/chrome` native Chrome integration (per the user's global
CLAUDE.md: prefer native Chrome over Playwright for anything needing the
real logged-in browser + real mic permission prompts) against a real
`bun run web` server:

- [ ] Enable voice input in Settings (toggle on, grant the mic-permission
      prompt when Chrome asks).
- [ ] **Hold-to-talk:** press and hold the hold button, say a short
      sentence, release — confirm the transcribed text appears in the
      Composer's text box, then press Send and confirm the message sends
      normally (the existing chat path, unmodified).
- [ ] **Tap-to-toggle with VAD auto-stop:** tap the toggle button, speak
      one sentence, pause past the configured silence window, speak a
      second sentence, pause again, then tap the toggle button to stop —
      confirm BOTH sentences appended into the composer text box as two
      separate auto-closed segments (§7.1 b, live, not just unit-tested).
- [ ] **Degrade — mic permission denied:** deny the browser's mic
      permission prompt (or revoke it in Chrome's site settings and
      retry) — confirm the mic button shows an inline error and is
      disabled, not a silent no-op or an uncaught exception in the
      console.
- [ ] **Degrade — WebGPU-absent WASM fallback:** if testing on a
      WebGPU-capable Chrome, this can only be checked by simulating
      absence — note in the ledger whether a real no-WebGPU browser was
      available to test the automatic WASM-fallback path; if not
      available, record this as an honest live-verify gap (mocked-only
      coverage for this one path), not a false "verified" claim.
- [ ] **Degrade — model-load failure:** with dev tools open, block the
      network request(s) transformers.js makes to fetch the model
      weights (e.g. via Chrome's request-blocking) and confirm the mic
      button reaches its error state with a toast/inline message, not a
      stuck "Loading voice model…" forever.

Record the real outcome of every checkbox above (pass/fail/not-available)
in the Task 16 ledger section's `[fill in as executed]` line before Task 18.

---

### Task 18: Partial-slice LAND (merge `--no-ff` to `main` + push) + Artifact regen note

**Files:** none created — a git operation + one controller-owned follow-up.

**Interfaces:** none.

- [ ] **Step 1: Confirm the pre-land gate is green**

Run: `bun run check` (root, full chain: `docs:check && typecheck && lint
&& check:web && test`). Expected: GREEN, including `docs:check` now that
Task 16 has documented `src/voice/`'s D1 deviation in `architecture.md`
(the `src/voice/` subsystem itself was already documented since Slice 29 —
this phase only adds the new `## Voice (web UI...)` section and the
`src/contracts/voice.ts` note, neither of which `docs-check.ts`'s
subsystem-presence scan requires beyond what already passes).

- [ ] **Step 2: Merge `--no-ff` to `main` and push**

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff slice-30b-phase7-voice -m "merge: Slice 30b Phase 7 — Browser voice input (Composer hold-to-talk + tap-toggle dictation) to the web UI"
git push origin main
```

Verify the pre-push slice-landing gate passes (it blocks a push to `main`
that changes `docs/architecture.md` unless `README.md`, `docs/ROADMAP.md`,
**and** `.superpowers/sdd/progress.md` are all updated in the same push —
Task 16 satisfied all three in one commit, so this should pass without
needing `DOCS_OK=1`).

- [ ] **Step 3: Delete the work branch**

```bash
git branch -d slice-30b-phase7-voice
git push origin --delete slice-30b-phase7-voice
```

- [ ] **Step 4: Record the landing in the SDD ledger**

Append (mirroring the exact `=== ✅ SLICE 30b PHASE 6 LANDED ... ===`
banner style from the Phase 6 section):

```
=== ✅ SLICE 30b PHASE 7 LANDED on main + PUSHED (<real date>) ===
Merge --no-ff <real merge commit sha>, pushed <real base sha>..<real merge sha> main→main
(slice-landing gate PASSED — architecture.md+README+ROADMAP+ledger all in
the same push), work branch slice-30b-phase7-voice DELETED, origin IN
SYNC. PARTIAL-slice landing — capability STAYS 🟡 (Phase 8 polish/a11y/
live-verify remains, NOT flipped ✅). Final gate GREEN: <real root pass/skip/fail counts> + <real web pass/files counts>.
All 18 tasks (Part A 1–9 + Part B 10–18) + whole-branch review (3
reviewers, <clean, or: N findings fixed>) + live-verify (<real
pass/fail/not-available per checklist item>) done.
```

- [ ] **Step 5: Regenerate the docs-snapshot Artifact (controller-owned, after the merge lands)**

This step is **not performed by the implementing session** — per the
repo's standing convention (`reference-artifact-regen-mechanics`), the
docs-snapshot Artifact is regenerated by the controller from the now-merged
`docs/architecture.md`, targeting the **same URL** the Phase-6 regen used
(`claude.ai/code/artifact/<uuid>` — the id is `c760844f` per the Phase-6
ledger entry; confirm it hasn't changed before reusing it). Expected diff
to the snapshot: **+1 node** ("Voice (web)" or similar, wired to the
existing "Voice" (CLI, §23) node and to "Composer"/"Chat" — not a
duplicate of the CLI voice node, a distinct web-side node referencing it),
updated footer slice/test counts (the real counts from Step 4's ledger
entry), and — if Task 17's whole-branch review found anything — whatever
narrative update that implies. Record the regenerated Artifact's node/edge
counts in the ledger as the final line of the Phase 7 section, mirroring
the Phase-6 T67 entry's level of detail.

```
- [x] Task 18 (Artifact): Artifact regenerated + published to the same url
  <uuid> (<real date>). +1 node ("Voice (web)") · deepened Composer/Chat
  nodes w/ Phase-7 clauses+files · +N edges · footer "... <N> slices ·
  <root count> root + <web count> web tests". Counts: <nodes>/<edges>/
  <tour steps>/<concepts>.
=== ✅✅ SLICE 30b PHASE 7 100% COMPLETE — all 18 tasks + whole-branch
review + live-verify + landed + ALL 4 DOC SURFACES CURRENT + Artifact
regenerated. main @ <sha>, origin in sync. Capability stays 🟡 (Phase 8
polish/a11y/live-verify remains). NEXT: Slice 30b Phase 8. ===
```

---

## Increment 6 boundary / final gate

Run: `bun run check` (root, full chain). Expected: GREEN — this is the
pre-land gate (Task 18, Step 1) and must be green before the merge in
Step 2 of that task.

---

## Self-review notes (per `superpowers:writing-plans`)

**Spec coverage (Part B's slice, §5 Increments 4–6 + §7.1/§7.2 hard parts):**
- Increment 4 (vad.ts + use-voice-input.ts + both gestures + VAD gating) → Tasks 10, 11, 12. ✅
- §7.1 (b)/(c) + §7.2 (a)–(d) adversarial-verify → Task 13 (HARD, ultracode). ✅
- Increment 5 (Composer mic button + waveform) → Tasks 14, 15. ✅
- Increment 6 (docs + live-verify + partial-slice land) → Tasks 16, 17, 18. ✅
- §6 "Web component tests" (mic-button degrade states, composer setValue
  wiring, submit path untouched) → Task 14's `mic-button.test.tsx` + Task
  15's `composer.test.tsx`. ✅
- §8 standing notes (architecture-doc update, telemetry-to-emit) →
  Global Constraints section + Task 16 Step 1. ✅
- Four-doc-surface hard line → Task 16 (all four) + Task 18 (land gate
  enforces the same-push requirement). ✅

**Placeholder scan:** one deliberate, explicitly-flagged exception —
Task 16 Step 1's D10-outcome paragraph carries an `<!-- IMPLEMENTER: -->`
comment with three concrete candidate sentences to choose from (not a bare
"TBD"), because the true content depends on Part A's real spike result,
which cannot be known at plan-authoring time; the task explicitly forbids
shipping the comment itself. Every other step in this document contains
complete, runnable code or exact prose to insert — no other "TBD"/"similar
to Task N"/vague instruction was found on review.

**Type consistency check:** `Segmenter`/`SegmenterOpts`/`createSegmenter`
(Task 10) → consumed verbatim by `use-voice-input.ts` (Task 12, imports
`createSegmenter, type Segmenter` from `./vad.ts`). `VoiceInputDeps`/
`UseVoiceInputOpts`/`UseVoiceInput`/`useVoiceInput` (Task 12) → consumed
verbatim by `mic-button.tsx` (Task 14, imports `useVoiceInput` — mocked in
its own test, real in the component). `MicButtonProps`/`MicButton` (Task
14) → consumed verbatim by `composer.tsx` (Task 15). No renamed field or
function was found across task boundaries on review.
