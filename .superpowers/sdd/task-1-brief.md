## Task 1: Minor ② — honest `mcp.mount` root-span counts

**Files:**
- Modify: `src/telemetry/spans.ts:58-62` (ATTR block) and `src/telemetry/spans.ts:407-433` (`withMcpMountSpan`)
- Test: `tests/mcp/tool-span.test.ts` (extend)

**Interfaces:**
- Consumes: `initRunTelemetry(runDir)` from `src/telemetry/provider.ts` (returns `{ shutdown(): Promise<void> }`); `withMcpMountSpan` signature unchanged.
- Produces: root `mcp.mount` span now carries `ATTR.MCP_SERVER_COUNT` (`'mcp.server.count'`, = number of servers with outcome `'mounted'`) and `ATTR.MCP_TOOL_COUNT` (`'mcp.tool.count'`, = sum of mounted servers' tool counts). Per-server `mcp.server.mount` events unchanged.

- [ ] **Step 1: Write the failing test**

Add to `tests/mcp/tool-span.test.ts`:

```typescript
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';

describe('withMcpMountSpan root-span counts', () => {
  it('records mounted-server count and summed tool count (not a raw record count)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mountspan-'));
    const tel = initRunTelemetry(dir);
    await withMcpMountSpan(async (record) => {
      record('a', 'mounted', 3);
      record('b', 'mounted', 2);
      record('c', 'consent not granted'); // skipped
      record('d', 'dormant');
      return 'x';
    });
    await tel.shutdown();
    const lines = (await readFile(join(dir, 'spans.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const mount = lines.find((s) => s.name === 'mcp.mount');
    expect(mount).toBeDefined();
    expect(mount.attributes['mcp.server.count']).toBe(2);
    expect(mount.attributes['mcp.tool.count']).toBe(5);
    expect(mount.events.filter((e: { name: string }) => e.name === 'mcp.server.mount')).toHaveLength(4);
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mcp/tool-span.test.ts`
Expected: FAIL — `mcp.server.count` is `undefined` and `mcp.tool.count` is `4` (the current raw record count), not `2`/`5`.

- [ ] **Step 3: Add the ATTR key**

In `src/telemetry/spans.ts`, insert after the `MCP_MOUNT_OUTCOME` line (currently line 62):

```typescript
  MCP_MOUNT_OUTCOME: 'mcp.mount.outcome',
  MCP_SERVER_COUNT: 'mcp.server.count',
```

- [ ] **Step 4: Fix `withMcpMountSpan` to track honest aggregates**

Replace the body of `withMcpMountSpan` (currently `spans.ts:408-433`) with:

```typescript
export function withMcpMountSpan<T>(
  fn: (
    record: (name: string, outcome: string, toolCount?: number) => void,
  ) => Promise<T>,
): Promise<T> {
  return inSpan('mcp.mount', async (span) => {
    let mountedServers = 0;
    let mountedTools = 0;
    const record = (
      name: string,
      outcome: string,
      toolCount?: number,
    ): void => {
      if (outcome === 'mounted') {
        mountedServers += 1;
        mountedTools += toolCount ?? 0;
      }
      span.addEvent('mcp.server.mount', {
        [ATTR.MCP_SERVER]: name,
        [ATTR.MCP_MOUNT_OUTCOME]: outcome,
        ...(toolCount !== undefined
          ? { [ATTR.MCP_TOOL_COUNT]: toolCount }
          : {}),
      });
    };
    const out = await fn(record);
    span.setAttribute(ATTR.MCP_SERVER_COUNT, mountedServers);
    span.setAttribute(ATTR.MCP_TOOL_COUNT, mountedTools);
    return out;
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/mcp/tool-span.test.ts`
Expected: PASS (both the existing pass-through test and the new counts test).

- [ ] **Step 6: Typecheck + commit**

Run: `bun run typecheck` (expect clean), then `bun run lint:file -- "src/telemetry/spans.ts" "tests/mcp/tool-span.test.ts"`.

```bash
git add src/telemetry/spans.ts tests/mcp/tool-span.test.ts
git commit -m "fix(telemetry): mcp.mount root span records mounted-server + summed tool counts (Slice 16 Task 1)"
```

---

