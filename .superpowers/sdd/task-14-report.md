### Task 14 (Slice 21): Agent turn wall-clock timeout — Report

**Status:** Implemented, GREEN.

**What changed:**
- `src/core/agent.ts`: wrapped the existing single `generateText({...})` call in
  `withWallClock(runTimeoutMs(), () => generateText({...}))`. Imported
  `withWallClock` from `../reliability/timeout.ts` and `runTimeoutMs` from
  `../reliability/config.ts`. All existing generateText options (system, prompt,
  tools, temperature, providerOptions, `abortSignal: input.abortSignal`,
  `stopWhen`, `experimental_telemetry`) are unchanged — only the call itself is
  now wrapped. No retry/backoff added (D5 respected): `withWallClock` races the
  generateText promise against a `setTimeout` that rejects `Error('timeout')`,
  clearing the timer either way.
- `tests/core/agent-timeout.test.ts` (new): builds a `MockLanguageModelV3`
  whose `doGenerate` awaits a 1000ms `setTimeout` before resolving (i.e. hangs
  well past the timeout). Sets `process.env.AGENT_RUN_TIMEOUT_MS = '20'` before
  the call and clears it in an `afterEach`. Asserts `runAgent({...})` rejects
  with `/timeout/`.

**TDD cycle:**
- RED: wrote the test first, ran `bun test tests/core/agent-timeout.test.ts` →
  failed with "Expected promise that rejects / Received promise that resolved"
  (no timeout enforced yet).
- GREEN: added the `withWallClock` wrap in `src/core/agent.ts`. Re-ran the test
  → PASS.
- `bun test tests/core/agent-timeout.test.ts tests/core/agent.test.ts tests/core/agent-abort.test.ts`
  → `5 pass, 0 fail`, 8 expect() calls (new + existing agent tests, no regression).
- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- "src/core/agent.ts" "tests/core/agent-timeout.test.ts"` →
  `biome check`, "Checked 2 files in 3ms. No fixes applied."

**Files:**
- Modified: `/Users/inderjotsingh/ai/src/core/agent.ts`
- Added: `/Users/inderjotsingh/ai/tests/core/agent-timeout.test.ts`

**Commit:** `56d712c` — `feat(core): wall-clock run_timeout on the agent turn (no LLM re-retry, D5)`
(branch `slice-21-graceful-degradation-retries`, 2 files changed, 60 insertions,
16 deletions). Staged only these 2 files explicitly (`git add src/core/agent.ts
tests/core/agent-timeout.test.ts`); verified via `git status --short` before
committing that no other repo-wide modified files (`.remember/*`,
`.superpowers/sdd/task-*-brief.md`/`task-*-report.md`, `docs/ROADMAP.md`) were
swept in. Pre-commit `docs-check` hook ran and passed (no `src/<subsystem>` doc
drift — this task only wraps an existing call inside an already-documented
module, no new subsystem).

**Self-review:**
- Followed the brief's exact pattern: reused the `MockLanguageModelV3` mock
  shape from `tests/core/agent.test.ts` / `tests/core/agent-abort.test.ts`
  (same `content`/`finishReason`/`usage`/`warnings` field shapes).
- No retry/backoff introduced — `withWallClock` is a pure additive backstop
  race around the single existing `generateText` call; the caller's
  `abortSignal` remains the primary cancel path and is passed through
  unchanged.
- All other `RunAgentInput` options (tools, temperature, providerOptions,
  maxSteps/stopWhen, functionId/telemetry) preserved verbatim inside the
  wrapped closure — no options were dropped or altered.

**Concerns:** None. No deviation from the prescribed design.

**Note:** This file previously held a report for a different, unrelated
"Task 14" from an earlier slice (crew-build-span telemetry). That content is
superseded by this report — see git history for the prior report if needed.
