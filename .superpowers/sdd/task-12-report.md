# Task 12 report (Slice 21): thread the degradation ledger through the run context

NOTE: this file previously held a stale report from a Slice-19 task
("CREW-BUILDER registry markers") that reused the `task-12` filename under
that slice's numbering. Replaced below with the correct report for Slice 21
Task 12.

## Summary

Extended `McpRunContext` (`src/cli/with-mcp-run.ts`) with a `ledger:
DegradationLedger` field. `withMcpRun` now creates the ledger via
`createLedger()` right after `createRun`, passes it into the `ctx` object
given to `body`, and persists it via
`writeArtifact(run, 'degradation.jsonl', serializeLedger(ledger))` inside the
existing `finally` block — before `reg.close()` / `tel.shutdown()` — guarded
on `ledger.events.length > 0`. Persisting in `finally` (rather than only on
the success-return path) means a run that throws after recording
degradation events still writes `degradation.jsonl`, matching the brief's
"a degraded run always writes the file" requirement.

In `src/cli/chat.ts`, the `withMcpRun` body callback now destructures
`ledger` and wraps its existing logic (including the early `return` inside
the "wantsCrew" branch) in `try { ... } finally { const summary =
formatLedger(ledger); if (summary) console.error(summary); }`, so the
summary prints on every exit path from the body — not just the final `else`
branch — while preserving the existing early-return behavior for the
crew-builder offer flow.

`src/cli/with-run.ts` (the non-MCP builder/archive path) was left untouched
per the brief's guidance ("only if it invokes agent execution; otherwise
skip") — it just wraps run-dir creation + telemetry setup for the builders
and doesn't run an orchestrator, so there's no agent-execution path to
thread a ledger through there.

## TDD RED → GREEN

1. Wrote `tests/cli/degradation-ledger.test.ts` per the brief's Step 1: calls
   `withMcpRun` with an empty `McpConfig`, records one `AgentDropped` event
   via `ctx.ledger`, and asserts `degradation.jsonl` is written under
   `run.dir` and parses back with `subject: 'a'`.
2. RED: `bun test tests/cli/degradation-ledger.test.ts` →
   `TypeError: undefined is not an object (evaluating 'ctx.ledger.record')`,
   confirming `McpRunContext` didn't yet expose a ledger.
3. Implemented the changes described above in `with-mcp-run.ts` and
   `chat.ts`.
4. GREEN: `bun test tests/cli/degradation-ledger.test.ts` → `1 pass, 0 fail`.

## Verification

- `bun test tests/cli/degradation-ledger.test.ts` — 1 pass.
- `bun test tests/cli/` — 60 pass / 0 fail across 16 files; no regressions
  (existing `tests/cli/with-mcp-run.test.ts` ordering/close/mount-span
  assertions all still pass unchanged).
- `bun run typecheck` — clean (`tsc --noEmit`, no output).
- `bun run lint:file -- "src/cli/with-mcp-run.ts" "src/cli/chat.ts"
  "tests/cli/degradation-ledger.test.ts"` — clean. (Biome auto-reformatted
  indentation the first time, given the new try/finally wrap in chat.ts; a
  follow-up `lint:file` run confirmed no further fixes needed.)

## Files touched

- `/Users/inderjotsingh/ai/src/cli/with-mcp-run.ts` (modified)
- `/Users/inderjotsingh/ai/src/cli/chat.ts` (modified)
- `/Users/inderjotsingh/ai/tests/cli/degradation-ledger.test.ts` (new)

## Commit

`baabb27` — "feat(cli): thread degradation ledger through the run + surface
it". Staged only the three files above via explicit `git add
src/cli/with-mcp-run.ts src/cli/chat.ts tests/cli/degradation-ledger.test.ts`
(never `-A`/`-am`), since numerous unrelated uncommitted files
(`docs/ROADMAP.md`, `.superpowers/sdd/*`, `.remember/*`) were present in the
working tree from sibling parallel tasks. Confirmed via `git status --short`
before and after staging that exactly those three files were included.
Pre-commit `docs-check` hook passed.

## Self-review

- `McpRunContext` shape matches the brief exactly (`ledger:
  DegradationLedger` added, nothing else changed).
- Ledger creation, threading, and persistence match the brief's snippet,
  adapted to the file's real try/finally control flow (persist-then-close
  ordering preserved, `reg.close()`/`tel.shutdown()` still run last).
- chat.ts's `console.error` usage matches the file's existing logging
  channel (no `console.log` used for the ledger summary — only for the
  primary answer/gap text as before).
- No `console.log` introduced; no behavior change to the crew-builder /
  agent-builder offer flows (the early `return` inside the wantsCrew branch
  is preserved, now just exits the inner `try` and hits the `finally`).
- Confirmed via `git status --short` that no unrelated files were staged.

## Concerns

- None blocking. This task only threads the plumbing (context + CLI
  surface); nothing here populates the ledger with real degradation events
  from model selection/retry/circuit-breaker logic — those call sites
  (e.g. `select-hook.ts`, `model-manager.ts`, wherever retries/circuit-breaks
  live in this slice) are presumably wired by other tasks in Slice 21. This
  task is verified with a synthetic `ctx.ledger.record(...)` call in the
  test, exactly as scoped by the brief.
- Noted the same stale-report-filename collision pattern seen in the
  Slice-19 Task 12 report (SDD ledger numbering reusing `task-12-report.md`
  across slices) — purely a bookkeeping artifact, not a code concern.

## Post-task robustness fix (2026-07-05)

After task completion, discovered a robustness issue in the ledger persistence:
if `writeArtifact` threw (e.g., disk full, permission), `reg.close()` and
`tel.shutdown()` would be skipped, breaking the cleanup invariant.

**Fix:** Wrapped ledger persistence in its own try/catch (commit `2e0a2e2`):
```ts
if (ledger.events.length > 0) {
  try {
    await writeArtifact(run, 'degradation.jsonl', serializeLedger(ledger));
  } catch (err) {
    console.error(`failed to persist degradation ledger: ...`);
  }
}
```

Ensured `reg.close()` + `tel.shutdown()` run unconditionally. Re-verified:
- Tests: 60 pass / 0 fail (existing ledger test included).
- Lint + typecheck: clean.
- Pre-commit hook: passed.
