## Task 8: Crew auto-insertion (`verify` flag → verify/branch/corrective/abstain)

**Files:** Modify `src/crew/types.ts` (`Task.verify?`, `CrewDef.verify?`, `CrewOutcome` +`unverified`), `src/crew/compile.ts` (insert steps), `src/crew/engine.ts` (map outcome); Test `tests/crew/verify-wiring.test.ts`

**Interfaces:** Consumes verify primitive + workflow Branch step. Produces the compiled sub-graph + `{kind:'unverified'}` outcome.

> Read `src/crew/compile.ts` + `src/workflow/types.ts` (BranchStep: `predicate`/`whenTrue`/`whenFalse`) first. Keep additive: a task without `verify` compiles exactly as today.

- [ ] **Step 1: Failing test** (mock models via injected deps; assert an unsupported answer yields `unverified`)
```ts
// tests/crew/verify-wiring.test.ts  (sketch — align to runCrew's real deps shape)
import { describe, expect, test } from 'bun:test';
import { runCrew } from '../../src/crew/engine.ts';
// Build a 1-task crew with verify:true, inject a verifyDeps whose judge always says "No"
// → expect outcome.kind === 'unverified' with unsupportedClaims non-empty.
```
> Flesh out against `runCrew`'s real signature; the assertion is: `verify:true` + failing judge → `{kind:'unverified'}`; `verify:true` + passing judge → `{kind:'done'}`; no `verify` → unchanged.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add flags + outcome** to `src/crew/types.ts`:
```ts
// Task<O>: add `verify?: boolean;`
// CrewDef: add `verify?: boolean;` (applies to the final/answer task)
// CrewOutcome union: add:
| { kind: 'unverified'; failedTaskId?: string; unsupportedClaims: string[]; faithfulness: number; draft: string }
```
- [ ] **Step 4: Insert the sub-graph** in `src/crew/compile.ts`: for a task with `verify`, after its AgentStep append a verify step (calls the primitive with the task output + query), a Branch on `supported`, a corrective+re-answer+verify₂ path (bounded by `verifyMaxRetries()`), and an abstain terminal. Map the abstain terminal's result to the `unverified` outcome in `src/crew/engine.ts`.
> This is the largest task; keep the inserted steps small + named (`<taskId>__verify`, `__branch`, `__corrective`, `__verify2`, `__abstain`). Reuse `effectiveTaskDeps`/context threading. If the branch/corrective wiring gets unwieldy, STOP and report DONE_WITH_CONCERNS with the sub-graph shape for review.

- [ ] **Step 5: Run tests + full suite** (existing crew tests unchanged) → PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(crew): opt-in verify → branch + bounded CRAG + unverified abstention"`

---

