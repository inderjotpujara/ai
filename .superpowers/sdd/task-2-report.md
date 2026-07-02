# Task 2 Report: Ollama download adapter (NDJSON stream) + supervisor guards (Slice 14)

## What was built

Three new source files (verbatim from the brief, with biome auto-format/import-order applied, no logic changes):

1. **`src/provisioning/ollama-pull.ts`**
   - `parseOllamaLine(line: string)` — parses one NDJSON line from Ollama's `/api/pull` stream. Detects a layer-download event by the **presence** of `digest`+`total`+`completed` fields (not the status verb, which varies across Ollama versions), per the task's core design directive. Falls back to verb-matching for `success` → Done, `verifying*` → Verifying, `writing*`/`removing*` → Finalizing, else Resolving. Blank/unparsable lines → `null`.
   - `OllamaPullAggregator` — stateful class wrapping a `ProgressTracker`. `feed(line)` parses the line, and for Downloading events **replaces** (not sums) the per-digest `{completed,total}` in an internal `Map<digest, {...}>`, then sums across all digests to get aggregate `bytesCompleted`/`bytesTotal`, feeding that into the tracker's `update()`.

2. **`src/provisioning/supervisor.ts`**
   - `checkDiskSpace({requiredBytes, freeBytes, headroomBytes?})` — disk preflight (Ollama doesn't do this itself and fails mid-download without it). `headroomBytes` defaults to `DEFAULT_HEADROOM = 2 GiB`.
   - `withRetry(fn, {attempts, baseMs, capMs, jitter, onRetry?})` — full-jitter exponential backoff retry; rethrows the last error after exhausting attempts; calls `onRetry(n)` before each retry sleep.
   - `StallWatchdog` — `constructor(timeoutMs, onStall, now?)`; `beat(bytes)` resets the stall clock on forward progress; `tick()` fires `onStall` once stalled past `timeoutMs`; `start(intervalMs)`/`stop()` wrap a `setInterval` driving `tick()`.

3. **`src/provisioning/providers/ollama.ts`**
   - `createOllamaProvider(opts?: {baseUrl?})` → `DownloadProvider` with `kind: ProviderKind.Ollama`.
   - `streamPull()` (internal) — `POST {baseUrl}/api/pull {model, stream:true}`, reads the NDJSON body via `ReadableStream` reader + `TextDecoder`, buffers partial lines across chunks, feeds each complete line to an `OllamaPullAggregator`, drives a `StallWatchdog` (`STALL_MS = 90_000`, longer than Ollama's own internal 30s per-part watchdog) via `.beat(bytesCompleted)`, and calls `onProgress` per event. Returns on `DownloadPhase.Done`.
   - The public `download()` wraps `streamPull` in `withRetry` (`attempts:6, baseMs:1_000, capMs:45_000`, jittered `0.5 + Math.random()/2`), emitting a synthetic `Resolving` progress event with `error: "retry N"` on each retry.
   - After the retry loop returns, calls `isModelInstalled(modelRef, baseUrl)` (existing `resource/ollama-control.ts` helper) as an install-confirm — throws `ProviderError` if Ollama reported success but the model isn't actually listed. This is the "consent/degrade never crash" contract's verification leg for this adapter.

Two test files, matching the brief's exact assertions:
- `tests/provisioning/ollama-pull.test.ts`
- `tests/provisioning/supervisor.test.ts`

## TDD evidence (RED → GREEN)

**ollama-pull.test.ts**
- RED (Step 2): `bun test tests/provisioning/ollama-pull.test.ts` → `error: Cannot find module '../../src/provisioning/ollama-pull.ts'`, 0 pass / 1 fail.
- GREEN (Step 4): after creating `src/provisioning/ollama-pull.ts` → `6 pass, 0 fail, 9 expect() calls`.

**supervisor.test.ts**
- RED (Step 6 pre-check): `bun test tests/provisioning/supervisor.test.ts` → `error: Cannot find module '../../src/provisioning/supervisor.ts'`, 0 pass / 1 fail.
- GREEN (Step 7): after creating `src/provisioning/supervisor.ts` → `4 pass, 0 fail, 7 expect() calls`.

**Full provisioning suite (Step 9):**
```
bun run typecheck            → clean (tsc --noEmit, no output/errors)
bun run lint:file -- src/provisioning/**/*.ts  → Checked 8 files, no errors (after biome --write auto-fixed import order + line-wrap formatting on the 3 new files; no logic changed)
bun test tests/provisioning/ → 24 pass, 0 fail, 35 expect() calls, across 5 files
```
`grep -rn "console\." src/provisioning/{ollama-pull,supervisor,providers/ollama}.ts` → no matches. No new npm dependency added (raw `fetch`, `node:*`/stream APIs only).

## LIVE-VERIFY (Step 10) — observed output

Environment: Ollama reachable at `http://localhost:11434` (`{"version":"0.30.8"}`), `OLLAMA_MODELS=./model-images`. `qwen3-embedding:0.6b` was already present from prior slice work (639 MB).

**Run 1 (already-installed model — exercises the fast confirm path):**
Ran the brief's exact script. Output:
```
qwen3-embedding:0.6b    ?%  0 B  —  ETA —  [resolving]
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  484.9 MB/s  ETA 0s  [downloading]
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  484.9 MB/s  ETA 0s  [downloading]
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  484.9 MB/s  ETA 0s  [verifying]
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  484.9 MB/s  ETA 0s  [finalizing]
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  484.9 MB/s  ETA 0s  [done]
undefined  NaN%  NaN undefined/NaN undefined  NaN undefined/s  ETA NaNh NaNm  [undefined]

DONE
```
Bar reached 100%/`[done]`; `console.error('\nDONE')` printed. (The trailing `undefined NaN%` line comes from the brief's own verify-script line `bar.done(p as any)` passing the **provider object**, not a `DownloadProgress`, into `.done()` — a bug in the throwaway verify script, not the adapter; the adapter's real progress stream is correct as shown by every preceding line.)

`ollama list` confirmed:
```
qwen3-embedding:0.6b        ac6da0dfba84    639 MB    6 seconds ago
```

**Delete + re-provision (genuine fresh download, confirms idempotency and a real network pull):**
```
$ ollama rm qwen3-embedding:0.6b
deleted 'qwen3-embedding:0.6b'
```
`ollama list | grep qwen3-embedding` → no match (confirmed absent).

Re-ran the identical script. This time it was a genuine cold pull: progress climbed live from `[resolving]` → `0%..100% [downloading]` (hundreds of incremental lines, 30–40+ MB/s observed) → `[verifying]` → `[finalizing]` → `100% [done]`, followed by `DONE`. Excerpt:
```
qwen3-embedding:0.6b    ?%  0 B  —  ETA —  [resolving]           (×12, manifest phase)
qwen3-embedding:0.6b    0%  33.7 KB/609.5 MB  174.2 KB/s  ETA 59m 43s  [downloading]
...
qwen3-embedding:0.6b   99%  608.7 MB/609.5 MB  36.4 MB/s  ETA 0s  [downloading]
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  29.7 MB/s  ETA 0s  [downloading]
...
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  509 B/s  ETA 0s  [verifying]
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  357 B/s  ETA 0s  [finalizing]
qwen3-embedding:0.6b  100%  609.5 MB/609.5 MB  357 B/s  ETA 0s  [done]
undefined  NaN%  NaN undefined/NaN undefined  NaN undefined/s  ETA NaNh NaNm  [undefined]

DONE
```
`ollama list | grep qwen3-embedding` confirmed re-installed:
```
qwen3-embedding:0.6b        ac6da0dfba84    639 MB    6 seconds ago
```

**Result: LIVE-VERIFY PASSED.** Bar reaches 100%/`[done]` on both a cached-model confirm and a genuine fresh download; `ollama list` confirms the install both times; delete → re-provision round-trips correctly (idempotency + real network pull both proven). Digest-mismatch recovery (rm partial blob + re-pull) was not separately forced — Ollama's own pull never surfaced a digest mismatch in this run, so that specific recovery branch remains covered only by the retry-loop's generic exception handling, as the brief anticipated ("exercised in the live-verify step" refers to normal retry, not a deliberately corrupted blob).

## Files changed

- `src/provisioning/ollama-pull.ts` (new)
- `src/provisioning/supervisor.ts` (new)
- `src/provisioning/providers/ollama.ts` (new)
- `tests/provisioning/ollama-pull.test.ts` (new)
- `tests/provisioning/supervisor.test.ts` (new)

Commit: `d83e7c8` — "feat(provisioning): Ollama download adapter + supervisor guards, live-verified (Slice 14 Task 2)" on branch `slice-14-provisioning`.

## Self-review

- **TDD evidence**: Each test file was run and confirmed RED (module-not-found) before its implementation file existed, then confirmed GREEN immediately after — both the standalone runs and the aggregate `tests/provisioning/` run (24/24) are clean.
- **Pristine output**: `bun run typecheck` silent/clean; `bun run lint:file` clean after a `biome --write` auto-fix pass (import ordering + line-wrap only, no behavioral change — verified by re-running tests after the fix, still 24/24 green); no `console.log`/`console.*` in the three new `src/` files; no new npm dependency (only `fetch`, `AbortController`, `TextDecoder`, `setInterval` — all built-ins).
- **Interfaces match Task 1 exactly**: confirmed `DownloadPhase`, `DownloadProgress`, `DownloadProvider` (`src/provisioning/types.ts`) and `ProgressTracker` (`src/provisioning/progress-tracker.ts`) signatures against the brief's assumptions before writing code — no mismatch.
- **Degrade-never-crash / consent-before-pull contracts**: the adapter never calls `/api/pull` speculatively — `download()` is only invoked by a caller that has already decided to pull (consent is the caller's job per the project's standing contract; this task only builds the mechanism). On failure, `withRetry` retries with backoff rather than crashing immediately, and only throws after exhausting `attempts`; the install-confirm (`isModelInstalled`) converts a false-positive "success" status into an explicit `ProviderError` rather than silently reporting done.
- **StallWatchdog constructor order**: the brief's own **interface list** at the top says `constructor(timeoutMs, now?, onStall)`, but the brief's **Step 6 code block** (the authoritative implementation given verbatim) declares `constructor(timeoutMs, onStall, now?)`, and Step 8's call site `new StallWatchdog(STALL_MS, () => ctrl.abort())` is consistent with the code-block order (works either way here since `now` is omitted, but only the code-block order type-checks for a hypothetical 3-arg call). I implemented the Step 6 code verbatim, which took precedence as directed by the task ("read your task brief FIRST — it is your requirements, with the exact code... use its exact code verbatim"). No test in the brief exercises 3-arg `StallWatchdog` construction, so this discrepancy is latent, not currently exposed by any test — flagged here for visibility.
- **No docs update performed**: `src/provisioning/` was already documented in `docs/architecture.md` as an "in progress" subsystem by Task 1, and the pre-commit `docs:check` hook passed without requiring an edit (adding files to an already-documented subsystem didn't trip the "undocumented subsystem" check). Per the project's hard-line doc rule, a full architecture.md/README/ROADMAP/Artifact refresh is expected at **slice close** (when Slice 14 is fully done), not necessarily after every intermediate task — consistent with how Task 1 also deferred full doc closure. Flagging so slice-close explicitly covers Task 2's additions (NDJSON parsing, aggregator, supervisor guards, Ollama adapter) in the narrative, not just the file tree.

## Concerns

1. **Cosmetic bug in the brief's own live-verify script**, not the adapter: `bar.done(p as any)` passes the `DownloadProvider` object (not the last `DownloadProgress`) to `ProgressBar.done()`, producing a garbage `undefined NaN%` render line at the very end of both live runs. The adapter's real progress events (every line before that) are correct. No source change was made to "fix" this since it's disposable verify-script code specified by the brief, not a deliverable file — noting it so it isn't mistaken for an adapter defect.
2. **StallWatchdog constructor-order discrepancy** between the brief's interface summary and its Step 6 code (detailed above) — implemented per the code block; no functional impact under current tests/call sites, but worth a one-line brief correction if this file is revisited.
3. Digest-mismatch recovery (delete partial blob + re-pull) was not independently forced/observed in live-verify; the retry loop's generic exception handling is the only mechanism currently exercising that path, per the brief's own scoping note.

## Task 2 review-fix

Three review fixes applied to the Task 2 deliverables, TDD throughout (RED confirmed before each implementation). Branch `slice-14-provisioning`, prior HEAD `d83e7c8`.

### Fix 1 (Important) — surface Ollama in-band errors instead of mis-classifying them as progress

**Problem:** Ollama's `/api/pull` stream can emit an in-band failure line like `{"error":"digest mismatch, file must be downloaded again"}`. `parseOllamaLine` had no `error` branch, so such a line fell through to the catch-all `return { phase: DownloadPhase.Resolving }` — silently swallowing the failure and letting the pull loop appear to make progress.

**Fix:**
- `src/provisioning/ollama-pull.ts`: added `error?: string` to the internal `OllamaEvent` type and to `ParsedLine`. `parseOllamaLine` now checks `ev.error` (non-empty string) BEFORE the download-detection and status branches, returning `{ phase: DownloadPhase.Failed, error: ev.error }`.
- `OllamaPullAggregator.feed`: computes the tracker update as before (so byte totals stay consistent), then if `parsed.phase === DownloadPhase.Failed`, returns `{ ...update, phase: DownloadPhase.Failed, error: parsed.error }` instead of the tracker's own phase.
- `src/provisioning/providers/ollama.ts` `streamPull`: when an emitted progress event has `phase === DownloadPhase.Failed`, throws `new ProviderError(p.error ?? 'Ollama pull failed')`. This throw is inside the existing `try` block (before the `finally`), so `watchdog.stop()` and `outer.removeEventListener('abort', onAbort)` still run. The `withRetry` loop in `download()` now treats a digest-mismatch (or any other in-band error) as a failed attempt, triggering backoff + re-pull rather than silently absorbing it.

**Tests added** (`tests/provisioning/ollama-pull.test.ts`):
- `parseOllamaLine > maps an in-band {"error":...} line to Failed with the error message` — asserts phase `Failed` and the exact error string.
- `OllamaPullAggregator > surfaces an in-band error line as a Failed progress event carrying the error` — feeds a digest event then an error line, asserts the returned progress is `Failed` with the error message.

RED: both new assertions failed with `Received: "resolving"` against the pre-fix code (confirmed by running `bun test tests/provisioning/ollama-pull.test.ts` before editing `ollama-pull.ts`). GREEN after the fix: `8 pass, 0 fail`.

### Fix 2 (Important) — test the StallWatchdog

Added a `describe('StallWatchdog', ...)` block to `tests/provisioning/supervisor.test.ts` using an injected `now` and manual `tick()` — no real timers. Confirmed the shipped constructor order by reading `supervisor.ts` first: `constructor(timeoutMs, onStall, now?)` (matches Task 2's Step 6 code, per the constructor-order note already on record in this report).

Tests:
- `fires onStall when no byte progress is made past timeoutMs` — `beat(100)` to set a baseline, `beat(100)` again with no advance (starts the stall clock), then advances `now` past `timeoutMs` and calls `tick()`; asserts a counter incremented via `onStall`.
- `does not fire when a beat with larger bytes resets the stall before timeout` — `beat(100)`, then `beat(100)` (stall starts) is followed by `beat(200)` (byte increase resets `stalledSince`) before `now` crosses `timeoutMs`; `tick()` at 900ms-since-reset does not fire.
- `stop() is safe to call even if start() was never called` — asserts no throw.

No source change was required for this fix — `StallWatchdog`'s existing implementation already behaves correctly; this fix closes a test coverage gap. GREEN immediately: all 3 new cases pass alongside the pre-existing `checkDiskSpace`/`withRetry` tests.

### Fix 3 (Minor) — abort during backoff sleep

**Problem:** `withRetry`'s backoff `await new Promise((r) => setTimeout(r, delay))` could not be interrupted by a caller abort — a caller-level abort during a multi-second backoff would sit unobserved until the sleep naturally elapsed.

**Fix (`src/provisioning/supervisor.ts`):**
- Added a private `abortableSleep(ms, signal?)` helper: with no signal, behaves exactly as before (`setTimeout` only). With a signal, resolves immediately if already aborted, otherwise races a `setTimeout` against the signal's `abort` event (whichever fires first resolves the promise; the other is cleaned up — `clearTimeout` / `removeEventListener`).
- `withRetry`'s opts gained an optional `signal?: AbortSignal`. The retry loop now (a) checks `attempt > 0 && opts.signal?.aborted` at the top of each iteration after the first — stopping further attempts without cutting off the initial in-flight attempt; (b) checks `opts.signal?.aborted` before starting a backoff sleep, breaking out instead of scheduling a sleep that would just be raced anyway; (c) calls `abortableSleep(delay, opts.signal)` instead of the raw `setTimeout` promise.
- If `signal` is absent, behavior is byte-for-byte unchanged (same raw-`setTimeout` path).
- Wired the outer signal through in `src/provisioning/providers/ollama.ts`: `createOllamaProvider`'s `withRetry` call now passes `signal` (the caller's `AbortSignal` from `download(modelRef, { onProgress, signal })`) into the opts object.

I implemented the full abort-race version (not just the simpler "check at top of loop" fallback) — it wasn't fiddly, so no shortcut was needed.

**Test added** (`tests/provisioning/supervisor.test.ts`):
- `withRetry > resolves the backoff delay promptly when the signal is already aborted` — constructs an already-aborted `AbortController`, calls `withRetry` with `baseMs: 5_000, capMs: 5_000, jitter: () => 1` (i.e. a full 5s backoff would occur without the fix) and `signal: ctrl.signal`. Asserts the call rejects, that `calls === 1` (the function ran once — the first attempt is not skipped by an already-aborted signal, only the retry is — and was not retried), and that the whole test completes in well under 1 second (`elapsed < 1_000`).

RED: pre-fix, this test **timed out** (bun's default 5000ms test timeout was exceeded — actual pre-fix run took >10s wall-clock across the 2 real backoff sleeps) because `withRetry` had no `signal` handling at all and just slept out real 5-second backoffs 2 more times after the first failure. Confirmed by running `bun test tests/provisioning/supervisor.test.ts` before editing `supervisor.ts`: `(fail) ... this test timed out after 5000ms`, with `calls` reaching 3 instead of 1. GREEN after the fix: total suite run dropped to ~10ms, `calls === 1`, `elapsed < 1ms`.

### Commands run (test evidence)

```
$ bun test tests/provisioning/ollama-pull.test.ts tests/provisioning/supervisor.test.ts
bun test v1.3.11 (af24e281)
 16 pass
 0 fail
 26 expect() calls
Ran 16 tests across 2 files. [13.00ms]

$ bun test tests/provisioning/
bun test v1.3.11 (af24e281)
 30 pass
 0 fail
 45 expect() calls
Ran 30 tests across 5 files. [19.00ms]

$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file -- src/provisioning/ollama-pull.ts src/provisioning/progress-tracker.ts src/provisioning/supervisor.ts src/provisioning/types.ts src/provisioning/providers/ollama.ts
$ biome check src/provisioning/ollama-pull.ts src/provisioning/progress-tracker.ts src/provisioning/supervisor.ts src/provisioning/types.ts src/provisioning/providers/ollama.ts
Checked 5 files in 2ms. No fixes applied.
```

(Note: `bun run lint:file -- "src/provisioning/**/*.ts"` — the glob form suggested in the fix instructions — fails with a biome internal error because the shell doesn't expand the quoted glob and biome doesn't glob-expand it itself; individual file paths were passed instead, matching how `lint:file` is invoked elsewhere in this report.)

### Files changed (review-fix)

- `src/provisioning/ollama-pull.ts` — Fix 1 (error branch + aggregator Failed passthrough)
- `src/provisioning/providers/ollama.ts` — Fix 1 (throw on Failed phase) + Fix 3 (wire `signal` into `withRetry` opts)
- `src/provisioning/supervisor.ts` — Fix 3 (`abortableSleep` helper + `signal` opt + loop guards)
- `tests/provisioning/ollama-pull.test.ts` — Fix 1 tests
- `tests/provisioning/supervisor.test.ts` — Fix 2 (StallWatchdog `describe` block) + Fix 3 test

No new npm dependencies. No `console.*` added (`grep -rn "console\." src/provisioning/*.ts src/provisioning/providers/*.ts` — no matches). No unrelated behavior changed — `signal` is optional everywhere and the no-signal path is untouched.

### Concerns

1. None blocking. The abort-race implementation (Fix 3) is a small, self-contained helper; it was not necessary to fall back to the simpler "check `signal?.aborted` at the top of each loop iteration only" variant mentioned as an acceptable minimal alternative in the task brief — the full race was straightforward given `AbortSignal`'s native `addEventListener('abort', ...)`.
2. The `attempt > 0` guard in `withRetry`'s abort check means an already-aborted signal does not prevent the very first attempt from running (only suppresses subsequent retries/backoffs). This matches the task's own phrasing ("assert the fn isn't retried after abort") — retried, not run at all — and is covered by the new test asserting `calls === 1`.
