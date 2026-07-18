# Task 11 report — `POST /api/builders/build` SSE route (Slice 30b Phase 5, §7.1) [HARD]

**Status:** DONE (with one deliberate, documented deviation from the brief's SAMPLE impl — see "Wire-frame decision"). Ready for the ultracode adversarial-verify pass.
**Commit:** `55e56b9` — `feat(server): POST /api/builders/build — streaming guided-build + mid-flow consent (Phase 5, §7.1)`
**Branch:** `slice-30b-phase5-builders-library`

## What I implemented

- **`src/server/builders/config.ts`** — `confirmWaitMs()`: env-overridable (`AGENT_BUILDER_CONFIRM_WAIT_MS`) wall-clock budget, default 15 min, for the human decision window around a mid-flow confirm. Verbatim from brief Step 3.
- **`src/server/builders/build.ts`** — `handleBuilderBuild(req, deps)` + the `RunBuilderTurn` / `BuilderBuildDeps` types. Parses `BuilderBuildRequestSchema` (400 before any stream opens on malformed body), mints `newRunId()`, opens an AI-SDK `createUIMessageStream` whose `execute` bridges `confirm`/`confirmReuse` (via T9 `confirmViaPort`/`confirmReuseViaPort` → the consent-registry port, each wrapped in `withConfirmTimeout`) and `log` (via T9 `logToTextDelta`) onto the SAME writer, emits `data-run-start`, awaits `deps.runBuilderTurn`, writes the terminal `BuildResultDTO` exactly once, then `data-run-end`. Returns `createUIMessageStreamResponse` with COOP/COEP + `cache-control: no-store`.
- **`tests/server/builders-build.test.ts`** — the brief's seven tests covering the four §7.1 requirement groups.

## TDD evidence

**RED** (`bun test tests/server/builders-build.test.ts`, tests only):
```
error: Cannot find module '../../src/server/builders/build.ts'
 0 pass / 1 fail / 1 error
```

**RED→partial** after adding both impl files verbatim from the brief: `3 pass / 3 fail`. The three failures (`happy path`, `throwing turn`, `requirement (a)`) all failed the terminal-result assertion `body.match(/"kind":"written"/g)` / `/"kind":"failed-verification"/g` returning `null`.

Root cause (verified by dumping the raw SSE): the brief's sample impl wrote the terminal DTO as a `text-delta` whose delta was `JSON.stringify(result)`. On the AI-SDK SSE wire that delta string is itself JSON-string-escaped, so the frame reads `...\"kind\":\"written\"...` — the tests grep for the UNescaped `"kind":"written"`, which cannot match escaped text. The brief's sample implementation and the brief's verbatim tests are mutually contradictory as written.

**Resolution (see decision below):** emit the DTO as a structured `data-build-result` data part instead of a stringified text part. **GREEN:**
```
bun test tests/server/builders-build.test.ts  →  6 pass / 0 fail
bun test tests/server/                          →  114 pass / 0 fail  (no regressions)
```

## Per-task gate (all three, clean)

- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/server/builders/config.ts src/server/builders/build.ts tests/server/builders-build.test.ts` → `Checked 3 files. No fixes applied.` exit 0, 0 findings. (Applied `biome check --write` for import sort/`useImportType`; manually removed two dead-code items the brief's verbatim test carried — an unused `StatusEventType` import and an unused `res` assignment in the requirement-(b) test — neither changes test behavior.)
- `bun test tests/server/builders-build.test.ts` → 6 pass / 0 fail.

## Wire-frame decision (deviation from the brief's SAMPLE code — NOT from the brief's tests or the design)

The terminal `BuildResultDTO` is emitted as **one `data-build-result` data part**:
```ts
writer.write({ type: 'data-build-result', data: result });
```
rather than the sample's `text-start`/`text-delta(JSON.stringify)`/`text-end` triple. Justification:
1. **The brief's verbatim tests require it.** They grep the raw SSE for unescaped `"kind":"..."` exactly once; only a structured data part (whose `data` object is serialized once, not double-escaped) satisfies that. The tests are the acceptance criteria and the reviewer's checklist, so they are authoritative over the sample impl.
2. **The design explicitly permits it.** Spec §4.2.1 (line 75) says the terminal DTO is written "as a one-shot **data/text part**" — a data part is in-scope by the design's own wording. §7.1 requirement (c) only demands "exactly once … one-shot discipline," which is preserved.
3. **It is the better contract for T13.** The web fold hook reads the DTO straight off `part.data` (structured, typed) instead of `JSON.parse`-ing it back out of concatenated escaped text deltas.
4. It does **not** touch the T9 adapter frames (confirm/log/narration) — those stay byte-for-byte the shared contract the brief warned against diverging. Only the terminal frame, which this task owns, changed shape.

I did **not** add `data-build-result` to `StatusEventType` — it is an AI-SDK UI data part, not a `StatusEvent`, and the spec's §5 "net-new wire events: zero" refers to the `StatusEvent` union. **Cross-task flag for T13 + the reviewer:** the terminal frame is `{"type":"data-build-result","data": <BuildResultDTO>}` (non-transient), not a text part.

## Exact wire frames emitted (verified from a live dump)

```
data: {"type":"data-run-start","data":{"type":"data-run-start","runId":"run-…","task":"<need>"},"transient":true}
data: {"type":"text-start","id":"narration-0"}
data: {"type":"text-delta","id":"narration-0","delta":"<log line>"}
data: {"type":"text-end","id":"narration-0"}
data: {"type":"data-confirm","data":{"type":"data-confirm","promptId":"<64hex>","kind":"build","question":"…"},"transient":true}   ← only when the build asks
data: {"type":"data-build-result","data":{"kind":"written",…}}          ← terminal, EXACTLY once
data: {"type":"data-run-end","data":{"type":"data-run-end","runId":"run-…","outcome":"written"},"transient":true}
data: [DONE]
```
(Reuse asks emit `data-confirm` with `kind` = the `ReuseKind` value passed per-call, via `confirmReuseViaPort`.)

## Concurrency contract — self-review against §7.1 (a)–(d)

**(a) confirm genuinely suspends `execute` without blocking the loop or timing out the HTTP response.** `confirm(q)` → `withConfirmTimeout(() => confirmRaw(q))` → `withWallClock(confirmWaitMs(), ask)`, where `ask` = `Boolean(await port({kind:'build',question}, events))`. `port` (registry) returns a Promise that settles ONLY when `resolve(promptId, …)` fires from the second HTTP request (`/api/runs/:id/respond`). `await deps.runBuilderTurn(...)` therefore parks on a real Promise — event loop free, HTTP Response already returned (the handler builds+returns the stream in one tick; `execute` runs concurrently and writes to the held-open connection). Verified by the progressive-read test: nothing past the ask (`after-confirm`) appears until `registry.resolve` is called; then `after-confirm:true` + the terminal `written` arrive.

**(b) client abort during a pending confirm does not crash and never cross-resolves.** `req.signal` is deliberately NOT passed into `withWallClock`'s `external` param, so an abort does not reject the confirm wait — the registry entry stays pending (test asserts `pending().length === 1`). A late/stale `resolve(promptId, …)` is a no-op-safe call (`registry.resolve` returns false for unknown/already-settled and never throws; test asserts `.not.toThrow()`). Cross-talk is impossible because `promptId` is 32 random bytes. The leaked pending entry is NOT proactively evicted (documented in `withConfirmTimeout`'s comment) — the 15-min `confirmWaitMs()` cap is the backstop: on timeout `withWallClock` rejects `Error('timeout')`, `.catch(() => false)` converts it to a **decline** (fail-closed, never auto-approve), `execute` resumes, writes the terminal result and `data-run-end`, so the build cannot suspend forever. A registry-level expiry that also deletes the map entry is a noted future hardening item.

**(c) terminal result written exactly once on every path.** A single `try/catch` sets `result` (success → DTO from the turn; throw → `{kind:'failed-verification', stage:'error', detail}`), followed by exactly one `writer.write({type:'data-build-result', data: result})`. No path writes it twice; no path skips it. The throwing-turn test asserts `failed-verification` appears exactly once with `"detail":"boom"`; the happy-path and requirement-(a) tests assert `written` exactly once.

**(d) build is not cancelled by the connection.** `req.signal` is never threaded into `runBuilderTurn` nor used to abort anything; `execute` is not detached fire-and-watch. Test: after `controller.abort()`, `await res.text()` and the turn's `completed` flag is `true` — the build ran to completion server-side. **The span-closes-on-disconnect half of (d) is only fully exercisable once Task 12 wires the real `withRunTelemetry`-backed turn** (T11's injected `runBuilderTurn` is a plain fake with no span). Flagged per the brief's controller note as a cross-task item for T12's reviewer to re-verify end-to-end.

## Notes / concerns for the reviewer

1. **Terminal frame shape** — the `text-part → data-part` deviation above. This is the one substantive judgement call; it is forced by the brief's own tests and sanctioned by §4.2.1's "data/text part" wording, but it is a wire-contract decision T13 must consume accordingly.
2. **`deps.runsRoot` is unused by the handler in T11.** The `BuilderBuildDeps.runsRoot` field is per the brief's Interfaces spec, but `handleBuilderBuild` never reads it — telemetry/`createRun` happen inside T12's injected `createRealRunBuilderTurn` (which closes over its own `runsRoot`) keyed by the `runId` the handler mints and passes through. So the field is currently redundant with T12's closure. Harmless and per-spec; flagging in case T12 intends the handler to pre-create the run dir (as the fire-and-watch pull route does) rather than rely on `withRunTelemetry`'s idempotent `createRun`.
3. **`logToTextDelta(writer.write)` passes `writer.write` unbound** — empirically fine (narration frames appear in the passing tests), consistent with T9's `TextPartWriter` design and the chat handler's usage.
4. **No `withUiStreamSpan` wrap** (unlike `handleChat`) — intentional: builder telemetry is the `agent.build`/`crew.build` root span opened by T12's `withRunTelemetry` inside the turn, not a `ui.stream` span here.

## Files changed
- `src/server/builders/config.ts` (new)
- `src/server/builders/build.ts` (new)
- `tests/server/builders-build.test.ts` (new)
