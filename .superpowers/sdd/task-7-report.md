# Task 7 report: `stt.worker.ts` — transformers.js Moonshine + Silero VAD worker

## Status: DONE

## What was built
- `web/src/features/voice/stt.worker.ts` — dedicated Web Worker exposing the
  `load` / `detectSpeech` / `transcribe` postMessage protocol
  (`SttWorkerRequest`/`SttWorkerResponse`), lazy-loading Moonshine ASR
  (`onnx-community/moonshine-{tiny,base}-ONNX`) + Silero VAD
  (`onnx-community/silero-vad`) via `@huggingface/transformers`.
  - WebGPU-detect → WASM fallback, extracted as an exported, unit-tested
    pure function `detectWebGpuDevice()`.
  - Cache-API persistence via `env.useBrowserCache = true`.
  - `ModelTier` is now canonically defined in this file (per the brief's
    interface note); Task 8 will import it from here and Task 4's temporary
    local copy in `web/src/features/settings/index.tsx` gets superseded then,
    not in this task.
- `web/src/features/voice/stt.worker.test.ts` — 4 tests covering
  `detectWebGpuDevice`'s branches (no `navigator.gpu`; adapter granted;
  adapter resolves `null`; `requestAdapter` rejects → D9 never-crash
  fallback), each via `vi.stubGlobal('navigator', ...)`.

## D10 spike — controller decision carried forward, NOT run by me
Per this task's explicit instruction, I did **not** run the manual Step-1
browser spike myself. The header comment records the controller's decision
verbatim:
```
// D10: built on Rung 1 (require-corp + CDN CORS fetch); empirically confirmed
// at Task 17 live-verify. Fallback ladder if CDN blocked: (2) COEP
// credentialless, (3) self-host models via env.localModelPath. See spec D10.
```
No COEP/header changes were made in this task (`web/vite.config.ts`'s
`isolation` object and `src/server/isolation-headers.ts` are untouched).
Empirical confirmation is deferred to Task 17 live-verify, as directed.

## Deviations from the brief's sample code (type-correctness fixes)
The brief's code is "the artifact the spike proves or requires correcting" —
I made the following adjustments to satisfy `@huggingface/transformers`
v4.2.0's actual `.d.ts` shapes (checked directly against
`node_modules/@huggingface/transformers/types/`), since `bun run typecheck`
must pass:
1. **`ProgressInfo` is a 5-member discriminated union** (`initiate` /
   `download` / `progress` / `progress_total` / `done`), not always
   `{loaded, total}` — only two members carry those fields. Replaced the
   brief's `(info: {loaded:number; total:number}) => ...` callback type with
   `(info: ProgressInfo) => ...` plus a `progressOf()` narrowing helper
   (`'loaded' in info && 'total' in info`) that only posts a progress message
   when the fields are present.
2. **`AutoProcessor.from_pretrained` return type is already `Processor`** —
   dropped the brief's redundant `as Processor` cast; it typechecks without
   it.
3. **`generate()` returns `Promise<ModelOutput | Tensor>`**; `batch_decode`
   expects `number[][] | Tensor`. Added an explicit `as Tensor` cast on the
   `generate()` result (the brief's code omitted this and would not
   typecheck as written).

All changes are narrow type-correctness fixes; the functional shape (device
detect → load ASR+processor+VAD → post `ready`; `detectSpeech`/`transcribe`
request→result round trips; uniform `error` message on any rejection) matches
the brief exactly.

## Dependency reconciliation
**Did NOT need to pull Task 9's dep-add forward.** `@huggingface/transformers`
is already a root dependency (`package.json:43`, `^4.2.0`), the root repo is a
bun workspace (`"workspaces": ["web"]`), and `bun run typecheck` in `web/`
resolved the import cleanly via the hoisted root `node_modules` with zero
changes to `web/package.json`. Left `web/package.json` untouched — Task 9 can
still add the explicit dependency entry + Vite worker/`optimizeDeps` config +
isolation-headers comment as originally scoped; nothing about that work was
pulled forward.

## Testing — what IS and ISN'T unit-tested
- **IS tested:** `detectWebGpuDevice()` — all 4 branches (no GPU / adapter
  granted / adapter null / `requestAdapter` throws), 4 passing tests in
  `stt.worker.test.ts`.
- **IS NOT tested (by design, per the brief and controller's testing-reality
  note):** the real `load()`/`detectSpeech()`/`transcribe()` model-loading and
  inference paths — these require a real WASM/ONNX runtime that cannot run
  under happy-dom/Vitest. No fake/mocked model call was fabricated to pretend
  otherwise. This is validated at Task 17/18 live-verify. The `postMessage`
  message-protocol handling on the **main-thread** side (the part that IS
  meaningfully unit-testable against a mocked `Worker` global) is Task 8's
  `stt-engine.ts`, per the brief's Files note.

## Gate results (all green)
- `cd web && bun run typecheck` — PASS (repo-root `bun run typecheck` also
  PASS).
- `cd web && bun run test` — 50 test files, 223 tests, all PASS (includes the
  4 new `stt.worker.test.ts` tests). Pre-existing unrelated `ECONNREFUSED`
  console noise from another test's reconnect-logging path is expected/
  pre-existing, not caused by this change.
- `bun run lint:file -- web/src/features/voice/stt.worker.ts
  web/src/features/voice/stt.worker.test.ts` — PASS after one `biome
  check --write` formatting pass (line-width wraps only, no logic changes).
- `bun run docs:check` (pre-commit hook) — PASS; no `docs/architecture.md`
  update required since no `src/**` file changed (this is a `web/**`-only
  change).

## Commit
`3a60ca6` — `feat(voice): stt.worker.ts — transformers.js Moonshine+Silero
worker, D10 spike outcome recorded`
(2 files changed: `web/src/features/voice/stt.worker.ts`,
`web/src/features/voice/stt.worker.test.ts`)

## Concerns / notes for the controller
- The three type-correctness deviations above are real and should be
  reviewed — they don't change the runtime call shape but they do change
  exactly what gets read off transformers.js's return values
  (`progressOf()` narrowing, the `as Tensor` cast). If Task 17 live-verify
  finds the actual runtime shapes differ (e.g. `generate()` genuinely returns
  something not `Tensor`-compatible, or Moonshine's processor/generate call
  signature differs from Whisper-style), this file is the one to revisit
  first.
- `asrProcessor(samples)` and `vadModel({ input: chunk })` are both typed
  loosely (`Processor`'s call signature is `(...args: any[]): any`, and the
  VAD result is hand-cast) — this is inherent to transformers.js's own types,
  not something tighter without the real spike data.
- No `docs/architecture.md` change was made — correctly out of scope for a
  `web/**`-only task with no new subsystem.
- A large batch of already-modified `.superpowers/sdd/*.md` / `.remember/*`
  files from other tasks in this session were present in `git status` before
  I started and were deliberately left unstaged/uncommitted by me (not part
  of this task's scope). `task-7-report.md` itself was found pre-populated
  with stale content from an unrelated earlier task (Phase 6 `appendMessage`/
  `getMessages`) and has been overwritten with this report.
