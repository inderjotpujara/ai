# Task 17 Report: `POST /api/models/pull` fire-and-watch + `ServerDeps.runModelPull` wiring

## What was implemented

Per the brief, exactly as specified:

1. **`src/server/models/pull.ts` (new)** — `handleModelPull(req, deps)`:
   - Parses/validates the body with `ModelPullRequestSchema` (400 on malformed input).
   - Resolves a `ProviderKind` server-side via `resolveProvider` (test-injectable; defaults to `defaultResolveProvider`, which re-reads the SAME cached catalog `GET /api/models` uses via `readCatalog()` and looks up `(runtime, modelRef)` → 404 if no match — the client never supplies/chooses the provider).
   - Mints `runId` (`newRunId`), **pre-creates the run dir** (`await createRun(deps.runsRoot, runId)`) BEFORE returning.
   - Starts the turn **detached**: `void deps.runModelPull({...}).catch(async (err) => { await writeArtifact(run, 'error.json', ...) })`.
   - Returns `{ runId }` (200) parsed through `RunLaunchResponseSchema`, without awaiting the pull.
   - Exports `RunModelPullTurn` and `ModelPullDeps` types.

2. **`src/server/launch-turns.ts`** — added `createRealRunModelPull(runsRoot)`: wraps `runModelPullBridge` (Task 15) in `withRunTelemetry` (no MCP mount), wired to the real `providerFor` (`src/provisioning/registry.ts`) and `resolveDestDir()`, with a per-pull `AbortController` (no external cancel wiring this phase, per the brief).

3. **`src/server/app.ts`** — extended `ServerDeps` with `runModelPull: RunModelPullTurn` and `freeDiskBytes: () => Promise<number>`; registered both `GET /api/models` (`handleModelList`, from T16 — not previously wired) and `POST /api/models/pull` (`handleModelPull`) in `handleApi`, placed after the `builders/build` route (no regex collisions).

4. **`src/server/main.ts`** — imported `createRealRunModelPull` and `freeDiskBytes` (from `../provisioning/cli-deps.ts`), constructed `const runModelPull = createRealRunModelPull(runsRoot);`, and added both `runModelPull` and `freeDiskBytes` to the `deps` object literal passed to `buildFetch`.

5. **Fixture ripple** — added `runModelPull: async () => {}` and `freeDiskBytes: async () => Number.MAX_SAFE_INTEGER` to all four `ServerDeps` literals in `tests/server/app.test.ts`, the one in `tests/server/runs-routes.test.ts`, and the `deps()` helper in `tests/server/phase4-routes.test.ts`.

6. **`tests/server/models-pull.test.ts` (new)** — the four tests from the brief verbatim (200+pre-created dir+detached invocation with resolved provider; unresolvable pair → 404 + no dir; malformed body → 400; throwing turn → `error.json` persisted, no unhandled rejection).

## TDD evidence

**RED** (before creating `src/server/models/pull.ts`):
```
bun test tests/server/models-pull.test.ts
error: Cannot find module '../../src/server/models/pull.ts' ...
0 pass / 1 fail / 1 error
```

**GREEN** (after implementing `pull.ts`):
```
bun test tests/server/models-pull.test.ts
4 pass / 0 fail / 7 expect() calls
```

**Step 9 group** (after wiring `launch-turns.ts`/`app.ts`/`main.ts` + fixture ripple):
```
bun test tests/server/models-pull.test.ts tests/server/app.test.ts tests/server/runs-routes.test.ts tests/server/phase4-routes.test.ts
23 pass / 0 fail / 59 expect() calls
```

**Full gate** (`bun run check` = `docs:check && typecheck && lint && check:web && test`): exit 0.
- `docs:check`: passed (no new `src/**` subsystem — this task only extends existing `src/server` routes/deps, already documented).
- `typecheck`: clean (`tsc --noEmit`, no output).
- `lint` (biome, all changed files): 0 errors (1 pre-existing warning, see Concerns).
- `check:web` (vitest): 133/133 passed.
- root `bun test` (bun:test, full suite): 1380 pass, 36 skip, 0 fail, 3279 expect() calls across 348 files.

## Fire-and-watch contract — how it's satisfied

- **Watchable at t=0**: `handleModelPull` calls `await createRun(deps.runsRoot, runId)` and only returns `{ runId }` after that `await` resolves — the run directory exists on disk before the HTTP response is sent, so an immediate client `GET /api/runs/:runId/stream` cannot 404 on a missing run dir (mirrors the Phase-4 `handleCrewRun` fix for the C1 launch→watch snapshot-404 bug). Verified by the first test: `existsSync(join(runsRoot, runId))` is `true` immediately after `res.json()`, with no additional wait.
- **`.catch` always attached**: the detached invocation is `void deps.runModelPull(...).catch(async (err) => {...})` — a single chained `.catch` on the same promise the `void` discards, so a rejection is caught synchronously at the moment it's constructed (there is no window where the returned promise is unobserved). The catch itself is wrapped in its own inner `try/catch` so even a failure to write `error.json` (e.g. run dir already removed) can't produce a second unhandled rejection. Verified by the fourth test: a turn that throws still results in `runs/<runId>/error.json` existing after a short wait, with no test-process crash from an unhandled rejection.
- **Span-once**: `runModelPullBridge` (Task 15) owns the `model.pull` root span's open/close (`rec.outcome('done')` on success, `rec.outcome('failed')` + rethrow on error, both inside the one `withModelPullSpan` call) — `createRealRunModelPull` doesn't wrap it in any additional span-opening logic, so the span closes exactly once regardless of outcome. This task didn't touch `pull-bridge.ts`; it only wires the already-reviewed T15 bridge into the new detached-turn seam.
- **Consent resolved up-front / no mid-stream confirm**: `handleModelPull` takes no `confirm`/consent callback at all — it fires immediately on a valid, resolvable request. This matches fork 1 (non-interactive-after-consent): whatever UI-level consent gate exists is expected to run before this endpoint is called, not inside it.
- **Input bounds**: `ModelPullRequestSchema` (`runtime: z.enum(RuntimeKind)`, `modelRef: z.string().min(1)`, Task 6) already bounds the body; `handleModelPull` adds no additional unbounded fields.
- **Provider never client-supplied**: `resolveProvider` is the only source of `ProviderKind` — the wire body has no `provider` field (enforced by the schema), and the default resolver derives it purely from the server's own cached catalog.

## Files changed

- `src/server/models/pull.ts` (new)
- `src/server/launch-turns.ts` (added `createRealRunModelPull`, new imports)
- `src/server/app.ts` (`ServerDeps` extended; two routes registered)
- `src/server/main.ts` (real turn constructed + added to `deps`)
- `tests/server/models-pull.test.ts` (new)
- `tests/server/app.test.ts` (4 `ServerDeps` literals extended)
- `tests/server/runs-routes.test.ts` (1 `ServerDeps` literal extended)
- `tests/server/phase4-routes.test.ts` (`deps()` helper extended)

Commit: `3abd2c7` — "feat(server): POST /api/models/pull fire-and-watch + createRealRunModelPull (Phase 5)"

## Self-review

- Reused the exact Phase-4 `handleCrewRun` concurrency shape (pre-create dir → detach → `.catch` → return) rather than inventing a new pattern.
- `GET /api/models` (Task 16) was implemented but never wired into `app.ts`/`main.ts` before this task — this task closes that gap as instructed, alongside the new `POST /api/models/pull` route.
- Route placement: both new routes sit after `/api/builders/build` and before the `/run` sub-path matches; neither pathname (`/api/models`, `/api/models/pull`) collides with any existing literal or regex route (`/api/models/pull` is a distinct literal string checked before any of the crews/workflows/runs regexes run).
- Import ordering in `launch-turns.ts` and `main.ts` was adjusted to satisfy biome's import-sort rule (alphabetical-by-specifier), since the brief's snippets showed the new imports appended at the end rather than sorted in place.
- Biome auto-format (`biome check --write`) reformatted a few multi-line object/type literals in `pull.ts`, `app.ts`, and `models-pull.test.ts` to satisfy its line-width/wrap rules; no logic changed, only whitespace/wrapping.

## Concerns

- `tests/server/models-pull.test.ts` (brief's verbatim code) declares a module-level `let root: string;` that is never used (the brief's `withRoot` helper shadows it with a local `root` parameter). Biome flags this as an unused-variable **warning** (not an error — `lint:file` still exits 0). Left as-is to match the brief's prescribed test code exactly; a trivial future cleanup would delete that one line.
- `createRealRunModelPull` creates its own `AbortController` per pull with no way for a caller (e.g. a future "cancel pull" UI action) to signal it — called out explicitly in the brief as an intentional deferral ("wiring a user-triggered cancel is a natural follow-on, not required here"), not a defect of this task.
- No live-verify (real Ollama/MLX/HF pull end-to-end through the new route) was run in this task — `createRealRunModelPull`/`runModelPullBridge`'s real provider wiring is exercised at the unit level only (T15's own tests cover the bridge; this task's tests inject a fake `runModelPull` turn). Per the standing live-verify-before-merge gate, this should be exercised live before the branch's final merge, alongside the rest of Increment 3.

---

# Addendum: Slice 30b Phase 7 — consolidated whole-branch review fix wave (2026-07-18)

Three Opus whole-branch reviewers ran against `slice-30b-phase7-voice`: correctness = merge-ready, security = ready-with-fixes (1 Important), docs = fixes-needed (Minor). This addendum applies all findings in one pass.

## S1 [Important — security] `src/server/main.ts` — escape ALL `renderIndexHtml` script globals

`voice.defaultModel` is a STRING global interpolated via bare `JSON.stringify(...)`, unlike `token` which was already routed through a `</` → `<` escape. A `defaultModel` value containing `</script>` could break out of the injected `<script>` tag (the numeric globals were never actually at risk, but the drift showed the escaping wasn't structurally enforced). Fixed by factoring a shared `const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');` and routing all five interpolations (token, notify.pollMs, notify.minDurationMs, voice.defaultModel, voice.vadSilenceMs) through it — so the escaping can no longer silently drift per-field. Added a new test in `tests/server/main.test.ts` asserting a `defaultModel` containing `</script><script>alert(1)</script>` renders escaped (`</script><script>alert(1)</script>`), alongside the pre-existing hostile-token test (still green, unchanged).

## C1 [Minor — correctness/comment] `src/contracts/enums.ts` — `CaptureSource` doc comment

The comment falsely claimed the enum was needed as a `voice.transcribe` span attribute "from the browser path" — no web code imports `CaptureSource` or emits telemetry (audio never leaves the tab in Phase 7). Rewrote the comment to state the true consumers (the pre-existing CLI: `src/voice/transcribe.ts`, `src/telemetry/spans.ts`) and that the parity test is a regression guard against future redefinition, not a live divergence check. No enum-value or test changes.

## C2 [Minor — correctness/cosmetic] `web/src/features/chat/composer.tsx` — empty padded row when voice is off

The `<div className="... px-3 pt-2"><MicButton/></div>` wrapper always rendered even though `MicButton` returns `null` when voice input is disabled (the default), leaving an empty padded row above the composer for every default user. Fixed by importing `isVoiceInputEnabled` from `../settings/index.tsx` (the same accessor `MicButton` itself reads) and gating the wrapper: `{isVoiceInputEnabled() && (<div>...<MicButton .../></div>)}`. Submit path untouched. `composer.test.tsx` updated: the mock for `../settings/index.tsx` now defaults `isVoiceInputEnabled` to `true` (so the existing voice-wiring tests still exercise the ON path) with a new test asserting the wrapper/mic-button fixture is absent when it's mocked `false`.

## C3 [Minor — correctness] Wire the dead interim busy-indicator

`useVoiceInput`'s `interim` state was tracked internally (`setInterim('…')`) but never rendered — `MicButton` accepted an `onInterim` prop that no caller (`composer.tsx`) ever passed, so the callback was genuinely dead threading. Fixed by rendering `voice.interim` (the hook's own return value) inline in `MicButton` when `voice.status === 'transcribing'` (`data-testid="mic-interim"`), and removed the now-redundant `onInterim` callback entirely from `UseVoiceInputOpts` and `MicButtonProps` (it duplicated what the returned `interim` field already provides — no caller ever supplied it). Added a `mic-button.test.tsx` case asserting the interim indicator renders while transcribing. `docs/architecture.md`'s "No live streaming interim transcript" limitation note updated to describe the return-value + render path instead of the removed callback.

## D1 [Minor — docs] `web/vite.config.ts` comment

Corrected "was proven/adjusted by the Task 7 D10 spike" (false — the empirical spike was carried forward to Task 17 live-verify, never run standalone in Task 7) to describe the config as built on the Rung-1 *reasoned assumption*, to be confirmed at live-verify — matching `architecture.md`'s own account.

## D2 [Minor — docs] `web/src/features/voice/stt.worker.ts` header comment

Changed "empirically confirmed at Task 17 live-verify" (past tense, reads as already-done) to "to be confirmed at Task 17 live-verify" (future tense, matches reality — live-verify hasn't run yet).

## D3 [Minor — docs] `README.md` — Slice-30b row title

The slice-table row title enumerated only Phases 1–6; appended "+ 7 (Browser voice input)" to match how the row body/status cell (and ROADMAP.md's parallel row) already described it.

## D4 [Minor — docs] `README.md` — stale "Next (product line)" row

Was still describing "Slice 30b Phase 7 onward — voice" with "rich, interruptible voice lives here" as if undelivered — but Phase 7 shipped (dictation only, no barge-in). Reworded to "Phase 8 onward — polish/a11y, stacking on the Phase 1/1b/2/3/4/5/6/7 foundation," explicitly noting Phase 7 shipped hold-to-talk/tap-to-toggle dictation but NOT rich/interruptible barge-in voice, which remains future scope.

## D5 [Minor — docs, done] `docs/architecture.md` Voice section wording

Two inaccuracies fixed: (1) `downsample-worklet.ts`'s table row claimed it posts "fixed-size 16kHz Float32Array chunks" — verified against the code (`downsample-worklet.ts`'s `process()`), the AudioWorklet's `postMessage` chunk length is actually **variable** per audio-render quantum (fractional-carry resample state), so the wording now says "variable-length (per audio-render quantum)". (2) "Contracts + config" claimed `CaptureSource` "is mirrored into `src/contracts/enums.ts`" — backwards; it's **single-sourced** there and re-exported by `src/voice/types.ts`. Both corrected.

## Gate results

- Root `bun run typecheck`: clean.
- `cd web && bun run typecheck`: clean.
- `cd web && bun run test`: 56 test files / 284 tests passed (0 fail).
- Root `bun run lint`: exit 0, 18 pre-existing warnings (none in touched files).
- Root `bun run docs:check`: passes ("living docs present + linked; every src subsystem documented").
- Root `bun run test` (full suite): 1556 pass / 36 skip / 0 fail / 3687 expect() calls across 377 files.

## Files changed

- `src/server/main.ts` (S1)
- `tests/server/main.test.ts` (S1 — new hostile-`defaultModel` test)
- `src/contracts/enums.ts` (C1)
- `web/src/features/chat/composer.tsx` (C2)
- `web/src/features/chat/composer.test.tsx` (C2 — new disabled-wrapper test)
- `web/src/features/voice/use-voice-input.ts` (C3 — removed dead `onInterim`)
- `web/src/features/voice/mic-button.tsx` (C3 — render `interim`, removed dead prop)
- `web/src/features/voice/mic-button.test.tsx` (C3 — new interim-visible test)
- `web/vite.config.ts` (D1)
- `web/src/features/voice/stt.worker.ts` (D2)
- `README.md` (D3, D4)
- `docs/architecture.md` (D5 + interim-limitation wording touched up alongside C3)

## Self-review / concerns

- No finding was skipped; all eight (S1, C1, C2, C3, D1–D5) applied.
- The `onInterim` removal goes slightly beyond the letter of C3's "wire it" instruction, but the brief itself authorized this explicitly ("If `onInterim`/Composer threading is now genuinely unused, remove the dead prop threading rather than leave it") — verified no caller anywhere in `web/src` ever passed it, and no test asserted on it.
- Did not touch `docs/ROADMAP.md` — its Slice 30b row title already said "+ 7" correctly (confirmed by grep) and no other stale Phase-7 wording was found there; only README.md needed D3/D4.

---

## Live-verify fix: Silero VAD load + inference (stt.worker.ts) — 2026-07-18

**Trigger:** driving the real browser, the worker loaded Moonshine ASR (~130MB, OK under COEP require-corp) then FAILED loading Silero VAD:
`Could not locate file: ".../onnx-community/silero-vad/resolve/main/config.json"`. `onnx-community/silero-vad` is a CUSTOM model with no root config.json, so `AutoModel.from_pretrained(id, { device })` made transformers.js fetch a non-existent config.json. Mocked-worker unit tests never hit the real HF fetch, so this only surfaced live.

**Reference API validated against (authoritative):** HuggingFace `transformers.js-examples/moonshine-web/src/worker.js` (fetched verbatim via `gh api …/contents/moonshine-web/src/worker.js`) — the exact Silero-VAD-+-Moonshine architecture this feature mirrors. Cross-checked the installed `@huggingface/transformers@4.2.0` type surface (`processing_utils.d.ts`, `modeling_utils.d.ts`) and `moonshine-web/src/constants.js` (`SAMPLE_RATE = 16000`).

### Fix 1 — Silero VAD load (was crashing live)
- **Before:** `AutoModel.from_pretrained(VAD_MODEL_ID, { device })`
- **After:** `AutoModel.from_pretrained(VAD_MODEL_ID, { config: { model_type: 'custom' } as PretrainedConfig, dtype: 'fp32' })` — no `device` (VAD runs CPU/WASM). The inline `model_type: 'custom'` tells transformers.js to skip the config.json fetch that 404'd. Matches the reference exactly. (TS cast needed because 4.2.0 types `config` as a full `PretrainedConfig`; the runtime accepts the partial, as the JS reference does.)

### Fix 2 — Silero VAD inference (`detectSpeech`), was wrong shape + non-stateful
- **Before:** `vadModel({ input: chunk })` → `result.output?.data?.[0]`. Raw Float32Array as `input`, no `sr`, no `state` — Silero would not run correctly.
- **After:** stateful, reference-exact:
  - Module scope: `const VAD_SR = new Tensor('int64', [16000], [])`; `let vadState` reset to a zeroed `new Tensor('float32', new Float32Array(2*1*128), [2,1,128])` on every (re)load.
  - Per call: `const input = new Tensor('float32', chunk, [1, chunk.length]); const { stateN, output } = await vadModel({ input, sr: VAD_SR, state: vadState }); vadState = stateN;` then `output.data[0] > 0.5`.
  - External `detectSpeech(chunk)→Promise<boolean>` signature UNCHANGED; state is threaded internally across calls and reset per session. Threshold kept at 0.5 (existing behavior; not part of the load/shape bug).

### Fix 3 — Moonshine inference (`transcribe`): VERIFIED CORRECT, no change
- Current flow `asrProcessor(samples)` → `asrModel.generate({ ...inputs, max_new_tokens: 256 })` → `asrProcessor.batch_decode(output, { skip_special_tokens: true })` is the standard whisper-style seq2seq path. Confirmed `Processor.batch_decode` exists in `processing_utils.d.ts` (delegates to `PreTrainedTokenizer.batch_decode`) and `MoonshineProcessor._call(audio)` returns feature-extractor inputs. The reference uses the `pipeline()` wrapper which does the same three steps internally. Left ASR load `{ device }` untouched (loaded fine live; the reference's per-module `dtype` map is a perf choice, not a correctness fix).

### Other changes
- `import { … , Tensor }` changed from `type Tensor` to a value import (needed to construct tensors); added `type PretrainedConfig`. D10 header + `detectWebGpuDevice` WebGPU logic + COEP headers untouched. External worker message protocol and `SttEngine`/`useVoiceInput` contract unchanged.

### Gate results
- `bun run typecheck` (web): clean.
- `bun run test` (web): 56 files, **284 passed**. (Existing tests mock the worker and assert only `detectWebGpuDevice` / the message protocol — none asserted the old VAD tensor shape, so none needed updating.)
- `bun run lint:file -- web/src/features/voice/stt.worker.ts`: clean.
- `bun run build` (web): success (stt.worker chunk 516 kB).

### Could NOT statically verify (needs the real browser — controller to re-drive)
- That Silero VAD actually reaches `ready` and that `silero_vad({ input, sr, state })` returns `{ stateN, output }` at runtime with these exact ONNX I/O names (validated only against the reference + docs, not executed — no ONNX/WASM under happy-dom).
- Real end-to-end transcription output from Moonshine `generate`/`batch_decode`.

---

## T17 live-verify fix #2 — AudioWorklet module fails to load in the build

### The live defect (real Chrome)
Enabling voice + starting capture threw **"Unable to load a worklet's module."**
Root cause: `audio-capture.ts` built the worklet URL with the asset pattern
`new URL('./downsample-worklet.ts', import.meta.url)` and passed it to
`ctx.audioWorklet.addModule(...)`. Under **Vite 8 + Rolldown**, that pattern does
NOT transpile/emit the worklet — `bun run build` produced **no worklet chunk** in
`dist/assets/`, so `addModule` received a URL to a raw, unservable `.ts` file.
happy-dom has no real AudioWorklet, so unit tests (which mock `addModule`) can't
catch it — browser-build-only.

### Confirmed-correct pattern (validated, not guessed)
Use Vite's **`?worker&url`** import for the worklet module:
`import WORKLET_MODULE_URL from './downsample-worklet.ts?worker&url';`

- **Why this and not the alternatives:** Vite's official Assets/Features docs
  (via context7 `/vitejs/vite`) confirm `?worker&url` produces a **separate,
  transpiled, dependency-bundled chunk** and returns its served URL — whereas
  the plain `?url` suffix does NOT bundle a module's dependencies and does NOT
  transpile a `.ts` file (vitejs/vite issues #9952 and #15431), and the
  `new URL('./x.ts', import.meta.url)` asset pattern isn't emitted by Rolldown
  for this case. Sources: Vite docs "Web Workers"/"Static Asset Handling"
  (context7 `/vitejs/vite`); vitejs/vite#9952, #15431.
- A worklet global scope **cannot resolve runtime `import`s**, so the emitted
  file must be a single self-contained chunk. This project already sets
  `worker.format: 'es'` in `vite.config.ts`, so `?worker&url` emits a clean
  single-file ES module (no `import` statements) — verified below. **No
  `vite.config.ts` change was needed.**

### Before / after
- **Before:** `const WORKLET_MODULE_URL = new URL('./downsample-worklet.ts', import.meta.url);`
- **After:** `import WORKLET_MODULE_URL from './downsample-worklet.ts?worker&url';`
- Extracted the pure `createDownsampler` (+ `OUTPUT_RATE`) into a new
  **zero-dependency** module `web/src/features/voice/downsampler.ts`;
  `audio-capture.ts` now **re-exports** it (`export { createDownsampler } from
  './downsampler.ts'`) so its external API and `audio-capture.test.ts`'s import
  are unchanged, and `downsample-worklet.ts` imports `createDownsampler` from
  `./downsampler.ts` instead of `./audio-capture.ts`. This is what makes the
  `?worker&url` bundle clean: the worklet chunk pulls in ONLY the pure math, not
  browser-only capture code, and avoids the circular worker reference that would
  arise if the worklet bundled `audio-capture.ts` (which itself imports the
  worklet URL). No math is duplicated — one source of truth, still unit-tested
  via the re-export. `createAudioCapture`'s API + `WORKLET_PROCESSOR_NAME`
  registration ('downsample-processor') unchanged.

### PROOF the worklet chunk is now emitted
`cd web && bun run build` →
```
dist/assets/downsample-worklet-_q4B9x1q.js   0.66 kB
```
- `grep -rl "registerProcessor\|DownsampleProcessor" dist/assets/` hits
  `downsample-worklet-_q4B9x1q.js` (and the main chunk, which references its URL).
- The emitted chunk is **fully self-contained**: the downsampler math is inlined,
  the `DownsampleProcessor` class is present, it ends with
  `registerProcessor("downsample-processor", …)`, and it contains **zero `import`
  statements** (grep count 0) — exactly what `addModule` needs in a worklet scope.
- The main bundle (`index-*.js`) references `assets/downsample-worklet-_q4B9x1q.js`
  as the served URL handed to `addModule`.

### Gate results
- `bun run build` (web): success; worklet chunk emitted (above).
- `bun run typecheck` (web): clean.
- `bun run test` (web): 56 files, **284 passed** (voice tests mock capture/`addModule`; none asserted the old URL construction, so none needed changing).
- `bun run lint:file` on the 3 touched files: clean.
- `bun run docs:check`: pass (new file is within the already-documented voice subsystem).

### Could NOT statically verify (needs the real browser — controller to re-drive)
- That `addModule(WORKLET_MODULE_URL)` now succeeds end-to-end and the worklet
  emits 16 kHz chunks in real Chrome (happy-dom has no AudioWorklet runtime). The
  bundling defect itself is proven fixed (chunk emitted, self-contained, served
  URL wired); the live re-drive confirms the round trip.
