### Task 5: Tool telemetry + CLI wiring (chat/flow/crew) + default `mcp.json`

**Files:**
- Modify: `src/telemetry/spans.ts` (ATTR keys + `withToolSpan` + `recordMountOutcome`)
- Modify: `src/workflow/run-step.ts` (wrap `callTool` in `withToolSpan`)
- Modify: `src/cli/flow.ts`, `src/cli/crew.ts`, `src/cli/chat.ts` (registry mounts)
- Create: `mcp.json` (committed default — today's two mounts)
- Test: `tests/mcp/tool-span.test.ts`

**Interfaces:**
- Consumes: `loadMcpConfig` (Task 1), `mountAll`/`warnUnknownAgents`/`MountedRegistry` (Task 3).
- Produces:
  - `ATTR.TOOL_NAME = 'gen_ai.tool.name'`, `ATTR.MCP_SERVER = 'mcp.server'`, `ATTR.MCP_TRANSPORT = 'mcp.transport'`, `ATTR.MCP_TOOL_COUNT = 'mcp.tool.count'`, `ATTR.MCP_MOUNT_OUTCOME = 'mcp.mount.outcome'`
  - `withToolSpan<T>(toolName: string, fn: () => Promise<T>): Promise<T>` — span `workflow.tool`.
  - `withMcpMountSpan<T>(fn: (record: (name: string, outcome: string, toolCount?: number) => void) => Promise<T>): Promise<T>` — span `mcp.mount` with per-server `mcp.server.mount` events.

- [ ] **Step 1: Write the failing span test**

```ts
// tests/mcp/tool-span.test.ts
import { describe, expect, it } from 'bun:test';
import { withMcpMountSpan, withToolSpan } from '../../src/telemetry/spans.ts';

// No provider initialized → no-op tracer; helpers must pass results through
// and propagate errors (the provider-attached path is exercised by run-viewer live tests).
describe('withToolSpan', () => {
  it('passes the function result through', async () => {
    expect(await withToolSpan('echo', async () => 42)).toBe(42);
  });
  it('propagates errors', async () => {
    await expect(withToolSpan('boom', async () => { throw new Error('x'); })).rejects.toThrow('x');
  });
});

describe('withMcpMountSpan', () => {
  it('hands the recorder to the body and returns its result', async () => {
    const out = await withMcpMountSpan(async (record) => {
      record('file-tools', 'mounted', 1);
      record('gh', 'dormant');
      return 'ok';
    });
    expect(out).toBe('ok');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test tests/mcp/tool-span.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Extend `src/telemetry/spans.ts`**

Add to the `ATTR` const (after `PROVISION_SNAPSHOT_FALLBACK`):

```ts
  TOOL_NAME: 'gen_ai.tool.name',
  MCP_SERVER: 'mcp.server',
  MCP_TRANSPORT: 'mcp.transport',
  MCP_TOOL_COUNT: 'mcp.tool.count',
  MCP_MOUNT_OUTCOME: 'mcp.mount.outcome',
```

Add at the end of the file:

```ts
/** Span for one engine-level tool call (StepKind.Tool) — closes the gap where
 *  direct tool dispatch ran uninstrumented (agent-internal tool calls are
 *  already covered by AI-SDK experimental_telemetry). */
export function withToolSpan<T>(
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('workflow.tool', async (span) => {
    span.setAttribute(ATTR.TOOL_NAME, toolName);
    return fn();
  });
}

/** Root span for an MCP mount pass; the body records one event per server. */
export function withMcpMountSpan<T>(
  fn: (record: (name: string, outcome: string, toolCount?: number) => void) => Promise<T>,
): Promise<T> {
  return inSpan('mcp.mount', async (span) => {
    let servers = 0;
    const record = (name: string, outcome: string, toolCount?: number): void => {
      servers += 1;
      span.addEvent('mcp.server.mount', {
        [ATTR.MCP_SERVER]: name,
        [ATTR.MCP_MOUNT_OUTCOME]: outcome,
        ...(toolCount !== undefined ? { [ATTR.MCP_TOOL_COUNT]: toolCount } : {}),
      });
    };
    const out = await fn(record);
    span.setAttribute(ATTR.MCP_TOOL_COUNT, servers);
    return out;
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/mcp/tool-span.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wrap engine tool dispatch in `src/workflow/run-step.ts`**

Add `withToolSpan` to the existing spans import, then change the two `callTool` call sites (semantics unchanged — same args, same errors):

In `runLeaf`:

```ts
  const tool = deps.tools[sub.tool];
  if (!tool?.execute) throw new WorkflowError(`unknown tool: ${sub.tool}`);
  return withToolSpan(sub.tool, () => callTool(tool, sub.input(ctx), callId));
```

In `runStepByKind` (`case StepKind.Tool`):

```ts
    case StepKind.Tool: {
      const tool = deps.tools[step.tool];
      if (!tool?.execute) {
        return Promise.reject(new WorkflowError(`unknown tool: ${step.tool}`));
      }
      return withToolSpan(step.tool, () => callTool(tool, step.input(ctx), step.id));
    }
```

Run: `bun test tests/workflow/` — Expected: PASS (no behavior change).

- [ ] **Step 6: Create the committed default `mcp.json` (repo root)**

```json
{
  "mcpServers": {
    "file-tools": {
      "command": "bun",
      "args": ["run", "src/mcp/server.ts"],
      "agents": ["file_qa"]
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "agents": ["web_fetch"]
    }
  }
}
```

- [ ] **Step 7: Rewire `src/cli/flow.ts`**

Replace the `createFetchTools, createFileTools` import with:

```ts
import { loadMcpConfig } from '../mcp/config.ts';
import { mountAll, warnUnknownAgents } from '../mcp/mount.ts';
import { withMcpMountSpan } from '../telemetry/spans.ts';
```

Replace the mount region of `main()` — from `const fileServer = await createFileTools();` through its matching final `finally { await fileServer.close(); }` — with (inner body unchanged except the marked lines):

```ts
  const config = loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
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
          runsRoot: 'runs',
          runId: `flow-${process.pid}`,
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
          console.error(
            `Workflow failed at ${outcome.failedStep}: ${outcome.message}`,
          );
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
  } finally {
    await reg.close();
  }
```

- [ ] **Step 8: Rewire `src/cli/crew.ts` (same pattern)**

Same import swap as Step 7. Replace its mount region — `const fileServer = await createFileTools();` through the final `finally { await fileServer.close(); }` — keeping the inner body identical except `const tools: ToolSet = { ...fileServer.tools, ...fetchServer.tools };` becomes `const tools: ToolSet = reg.merged;`, wrapped in:

```ts
  const config = loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    // ... existing selection/verify/runCrewCli body, tools = reg.merged ...
  } finally {
    await reg.close();
  }
```

(Crew members without per-member `tools` fall back to the merged set via `buildCrewAgent(member, tools)` — unchanged behavior.)

- [ ] **Step 9: Rewire `src/cli/chat.ts`**

Same import swap. Replace the mount region — `const fileServer = await createFileTools();` through `await fileServer.close();` (keep `await manager.unloadAll();` in the outer finally) — with:

```ts
  const config = loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    const orchestrator = createSuperAgent(
      reg.forAgent('file_qa'),
      reg.forAgent('web_fetch'),
      onBeforeDelegate,
    );
    const result = await runChat({
      orchestrator,
      task,
      runsRoot: 'runs',
      runId: `run-${process.pid}`,
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
  } finally {
    await reg.close();
    await manager.unloadAll();
  }
```

`maybeAutoProvision()` and everything above the mount region stay untouched.

- [ ] **Step 10: First-run consent seeding note + full gate**

The committed default `mcp.json` entries are NOT pre-approved: the first interactive `bun run flow|crew|chat` prompts once per server (y → recorded in `.mcp-approvals.json`). Non-TTY runs skip unapproved servers with a warning (tests construct deps directly, so the suite is unaffected).

Run: `bun run docs:check && bun run typecheck && bun run lint` then `bun test`
Expected: all clean/green (pre-existing pass counts + the new mcp tests).

- [ ] **Step 11: Commit**

```bash
git add src/telemetry/spans.ts src/workflow/run-step.ts src/cli/flow.ts src/cli/crew.ts src/cli/chat.ts mcp.json tests/mcp/tool-span.test.ts
git commit -m "feat(mcp): registry-driven CLI mounts + workflow.tool/mcp.mount telemetry + default mcp.json (Slice 15 Task 5)"
```

---

