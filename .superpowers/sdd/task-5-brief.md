## Task 5: Migrate `crew` CLI to `withMcpRun`

**Files:**
- Modify: `src/cli/crew.ts` (`CrewCliDeps` 14-25, `runCrewCli` 28-62, `main` 76-141)
- Test: `tests/cli/crew.test.ts`, `tests/integration/crew.live.test.ts`

**Interfaces:**
- Consumes: `withMcpRun` (Task 3).
- Produces: `CrewCliDeps` has `run: RunHandle` in place of `runsRoot`/`runId`; `runCrewCli` no longer creates the run or manages telemetry.

- [ ] **Step 1: Migrate `tests/cli/crew.test.ts` (RED)**

Add imports:

```typescript
import { createRun } from '../../src/run/run-store.ts';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
```

For each `runCrewCli({ ..., runsRoot, runId: 'rN', ... })` (cases `r1`, `r2`, `r3`), wrap exactly as in Task 4 Step 1:

```typescript
const run = await createRun(runsRoot, 'r1');
const tel = initRunTelemetry(run.dir);
let outcome;
try {
  outcome = await runCrewCli({ def, input, run, tools /*, ...*/ });
} finally {
  await tel.shutdown();
}
```

Leave the `join(runsRoot, 'r1', 'spans.jsonl')` / `result.txt` / `unverified.txt` assertions unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/crew.test.ts`
Expected: FAIL — `CrewCliDeps` has no `run`; `runCrewCli` still calls `createRun` on `deps.runsRoot`.

- [ ] **Step 3: Update `CrewCliDeps` + `runCrewCli` in `src/cli/crew.ts`**

Replace `runsRoot: string; runId: string;` (lines 17-18) with `run: RunHandle;`. Extend the import on line 7:

```typescript
import { type RunHandle, writeArtifact } from '../run/run-store.ts';
```

Rewrite `runCrewCli` (lines 28-62) to use `deps.run` and drop telemetry ownership:

```typescript
/** Run a crew with telemetry + artifact persistence (mirrors runFlow).
 *  Telemetry + the run dir are established by the caller (withMcpRun). */
export async function runCrewCli(deps: CrewCliDeps): Promise<CrewOutcome> {
  const { run } = deps;
  const def = deps.verifyDeps ? { ...deps.def, verify: true } : deps.def;
  const outcome = await runCrew(def, deps.input, {
    tools: deps.tools,
    onBeforeDelegate: deps.onBeforeDelegate,
    runAgentStep: deps.runAgentStep,
    verifyDeps: deps.verifyDeps,
  });
  if (outcome.kind === 'done') {
    const text =
      typeof outcome.output === 'string'
        ? outcome.output
        : JSON.stringify(outcome.output, null, 2);
    await writeArtifact(run, 'result.txt', text);
  } else if (outcome.kind === 'unverified') {
    await writeArtifact(
      run,
      'unverified.txt',
      `task ${outcome.failedTaskId ?? '?'} abstained (faithfulness ${outcome.faithfulness}); unsupported claims:\n${outcome.unsupportedClaims.join('\n')}\n\ndraft:\n${outcome.draft}`,
    );
  } else {
    await writeArtifact(run, 'failed.txt', `task ${outcome.failedTask ?? '?'}: ${outcome.message}`);
  }
  return outcome;
}
```

Remove the now-unused imports `createRun` and `initRunTelemetry` (lines 7-8). Remove `loadMcpConfig` (line 5), `mountAll` (line 6), `withMcpMountSpan` (line 9) once `main` is rewired in Step 4.

- [ ] **Step 4: Rewire `main()` to use `withMcpRun`**

Add `import { withMcpRun } from './with-mcp-run.ts';`. Replace the mount block through the outer `finally` (lines 89-140) with:

```typescript
  await withMcpRun(
    { runsRoot: 'runs', runId: `crew-${process.pid}` },
    async ({ run, reg }) => {
      const selection = await createSelectionRuntime();
      try {
        const tools: ToolSet = reg.merged;
        const verifyRuntime = verify ? makeRealVerifyDeps() : undefined;
        try {
          const outcome = await runCrewCli({
            def,
            input: positional.join(' ').trim(),
            run,
            tools,
            onBeforeDelegate: selection.onBeforeDelegate,
            verifyDeps: verifyRuntime?.verifyDeps,
          });
          if (outcome.kind === 'done') {
            console.log(
              typeof outcome.output === 'string'
                ? outcome.output
                : JSON.stringify(outcome.output, null, 2),
            );
          } else if (outcome.kind === 'unverified') {
            console.error(
              `Crew abstained at ${outcome.failedTaskId ?? '?'} (unverified, faithfulness ${outcome.faithfulness}): ${outcome.unsupportedClaims.join('; ')}`,
            );
            process.exitCode = 1;
          } else {
            console.error(`Crew failed at ${outcome.failedTask ?? '?'}: ${outcome.message}`);
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

- [ ] **Step 5: Migrate `tests/integration/crew.live.test.ts`**

Apply the Step 1 transform to its `runCrewCli({ runsRoot, runId: 'live', ... })` call.

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test tests/cli/crew.test.ts` (PASS), `bun run typecheck` (clean).

- [ ] **Step 7: Lint + commit**

Run: `bun run lint:file -- "src/cli/crew.ts" "tests/cli/crew.test.ts" "tests/integration/crew.live.test.ts"`.

```bash
git add src/cli/crew.ts tests/cli/crew.test.ts tests/integration/crew.live.test.ts
git commit -m "refactor(cli): crew uses withMcpRun; runCrewCli takes run:RunHandle (Slice 16 Task 5)"
```

---

