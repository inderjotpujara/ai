# Task 23 Report — `chat.run` root-span opener (Slice 30b Phase 8, D9, Part 1 of the kind=agent notification fix)

> NOTE: This file previously held a stale Phase-5 MCP Task-23 report; overwritten with the current Phase-8 task.

## Status: DONE

## What shipped
- **`src/telemetry/spans.ts`**: Added `withChatRunSpan<T>(runId, task, fn)` directly after `withRunSpan` (verbatim per brief). Opens `inSpan('chat.run', …)` with a byte-identical attribute body (RUN_ID, CONTENT_POLICY, TASK under `recordIoEnabled()`), plus the documented rationale comment. **`withRunSpan` was NOT modified** — it stays the generic `agent.run` opener for a future standalone-agent-run feature (§7.2b).
- **`src/cli/run-chat.ts`**: Import changed to `withChatRunSpan` (line 7); call site changed to `withChatRunSpan(run.id, deps.task, …)` (line 21). `runChat` is `withRunSpan`'s only caller, so chat turns now open `chat.run`.
- **`tests/telemetry/chat-run-span.test.ts`** (new): TDD test — asserts `withChatRunSpan` emits a `chat.run` root carrying the run id, AND that `withRunSpan` STILL emits `agent.run` (guards the intact generic capability).
- **`tests/cli/run-chat.test.ts`**: Updated one assertion (`agent.run` → `chat.run`). This test directly verifies the chat path's root span name, so my rename requires it — in-scope for the rename, NOT a RUN_ROOT_NAMES concern.

## TDD trace
1. Wrote failing test → FAIL (`Export named 'withChatRunSpan' not found`). Confirmed RED.
2. Implemented → new test GREEN (2 pass, 4 expect).

## Gate results (all green)
- `bunx biome check --write` on all 4 changed files: clean.
- `bun run typecheck`: pass (0 errors).
- `bun run lint:file` on the 3 changed src/test files: clean (0 errors/warnings).
- Broad suites `bun test tests/run/ tests/cli/ tests/server/ tests/telemetry/ tests/contracts/`: **510 pass, 0 fail** (120 files).

## Concerns / expected-red deferred to T24
- **None red.** The brief warned run-dto/run-summary tests *may* go red because `RUN_ROOT_NAMES` does not yet know `chat.run`. In practice **no unit test broke** — those suites classify from stored/fixture span names and do not exercise the live chat path through `withChatRunSpan`.
- The `RUN_ROOT_NAMES`/`deriveRunKind` gap is therefore a **runtime-only** gap: a live chat run would currently read as a perpetual-"Running" ghost until Task 24 adds `'chat.run'` to `RUN_ROOT_NAMES` + `deriveRunKind` and adds the §7.2 regression net. Exactly the anticipated boundary, cleanly bounded — no silent full-suite breakage. **T24 should follow immediately.**

## Commit
- `b63ff08` — `feat(telemetry): chat turns open a chat.run root, not agent.run (D9)` (branch `slice-30b-phase8-polish-a11y`; pre-commit docs-check passed).
