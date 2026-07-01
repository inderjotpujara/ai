# Task 8 Report — Crew auto-insertion of grounded-verification sub-graph

**Status: DONE**

## What was built

When a crew task sets `verify: true` (or `CrewDef.verify: true` crew-wide), the
sequential compiler splices a grounded-verification sub-graph in right after the
task's answer step. Fully additive: a task/crew without `verify`, or a run without
injected `verifyDeps`, compiles byte-for-byte as before.

## Sub-graph shape

For answer step `T` with `R = verifyMaxRetries()` (default 1), one gate per attempt:

```
T                (answer — existing AgentStep, unchanged)
T__verify   Verify   verify(ctx[T])                     -> Verdict
T__branch   Branch   supported? whenTrue T__pass / whenFalse T__corrective
T__pass     Verify(pass)   no-op terminal (accept original answer)
T__corrective Verify(corrective)  rewrite→re-recall→re-answer -> string (re-answer)
T__verify2  Verify   verify(ctx[T__corrective])         -> Verdict
T__branch1  Branch   supported? whenTrue T__pass1 / whenFalse T__abstain
T__pass1    Verify(pass)   no-op terminal (accept corrective answer)
T__abstain  Verify(abstain)  writes UnverifiedMarker    -> marker
```

- With `R` retries the `(corrective → verify → branch)` block is a **fixed
  unrolled chain**, not a loop. The **final** gate's `whenFalse` is the single
  `T__abstain` terminal.
- `R = 0` collapses to `verify → branch → (pass | abstain)`.
- Naming matches the brief: `__verify`, `__branch`, `__corrective`, `__verify2`,
  `__abstain` (extra gates suffixed `__branchN`, `__passN`, `__verifyN`).

### Why a new StepKind instead of hacking AgentStep
The engine's Branch predicate is **synchronous** and reads `ctx`, but `verify()`
and the corrective re-answer are **async** and need structured (Verdict) output —
they don't fit the Agent (`string→string`) contract. Rather than fight the model
(the brief's escape hatch), I added **one cohesive new kind `StepKind.Verify`**
carrying a self-contained `run(ctx, deps) => Promise<O>` closure. The engine's
`runStepByKind` gets exactly one new case that just invokes the closure; all
existing kinds (Agent/Tool/Branch/Map) are untouched. Branch is reused as-is for
the supported? decisions. This kept the engine change minimal and additive while
letting verify logic stay fully structured.

### How abstain surfaces as an outcome
The `abstain` op writes an `UnverifiedMarker` (`{__unverified:true, answerStepId,
unsupportedClaims, faithfulness, draft}`) into the workflow context. `runCrew`
scans the finished context (`findUnverified`) and, if present, returns
`{kind:'unverified', failedTaskId, unsupportedClaims, faithfulness, draft}`.
The engine's existing dead-arm skip-propagation means only the taken path's
terminal exists in `ctx`, so at most one marker is present.

## `expand.ts` signature for Task 9 (workflow path reuse)

```ts
// src/verification/expand.ts
export type ExpandVerificationOpts = {
  answerStepId: string;                       // step whose output is the answer
  answerAgent: string;                        // agent to re-run for corrective re-answer
  space: string;                              // memory space for evidence + re-recall
  verifyDeps: VerifyDeps;                     // injected judge/decompose/getByIds
  query?: (ctx: WorkflowContext) => string;  // derive query; default String(ctx.input)
  maxRetries?: number;                        // default verifyMaxRetries()
  threshold?: number;                         // forwarded to verify()
};

export function expandVerification(opts: ExpandVerificationOpts): Step[];

// Marker + guard the engine uses to detect abstention:
export type UnverifiedMarker = {
  __unverified: true; answerStepId: string;
  unsupportedClaims: string[]; faithfulness: number; draft: string;
};
export function isUnverifiedMarker(v: unknown): v is UnverifiedMarker;
```

Returned steps are appended **after** the caller's own answer step (the caller
keeps ownership of `T`). Task 9 (workflow) calls the identical helper; the
recall/re-answer deps flow through `WorkflowDeps.recall` + `WorkflowDeps.runAgentStep`.

## Threading the deps

- `CrewDeps` gained (all optional, injectable): `verifyDeps?`, `recall?`,
  `verifySpace?`, `verifyMaxRetries?`, `verifyThreshold?`. `verifyDeps` being
  present is what *activates* any `verify` flag — absent = flags inert (today's path).
- `WorkflowDeps` gained `recall?`. `runStepByKind` hands `{runAgentStep, recall}`
  (typed `WorkflowVerifyDeps`) to each Verify closure at execution time, so the
  corrective op can re-run the answering agent and re-recall evidence.
- The real Ollama-backed `VerifyDeps` are **NOT** built here — that's Task 10.
  Tests inject a fake whose judge (Yes/No) is controllable.

## Backward-compat evidence
- Test `no verify flag → unchanged`: outcome `done`, `ctx.t1` is the raw answer,
  and `verifyDeps.generate` is asserted **never called** (0 invocations).
- Existing `tests/crew/*` + `tests/workflow/*` + `tests/verification/*`: **51 pass, 0 fail**.
- `compileToWorkflow(crew)` with no second arg = original mapping (Agent steps only).
- Full suite: **276 pass / 18 skip / 0 fail** (294 tests, 99 files).
- `tsc --noEmit` clean; `biome check` clean on all 8 changed files; `docs:check` passes.

## TDD RED → GREEN
- RED: `tests/crew/verify-wiring.test.ts` written first — `verify:true` + failing
  judge asserted `unverified`; initial run failed (`Expected "unverified" Received
  "done"`), other 3 passed vacuously.
- GREEN: after implementing types + `expand.ts` + compile/engine wiring, all 4
  pass (10 expect calls), including the gate-1-fails / corrective-recovers → `done` path.

## Files
- `src/crew/types.ts` — `Task.verify?`, `CrewDef.verify?`, `CrewOutcome |unverified`.
- `src/workflow/types.ts` — `StepKind.Verify`, `VerifyStep`, `WorkflowVerifyDeps`.
- `src/workflow/run-step.ts` — `WorkflowDeps.recall?` + Verify dispatch case.
- `src/verification/expand.ts` — **new**, shared `expandVerification()` + marker.
- `src/crew/compile.ts` — `compileToWorkflow(crew, verifyOpts?)` splices sub-graph.
- `src/crew/engine.ts` — `CrewDeps` verify fields, `findUnverified`, outcome mapping.
- `src/cli/crew.ts` — handle the new `unverified` outcome (typecheck-forced; real
  CLI deps are Task 10).
- `tests/crew/verify-wiring.test.ts` — **new**, 4 tests.

## Concerns / limitations
1. **Corrective path IS implemented** (rewrite → re-recall via `deps.recall` →
   re-answer via `runAgentStep` → re-verify), and covered by the recovery test.
   When `deps.recall` is absent, corrective re-answers *without* fresh retrieval
   (re-answer only) — deliberate graceful degradation.
2. **Mid-crew verified tasks**: verification is designed for the final/answer
   task. If a *non-final* task abstains, `ctx[T]` still holds the (bad) answer, so
   downstream tasks that depend on `T` will still run on it; the crew outcome is
   nonetheless `unverified` (first marker wins). Recommend keeping `verify` on the
   terminal task until a follow-up adds downstream short-circuiting. Noted for the
   slice's architecture-doc update.
3. **Docs**: `docs:check` passes (verification subsystem already documented; new
   file is under it). The full architecture.md / README / ROADMAP / Artifact
   slice-landing updates are the slice's concern, not this single task, and the
   pre-push slice-landing gate will enforce them at push time.
4. Committed on branch `slice-13-task-8-verify-wiring` (was on `main`; auto-branched).
