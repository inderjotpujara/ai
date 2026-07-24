# Task 6 report (Slice 32) — extract shared `runGoldenEval` binding

## Summary
Factored the duplicated golden-eval BINDING (selectJudge → build `EvalDeps` →
`evalCases`, with JudgeUnavailableError → degrade-to-null) out of both builders
into ONE shared helper `runGoldenEval` in `src/verified-build/eval.ts`. Both
builders' `goldenEval` closures now delegate to it. Behavior-preserving.

Commit: `121d833 refactor(verified-build): extract shared runGoldenEval binding`

## Closures' equivalence analysis (verified before designing the signature)
Read both closures side by side (`src/agent-builder/builder.ts:206-246`,
`src/crew-builder/builder.ts:244-283`). Byte-identical EXCEPT the `runCase` body:
- Agent: `withWallClock(dryRunMs(), () => verify.runAgent(agent, input, AbortSignal.timeout(dryRunMs())))`
- Crew:  `withWallClock(dryRunMs(), () => verify.runArtifact(runnable, shape, input))`

Everything else identical: same `selectJudge({candidates, generatorFamily})`,
same `if (model === null) return null`, same `evalCases(cases, {runCase, judge:
(prompt)=>verify.judge(prompt, judgeModelId), judgeModel, belowBar})`, same
`catch (JudgeUnavailableError) → return null; else throw`.

Conclusion: safely unifiable. The ONLY divergence (runAgent w/ AbortSignal vs
runArtifact w/ shape) lives entirely inside `runCase`, which the helper takes as a
parameter — parameterized cleanly, not papered over. The judge argument-order
difference (`verify.judge(prompt, model)`) is absorbed by the caller's adapter
`judge: (model, prompt) => verify.judge(prompt, model)` matching the helper's
`GoldenEvalBinding.judge: (model, prompt) => Promise<boolean>`.

## Helper design (reusable primitive for Task 7)
```ts
export type GoldenEvalBinding = {
  cases: GoldenCase[];
  judgeCandidates: () => JudgeCandidate[];
  generatorFamily?: string;
  runCase: (input: string) => Promise<string>;
  judge: (model: string, prompt: string) => Promise<boolean>;
};
export async function runGoldenEval(b: GoldenEvalBinding): Promise<EvalResult | null>;
```
Task 7's `reevalArtifact` can call this with a resolved model + a loaded golden
(pass `golden.cases` as `cases`, its own `judgeCandidates`/`generatorFamily`, its
own `runCase`/`judge`) — no regeneration, no gate coupling. Task 7's logic is NOT
built here.

## One intentional deviation (noted)
The old closures emitted `console.error('[verify] judge model unavailable …')` in
the JudgeUnavailableError branch. The shared helper (per the task brief's canonical
implementation) omits it. Rationale: (a) the brief's spec omits it; (b) the repo's
no-console rule; (c) gate.ts already records the degrade as telemetry
(`VERIFY_JUDGE_BELOW_BAR: true` + `golden_eval {skipped:true}`), so it stays
observable; (d) no test asserts on the log line. The eval RESULT semantics (null on
degrade) are byte-for-byte identical.

## TDD
RED — added `describe('runGoldenEval')` (5 tests: qualifying→EvalResult+judgeModel,
C3 judge-binding uses the cross-family pick, below-bar→null, JudgeUnavailableError→
null, other errors propagate) to `tests/verified-build/eval.test.ts`:
```
$ bun run test:file -- "tests/verified-build/eval.test.ts"
SyntaxError: Export named 'runGoldenEval' not found … eval.ts
 0 pass / 1 fail / 1 error
```
GREEN — after implementing the helper + rewriting both closures:
```
$ bun run test:file -- "tests/verified-build/eval.test.ts" \
    "tests/agent-builder/gate-integration.test.ts" \
    "tests/crew-builder/gate-integration.test.ts"
 36 pass / 0 fail / 126 expect() calls / 3 files
```
Both gate-integration suites (the regression net proving behavior preserved, incl.
"judge model that cannot be loaded degrades to runs", "below-bar", and "judge runs
on the model selectJudge picked") pass UNCHANGED.

## Gate
```
$ bun run typecheck   → tsc --noEmit, clean
$ bun run lint:file -- src/verified-build/eval.ts src/agent-builder/builder.ts \
    src/crew-builder/builder.ts tests/verified-build/eval.test.ts
  Checked 4 files, no fixes applied.
```

## Files changed
- `src/verified-build/eval.ts` — added `GoldenEvalBinding` type + `runGoldenEval`; imports `selectJudge`/`JudgeUnavailableError`/`JudgeCandidate` from `./judge.ts`.
- `src/agent-builder/builder.ts` — `goldenEval` delegates; import `runGoldenEval` (was `evalCases`), dropped now-unused `JudgeUnavailableError` (kept `selectJudge` — still used by `makeGolden`).
- `src/crew-builder/builder.ts` — symmetric.
- `tests/verified-build/eval.test.ts` — new `runGoldenEval` suite.

## Self-review / concerns
- `makeGolden` in both builders still calls `selectJudge` independently (unchanged
  by this task) — a separate below-bar gate, out of scope here.
- Pure extraction; no signature change to `evalCases`/`EvalDeps`/`GateDeps`, so no
  other callers touched. docs-check passed in pre-commit.
