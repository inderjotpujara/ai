## Task 6: Migrate `chat` CLI + `runChat` to `withMcpRun`

**Files:**
- Modify: `src/cli/run-chat.ts` (`ChatDeps` 9-16, `runChat` 18-42), `src/cli/chat.ts` (`main` 108-141)
- Test: `tests/cli/run-chat.test.ts`, `tests/integration/run-viewer.live.test.ts`

**Interfaces:**
- Consumes: `withMcpRun` (Task 3).
- Produces: `ChatDeps` has `run: RunHandle` in place of `runsRoot`/`runId`; `runChat` uses `run.id` for its span name and no longer manages telemetry.

- [ ] **Step 1: Migrate `tests/cli/run-chat.test.ts` (RED)**

Add imports (`createRun`, `initRunTelemetry`). Each case builds deps with `runsRoot: root, runId: 'run-N'`. Transform to create the run + init telemetry and pass `run`:

```typescript
const run = await createRun(root, 'run-1');
const tel = initRunTelemetry(run.dir);
let result;
try {
  result = await runChat({ orchestrator, task, run, /* routerNumCtx, capture */ });
} finally {
  await tel.shutdown();
}
```

Repeat for `run-2`, `run-span`, `run-nojournal`. Keep `join(root, 'run-1', 'spans.jsonl')` / `answer.txt` / `gap.txt` / `resource.txt` assertions unchanged. (The `run-span` case asserts a span in `spans.jsonl`; it still resolves because the test now owns telemetry.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/run-chat.test.ts`
Expected: FAIL — `ChatDeps` has no `run`; `runChat` still calls `createRun`/`initRunTelemetry`.

- [ ] **Step 3: Update `ChatDeps` + `runChat` in `src/cli/run-chat.ts`**

Replace `runsRoot: string; runId: string;` (lines 12-13) with `run: RunHandle;`. Change the import on line 5:

```typescript
import { type RunHandle, writeArtifact } from '../run/run-store.ts';
```

Remove the `initRunTelemetry` import (line 6). Rewrite `runChat` (18-42):

```typescript
export async function runChat(deps: ChatDeps): Promise<OrchestratorResult> {
  const { run } = deps;
  return await withRunSpan(run.id, deps.task, async () => {
    const result = await runOrchestrator(
      deps.orchestrator,
      deps.task,
      deps.routerNumCtx,
      deps.capture,
    );
    setRunOutcome(result);
    if (result.kind === 'answer') {
      await writeArtifact(run, 'answer.txt', result.text);
    } else if (result.kind === 'gap') {
      await writeArtifact(run, 'gap.txt', result.message);
    } else {
      await writeArtifact(run, 'resource.txt', result.message);
    }
    return result;
  });
}
```

- [ ] **Step 4: Rewire `chat.ts` `main()` to use `withMcpRun`**

In `src/cli/chat.ts`: add `import { withMcpRun } from './with-mcp-run.ts';`; remove `loadMcpConfig` (line 7), `mountAll` (line 8), `withMcpMountSpan` (line 25) imports. Replace lines 108-141 (mount block + `try/finally` around `runChat`) with:

```typescript
  await withMcpRun(
    { runsRoot: 'runs', runId: `run-${process.pid}` },
    async ({ run, reg }) => {
      const orchestrator = createSuperAgent(
        reg.forAgent('file_qa'),
        reg.forAgent('web_fetch'),
        onBeforeDelegate,
      );
      const result = await runChat({
        orchestrator,
        task,
        run,
        routerNumCtx,
        capture,
      });
      if (result.kind === 'answer') {
        console.log(result.text);
      } else if (result.kind === 'gap') {
        console.log(result.message);
      } else {
        console.error(result.message);
        process.exitCode = 1;
      }
    },
  );
  await manager.unloadAll();
```

> Note the ordering change: `manager.unloadAll()` now runs after `withMcpRun` returns (which itself closes the registry + flushes telemetry in its `finally`). Previously `reg.close()` and `manager.unloadAll()` shared one `finally`; the model manager is independent of the run scope, so unloading it after the run closes is correct. If `runChat` throws, `withMcpRun`'s `finally` still closes the registry + telemetry; wrap the `withMcpRun` call in `try { … } finally { await manager.unloadAll(); }` to preserve unload-on-error parity with the original.

Concretely, use:

```typescript
  try {
    await withMcpRun(
      { runsRoot: 'runs', runId: `run-${process.pid}` },
      async ({ run, reg }) => {
        /* …body from above… */
      },
    );
  } finally {
    await manager.unloadAll();
  }
```

- [ ] **Step 5: Migrate `tests/integration/run-viewer.live.test.ts`**

Apply the Step 1 transform to its `runChat({ runsRoot, runId, ... })` call(s) (create run + init telemetry, pass `run`).

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test tests/cli/run-chat.test.ts` (PASS), `bun run typecheck` (clean).

- [ ] **Step 7: Lint + commit**

Run: `bun run lint:file -- "src/cli/chat.ts" "src/cli/run-chat.ts" "tests/cli/run-chat.test.ts" "tests/integration/run-viewer.live.test.ts"`.

```bash
git add src/cli/chat.ts src/cli/run-chat.ts tests/cli/run-chat.test.ts tests/integration/run-viewer.live.test.ts
git commit -m "refactor(cli): chat/runChat use withMcpRun; ChatDeps takes run:RunHandle (Slice 16 Task 6)"
```

---

