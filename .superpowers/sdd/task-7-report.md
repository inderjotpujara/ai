# Task 7 report — `src/self-improve/reeval.ts` (`reevalArtifact`, generation-free) — Slice 32

**Status: COMPLETE.** Commit `e263854`.

(This file previously held a stale Slice-25b Task-7 report; overwritten for Slice 32.)

## What shipped
`reevalArtifact(entry, name, deps)` — the generation-free re-eval engine. It replays
an artifact's **persisted** golden set against the **freshly-resolved** model and
returns a discriminated `ReevalOutcome`. It never regenerates the artifact: no
`stage`/`structural`/`dryRun`/`makeGolden`/`verifyAndCommit` — only `loadGolden`
(injected) + the shared `runGoldenEval` binding.

Flow (exact, early-return):
1. `deps.loadGolden(entry.goldenPath)` → null ⇒ `{ kind:'skipped', reason: NoGolden }`
   (returns **before** any resolve — proven by test (a): `resolved` stays false).
2. `deps.resolve(entry.need)` → the freshly-resolved `{ decl, numCtx }`.
3. `runGoldenEval({ cases: golden.cases, judgeCandidates, generatorFamily:
   modelFamily(resolved.decl.model), runCase:(input)=>deps.runCase(name,
   resolved.decl, input), judge })`.
4. `runGoldenEval` returned `null` (judge below-bar / `JudgeUnavailableError`) ⇒
   `{ kind:'skipped', reason: JudgeUnavailable }` — **never a regression, never a
   demote** (D4/D5's job).
5. Real `EvalResult` ⇒ `{ kind:'evaluated', result, resolved }` — carries the
   `EvalResult` + the resolved model identity so D4 can diff vs baseline and D6 record.

Types: `ReevalSkip` is a **string enum** (`NoGolden='no-golden'`,
`JudgeUnavailable='judge-unavailable'`). `ReevalOutcome` is a `type` discriminated
union on the `kind` literal. `ReevalDeps` / `ResolvedModel` exported for the caller
(D4/scheduler) to wire.

## `modelFamily` export decision
`modelFamily` was a **private** fn in `src/agent-builder/deps.ts` (was ~line 235).
I **lifted it into `src/verified-build/judge.ts`** (exported), NOT re-exported from
`deps.ts`. Rationale:
- Its sole purpose is to compute `generatorFamily` for `selectJudge`; the `family`
  concept is *defined* in `judge.ts` (`JudgeCandidate.family`, `JudgeDeps.generatorFamily`).
  It now lives next to the code it feeds — maximum cohesion.
- Both callers (`agent-builder/deps.ts` and the new `self-improve/reeval.ts`) already
  import from `verified-build/judge.ts`, so no new import edges into heavy modules.
- **Avoids `self-improve` importing from `agent-builder/deps.ts`**, which pulls in the
  AI SDK, model manager, registry, MCP config, embedder, etc. — the re-eval engine
  stays light and provider-agnostic.
`deps.ts` now imports `modelFamily` from `judge.ts` (its two call sites `toJudgeCandidate`
and the verify-deps `generatorFamily` are unchanged); the local copy was deleted.
No logic duplicated.

## TDD RED → GREEN
**RED** (before impl existed):
```
$ bun run test:file -- "tests/self-improve/reeval.test.ts"
error: Cannot find module '../../src/self-improve/reeval.ts'
 0 pass / 1 fail / 1 error
```
**GREEN** (after impl):
```
$ bun run test:file -- "tests/self-improve/reeval.test.ts"
 4 pass / 0 fail / 8 expect() calls
```
Tests (all mocked, no real model): (a) missing golden → `skipped(NoGolden)` **and
`resolve` never called**; (b) below-bar judge candidate (1e9 < 24e9 bar) →
`skipped(JudgeUnavailable)`, no EvalResult; (c) real eval → `evaluated` carrying
`result.passed===true` + `resolved.decl.model==='B:7b'`; (d) extra guard —
`runCase` receives the artifact `name` as its `ref` (proves no regen path; the name
is the run ref).

## Gate (all three + regression)
```
$ bun run typecheck                       # clean (fixed EvalResult import: it lives in
                                          #   verified-build/types.ts, not re-exported by eval.ts)
$ bun run lint:file -- src/self-improve/reeval.ts tests/self-improve/reeval.test.ts \
      src/verified-build/judge.ts src/agent-builder/deps.ts   # Checked 4 files. No fixes applied.
$ bun test tests/self-improve/reeval.test.ts tests/verified-build/judge.test.ts   # 9 pass / 0 fail
$ bun test tests/agent-builder/{deps,builder,gate-integration}.test.ts            # 34 pass / 0 fail
```
The `modelFamily` move is confirmed regression-free by the judge + agent-builder suites.

## Files changed
- **NEW** `src/self-improve/reeval.ts` — the engine (`reevalArtifact`, `ReevalSkip`,
  `ReevalOutcome`, `ReevalDeps`, `ResolvedModel`).
- **NEW** `tests/self-improve/reeval.test.ts` — 4 unit tests.
- `src/verified-build/judge.ts` — added exported `modelFamily`.
- `src/agent-builder/deps.ts` — import `modelFamily` from `judge.ts`; deleted the private copy.

## Self-review
- No `stage/structural/dryRun/makeGolden/verifyAndCommit` coupling — by design (only
  `loadGolden` + `runGoldenEval`). Test (d) locks the no-regen property.
- Degrade paths exact: `NoGolden` short-circuits before resolve; `JudgeUnavailable`
  maps the `runGoldenEval` `null` (below-bar OR caught `JudgeUnavailableError`).
- Provider/runtime-agnostic: everything through injected `resolve`/`runCase`/`judge`.
- `judge` passed straight through — `runGoldenEval` binds the selected judge-model id
  into each call, so the `(model, prompt)` shape is preserved unchanged.

## Concerns
- None blocking. Note for the D4/scheduler task: `reevalArtifact` deliberately returns
  `skipped` (not a `regressed`/`demote` verdict) on missing-golden / below-bar-judge —
  the diff-vs-baseline and demote/record decisions are the caller's, exactly as the
  brief specifies. `ResolvedModel`/`ReevalDeps` are exported for that wiring.
- Doc gate: `docs:check` passed on commit (self-improve subsystem already documented in
  architecture.md from an earlier task); no architecture.md edit needed for a new file
  within an already-documented subsystem. README/ROADMAP/ledger updates happen at slice
  close, not per mid-slice task.
