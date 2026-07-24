# Task 8 Report — Slice 32: Eval job dispatch SEAM

(Note: `task-8-report.md` is reused per slice. This is the **Slice 32** Task 8 report; the prior content was Slice 31 Incr 3 and is superseded.)

**Status:** DONE. Commit `79c7fa5` — `feat(queue): Eval dispatch case + EvalMode/EvalJobPayloadSchema + RunEvalTurn seam`. Branch `slice-32-self-improvement`. Model: Opus.

## Scope delivered (seam only)
Landed the queue→execution dispatch seam for `JobKind.Eval`, exercised with a FAKE `runEvalTurn`. Did NOT implement sweep/pull orchestration or the real executor (Task 14/16).

### `src/server/jobs/dispatch.ts`
- `export enum EvalMode { Sweep='sweep', AffectedByPull='affected-by-pull', Artifact='artifact' }` — string enum per repo rules.
- `export type RunEvalTurn = (input: { mode: EvalMode; ref?: string; reason?: string; runId: string; signal?: AbortSignal }) => Promise<OrchestratorResult>`.
- `runEvalTurn?: RunEvalTurn` added to `JobDispatchDeps` (OPTIONAL so pre-Slice-32 fixtures keep compiling — verified: existing `baseDeps()` fixture has no `runEvalTurn` and still typechecks).
- `EvalJobPayloadSchema = z.object({ mode: z.enum(EvalMode), ref: z.string().min(1).optional(), reason: z.string().optional() }).refine(p => p.mode !== EvalMode.Artifact || !!p.ref, { message: 'ref required for mode=artifact' })`.
- **Replaced (not wrapped) the Task 5 throw-only stub** `case JobKind.Eval:` with the real case: `EvalJobPayloadSchema.parse(job.payload)` → fail-fast `if (!deps.runEvalTurn) throw new Error('eval job but no runEvalTurn dep is wired')` → `deps.runEvalTurn({ mode, ref, reason, runId: requireRunId(job), signal })`. Threads the pool `signal` like the Chat case. The `_exhaustive: never` default is untouched.

### `src/server/launch-turns.ts`
- `createRealRunEvalTurn(_runsRoot: string): RunEvalTurn` added, STUBBED to `throw new Error('runEval not wired until Task 16')` at construction time (throws on the factory call, not a returned-turn throw — so any premature wiring crashes loudly at daemon-build rather than dispatching a silent no-op). Doc comment states the real body (withRunTelemetry/withMcpRun + root span `eval.reeval` + `runEval` import) lands in Task 16.

## Confirmations of scope boundaries
- **T5 stub REPLACED, not wrapped** — the throw-only body + its "Task 8 to replace" comment are gone; the case now returns the real executor.
- **Did NOT wire the daemon/server** — `git show --stat HEAD` confirms only 4 files changed; `src/cli/daemon.ts` and `src/server/main.ts` are untouched. `createRealRunEvalTurn` is defined but not referenced anywhere (Task 16 wires it).
- **Did NOT touch `src/run/run-trace.ts`** — `eval.reeval` in `RUN_ROOT_NAMES`/`TERMINAL_RUN_ROOTS` is Task 16's item. Confirmed untouched.

## TDD RED → GREEN
Tests added: 3 dispatch tests in `tests/server/jobs/dispatch.test.ts` + 1 stub-guard test in new `tests/self-improve/eval-turn.test.ts`.

**RED** — `bun test tests/server/jobs/dispatch.test.ts tests/self-improve/eval-turn.test.ts`:
```
SyntaxError: Export named 'EvalMode' not found in module '.../dispatch.ts'
SyntaxError: Export named 'createRealRunEvalTurn' not found in module '.../launch-turns.ts'
 0 pass / 2 fail
```

**GREEN** — same command after impl:
```
 13 pass / 0 fail / 29 expect() calls
```

Tests cover: (1) Eval payload → `runEvalTurn` with parsed `mode`/`ref`/`reason`/`runId` + threaded signal; (2) missing `runEvalTurn` dep → throws `/runEvalTurn/`; (3) `mode=artifact` no `ref` → schema throws `/ref required for mode=artifact/`; (4) `createRealRunEvalTurn` factory throws `/runEval not wired until Task 16/`.

## Gate (all three)
- `bun run typecheck` (`tsc --noEmit`) → clean.
- `bun run lint:file -- src/server/jobs/dispatch.ts src/server/launch-turns.ts tests/server/jobs/dispatch.test.ts tests/self-improve/eval-turn.test.ts` → `Checked 4 files. No fixes applied.`
- Focused `bun test` (above) → 13 pass / 0 fail.

## Files changed
- `src/server/jobs/dispatch.ts`
- `src/server/launch-turns.ts`
- `tests/server/jobs/dispatch.test.ts`
- `tests/self-improve/eval-turn.test.ts` (new)

## Self-review
- Fail-fast correctness (the Opus reason): both failure modes throw and are proven by test — a missing dep throws (never falls through / no-ops), and `mode=artifact` with no `ref` throws at `.parse` (permanent, non-retryable → pool records terminal Failed). `Sweep`/`AffectedByPull` tolerate an absent `ref` (correct).
- House-shape match: dispatch case mirrors the `a2aRef`/`runAgentTurn` guard in structure; enum + `z.enum(EvalMode)` follows the `ProviderKind`/`RunOrigin` precedent; doc comments match surrounding style.
- `_runsRoot` unused-param prefix keeps lint clean while preserving the real Task 16 signature.

## Concerns
None blocking. Task 16 must: (a) unstub `createRealRunEvalTurn` (real `withRunTelemetry` + `runEval` from `src/self-improve/executor.ts`, root span `eval.reeval`), (b) wire `runEvalTurn: createRealRunEvalTurn(runsRoot)` into BOTH `buildRealDaemon` and `src/server/main.ts`, (c) add `eval.reeval` to `RUN_ROOT_NAMES`/`TERMINAL_RUN_ROOTS` in `src/run/run-trace.ts`. All three are explicitly out of scope here.
