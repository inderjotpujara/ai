# Task-3 Fix Report — Telemetry Layer Bug Fixes

## What Changed

### Bug A — JsonlFileExporter fire-and-forget write (BLOCKING)

**Before:** `export()` called `appendFile(...).then(...)` with no chain, and `shutdown()` was an empty `async shutdown(): Promise<void> {}`. When a test (or the run path) did `await provider.shutdown()`, the file write was still pending — causing `ENOENT` when the next line tried to read `spans.jsonl`.

**After:** `src/telemetry/jsonl-exporter.ts` now uses a `private writeChain: Promise<void> = Promise.resolve()` that serializes all `appendFile` calls. `forceFlush()` and `shutdown()` both `await this.writeChain.catch(() => {})`, so they block until the last write lands. The `export()` signature is now the multi-line formatter-compliant form.

**New test added** (`tests/telemetry/jsonl-exporter.test.ts`): `shutdown flushes in-flight writes before returning` — exports a span, awaits `provider.shutdown()` with no sleep, then reads the file immediately and asserts `"name":"flush-check"` is present. This is the exact regression gate.

### Bug B1 — global tracer provider only honors first registration

**Before:** `initRunTelemetry` called `trace.setGlobalTracerProvider(provider)` directly. The OTel API ignores subsequent calls (once a real provider is registered the proxy is locked). Second runs in the same process kept using the first provider, writing spans to the wrong file.

**After:** `src/telemetry/provider.ts` now calls `trace.disable()` immediately before `trace.setGlobalTracerProvider(provider)`. `trace.disable()` is the public API that resets the global to the no-op proxy, allowing the following `setGlobalTracerProvider` to register cleanly. The `contextManagerSet` guard remains — the context manager is still only set once per process.

**Strengthened test** (`tests/telemetry/provider.test.ts`): replaced the trivial `expect(true).toBe(true)` stub with a real assertion — creates two dirs, calls `initRunTelemetry(dir)` → shutdown, then `initRunTelemetry(dir2)` → emit span → shutdown, then reads `dir2/spans.jsonl` and asserts `"name":"second-run-span"` is present.

### Bug B2 — spans.test.ts internal-API hack

**Before:** `tests/telemetry/spans.test.ts` used `(trace as unknown as TraceInternal)._proxyTracerProvider.setDelegate(provider)` to work around the once-per-process lock — a brittle private-API hack.

**After:** The file now imports `registerTestProvider()` from `tests/helpers/otel-test-provider.ts` and calls it in `beforeEach`. The helper uses `trace.disable()` + `trace.setGlobalTracerProvider(provider)` (public API). All test-level imports of `context`, `trace`, `BasicTracerProvider`, `InMemorySpanExporter`, and `SimpleSpanProcessor` were removed from `spans.test.ts` (no longer needed). The same two assertions (nesting/parent-linkage and ERROR-status) pass unchanged.

**New file:** `tests/helpers/otel-test-provider.ts` — `registerTestProvider()` builds a fresh `InMemorySpanExporter` + `BasicTracerProvider`, sets the context manager once (same guard pattern), calls `trace.disable()`, registers the provider, and returns `{ exporter, provider }`.

## Before / After `bun test tests/telemetry/`

**Before:**
```
tests/telemetry/jsonl-exporter.test.ts:
ENOENT: no such file or directory, open '…/spans-Hw5H8X/spans.jsonl'
(fail) writes one JSON line per ended span with parent linkage [0.81ms]
6 pass / 1 fail
```

**After:**
```
8 pass / 0 fail
Ran 8 tests across 3 files. [79ms]
```

Individual files also pass in isolation (2/2, 2/2, 4/4).

## Files Changed

- `src/telemetry/jsonl-exporter.ts` — write chain + `forceFlush` + `shutdown`
- `src/telemetry/provider.ts` — `trace.disable()` before re-registration
- `tests/helpers/otel-test-provider.ts` — new; `registerTestProvider()` helper
- `tests/telemetry/spans.test.ts` — drop internal hack, use `registerTestProvider`
- `tests/telemetry/jsonl-exporter.test.ts` — add flush regression test
- `tests/telemetry/provider.test.ts` — strengthen idempotent test + add `dir2`

## Concerns

None. All fixes use public OTel APIs. `trace.disable()` is documented as the correct reset mechanism. The write chain approach is standard for serializing async I/O without locks. Typecheck and lint (biome) are both clean.

## Commit

`9600aa4 fix(telemetry): flush spans on shutdown + re-init-safe provider swap`
