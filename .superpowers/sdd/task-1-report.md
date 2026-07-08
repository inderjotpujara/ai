# Task 1 Report: Structured leveled logger (Slice 30a, Ops Surface)

## Status: DONE

## Commit
`4c28a38618ae6896cc868c914e8f0dc968629769` — feat(log): structured leveled logger stamped with run-id (replaces ad-hoc console.* status)

## What changed
- `src/telemetry/run-router.ts`: added `currentRunId(): string | undefined`, reading the existing module-private `RUN_ID_KEY` off `context.active()`. No other change (existing `RUN_ID_KEY`, `withRunContext`, `registerRun`, `unregisterRun`, `ensureGlobalTelemetry` untouched, per instructions not to duplicate/recreate them).
- `src/log/logger.ts` (new): `createLogger(name): Logger` (`debug`/`info`/`warn`/`error`, each `(msg, fields?) => void`); emits one record to stderr — pretty (`HH:MM:SS LEVEL name  msg`) when `process.stderr.isTTY`, else a JSON line `{ ts, level, name, runId, msg, ...fields }`; level gate via `AGENT_LOG_LEVEL` (default `info`, order debug<info<warn<error); `setLogSink(fn)` test seam. Stamps `runId` via `currentRunId()`.
- `tests/log/logger.test.ts` (new): the brief's two cases (JSON shape + runId stamp; `AGENT_LOG_LEVEL` gate), with two adjustments over the literal brief text — see Concerns.
- `src/cli/chat.ts`: added `const log = createLogger('chat');` (import from `../log/logger.ts`, placed alphabetically before `../mcp/mount.ts`); replaced the two STATUS `console.error(...)` calls (router-warm message, project-store status message) with `log.info(...)`. Left the usage-error `console.error` untouched (exits before a logger helps, per brief).
- `docs/architecture.md`: added a **Logging** row to the subsystem registry table (`src/log/`), placed after **Telemetry**, describing `createLogger`/`setLogSink`, TTY-vs-JSON emission, the `AGENT_LOG_LEVEL` gate, and the `currentRunId()` dependency on `telemetry/run-router.ts`.

## TDD steps
1. Wrote `tests/log/logger.test.ts` first; ran `bun test tests/log/logger.test.ts` → failed as expected (`Cannot find module '../../src/log/logger.ts'`).
2. Added `currentRunId()` to `run-router.ts`.
3. Implemented `src/log/logger.ts` per the brief's code verbatim.
4. Wired `chat.ts`'s two status lines through `log.info`.
5. Ran the full test/typecheck/lint/docs-check gate (below), fixed two issues surfaced (see Concerns), then committed.

## Test summary
`bun test tests/log/ tests/telemetry/ tests/cli/` → 109 pass, 0 fail (258 expect calls); `bun run typecheck` clean; `bun run lint:file` on the 4 touched source/test files clean; full `bun run lint` (whole repo, 508 files) shows 14 pre-existing warnings, none in touched files; `bun run docs:check` green.

## Concerns
- **Test brief deviation (justified):** the brief's test as literally written (`withRunContext('run-xyz', ...)` with no prior `ensureGlobalTelemetry()`/`initRunTelemetry()` call) **fails when run standalone** (`bun test tests/log/`): `context.active()` returns `ROOT_CONTEXT` under the default no-op OTel context manager, so `withRunContext`'s `context.with(...)` binding is silently dropped and `runId` comes back `undefined`. It only "passes" in a combined run (`tests/log/ tests/telemetry/ tests/cli/`) because another test file in that batch (e.g. `tests/cli/with-run.test.ts`) happens to call `initRunTelemetry` → `ensureGlobalTelemetry()` first and leaks the global AsyncLocalStorage context manager into the shared process (bun runs test files in one process). This mirrors the codebase's real invariant — every production call site (`src/cli/with-run.ts`, `with-mcp-run.ts`, `memory.ts`) calls `initRunTelemetry` (which calls `ensureGlobalTelemetry`) before `withRunContext`. Fix: added one `ensureGlobalTelemetry()` call at module scope in the test file, so it's deterministic standalone rather than passing only via incidental cross-file pollution. No production code semantics changed; `run-router.ts` gained only `currentRunId()` as specified.
- **Minor type fix:** `lines[0]` → `lines[0] ?? ''` in both test assertions — `tsc --noEmit` failed under this repo's `noUncheckedIndexedAccess: true`; the brief's snippet predates that check. Matches the existing pattern already used in `tests/reliability/ledger.test.ts`.
- No other deviations. `run-router.ts`'s existing exports were not duplicated or modified beyond the one addition.
