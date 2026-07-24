### Task 8: `EvalMode` + `EvalJobPayloadSchema` + dispatch case + turn wiring

**Files:**
- Modify: `src/server/jobs/dispatch.ts` (`EvalMode` enum + `EvalJobPayloadSchema` + `case JobKind.Eval` in `buildExecutor` + `RunEvalTurn` on `JobDispatchDeps:43`), `src/server/launch-turns.ts` (`createRealRunEvalTurn`), `src/cli/daemon.ts` (`buildRealDaemon` `createJobDispatch({…})` call ~line 175), `src/server/main.ts` (its own `createJobDispatch` construction)
- Test: `tests/server/jobs/dispatch.test.ts` (extend), `tests/self-improve/eval-turn.test.ts`

**Interfaces:**
- Consumes: `runEval` from `../../self-improve/executor.ts` — **NOT YET BUILT** (Task 14/16). To keep this task independently testable, wire the dispatch case to call an injected `RunEvalTurn` dep that Task 14 fills with the real executor; here it is exercised with a fake.
- Produces:
  ```ts
  // src/server/jobs/dispatch.ts — NEW
  export enum EvalMode { Sweep = 'sweep', AffectedByPull = 'affected-by-pull', Artifact = 'artifact' }
  const EvalJobPayloadSchema = z.object({
    mode: z.enum(EvalMode),
    ref: z.string().min(1).optional(),   // required iff mode === Artifact
    reason: z.string().optional(),       // 'sweep' | 'pull:<ref>' | 'manual'
  });
  // On JobDispatchDeps (dispatch.ts:43), add:
  //   runEvalTurn?: RunEvalTurn;  // optional so pre-Slice-32 dispatch fixtures compile
  export type RunEvalTurn = (input: {
    mode: EvalMode; ref?: string; reason?: string; runId: string; signal?: AbortSignal;
  }) => Promise<OrchestratorResult>;
  ```
  `case JobKind.Eval`: `const { mode, ref, reason } = EvalJobPayloadSchema.parse(job.payload); if (!deps.runEvalTurn) throw new Error('eval job but no runEvalTurn dep is wired'); return deps.runEvalTurn({ mode, ref, reason, runId: requireRunId(job), signal });` (mirrors the `a2aRef` fail-fast at `dispatch.ts:200`). `EvalMode.Artifact` with no `ref` is a permanent defect — `EvalJobPayloadSchema` refine: `.refine(p => p.mode !== EvalMode.Artifact || !!p.ref, 'ref required for mode=artifact')`.

- [ ] **Step 1: Write the failing tests** — the dispatch maps an eval payload to `runEvalTurn`; a bad payload throws; a missing dep throws:

```ts
test('Eval job dispatches to runEvalTurn with the parsed mode/ref', async () => {
  const calls: unknown[] = [];
  const dispatch = createJobDispatch({ /* fakes */ runEvalTurn: async (i) => { calls.push(i); return { kind: 'answer', text: 'ok' }; } } as never);
  const exec = dispatch(JobKind.Eval);
  await exec({ payload: { mode: 'artifact', ref: 'file_qa' }, runId: 'r1' } as never, undefined as never);
  expect(calls[0]).toMatchObject({ mode: 'artifact', ref: 'file_qa', runId: 'r1' });
});
test('Eval job with mode=artifact and no ref is a permanent defect (throws)', async () => { /* EvalJobPayloadSchema.parse throws */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — add the enum/schema/case/dep. Add `createRealRunEvalTurn(runsRoot): RunEvalTurn` to `src/server/launch-turns.ts` that opens a run via `withRunTelemetry`/`withMcpRun` (root span `eval.reeval` so `deriveRunKind` classifies it) and calls `runEval(...)` (import from `../self-improve/executor.ts` — **this import lands with Task 16; until then, stub `createRealRunEvalTurn` to throw `new Error('runEval not wired until Task 16')` and DO NOT wire it into the daemon/server yet**). Wire `runEvalTurn: createRealRunEvalTurn(runsRoot)` into BOTH `buildRealDaemon` (`src/cli/daemon.ts` `createJobDispatch({…})`) and `src/server/main.ts`'s `createJobDispatch` in Task 16 (not here — this task only lands the dispatch seam + the fake-tested case).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/jobs/dispatch.ts src/server/launch-turns.ts tests/server/jobs/dispatch.test.ts`.

```bash
git add src/server/jobs/dispatch.ts src/server/launch-turns.ts tests/server/jobs/dispatch.test.ts
git commit -m "feat(queue): Eval dispatch case + EvalMode/EvalJobPayloadSchema + RunEvalTurn seam"
```

*Model: Opus (dispatch/turn wiring is the queue→execution seam; the fail-fast on a missing dep must not silently fall through).*

