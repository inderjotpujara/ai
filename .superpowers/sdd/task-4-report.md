# Task 4 report: Crew telemetry span (Slice 11)

## Implemented

`src/telemetry/spans.ts` (additive only, no existing behavior changed):
- Added `ATTR.CREW_ID` (`'crew.id'`), `ATTR.CREW_PROCESS` (`'crew.process'`), `ATTR.CREW_TASK_MEMBER` (`'crew.task.member'`) to the existing `ATTR as const` object, appended before the closing `} as const;`.
- Added `withCrewSpan<T>(crewId, process, fn)` — opens root span `'crew.run'` via the private `inSpan` helper (same pattern as `withWorkflowSpan`), tags `ATTR.CREW_ID`/`ATTR.CREW_PROCESS`, then runs `fn()` inside the active span context so any nested spans (`workflow.run`/`workflow.step` for sequential process, `agent.delegation` for hierarchical) attach beneath it automatically via OTel's active-context propagation.

`tests/telemetry/crew-spans.test.ts` — new test file, copied verbatim from the brief:
- `registerTestProvider()` + `withCrewSpan('research-crew', 'sequential', ...)` wrapping a nested `withStepSpan('t1', 'agent', ...)`.
- Asserts `crew.run`'s attributes carry `ATTR.CREW_ID`/`ATTR.CREW_PROCESS`, and that the nested `workflow.step` span's `parentSpanContext?.spanId` equals `crew.run`'s `spanContext().spanId` — i.e. genuine parent/child nesting, not just co-occurrence.

## TDD RED → GREEN

**RED** — ran before touching `spans.ts`:
```
$ bun test tests/telemetry/crew-spans.test.ts
SyntaxError: Export named 'withCrewSpan' not found in module '.../src/telemetry/spans.ts'.
0 pass / 1 fail / 1 error
```

Implemented the 3 `ATTR` keys + `withCrewSpan` exactly per the brief's verbatim code (no deviation needed this time — the brief already used the correct `parentSpanContext?.spanId` convention from the prior Slice-10 finding).

**GREEN:**
```
$ bun test tests/telemetry/crew-spans.test.ts
1 pass / 0 fail / 3 expect() calls
```

## Final verification (run before commit)

```
$ bun run typecheck                                   → tsc --noEmit clean
$ bun run lint:file -- "src/telemetry/spans.ts"       → biome check: no issues
$ bun test                                            → 210 pass, 15 skip (pre-existing/unrelated), 0 fail, 408 expect() calls, 225 tests / 72 files
```

## Files changed
- `src/telemetry/spans.ts` (modified, additive — 3 ATTR keys + 1 new exported function)
- `tests/telemetry/crew-spans.test.ts` (new)

## Commit
- `b8e21e1` feat(telemetry): crew.run span + crew ATTR keys

## Self-review
- Additive-only confirmed: every existing `ATTR` key, exported function signature, and helper (`inSpan`, `withRunSpan`, `withDelegationSpan`, `withWorkflowSpan`, `withStepSpan`, `annotateStep`, etc.) is byte-for-byte untouched; only 3 new `ATTR` keys and one new function were appended.
- `withCrewSpan` goes through the private `inSpan` helper exactly like `withWorkflowSpan` — same error-handling (`SpanStatusCode.ERROR` on throw), same `span.end()` in `finally`, same active-span propagation via `tracer().startActiveSpan`. No new tracer/exporter logic introduced.
- Nesting assertion uses `parentSpanContext?.spanId` (this repo's installed OTel SDK convention, confirmed via the existing `tests/telemetry/spans.test.ts` and `tests/telemetry/workflow-spans.test.ts` patterns), not the `parentSpanId` shape that doesn't exist on this SDK's `ReadableSpan`.
- Followed the "assert before shutdown" constraint: `exporter.getFinishedSpans()` is called immediately after `withCrewSpan(...)` resolves; `exporter.shutdown()` is never called in this test, so there's no risk of the documented `InMemorySpanExporter.shutdown()`-clears-spans pitfall from a prior slice.
- No `console.log` added.
- Test reuses the shared `registerTestProvider()` helper from `tests/helpers/otel-test-provider.ts` — no new test infrastructure needed.

## Docs note (scope boundary, not an omission)
Per `.superpowers/sdd/task-8-brief.md`, **Task 8** owns `docs/architecture.md` §13 ("Crews & roles") and the §2 module-map `src/crew/` node/edges for this slice — it's scheduled after the engine/CLI tasks land so the doc reflects the finished subsystem in one pass, not a half-built one. This task is telemetry-primitives-only (mirroring how Slice 10 split workflow-spans from the engine/CLI/doc tasks), so `docs/architecture.md` is intentionally untouched here. The repo's pre-commit hook (`docs:check` — living-doc presence/linkage) passed; the stricter pre-push hook (blocks `src/**` changes not paired with an `architecture.md` update in the same push) will be satisfied once Task 8 lands before this branch is pushed/merged.

## Concerns
- None functional. The brief's test snippet needed zero corrections this time (Slice 10's Task 4 already surfaced and fixed the `parentSpanId` vs `parentSpanContext?.spanId` SDK-version mismatch, and this brief already used the corrected convention).
- `ATTR.CREW_TASK_MEMBER` is added per the brief's interface contract but not yet exercised by any helper in this task — it's for a later task (crew task-to-agent assignment, likely Task 5/6) to `setAttribute`/`annotateStep` with. Confirmed this is expected: the brief explicitly lists it under "Produces" for Tasks 6/7 to consume, not for Task 4 to use.
