## Task 3: `withMcpRun` helper + ordering proof

**Files:**
- Create: `src/cli/with-mcp-run.ts`
- Test: `tests/cli/with-mcp-run.test.ts`

**Interfaces:**
- Consumes: `createRun` (`src/run/run-store.ts`), `initRunTelemetry` (`src/telemetry/provider.ts`), `loadMcpConfig` (`src/mcp/config.ts`), `mountAll` + `MountAllDeps` + `MountedRegistry` (`src/mcp/mount.ts`), `withMcpMountSpan` (`src/telemetry/spans.ts`), `McpConfig` (`src/mcp/types.ts`), `RunHandle` (`src/run/run-store.ts`).
- Produces:
  ```typescript
  export type McpRunContext = { run: RunHandle; reg: MountedRegistry; config: McpConfig };
  export function withMcpRun<T>(
    opts: { runsRoot: string; runId: string; config?: McpConfig; mountDeps?: MountAllDeps },
    body: (ctx: McpRunContext) => Promise<T>,
  ): Promise<T>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/cli/with-mcp-run.test.ts`:

```typescript
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { McpConfig } from '../../src/mcp/types.ts';
import { withMcpRun } from '../../src/cli/with-mcp-run.ts';

const EMPTY_CONFIG = { entries: [], dormant: [], warnings: [] } as unknown as McpConfig;

describe('withMcpRun', () => {
  it('creates the run, then the mcp.mount span lands in spans.jsonl (ordering fix)', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const seen = await withMcpRun(
      { runsRoot, runId: 'r1', config: EMPTY_CONFIG, mountDeps: { mount: async () => ({ tools: {}, close: async () => {} }) } },
      async ({ run, reg }) => {
        expect(run.id).toBe('r1');
        return reg.mounted.length;
      },
    );
    expect(seen).toBe(0);
    const lines = (await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.some((s) => s.name === 'mcp.mount')).toBe(true);
    await rm(runsRoot, { recursive: true, force: true });
  });

  it('closes the registry after the body', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    let closed = false;
    await withMcpRun(
      {
        runsRoot,
        runId: 'r2',
        config: EMPTY_CONFIG,
        mountDeps: { mount: async () => ({ tools: {}, close: async () => { closed = true; } }) },
      },
      async () => undefined,
    );
    // empty config mounts nothing, so reg.close() iterates zero servers; assert the call path ran cleanly
    expect(closed).toBe(false);
    await rm(runsRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/with-mcp-run.test.ts`
Expected: FAIL — `Cannot find module '../../src/cli/with-mcp-run.ts'`.

- [ ] **Step 3: Implement `src/cli/with-mcp-run.ts`**

```typescript
import { loadMcpConfig } from '../mcp/config.ts';
import { type MountAllDeps, type MountedRegistry, mountAll } from '../mcp/mount.ts';
import type { McpConfig } from '../mcp/types.ts';
import { type RunHandle, createRun } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { withMcpMountSpan } from '../telemetry/spans.ts';

export type McpRunContext = {
  run: RunHandle;
  reg: MountedRegistry;
  config: McpConfig;
};

/** Owns the per-run CLI scope so the ordering invariant lives in ONE place:
 *  create the run dir, install the run-scoped telemetry provider, THEN mount
 *  MCP under it (so `mcp.mount` reaches runs/<id>/spans.jsonl), run the body,
 *  and tear down (close registry, flush telemetry) in that order. */
export async function withMcpRun<T>(
  opts: {
    runsRoot: string;
    runId: string;
    config?: McpConfig;
    mountDeps?: MountAllDeps;
  },
  body: (ctx: McpRunContext) => Promise<T>,
): Promise<T> {
  const run = await createRun(opts.runsRoot, opts.runId);
  const tel = initRunTelemetry(run.dir);
  const config = opts.config ?? loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config, opts.mountDeps);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    return await body({ run, reg, config });
  } finally {
    await reg.close();
    await tel.shutdown();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/with-mcp-run.test.ts`
Expected: PASS — `spans.jsonl` contains an `mcp.mount` span (proving the span now lands because telemetry was initialized before the mount).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck`; `bun run lint:file -- "src/cli/with-mcp-run.ts" "tests/cli/with-mcp-run.test.ts"`.

```bash
git add src/cli/with-mcp-run.ts tests/cli/with-mcp-run.test.ts
git commit -m "feat(cli): withMcpRun helper owns run-dir+telemetry+mount ordering (Slice 16 Task 3)"
```

---

