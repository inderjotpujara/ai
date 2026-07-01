## Task 9: Workflow verify wiring

**Files:** Modify `src/workflow/types.ts` (`AgentStep.verify?`) + `src/workflow/run-step.ts`/`engine.ts` or a `withVerification(step)` helper; Test `tests/workflow/verify-wiring.test.ts`

- [ ] **Step 1–5:** Mirror Task 8 for the workflow path: an `AgentStep.verify?: boolean` (or a `withVerification(step, {space})` helper in `src/workflow`) expands at `defineWorkflow` time to the same verify→branch→corrective→abstain sub-graph. Test: a workflow step with `verify` + failing judge routes to the abstain terminal. Commit `feat(workflow): opt-in verify step expansion`.
> If crew already compiles to a workflow, prefer implementing the expansion ONCE as a shared `src/verification/expand.ts` helper used by both compilers (DRY). Decide in Task 8 and reuse here.

---

