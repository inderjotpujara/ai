# Task 8 report: `createSttEngine` (main-thread Web Worker host) + mocked-worker tests + canonicalize `ModelTier`

(Note: this file name was previously used by an earlier Slice-30b-Phase-6
Task 8 — `listSessions` SQL keyset cursor pagination. That work is preserved
in git history/merge commits. This report replaces it for the current
Phase-7 Task 8.)

## Status: DONE

## Commit
`a68e784` — `feat(voice): createSttEngine — mocked-worker-tested message protocol host (D1/D4/D7)`

5 files changed: `web/src/features/voice/stt-engine.ts` (new), `web/src/features/voice/stt-engine.test.ts` (new), `web/src/features/voice/model-tier.ts` (new), `web/src/features/voice/stt.worker.ts` (modified), `web/src/features/settings/index.tsx` (modified).

## What was built

`web/src/features/voice/stt-engine.ts` — `createSttEngine(cfg: { model: ModelTier }): SttEngine`. Spawns `stt.worker.ts` as a module Worker, posts `{ kind: 'load', model }` on construction, and exposes:
- `ready()` — resolves only on the worker's `ready` message.
- `onProgress(cb)` — subscribes to `progress` messages, returns an unsubscribe function.
- `detectSpeech(chunk16k)` / `transcribe(frames: VoiceFrames)` — each assigns a numeric `id`, posts the request (transferring the underlying buffer), and resolves/rejects a per-id pending promise when the matching `*Result`/`error` response arrives. Two concurrent calls are matched correctly even if responses arrive out of order.
- `close()` — terminates the worker and clears all pending maps/listeners.

Deliberate design point over the brief's reference implementation: `detectSpeech`/`transcribe` are **not** gated on `ready()` — they post immediately. A request issued before `ready` is never lost; it's simply answered later by whatever the worker sends back for that id (a real result, or a worker-side "not loaded yet" `error`). Added an explicit test for this (`'a detectSpeech()/transcribe() call issued before ready is not lost...'`) exercising both outcomes (one rejects, one resolves) from calls made pre-`ready`.

## `ModelTier` canonicalization (Task 4 Minor resolved)

Per your instruction, overrode the brief's plain-union `ModelTier` with a **string enum**, defined once in a new shared module `web/src/features/voice/model-tier.ts`:
```ts
export enum ModelTier { Base = 'moonshine-base', Tiny = 'moonshine-tiny' }
```
(Chose a dedicated module rather than `stt-engine.ts` itself, to avoid `stt-engine.ts` ↔ `stt.worker.ts` needing to cross-import the enum in both directions.)

- `stt.worker.ts` — removed its local union, now `import { ModelTier } from './model-tier.ts'` and re-exports it (so any existing importer of `ModelTier` from `stt.worker.ts` keeps working). `MODEL_IDS` keys switched to computed `[ModelTier.Base]` / `[ModelTier.Tiny]`.
- `settings/index.tsx` — removed the Task 4 temporary local union + its doc comment, now `import { ModelTier } from '../voice/model-tier.ts'` and `export { ModelTier }`. `isModelTier` compares against `ModelTier.Base`/`ModelTier.Tiny`, `defaultModelTier()` returns `ModelTier.Base`, and the `<select>` options use `value={ModelTier.Base}` / `value={ModelTier.Tiny}`.
- String values are byte-identical to before (`'moonshine-base'` / `'moonshine-tiny'`) — no change to persisted `localStorage`, the `window.__AGENT_VOICE_DEFAULT_MODEL__` global, or the HF model-id map.
- The brief's verbatim test snippet passed raw string literals (`'moonshine-tiny'`) as `cfg.model` — TS string enums are not structurally assignable from bare literals, so the test file was adapted to pass `ModelTier.Tiny`/`ModelTier.Base` instead (the resulting protocol assertions, e.g. `{ kind: 'load', model: 'moonshine-tiny' }`, are unchanged since those just check runtime message values, which are still the plain strings).

## Testing

`stt-engine.test.ts`: 10 tests — load-on-construct, `ready()` gating, progress forwarding + unsubscribe, `detectSpeech`/`transcribe` id-correlation (including out-of-order concurrent resolution), request-scoped error isolation (doesn't reject `ready()`), the added pre-ready not-lost test, and `close()` terminating the worker. All assert against a `vi.stubGlobal('Worker', ...)` fake that records `postMessage` calls and lets the test drive `onmessage` — no real transformers.js/WASM involved (matches Task 7's stated boundary).

Gate run (`cd web && bun run typecheck && bun run test`, plus root `bun run lint`):
- `bun run typecheck` — PASS (0 errors). Fixed two `noUncheckedIndexedAccess` destructuring errors in the test file (added `!` + `biome-ignore`, since array destructuring types as possibly-undefined here).
- `bun run test` (full web suite) — **51 test files / 233 tests passed**, including all 10 new `stt-engine` tests, `stt.worker.test.ts` (unchanged, 4 tests), and `settings/index.test.tsx` (unchanged, 8 tests — still green after the enum swap, confirming the persisted-value contract held).
- `bun run lint` (root, biome over the whole repo) — clean on all 5 touched files. Added `biome-ignore` comments (matching the repo's existing convention, e.g. `chat/actions.test.tsx`) for: the `noConstructorReturn` on the fake-Worker-constructor mocking idiom, and 5 `noNonNullAssertion`s on destructured/found test values whose presence is guaranteed by the preceding assertion/await. Pre-existing unrelated warnings elsewhere in the repo (`tests/server/mcp-list.test.ts`, `tests/server/models-pull.test.ts`) are untouched.
- Pre-commit `docs:check` passed automatically (no `docs/architecture.md` change needed — no new subsystem, `web/**`-only change).

## Concerns / follow-ups for later tasks
- None blocking. `use-voice-input.ts` (Task 10+) is the next consumer of `SttEngine`/`ModelTier`.
- `stt-engine.ts` is not itself covered by Part B's live-verify yet (that's Task 17/18, same boundary Task 7 documented) — this task's tests only prove the protocol/plumbing against a mock, per the brief's explicit scope.

## Review fix (2026-07-18): dangling-promise leak on `close()`

**Critical finding from review:** `close()` terminated the worker and cleared
`pendingDetect`/`pendingTranscribe`, but never *rejected* the promises those
maps held, and never rejected `readyPromise` if `close()` landed before the
worker's `ready`/`error` arrived. Any in-flight `detectSpeech()`,
`transcribe()`, or `ready()` caller would hang forever.

**Fix** (`web/src/features/voice/stt-engine.ts`):
- Added a `closed` boolean and a `readySettled` boolean (tracks whether
  `readyPromise` has already resolved/rejected via the worker's `ready`/`error`
  message).
- `close()` now: rejects every entry still in `pendingDetect`/`pendingTranscribe`
  with `new Error('stt-engine closed')` before clearing the maps; rejects
  `readyPromise` via the stored `readyReject` only if `readySettled` is still
  `false` (no-op guard — avoids acting on an already-settled promise); then
  terminates the worker and clears `progressListeners` as before. `closed` is
  idempotent-guarded so a second `close()` call is a no-op.
- `ready()`, `detectSpeech()`, `transcribe()` now check `closed` first and
  return an already-rejected `Promise.reject(new Error('stt-engine closed'))`
  instead of posting to (or awaiting) a terminated worker.
- Added `readyPromise.catch(() => {})` right after creation, so that if a
  caller never calls `ready()` at all (common — many callers only use
  `detectSpeech`/`transcribe`) and `close()` later rejects it, Node/Vitest
  doesn't surface an "unhandled rejection" warning. This passive catch doesn't
  consume the rejection for real callers — `ready()` still returns the same
  `readyPromise` reference, and any `.then`/`.catch`/`await` on it by an actual
  caller still observes the rejection normally.

**Correction to this report's earlier claim:** the paragraph above titled
"Deliberate design point over the brief" — stating that not gating
`detectSpeech`/`transcribe` on `ready()` was a design choice "over the brief" —
is **inaccurate**. The brief's own reference implementation also posts
`detectSpeech`/`transcribe` without gating on `ready()` first; this was not an
enhancement beyond the brief, just a faithful implementation of it. No code
change needed for this correction — noted here per review instruction.

**Test added** (`web/src/features/voice/stt-engine.test.ts`):
- `'close() rejects outstanding detectSpeech/transcribe/ready promises instead
  of hanging them forever'` — starts `ready()`, `detectSpeech()`, and
  `transcribe()` with the fake worker never responding, calls `close()`, and
  asserts all three reject with `/closed/` (previously these would hang
  forever — this is the regression the fix targets).
- `'calls made after close() reject fast instead of posting to the terminated
  worker'` — calls `close()` first, then asserts `ready()`/`detectSpeech()`/
  `transcribe()` all reject immediately with `/closed/` and that no new
  messages are posted to the (terminated) fake worker.
- Kept the existing `'close() terminates the worker'` test unchanged.

### Gate run
`cd web && bun run typecheck && bun run test`:
- `bun run typecheck` — PASS (0 errors).
- `bun run test` — **51 test files / 235 tests passed** (was 233; +2 new
  `stt-engine` tests). `stt-engine.test.ts` alone: 12/12 passed
  (`bunx vitest run src/features/voice/stt-engine.test.ts`).
- Root `bun run lint:file -- "web/src/features/voice/stt-engine.ts"
  "web/src/features/voice/stt-engine.test.ts"` — clean, no findings (one
  formatting fix applied by hand to match biome's preferred wrap of a
  multi-line `expect(...).rejects.toThrow(...)` before it passed clean).
- `bun run docs:check` — passed (no new subsystem; `web/**`-only change).

Commit: `fix(voice): reject pending stt-engine promises on close() to prevent
hangs [review fix]`.

Report file: `/Users/inderjotsingh/ai/.superpowers/sdd/task-8-report.md`
