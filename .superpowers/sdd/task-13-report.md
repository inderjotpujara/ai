# Task 13 Report — web `postSseStream` + `use-build-events.ts` fold hook

**Commit:** `e70754f` — `feat(web): postSseStream + use-build-events fold hook (Phase 5)`

## What was implemented

1. **`postSseStream<T>`** appended to `web/src/shared/transport/sse-adapter.ts` (additive, no existing export touched): a POST-body SSE reader mirroring `createSseTransport().stream()`'s fetch/`readSseStream` plumbing, but takes an explicit `path`/`body`/`schema` instead of GET-only `runId`-based path selection. Adds one line beyond the brief's snippet: `if (frame.data === '[DONE]') continue;` before `JSON.parse`, so the AI-SDK UI-message-stream's trailing `data: [DONE]\n\n` sentinel (emitted unconditionally by `JsonToSseTransformStream.flush`, confirmed by reading the installed `ai@6.0.225` package) is skipped instead of crashing `JSON.parse('[DONE]')`.

2. **`web/src/features/builders/use-build-events.ts`** (new): `foldBuildFrame` (pure fold), `useBuildEvents()` hook, and supporting schemas/types (`BuilderWireFrameSchema`, `BuilderFrame`, `BuildFoldState`, `PendingConfirm`).

## Ground-truth verification before writing code (why the brief's snippet needed changes)

Before implementing, I read the actual server files rather than trusting the brief's illustrative snippets, per the task's explicit override instructions:
- `src/server/builders/build.ts` — confirmed `createUIMessageStream`/`createUIMessageStreamResponse` is used (an AI-SDK UI-message stream), and traced `JsonToSseTransformStream` in the installed `ai` package to confirm the `data: [DONE]\n\n` terminator is real and unconditional.
- `src/server/builders/build.ts:93-94` — the `events: EventSink` sink writes `writer.write({ type: e.type, data: e, transient: true })` for **every** StatusEvent it dispatches (RunStart, RunEnd, **and** Confirm — confirmed via `src/server/consent/registry.ts:37-42`, where `port` mints `{ type: StatusEventType.Confirm, promptId, kind, question }` and calls `emit`/`events` with it). So RunStart/Confirm/RunEnd are **all** envelope-wrapped on the wire, not flat — this is a correction to the task's own informal note ("confirm/log/narration frames are flat"), which turned out to only be true for narration.
- `src/server/builders/build.ts:125` — the terminal is `writer.write({ type: 'data-build-result', data: result })`, a one-shot **data part**, not a text-delta.
- `src/server/builders/adapter.ts` (`logToTextDelta`) — narration IS flat: `{ type: 'text-start'|'text-delta'|'text-end', id, delta? }`, unenveloped.
- Cross-checked against the existing precedent hook `web/src/features/agents/use-status-events.ts` + its test `web/src/features/agents/live-rail.test.tsx` (uses `renderHook`), which already treats incoming `DataUIPart`s as `{ type, data }` envelopes and reads `part.data` — confirming this envelope convention is standard elsewhere in the codebase, not builder-specific.

## Design: envelope unwrap kept OUT of the pure fold

To keep `foldBuildFrame` matching the brief's clean flat-`StatusEvent` test shapes (and matching the `foldSpan`/`foldEvent` convention), I split responsibilities:
- `BuilderWireFrameSchema` (exported) validates the **raw wire shape** `postSseStream` receives: a StatusEvent envelope (`{ type: StatusEventType, data: StatusEvent, transient? }`), the build-result data part (`{ type: 'data-build-result', data: unknown }`), or a flat narration text part.
- `unwrapWireFrame` (private) strips the envelope for StatusEvent frames only (`.data` **is** the flat `StatusEvent`); build-result and text parts pass through unchanged (already the shape the fold expects).
- `foldBuildFrame` (exported, pure) then only ever sees flat `StatusEvent | BuildResultPart | TextPart` — identical in shape to the brief's test snippets for RunStart/Confirm/RunEnd/text-delta.
- `useBuildEvents().start()` composes `postSseStream(..., BuilderWireFrameSchema) → unwrapWireFrame → foldBuildFrame → setState`.

## TDD evidence

- **RED (`postSseStream`):** `TypeError: postSseStream(...) is not a function or its return value is not async iterable` (2 failing tests) before implementation.
- **GREEN (`postSseStream`):** 6/6 tests in `sse-adapter.test.ts` pass after implementation (4 pre-existing + the brief's POST test + a new `[DONE]`-tolerance test I added, since the [DONE] requirement was explicitly called out but the brief's own snippet didn't include it).
- **RED (`use-build-events`):** `Error: Failed to resolve import "./use-build-events.ts"` before the file existed.
- **GREEN (`use-build-events`):** 6/6 tests pass — the brief's 5 `foldBuildFrame` cases (with the build-result case rewritten to the verified data-part shape instead of the brief's text-delta snippet) + one integration test I added that drives `useBuildEvents().start()` through `renderHook` against literal enveloped SSE wire bytes (matching `build.ts`'s exact output, including the `[DONE]` terminator) to prove the full `postSseStream → unwrap → fold → setState` pipeline composes correctly end-to-end, not just each piece in isolation.

## Gate results (both, before commit)

- Root: `bun run typecheck` — clean (no root files changed, so no root lint needed).
- Web: `cd web && bun run typecheck` — clean.
- Web: `cd web && bun run test` — **34/34 test files, 130/130 tests pass** (one unrelated `ECONNREFUSED :3000` `AggregateError` printed to stderr from an unrelated async source in the suite run, not a test failure — pre-existing, not touched by this task).
- Lint: `bun run lint:file -- web/src/shared/transport/sse-adapter.ts web/src/shared/transport/sse-adapter.test.ts web/src/features/builders/use-build-events.ts web/src/features/builders/use-build-events.test.ts` — initially caught one real issue (`noUnusedVariables`: an unused `StatusEnvelope` type alias, since the fold operates on the unwrapped flat type, not the envelope type) + formatting nits; fixed the unused type by hand and ran `bunx biome check --write` for formatting; re-ran lint clean, then re-ran web typecheck + full test suite again post-format — still 34/34 · 130/130 green.

## Files changed

- `/Users/inderjotsingh/ai/web/src/shared/transport/sse-adapter.ts` — added `postSseStream` (additive).
- `/Users/inderjotsingh/ai/web/src/shared/transport/sse-adapter.test.ts` — added `postSseStream` describe block (brief's POST test + `[DONE]`-tolerance test).
- `/Users/inderjotsingh/ai/web/src/features/builders/use-build-events.ts` — new.
- `/Users/inderjotsingh/ai/web/src/features/builders/use-build-events.test.ts` — new.

## Self-review

- `postSseStream`'s `[DONE]` check compares `frame.data === '[DONE]'` (post-`parseSseFrame`, pre-`JSON.parse`) — correct level, since `parseSseFrame` already strips the `data:` prefix, leaving the literal string `[DONE]`.
- `unwrapWireFrame` is intentionally unexported (private implementation detail of the hook); the integration test exercises it indirectly through `useBuildEvents().start()` rather than importing it directly, keeping the public surface exactly what the brief's interface list specifies (`postSseStream`, `foldBuildFrame`, `useBuildEvents`).
- `BuildResultPart.data` is deliberately kept `z.unknown()`/`unknown` (not validated against `BuildResultDtoSchema`) — matches the brief's stated intent ("Task 14 validates it against BuildResultDtoSchema before rendering") and keeps this module free of a `BuildResultDtoSchema` dependency.
- Confirmed via `src/server/launch-turns.ts` that only `RunStart`/`Confirm`/`RunEnd` can actually appear on this stream in practice (the builder-turn's `events` sink is never wired into `runBuilderTurn`/`buildAgent`/`buildCrewOrWorkflow` — those get only plain `confirm`/`confirmReuse`/`log` callbacks); `StatusEventSchema`'s full 9-member union is reused as-is (matching the `use-status-events.ts` precedent) rather than narrowed, since narrowing would add no safety and the full schema is the established import from `@contracts`.

## Concerns / deviations from the brief (both explicitly authorized by the task instructions)

1. **`[DONE]` handling** — added; the brief's `postSseStream` snippet lacked it. Required by the task's wire-contract note.
2. **Build-result terminal shape** — the brief's step-5 test and step-7 `use-build-events.ts` snippet modeled the terminal as a `text-delta` (id `'build-result'`) carrying `JSON.stringify(dto)`. Verified server code (`build.ts:125`) proves it is instead a one-shot `data-build-result` **data part** (`{ type: 'data-build-result', data: <BuildResultDTO> }`). Implemented and tested against the verified shape instead; the incorrect test case was replaced (documented inline in the test file), not left alongside a passing-but-wrong duplicate.
3. Additionally corrected the task's own informal claim that confirm/narration frames are "flat" — narration is flat, but `data-confirm` (like `data-run-start`/`data-run-end`) is envelope-wrapped on the wire, per direct inspection of `build.ts` + `consent/registry.ts`. `foldBuildFrame` still receives it flat (envelope stripped one layer up in `useBuildEvents`), so this only affected the internal wire/unwrap design, not the fold's public test shape.

No other ambiguities found; ready for Task 14 (the guided wizard UI) to consume `useBuildEvents()`.
