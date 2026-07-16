# Task 15 Report — Pull→spans bridge (`withModelPullSpan` + `recordPullProgressTick` + `runModelPullBridge`)

**Status:** DONE
**Commit:** `eb6ac30` — `feat(provisioning): pull→spans bridge — withModelPullSpan + recordPullProgressTick + runModelPullBridge (Phase 5, §7.2)`
**Increment:** 3 (Models/pull). Spec §7.2 (the hard part). Fork-1 locked: model pull rides the EXISTING runs/spans machinery — NO new SSE stream.

## What I implemented

Three pure/unit-testable pieces, exactly per the brief's verbatim code:

1. **`src/telemetry/spans.ts`** — appended 8 `ATTR` keys (`MODEL_PULL_RUNTIME`, `MODEL_PULL_MODEL_REF`, `MODEL_PULL_OUTCOME`, `MODEL_PULL_PHASE`, `MODEL_PULL_PERCENT`, `MODEL_PULL_BYTES_COMPLETED`, `MODEL_PULL_BYTES_TOTAL`, `MODEL_PULL_SPEED_BPS`) and two helpers:
   - `withModelPullSpan(info, fn)` — opens a `model.pull` root span via the shared `inSpan` primitive; sets runtime + modelRef attrs; passes the body an `outcome(o)` recorder that writes `MODEL_PULL_OUTCOME`.
   - `recordPullProgressTick(p)` — opens one short-lived `model.pull.progress` child span via `inSpan`, sets phase/bytesCompleted always, and percent/bytesTotal/speed only when non-null. Opens+closes synchronously within the call.
2. **`src/provisioning/pull-bridge.ts`** (new) — `runModelPullBridge(input, deps)` drives `provider.download(...)` under `withModelPullSpan`: emits ONE synthetic `Resolving` "started" tick first (the "+1" in "N onProgress → N+2 spans"), fires a tick per real `onProgress` (sync callback → `void`-pushed into a `pending[]`, never awaited inline so a backed-up exporter never stalls the download), then `await Promise.all(pending)` before `rec.outcome('done')`. On throw: drains `pending`, sets `rec.outcome('failed')`, rethrows so `inSpan`'s catch marks the root ERROR.

## TDD evidence

- **RED (span helpers):** `bun test tests/telemetry/model-pull-span.test.ts` → `SyntaxError: Export named 'withModelPullSpan' not found`.
- **GREEN (span helpers):** after appending helpers → 2 pass / 5 expect calls.
- **RED (bridge):** `bun test tests/provisioning/pull-bridge.test.ts` → `Cannot find module '.../pull-bridge.ts'`.
- **GREEN (both):** `bun test tests/telemetry/model-pull-span.test.ts tests/provisioning/pull-bridge.test.ts` → 5 pass / 10 expect calls.
- **Regression:** `tests/telemetry tests/provisioning tests/run` → 229 pass / 0 fail (spans.ts change is purely additive).

## Exact span-attribute shape for a progress tick

A `model.pull.progress` child span carries (nulls omitted):
```
model.pull.progress.phase                  : string   (e.g. "downloading", "resolving")
model.pull.progress.percent                : number   (only when percent !== null)
model.pull.progress.bytes_completed        : number   (always)
model.pull.progress.bytes_total            : number   (only when bytesTotal !== null)
model.pull.progress.speed_bytes_per_sec    : number   (only when speedBytesPerSec !== null)
```
The `model.pull` root carries `model.pull.runtime`, `model.pull.model_ref`, and (at close) `model.pull.outcome` = `done` | `failed`. These surface unchanged through `SpanDtoSchema.attributes` over the existing `/api/runs/:id/stream` — **zero net-new wire events**.

## Pull span opens/closes EXACTLY ONCE (success / failure / abort)

`withModelPullSpan` delegates to the single `inSpan('model.pull', ...)` primitive, whose body is `try { return await fn(span) } catch { setStatus(ERROR); throw } finally { span.end() }`. `span.end()` runs exactly once in the `finally` for every exit path:
- **Success:** `fn` resolves → `finally` ends the root once (status default OK, outcome=`done`).
- **Failure (provider rejects):** the bridge rethrows → `inSpan`'s catch sets `SpanStatusCode.ERROR` → `finally` ends once (outcome=`failed`).
- **Abort:** the `AbortSignal` propagates through `provider.download` as a rejection → same catch/finally path → single end, ERROR status.

Progress ticks are independently short-lived: each `recordPullProgressTick` is its own `inSpan` instance with its own `finally { span.end() }`, so rapid/concurrent `onProgress` callbacks never leave a tick dangling (each call ends ITS OWN span). The bridge additionally `await Promise.all(pending)` before the root's body returns on BOTH paths, so no tick span outlives the root's close.

## RunKind.Pull resolution (re-verified, not just trusted — review req (c))

`src/run/run-dto.ts` (committed Task 2): `RUN_ROOT_NAMES` includes `'model.pull'` (line 37) and `deriveRunKind` returns `RunKind.Pull` for it (line 51). Both `mapRunToDto` (detail) and `summarizeRunListItem` (list) call the same `runRootSummary`/`deriveRunKind`, so they cannot drift. Consequence proven by test: once the `model.pull` root closes, `runRootSummary` recognizes it and `lifecycle` flips `Running`→`Done` (success) / `Failed` (reject) — verified by `mapRunToDto` asserting `spanCount === N+2`, tick count `=== N+1`, and `lifecycle === Done`/`Failed`.

## NO new stream/transport code (confirmed)

`pull-bridge.ts` imports only `../core/types.ts` (enums), `../telemetry/spans.ts` (the two helpers), and `./types.ts` (DownloadProvider/DownloadPhase). No SSE, no `ReadableStream`, no route, no transport, no new event type. The pull rides `spans.jsonl` + the existing `/api/runs/:id/stream` exactly as designed (fork 1).

## Files changed

- `src/telemetry/spans.ts` (append-only: 8 ATTR keys + 2 helpers)
- `src/provisioning/pull-bridge.ts` (new)
- `tests/telemetry/model-pull-span.test.ts` (new)
- `tests/provisioning/pull-bridge.test.ts` (new)

## Self-review

- Root ends exactly once on all three exit paths (see above). ✓
- Ticks short-lived, no dangling under rapid callbacks; drained before root close. ✓
- Progress attrs well-formed; nullable fields conditionally set (no `null` written as an attribute value). ✓
- Root outcome/status correct on resolve (`done`/OK) AND reject (`failed`/ERROR). ✓
- RunKind.Pull + lifecycle flip verified via `mapRunToDto`. ✓
- No new stream/transport code. ✓
- Per-task gate all green: `bun run typecheck` clean, `bun run lint:file` 0 errors (biome auto-format applied to import sorting + string-quote normalization; removed one unused `runId` in the intentionally-light middle test — brief explicitly permits trimming it), focused tests pass.

## Concerns / follow-ups

- **Cross-task (Task 17, review req (d)):** a client opening `/api/runs/:id/stream` BEFORE the first tick span is written relies on the existing "no spans yet → poll again" degrade path. That path is unchanged and needs no new code, but it is only exercisable once Task 17 wires the live pull route — flagged as a cross-task verification item (same split as Task 11/12).
- The intentionally-light middle bridge test asserts nothing (only proves the bridge doesn't crash/hang un-scoped); it is fully subsumed by the third scoped test. Kept for the no-crash signal; safe to delete if a reviewer prefers.

## Follow-up fix (post-review)

**Finding (Important — test hygiene):** the middle test in `tests/provisioning/pull-bridge.test.ts` (`'a rejecting provider marks the root Failed (mapRunToDto agrees)'`) was a no-op masquerading as failure-path coverage — zero `expect()` calls, `runModelPullBridge` invoked outside any `withRunTelemetry` scope (so no `spans.jsonl` was ever written and `mapRunToDto` was never called), and the rejection swallowed via `.catch(() => {})`.

**Verification before fixing:** confirmed the no-op met all three criteria in the finding, and confirmed the failure/rejection path IS genuinely asserted elsewhere in the same file — the third test, `'a rejecting provider marks the root Failed, scoped under withRunTelemetry (mapRunToDto agrees)'`, runs the same rejecting-provider bridge call inside a real `withRunTelemetry` scope and asserts `expect(dto?.lifecycle).toBe(RunLifecycle.Failed)`. Since real coverage already existed, the fix was a straight **delete**, not a replace.

**Fix:** removed the no-op test entirely; no other code changed.

**Gate (all before commit):**
- `bun run typecheck` — clean (no output, `tsc --noEmit` exits 0).
- `bun run lint:file -- tests/provisioning/pull-bridge.test.ts` — `Checked 1 file in 4ms. No fixes applied.` (0 errors).
- `bun test tests/provisioning/pull-bridge.test.ts` — `2 pass, 0 fail, 5 expect() calls`. The remaining scoped test still asserts the Failed lifecycle for real.

**Fix commit:** amended onto Task 15's implementation (new follow-up commit on top of `eb6ac30`) — see `test(provisioning): remove no-op pull-bridge test (asserts nothing); failure path covered by scoped test (Phase 5 T15 review)`.
