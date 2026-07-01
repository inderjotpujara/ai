## Task 10: Recall tool + auto-inject helper

**Files:**
- Create: `src/memory/recall-tool.ts`
- Test: `tests/memory/recall-tool.test.ts`

**Interfaces:**
- Produces: `makeRecallTool(store: MemoryStore, ctx: { space?: string; namespace?: string }): Tool` (AI SDK tool with zod input `{ query: string; topK?: number }`); `formatResults(results: RetrievalResult[]): string` (citation-tagged); `injectRecall(store, ctx, task): Promise<string>` (prepends budget-fit recall to a task string; returns task unchanged if nothing found).
- Consumes: `MemoryStore` (Task 9); AI SDK `tool`, `zod`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/memory/recall-tool.test.ts
import { describe, expect, test } from 'vitest';
import { formatResults } from '../../src/memory/recall-tool.ts';
import type { RetrievalResult } from '../../src/memory/types.ts';

describe('formatResults', () => {
  test('tags each chunk with [mem:<id>] citation', () => {
    const r: RetrievalResult[] = [{ id: 'doc#0', text: 'the sky is blue', source: 'doc', score: 0.1, namespace: '' }];
    const out = formatResults(r);
    expect(out).toContain('[mem:doc#0]');
    expect(out).toContain('the sky is blue');
  });
  test('empty results → explicit abstention message', () => {
    expect(formatResults([])).toMatch(/no supporting memory/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/recall-tool.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/memory/recall-tool.ts`**
```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { MemoryStore } from './store.ts';
import type { RetrievalResult } from './types.ts';

export function formatResults(results: RetrievalResult[]): string {
  if (results.length === 0) return 'No supporting memory found.';
  return results.map((r) => `[mem:${r.id}] (${r.source}) ${r.text}`).join('\n\n');
}

export function makeRecallTool(store: MemoryStore, ctx: { space?: string; namespace?: string }) {
  return tool({
    description: 'Recall relevant facts from long-term memory. Cite results by their [mem:<id>] tag.',
    parameters: z.object({ query: z.string(), topK: z.number().int().positive().optional() }),
    execute: async ({ query, topK }) => {
      const results = await store.recall(query, { space: ctx.space, namespace: ctx.namespace, topK });
      return formatResults(results);
    },
  });
}

/** For opt-in auto-injection: prepend recalled context to a task prompt. */
export async function injectRecall(store: MemoryStore, ctx: { space?: string; namespace?: string }, task: string): Promise<string> {
  const results = await store.recall(task, { space: ctx.space, namespace: ctx.namespace });
  if (results.length === 0) return task;
  return `Relevant memory:\n${formatResults(results)}\n\n---\nTask:\n${task}`;
}
```
> Match the exact `tool()` signature the codebase uses (v6 uses `inputSchema` in some versions, `parameters` in others). Check how existing tools in `src/core/` / `src/tools/` are declared and mirror that exactly.

- [ ] **Step 4: Run tests to verify they pass**
Run: `bun test tests/memory/recall-tool.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/memory/recall-tool.ts tests/memory/recall-tool.test.ts
git commit -m "feat(memory): recall tool (citation-tagged) + auto-inject helper"
```

---

