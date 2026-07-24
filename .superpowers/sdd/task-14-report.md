# Task 14 report — `applyRegressionOutcome` (Slice 32, D5 action)

> Note: this path previously held a superseded report for an unrelated "Task 14"
> (Slice 25b `isLoopbackHost`). Overwritten here per this task's instruction to
> write the Slice-32 Task-14 report to this exact path.

## Files changed
- Created `src/self-improve/action.ts` — the D5 action orchestrator.
- Created `tests/self-improve/action.test.ts` — 6 unit tests (fake store + fake upsert).

## Action sequence as implemented
`applyRegressionOutcome(input, deps): { demoted: boolean }` — thin, injected-deps orchestration.

On EVERY verdict:
1. Append one `eval_history` row via `deps.history.insert`:
   `{ id: randomUUID(), artifactId: name, model: currentModel, baselineModel, ts: (deps.now ?? Date.now)(), passed, passedCount, total, regressed: verdict===Regression, perCase: result.perCase, judgeModel, belowBar, reason }`.
   `baselineModel`/`reason` pass through as-is (left `undefined` when omitted → history layer stores NULL).

IF `outcome.verdict === RegressionVerdict.Regression` (exact order):
2. `deps.upsertEntry(dir, name, { ...entry, verifiedLevel: VerifiedLevel.Unverified, lastEvalPass: false })` — Behaves→Unverified demote. Atomic (upsertEntry uses `atomicWrite`) and idempotent (already-Unverified → same safe re-write).
3. `recordDegrade({ kind: DegradeKind.ModelDegraded, subject: name, reason: 'golden re-eval regression on model swap', from: baselineModel ?? '', to: currentModel })`.
4. `recordEvalRegression({ artifact: name, regressedCount: outcome.regressedCaseIds.length, drop: outcome.drop, from: baselineModel ?? '', to: currentModel })`.
5. return `{ demoted: true }`.

ELSE (Pass / WithinNoise / Inconclusive): row recorded, then early-return `{ demoted: false }` — no demote, no degrade, no `eval.regression`.

No auto-repair, no re-route, no regeneration.

## Degrade-never-crash / no-PII
- Crash-safety comes from `upsertEntry`'s `atomicWrite` (temp-then-rename) — no half-written manifest possible; the orchestrator stays thin and does NOT swallow errors with a speculative try/catch (would hide real failures; not specified by the brief).
- `recordDegrade`/`recordEvalRegression` are no-ops with no active tracer span, so the action is safe to call outside a span.
- `eval.regression` span carries artifact name, regressedCount, drop, and from/to model ids only — never golden case text or raw output.

## TDD RED → GREEN
- RED: `bun run test:file -- "tests/self-improve/action.test.ts"` → `Cannot find module '../../src/self-improve/action.ts'` (0 pass, 1 fail, 1 error).
- GREEN after implementing: `6 pass, 0 fail, 26 expect() calls`.

Tests: Regression → demoted:true + exact row fields (regressed:true, model B:7b, baselineModel A:7b, ts 5, perCase length 3, string id) + upsertCalls===1 + verifiedLevel Unverified + lastEvalPass false; WithinNoise → row regressed:false, upsertCalls===0, demoted:false; Pass → row + no demote; Inconclusive → row (belowBar:true) + no demote; idempotent demote on already-Unverified entry (demoted:true, no throw); omitted baselineModel/reason left undefined on the row.

## Gate (all three green)
- `bun run typecheck` → clean.
- `bun run lint:file -- src/self-improve/action.ts tests/self-improve/action.test.ts` → No fixes applied (biome autofix applied import-sort + wrapping during dev, then clean).
- `bun run test:file -- "tests/self-improve/action.test.ts"` → 6 pass / 0 fail.

## Self-review
- Matches brief interface exactly (`ApplyDeps`, `applyRegressionOutcome` signature, row shape, effect order). Extracted a named `ApplyInput` type for readability (brief inlined it) — no behavioral difference.
- `regressed` flag derived once and reused for both the row and the branch, so they can never disagree.

## Concerns
- None blocking. The degrade-never-crash guarantee is satisfied structurally by `atomicWrite` rather than a try/catch. If a later task wants a degrade recorded on an insert/upsert *throw*, that is an additive change (not required for D5 as specified).
- Span-attribute emission is only exercised live under an active span (out of scope for this unit test, per brief's "just assert they don't throw").
