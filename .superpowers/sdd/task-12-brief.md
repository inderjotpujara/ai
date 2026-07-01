## Task 12: Wire memory into crews + workflows (auto-write + recall tool) + live test

**Files:**
- Modify: `src/workflow/run-step.ts` (or `engine.ts`) — optional `memory` in deps; auto-write after step success
- Modify: `src/crew/engine.ts` — pass `memory` through; bind recall tool to members; namespace = crew id
- Test: `tests/memory/wiring.test.ts`, `tests/integration/memory.live.test.ts`

**Interfaces:**
- Consumes: `MemoryStore` (Task 9), `makeRecallTool`/`injectRecall` (Task 10), the existing `WorkflowDeps`/`CrewDeps`.
- Produces: `WorkflowDeps.memory?: MemoryStore`, per-crew/per-task `persistMemory?: boolean` (default true), `CrewDeps.memory?: MemoryStore`.

- [ ] **Step 1: Write the failing wiring test** (mock store records writes; no Ollama)
```ts
// tests/memory/wiring.test.ts
import { describe, expect, test } from 'vitest';
import { autoPersistStepOutput } from '../../src/workflow/run-step.ts';

describe('auto-write wiring', () => {
  test('persists a completed step output to namespaced memory unless opted out', async () => {
    const writes: any[] = [];
    const store = { remember: async (t: string, o: any) => { writes.push({ t, o }); } } as any;
    await autoPersistStepOutput(store, { workflowId: 'wf1', stepId: 's1', output: 'result text', persist: true, at: 1 });
    expect(writes).toHaveLength(1);
    expect(writes[0].o.namespace).toBe('wf1');
  });
  test('opt-out skips the write', async () => {
    const writes: any[] = [];
    const store = { remember: async () => { writes.push(1); } } as any;
    await autoPersistStepOutput(store, { workflowId: 'wf1', stepId: 's1', output: 'x', persist: false, at: 1 });
    expect(writes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/wiring.test.ts`
Expected: FAIL (`autoPersistStepOutput` undefined).

- [ ] **Step 3: Add `autoPersistStepOutput`** to `src/workflow/run-step.ts` and call it from the engine after a step completes+validates (only when `deps.memory` is set):
```ts
import type { MemoryStore } from '../memory/store.ts';
import { MemoryKind } from '../memory/types.ts';

export async function autoPersistStepOutput(
  store: MemoryStore | undefined,
  info: { workflowId: string; stepId: string; output: unknown; persist: boolean; at: number },
): Promise<void> {
  if (!store || !info.persist) return;
  const text = typeof info.output === 'string' ? info.output : JSON.stringify(info.output);
  if (!text.trim()) return;
  await store.remember(text, {
    space: 'default', namespace: info.workflowId, kind: MemoryKind.RunMemory,
    source: `${info.workflowId}:${info.stepId}`, at: info.at,
  });
}
```

- [ ] **Step 4: Thread `memory` through `WorkflowDeps`/`CrewDeps`** and, in `src/crew/engine.ts`, when `memory` is present, bind `makeRecallTool(memory, { namespace: crew.id })` into each member's tools (namespace = crew id) and pass `memory` into the workflow deps so auto-write fires. Respect a `persistMemory` flag on the crew/task (default true).
> Read `src/crew/engine.ts` + `src/workflow/engine.ts` to find the exact deps object + step-completion point; keep changes additive (memory optional → no behavior change when absent, so existing crew/workflow tests stay green).

- [ ] **Step 5: Write the live test** (skips if Ollama down or embedder not pulled — mirror `tests/integration/crew.live.test.ts` skip guard)
```ts
// tests/integration/memory.live.test.ts
import { describe, expect, test } from 'vitest';
import { rmSync } from 'node:fs';
import { ollamaReady } from './ollama-available.ts'; // reuse existing helper name/shape
// Build the real embedder + store via the same wiring the CLI uses.

const ready = await ollamaReady('qwen3-embedding:0.6b');
const DIR = '/tmp/mem-live';

describe.skipIf(!ready)('memory.live', () => {
  test('ingest text then recall a relevant chunk', async () => {
    try { rmSync(DIR, { recursive: true, force: true }); } catch {}
    // construct store with real embedTexts/embedQuery/probe (Task 4 makeEmbedder + probeEmbedder + Model Manager)
    // await store.remember('The Raft consensus algorithm elects a leader via randomized timeouts.', { space:'default', at: Date.now() });
    // const hits = await store.recall('how does raft choose a leader', { space:'default', numCtx: 8192 });
    // expect(hits.join through formatResults).toMatch(/leader/i);
    expect(true).toBe(true); // replace with the real roundtrip once wiring names are confirmed
  }, 180_000);
});
```
> Flesh out the commented lines using the real `makeEmbedder`/`probeEmbedder` + `createMemoryStore`. The assertion must prove a relevant chunk is recalled (e.g. contains "leader"). Keep the 180s timeout + skip guard.

- [ ] **Step 6: Run the unit test + full suite + typecheck**
Run: `bun test tests/memory/wiring.test.ts && bun run typecheck && bun test`
Expected: wiring test PASS; existing crew/workflow suites still PASS; live test skips when Ollama is down.

- [ ] **Step 7: Commit**
```bash
git add src/workflow/run-step.ts src/workflow/engine.ts src/crew/engine.ts tests/memory/wiring.test.ts tests/integration/memory.live.test.ts
git commit -m "feat(memory): wire recall + namespaced auto-write into crews and workflows"
```

---

