## Task 4: Migrate `flow` CLI to `withMcpRun`

**Files:**
- Modify: `src/cli/flow.ts` (`FlowDeps` 30-42, `runFlow` 73-112, `main` 125-194)
- Test: `tests/cli/flow.test.ts`, `tests/integration/workflow.live.test.ts`

**Interfaces:**
- Consumes: `withMcpRun` from Task 3; `createRun`/`initRunTelemetry` (for the test wrapper only).
- Produces: `FlowDeps` now has `run: RunHandle` in place of `runsRoot`/`runId`; `runFlow` no longer creates the run or initializes/tears down telemetry.

- [ ] **Step 1: Update the failing test first (RED via signature)**

In `tests/cli/flow.test.ts`, each case currently passes `runsRoot`/`runId` to `runFlow` and then reads `join(runsRoot, runId, 'spans.jsonl')`. Migrate every `runFlow({...})` call. Add imports at the top:

```typescript
import { createRun } from '../../src/run/run-store.ts';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
```

Replace each call site of the form:

```typescript
const outcome = await runFlow({ def, input, runsRoot, runId: 'r1', agents, tools /*, ...*/ });
```

with:

```typescript
const run = await createRun(runsRoot, 'r1');
const tel = initRunTelemetry(run.dir);
let outcome;
try {
  outcome = await runFlow({ def, input, run, agents, tools /*, ...*/ });
} finally {
  await tel.shutdown();
}
```

Keep the existing `readFile(join(runsRoot, 'r1', 'spans.jsonl'), ...)` and `result.txt`/`failed.txt`/`unverified.txt` assertions unchanged (paths still resolve because the test now owns `createRun`). Apply the same transform to the `r2` and `r3` cases (using their respective ids).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/flow.test.ts`
Expected: FAIL — type error / runtime: `runFlow` still destructures `deps.runsRoot`/`deps.runId` and calls `createRun` internally (double-create), and `FlowDeps` has no `run`.

- [ ] **Step 3: Update `FlowDeps` and `runFlow` in `src/cli/flow.ts`**

Change the `FlowDeps` fields (lines 33-34) from:

```typescript
  runsRoot: string;
  runId: string;
```

to:

```typescript
  run: RunHandle;
```

Add the import for `RunHandle` (extend the existing `run-store` import on line 10):

```typescript
import { type RunHandle, createRun, writeArtifact } from '../run/run-store.ts';
```

> `createRun` stays imported because `main()` no longer uses it — remove `createRun` from this import if lint flags it unused after Step 5; keep `writeArtifact`.

Replace `runFlow` (lines 73-112) so it uses `deps.run` and does NOT init/teardown telemetry:

```typescript
/** Run a workflow with telemetry + artifact persistence (mirrors runChat).
 *  Telemetry + the run dir are established by the caller (withMcpRun). */
export async function runFlow(deps: FlowDeps): Promise<WorkflowOutcome> {
  const { run } = deps;
  const def = deps.verifyDeps
    ? defineWorkflow(withVerifyFlags(deps.def), { verifyDeps: deps.verifyDeps })
    : deps.def;
  return await withWorkflowSpan(def.id, async () => {
    const outcome = await runWorkflow(def, deps.input, {
      runAgentStep: defaultRunAgentStep(deps.agents, deps.onBeforeDelegate),
      tools: deps.tools,
    });
    annotateStep({ [ATTR.WORKFLOW_OUTCOME]: outcome.kind });
    if (outcome.kind === 'done') {
      await writeArtifact(run, 'result.txt', lastStepOutputText(deps.def, outcome.output));
    } else if (outcome.kind === 'unverified') {
      await writeArtifact(
        run,
        'unverified.txt',
        `step ${outcome.failedStepId ?? '?'} abstained (faithfulness ${outcome.faithfulness}); unsupported claims:\n${outcome.unsupportedClaims.join('\n')}\n\ndraft:\n${outcome.draft}`,
      );
    } else {
      await writeArtifact(run, 'failed.txt', `step ${outcome.failedStep}: ${outcome.message}`);
    }
    return outcome;
  });
}
```

Remove the now-unused imports `createRun` (if unused) and `initRunTelemetry` from lines 10-11 (keep `writeArtifact`; `initRunTelemetry` is no longer referenced here).

- [ ] **Step 4: Rewire `main()` to use `withMcpRun`**

Add the import:

```typescript
import { withMcpRun } from './with-mcp-run.ts';
```

Remove the now-unused imports in `main`'s path: `loadMcpConfig`, `mountAll` (keep `warnUnknownAgents`), `withMcpMountSpan`. Then replace the body of `main()` from the mount block through the outer `finally` (current lines 138-193) with:

```typescript
  await withMcpRun(
    { runsRoot: 'runs', runId: `flow-${process.pid}` },
    async ({ run, reg, config }) => {
      const selection = await createSelectionRuntime();
      try {
        const tools: ToolSet = reg.merged;
        const agents: Record<string, Agent> = {};
        const fileQa = createFileQaAgent(reg.forAgent('file_qa'));
        const webFetch = createWebFetchAgent(reg.forAgent('web_fetch'));
        agents[fileQa.name] = fileQa;
        agents[webFetch.name] = webFetch;
        warnUnknownAgents(config, Object.keys(agents), (m) => console.error(m));

        const verifyRuntime = verify ? makeRealVerifyDeps() : undefined;
        try {
          const outcome = await runFlow({
            def,
            input: positional.join(' ').trim(),
            run,
            agents,
            tools,
            onBeforeDelegate: selection.onBeforeDelegate,
            verifyDeps: verifyRuntime?.verifyDeps,
          });
          if (outcome.kind === 'done') {
            console.log(lastStepOutputText(def, outcome.output));
          } else if (outcome.kind === 'unverified') {
            console.error(
              `Workflow abstained at ${outcome.failedStepId ?? '?'} (unverified, faithfulness ${outcome.faithfulness}): ${outcome.unsupportedClaims.join('; ')}`,
            );
            process.exitCode = 1;
          } else {
            console.error(`Workflow failed at ${outcome.failedStep}: ${outcome.message}`);
            process.exitCode = 1;
          }
        } finally {
          if (verifyRuntime) {
            verifyRuntime.store.close();
            await verifyRuntime.manager.unloadAll();
          }
        }
      } finally {
        await selection.close();
      }
    },
  );
```

- [ ] **Step 5: Migrate `tests/integration/workflow.live.test.ts`**

Apply the same transform as Step 1 to its single `runFlow({ runsRoot, runId: 'live', ... })` call (create the run + init telemetry around it, pass `run`). This test is `describe.skipIf`-gated on Ollama; the transform is mechanical.

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test tests/cli/flow.test.ts` (expect PASS), then `bun run typecheck` (expect clean).

- [ ] **Step 7: Lint + commit**

Run: `bun run lint:file -- "src/cli/flow.ts" "tests/cli/flow.test.ts" "tests/integration/workflow.live.test.ts"`.

```bash
git add src/cli/flow.ts tests/cli/flow.test.ts tests/integration/workflow.live.test.ts
git commit -m "refactor(cli): flow uses withMcpRun; runFlow takes run:RunHandle (Slice 16 Task 4)"
```

---

