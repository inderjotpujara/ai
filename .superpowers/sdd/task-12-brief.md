### Task 12: Wire the ledger into the run context + CLI surface

**Files:**
- Modify: `src/cli/with-mcp-run.ts` (add `ledger` to `McpRunContext`; persist on exit)
- Modify: `src/cli/with-run.ts` (expose a ledger for the non-MCP path if it runs agents) — only if it invokes agent execution; otherwise skip.
- Modify: `src/cli/chat.ts` (print `formatLedger` after the run)
- Test: `tests/cli/degradation-ledger.test.ts`

**Interfaces:**
- Consumes: `createLedger`, `formatLedger`, `serializeLedger`, `DegradationLedger` (ledger.ts); `writeArtifact` (`src/run/run-store.ts`).
- Produces: `McpRunContext` gains `ledger: DegradationLedger`. On body completion, if `ledger.events.length > 0`, write `degradation.jsonl` via `writeArtifact(ctx.run, 'degradation.jsonl', serializeLedger(ledger))`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/degradation-ledger.test.ts
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withMcpRun } from '../../src/cli/with-mcp-run.ts';
import { DegradeKind } from '../../src/reliability/ledger.ts';

describe('withMcpRun degradation ledger', () => {
  it('exposes a ledger and persists it when events were recorded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runs-'));
    let runDir = '';
    await withMcpRun({ runsRoot: root, runId: 'r1', config: { entries: [], dormant: [], warnings: [] } }, async (ctx) => {
      runDir = ctx.run.dir;
      ctx.ledger.record({ kind: DegradeKind.AgentDropped, subject: 'a', reason: 'down' });
    });
    const text = await readFile(join(runDir, 'degradation.jsonl'), 'utf8');
    expect(JSON.parse(text.trim()).subject).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/degradation-ledger.test.ts`
Expected: FAIL — `ctx.ledger` undefined.

- [ ] **Step 3: Implement**

In `src/cli/with-mcp-run.ts`:
- Import: `import { createLedger, serializeLedger, type DegradationLedger } from '../reliability/ledger.ts';` and `writeArtifact` from `../run/run-store.ts` (add to existing import).
- Extend the type: `export type McpRunContext = { run: RunHandle; reg: MountedRegistry; config: McpConfig; ledger: DegradationLedger };`
- In `withMcpRun`, after `createRun`, create `const ledger = createLedger();`, pass it in the `ctx` object, and in the `finally`/after-body block write it out:

```ts
try {
  const result = await body({ run, reg, config, ledger });
  if (ledger.events.length > 0) {
    await writeArtifact(run, 'degradation.jsonl', serializeLedger(ledger));
  }
  return result;
} finally {
  await reg.close();
  await tel.shutdown();
}
```

(Adapt to the file's existing control flow — the point is: ledger created, threaded into `ctx`, persisted when non-empty.)

In `src/cli/chat.ts`: after the run completes, print the summary:

```ts
import { formatLedger } from '../reliability/ledger.ts';
// after obtaining the result, before returning:
const summary = formatLedger(ctx.ledger);
if (summary) console.error(summary);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/degradation-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/cli/with-mcp-run.ts" "src/cli/chat.ts" "tests/cli/degradation-ledger.test.ts"
git add src/cli/with-mcp-run.ts src/cli/chat.ts tests/cli/degradation-ledger.test.ts
git commit -m "feat(cli): thread degradation ledger through the run + surface it"
```

---

