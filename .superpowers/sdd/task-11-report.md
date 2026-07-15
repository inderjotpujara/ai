# Task 11 report — Fire-and-watch launch handlers + real run-turns

**Status:** DONE. Committed on `slice-30b-phase4-crews-workflows`.

**Commit SHA:** `8001213` — `feat(server): fire-and-watch crew/workflow launch handlers + real turns (Phase 4)`

## What was done

Implemented the brief verbatim (TDD order — failing tests first):

1. **`tests/server/crews-run.test.ts`** — the brief's exact 4 tests (200+pre-created
   dir+detached invoke, unknown→404 no dir, malformed body→400, throwing turn→
   `error.json`). Confirmed FAIL first (`Cannot find module '../../src/server/crews/run.ts'`).
2. **`tests/server/workflows-run.test.ts`** — analogous 4 tests, swapping
   `handleWorkflowRun`/`fetch-then-summarize`/`/api/workflows/:id/run`/`runWorkflowTurn`
   per the brief's instruction ("copy the crew test, swapping...").
3. **`src/server/crews/run.ts`** — `RunCrewTurn`, `CrewRunDeps`, `handleCrewRun` exactly
   as specified.
4. **`src/server/workflows/run.ts`** — `RunWorkflowTurn`, `WorkflowRunDeps`,
   `handleWorkflowRun` exactly as specified.
5. **`src/server/launch-turns.ts`** — `createRealRunCrewTurn`/`createRealRunWorkflowTurn`,
   with the placeholder imports resolved (see below).

Biome's `--write` reformatted the two `run.ts` files and `crews-run.test.ts` (wrapped
multi-line `handleCrewRun(...)` calls and the destructured import) — pure formatting,
no logic change; re-ran tests + typecheck after to confirm.

## Import paths resolved for the real-turn seam (`src/server/launch-turns.ts`)

Read `src/cli/crew.ts` `main()` (lines 87–133) and `src/cli/flow.ts` `main()`
(lines 117–182) and copied their exact import lines, adjusted for the new file's
location (`src/server/launch-turns.ts`, i.e. one directory shallower than
`src/cli/*.ts`):

| Symbol | Brief's placeholder | Resolved import (relative to `src/server/`) |
|---|---|---|
| `runCrewCli` | `'../cli/crew.ts'` | `'../cli/crew.ts'` (correct as given) |
| `runFlow` | `'../cli/flow.ts'` | `'../cli/flow.ts'` (correct as given) |
| `withMcpRun` | `'../cli/with-mcp-run.ts'` | `'../cli/with-mcp-run.ts'` (correct as given) |
| `createSelectionRuntime` | not given | `'../cli/select-runtime.ts'` — same file `crew.ts`/`flow.ts` both import it from (`'./select-runtime.ts'` relative to `src/cli/`) |
| `AGENTS`, `agentNames` | not given | `'../../agents/index.ts'` — **repo-root** `agents/index.ts` (NOT `src/agents/`, which doesn't exist). `flow.ts` imports these via `'../../agents/index.ts'` relative to `src/cli/flow.ts`, which resolves to the repo-root `agents/` dir; from `src/server/launch-turns.ts` (one directory shallower) the equivalent path is also `'../../agents/index.ts'` (both `src/cli` and `src/server` are one level under `src/`, so the relative depth to repo root is identical). |
| `Agent` (type, for the agent map) | not shown in brief snippet | `'../core/agent-def.ts'` — needed because `flow.ts` types its agent map as `Record<string, Agent>`; the brief's sketch used `ReturnType<(typeof AGENTS)[string]>` which is equivalent but I used the same `Record<string, Agent>` shape `flow.ts` uses for exact fidelity. |

Both real-turn functions mirror their CLI counterparts' bodies exactly:
`withMcpRun({ runsRoot, runId }, ...)` → `createSelectionRuntime({ ledger })` →
run the engine (`runCrewCli`/`runFlow`) with `tools: reg.merged`,
`onBeforeDelegate: selection.onBeforeDelegate`, `ledger` → `finally { await selection.close() }`.
The workflow turn additionally builds the agent map via `agentNames()` +
`AGENTS[name]` + `reg.forAgent(name)`, identical to `flow.ts` `main()`'s loop
(including the `throw new Error('unknown agent: ...')` guard on a missing factory).

Note: `withMcpRun` internally calls `createRun(opts.runsRoot, opts.runId)` again for
the same `runId` the handler already pre-created — this is safe/idempotent
(`createRun` is `mkdir(dir, { recursive: true })`, confirmed in `src/run/run-store.ts`),
so no double-create hazard.

## The concurrency contract — confirmed present

1. **Pre-created dir before return.** Both handlers call
   `const run = await createRun(deps.runsRoot, runId);` and this line executes
   (and is awaited) **before** the `void deps.run*Turn(...)` line and before the
   final `return json(...)`. Test asserts `existsSync(join(root, runId))` is `true`
   immediately after `handleCrewRun`/`handleWorkflowRun` resolves, with zero delay.
2. **Detached with `.catch`, never a bare `void promise`.** Both handlers write:
   ```ts
   void deps.runCrewTurn({ def, input, runId }).catch(async (err: unknown) => {
     try {
       await writeArtifact(run, 'error.json', JSON.stringify({ error: explain(err).title }));
     } catch {
       // best-effort
     }
   });
   ```
   (same shape in `workflows/run.ts` with `runWorkflowTurn`). The `.catch` is
   chained directly onto the turn's promise — confirmed present in both files by
   direct read after Biome's reformat (Biome only re-wrapped the workflow one
   across multiple lines; the `.catch` handler itself is untouched).
3. **Rejection → `error.json`, no unhandled rejection.** Verified by the
   "a throwing turn persists error.json" test in both suites — the turn throws,
   the handler still returns `{runId}` synchronously (relative to the turn), and
   after a short `setTimeout` the `error.json` file exists in the pre-created run
   dir. `bun test` reported the run clean (no "Unhandled error between tests" for
   these two files, unlike the initial pre-implementation run which correctly
   showed the module-not-found error).
4. **400/404 ordering.** `getCrew(name)`/`getWorkflow(id)` lookup happens FIRST
   (→ 404 with no dir created), THEN body parsing (→ 400 with no dir created);
   `createRun` only runs after both checks pass. Tests confirm no dir exists
   implicitly (the 404/400 tests never read `runId` from a body, since the
   response never reaches that stage).

## Gate results (all green)

- `bun run typecheck` (`tsc --noEmit`): clean, no errors — including the real-turn
  wiring against `runCrewCli`/`runFlow`/`createSelectionRuntime`/`AGENTS`/`agentNames`.
- `bun run lint:file -- src/server/crews/run.ts src/server/workflows/run.ts src/server/launch-turns.ts tests/server/crews-run.test.ts tests/server/workflows-run.test.ts`:
  `Checked 5 files in 4ms. No fixes applied.` (after one `biome check --write` pass
  to apply formatting-only fixes, then a clean re-run confirmed 0 remaining issues).
- `bun test tests/server/crews-run.test.ts tests/server/workflows-run.test.ts`:
  ```
  bun test v1.3.11 (af24e281)
   8 pass
   0 fail
   14 expect() calls
  Ran 8 tests across 2 files. [150.00ms]
  ```
- Full server-group regression: `bun test --path-ignore-patterns 'web/**' tests/server/`
  → `96 pass / 0 fail / 237 expect() calls` across 19 files (up from the prior 88
  pass at Task 10 + 8 new).
- `git commit` ran the pre-commit hook (`bun run scripts/docs-check.ts`) →
  `✔ docs-check: living docs present + linked; every src subsystem documented.`
  (no docs changes needed — these are new files under the already-documented
  `src/server` and `src/server/{crews,workflows}` subsystems, no new subsystem).

## Scope note — routes NOT wired

Per the brief and the plan's task sequencing (confirmed in `task-10-brief.md`'s own
note: *"the `/run` POST routes come in Task 12 and MUST precede the bare `:name`
detail regex"*), this task creates the handlers + real turns only. Wiring
`POST /api/crews/:name/run` and `POST /api/workflows/:id/run` into
`src/server/app.ts`'s `handleApi` — and constructing `CrewRunDeps`/`WorkflowRunDeps`
(with `createRealRunCrewTurn(runsRoot)`/`createRealRunWorkflowTurn(runsRoot)`) for
the live server — is explicitly Task 12's job. `src/server/app.ts` was NOT modified
in this task.

## Concerns

None blocking. Two judgment calls worth flagging for the phase-gate review:

1. The brief's `launch-turns.ts` sample typed the workflow agent map as
   `Record<string, ReturnType<(typeof AGENTS)[string]>>`; I used `Record<string, Agent>`
   (imported from `../core/agent-def.ts`) instead, since that's the literal type
   `flow.ts`'s `main()` uses for the same variable and it typechecks identically.
   Purely a readability choice — flagged in case the reviewer prefers the brief's
   exact `ReturnType<...>` spelling for some reason.
2. `withMcpRun` re-invokes `createRun` for a runId the handler already created.
   Confirmed harmless (idempotent `mkdir recursive`), but it's a double call worth
   a reviewer's eye if `createRun`'s semantics ever change (e.g. if it started
   truncating/resetting an existing dir, this would become a real bug — it
   currently does not).

## Fix wave — early-failed launch now watchable (terminal Failed)

Adversarial review of this task found a real bug: the launch handlers correctly
write `runs/<id>/error.json` on a detached-turn rejection, but `run-dto.ts`'s
lifecycle derivation never looked at it. A run whose process died **before** its
`crew.run`/`workflow.run`/`agent.run` root span ever flushed (spans.jsonl absent,
empty, or containing only a non-root span like `mcp.mount`) kept reading
`lifecycle=Running` forever — and `handleRunStream`'s stop condition
(`lifecycle !== Running`) then polls to its 600s `maxWaitMs` cap instead of
closing. Fixed on the same branch, same slice.

### Fix 1 — `src/run/run-dto.ts`

Both `mapRunToDto` and `summarizeRunListItem` now treat "root reads Running
AND `error.json` is present" as this run's real terminal state:
`lifecycle = RunLifecycle.Failed`, `outcome = 'error'` (matching the existing
`rec.outcome('error')` convention already used in `server/chat/handler.ts` and
`server/runs/stream.ts` — no new string invented). A run whose root already
resolved (Done/Failed) is untouched — a completed/failed root wins even if an
`error.json` also happens to be present (spec'd "surgical" requirement).

- `mapRunToDto`: moved `readRunArtifacts` up before the `spans.length === 0`
  early-return so that guard becomes `if (spans.length === 0 && !hasError) return
  undefined;` — this is what makes the "no spans.jsonl at all + error.json" case
  fall through into the normal (now Failed) derivation instead of returning
  `undefined` (the pre-fix behavior, which would have left the SSE stream's `dto`
  perpetually `undefined` too).
- `summarizeRunListItem`: added a single cheap `stat(error.json)` check
  (`hasErrorArtifact` helper) — only paid on the already-narrow "root reads
  Running" branch, so the list view's mtime-cache/no-readdir cheapness is
  preserved for the common case.

### Fix 2 — `src/server/crews/run.ts` + `src/server/workflows/run.ts`

Doc-only: added a JSDoc line on `RunCrewTurn`/`RunWorkflowTurn` stating
implementations MUST be `async` (always return a Promise) — a
synchronously-throwing impl would escape the handler's `.catch` and crash the
request instead of degrading to `error.json`. No logic change.

### Covering tests — `tests/run/error-lifecycle.test.ts` (new, TDD)

6 tests: (1) `mapRunToDto` with ONLY `error.json` (no spans.jsonl) → Failed/error;
(2) `mapRunToDto` with `error.json` + a spans.jsonl containing only `mcp.mount`
(non-root) → Failed/error; (3) a completed `crew.run` root wins over a
coincidental `error.json` → stays Done/answer; (4) an in-flight run with no
`error.json` stays Running (unaffected); (5)/(6) the same non-root+error.json
and completed-root-wins cases for `summarizeRunListItem`.

### Gate (all green)

- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/run/run-dto.ts src/server/crews/run.ts src/server/workflows/run.ts tests/run/error-lifecycle.test.ts`
  → `Checked 4 files in 7ms. No fixes applied.` (one `biome format --write` pass
  on the new test file to fix line-wrapping first).
- `bun test tests/run tests/server/runs-detail.test.ts tests/server/runs-list.test.ts tests/server/crews-run.test.ts tests/server/workflows-run.test.ts`:
  ```
  bun test v1.3.11 (af24e281)
   109 pass
   0 fail
   286 expect() calls
  Ran 109 tests across 18 files. [501.00ms]
  ```
- Extra safety check (not in the gate list but exercised anyway, since
  `run-dto.ts` is load-bearing for both detail and stream):
  `bun test tests/server/runs-stream.test.ts tests/server/runs-routes.test.ts` →
  `13 pass / 0 fail / 23 expect() calls`. No regressions.

### Concerns

None blocking. One scope note: `summarizeRunListItem`'s pre-existing
"`stat(spans.jsonl)` fails → return `undefined`, not a started/completed run" gate
was deliberately left unchanged — a run that dies before spans.jsonl is ever
created still won't appear in the run **list** (it will still resolve correctly
via `mapRunToDto`, i.e. it IS watchable via `/api/runs/:id/stream`, which is what
Task 11's adversarial review flagged). Changing that gate to also surface such
runs in the list was judged out of scope ("Do NOT... Broaden scope beyond these
two fixes") and would need its own cache-key strategy (the mtime cache keys off
`spans.jsonl`, which wouldn't exist in that path).
