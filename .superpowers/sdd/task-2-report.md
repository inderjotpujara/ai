# Task 2 report — Per-run telemetry via a routing span-processor (Slice 30a)

**Status:** DONE

## What shipped
Replaced the process-global `trace.setGlobalTracerProvider`-per-run design with
ONE global `BasicTracerProvider` fronted by a single `RunRoutingSpanProcessor`
that fans each span to the run active in its OTel `Context`. Two overlapping runs
in one process now write to separate `spans.jsonl` files.

### Files
- **Created** `src/telemetry/run-router.ts` — `RunRoutingSpanProcessor`
  (`onStart` captures the run id from the parent context into a `WeakMap`;
  `onEnd` looks it up and delegates to that run's processors), plus
  `ensureGlobalTelemetry`, `registerRun`, `unregisterRun`, `withRunContext`.
- **Created** `tests/telemetry/run-router.test.ts` — the two-overlapping-runs
  proof test (verbatim from the brief).
- **Modified** `src/telemetry/provider.ts` — `initRunTelemetry(runDir, runId)`
  registers the run's processors on the shared router; `shutdown` flushes +
  unregisters. No process-global swap. `buildProcessors`/`recordIoEnabled`
  unchanged.
- **Modified** `src/cli/with-mcp-run.ts` — passes `run.id`; wraps mount + body +
  teardown in `withRunContext(run.id, ...)` (mount must be inside the context so
  the `mcp.mount` span still lands in the run's spans.jsonl — asserted by
  `tests/cli/with-mcp-run.test.ts`).
- **Modified** `src/cli/with-run.ts` and `src/cli/memory.ts` — pass `run.id`,
  wrap body in `withRunContext`.
- **Modified** test call sites to the 2-arg signature + `withRunContext`:
  `tests/telemetry/provider.test.ts`, `tests/cli/run-chat.test.ts`,
  `tests/cli/crew.test.ts`, `tests/cli/flow.test.ts`,
  `tests/mcp/tool-span.test.ts`, and the 3 `tests/integration/*.live.test.ts`.

## Deviations from the brief (resolved against the installed SDK, not guessed)

1. **`initRunTelemetry` now `mkdirSync(runDir, {recursive:true})`.** The proof
   test uses raw dirs (`join(root,'A')`) without `createRun`, and
   `JsonlFileExporter` uses `appendFile` (no parent-dir creation), so the write
   ENOENT'd and nothing landed. Production callers already `createRun` first;
   this is defensive and idempotent.

2. **`ensureGlobalTelemetry` re-asserts the global provider on every call**
   (build router+provider once; `trace.disable()` + `setGlobalTracerProvider`
   each call) rather than a pure one-time `installed` guard. Reason found the
   hard way: `bun test` shares module state across files (verified with a probe),
   and the existing span-assertion tests swap the global tracer provider via
   `tests/helpers/otel-test-provider.ts` (`registerTestProvider` →
   `trace.disable()` + `setGlobalTracerProvider(InMemory)`). A pure install-once
   guard never reclaims the global after that swap, so later runs' spans went to
   a shut-down test provider (empty files / ENOENT). Re-asserting reclaims it.
   Safe for concurrent runs: the router is a stable singleton and routing is by
   the run id in the active context, not by which provider a span came through;
   the `disable`+`setGlobal` pair is synchronous so no span is emitted in the
   gap. This mirrors the old code's per-call re-registration while keeping ONE
   router so registrations accumulate.

3. The brief's inline `import('@opentelemetry/api').Context` was hoisted to a
   top-level `type` import for lint cleanliness; types are otherwise imported
   from `@opentelemetry/sdk-trace-base` / `@opentelemetry/api` as specified.

## Tests / checks
- `bun test tests/telemetry/ tests/cli/run-chat.test.ts` → 41 pass, 0 fail
  (incl. the two-overlapping-runs proof test).
- `bun test tests/cli/ tests/mcp/` → 162 pass, 0 fail.
- `bun run typecheck` → clean.
- `bun run lint:file` on all 14 touched files → clean.

## Concerns
None blocking. Note for downstream: any NEW code path that emits spans for a run
must run under `withRunContext(runId, ...)` (or a child of it) or its spans will
not be routed to that run's spans.jsonl — the intended trade for concurrency
isolation.
