### Task 5: Top-level error boundary + persisted `error.json`

**Files:**
- Create: `src/errors/boundary.ts`
- Create: `tests/errors/boundary.test.ts`
- Modify: `src/cli/chat.ts:407-412` (replace `main().catch(console.error)`)

**Interfaces:**
- Consumes: the exported error classes from `src/core/errors.ts` (`ProviderError`, `ToolError`, `ResourceError`, `WorkflowError`, `CrewError`, `MemoryError`, `VerificationError`, `MaxStepsError`).
- Produces:
  - `explain(err: unknown): { title: string; hint: string }` — maps a `FrameworkError` subclass to an actionable message; unknown errors get a generic pair.
  - `handleTopLevel(err: unknown, deps?: { runDir?: string; write?: (path: string, data: string) => void; log?: (s: string) => void }): number` — logs the explained error, persists `error.json` to `runDir` if provided, returns exit code `1`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors/boundary.test.ts
import { expect, test } from 'bun:test';
import { explain, handleTopLevel } from '../../src/errors/boundary.ts';
import { ResourceError, ProviderError } from '../../src/core/errors.ts';

test('explain maps typed errors to actionable hints', () => {
  expect(explain(new ResourceError('no fit')).title).toMatch(/memory budget|resource/i);
  expect(explain(new ProviderError('ollama down')).hint).toMatch(/ollama|provider/i);
  expect(explain(new Error('weird')).title).toBeDefined();
});
test('handleTopLevel persists error.json and returns exit 1', () => {
  const writes: Record<string, string> = {};
  const code = handleTopLevel(new ProviderError('x'), { runDir: '/tmp/r', write: (p, d) => { writes[p] = d; }, log: () => {} });
  expect(code).toBe(1);
  expect(JSON.parse(writes['/tmp/r/error.json'])).toMatchObject({ name: 'ProviderError' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/errors/boundary.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/errors/boundary.ts
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ProviderError, ToolError, ResourceError, WorkflowError, CrewError, MemoryError, VerificationError, MaxStepsError } from '../core/errors.ts';

export function explain(err: unknown): { title: string; hint: string } {
  if (err instanceof ResourceError) return { title: 'No model fits the memory budget', hint: 'Free memory, pick a smaller model, or run `bun run provision`.' };
  if (err instanceof ProviderError) return { title: 'A model provider/runtime failed', hint: 'Check the provider (e.g. Ollama running: `bun run status`).' };
  if (err instanceof ToolError) return { title: 'A tool failed', hint: 'Check the tool/MCP server; see the run trace with `bun run runs`.' };
  if (err instanceof MemoryError) return { title: 'A memory/RAG error', hint: 'Check the space/embedder; a reindex may be required.' };
  if (err instanceof VerificationError) return { title: 'Verification was misused', hint: 'Ensure a memory store is configured for --verify.' };
  if (err instanceof WorkflowError || err instanceof CrewError) return { title: 'A workflow/crew error', hint: 'Inspect the failing step with `bun run runs`.' };
  if (err instanceof MaxStepsError) return { title: 'The agent hit its step ceiling', hint: 'The task may need a crew/workflow, or a higher step budget.' };
  return { title: 'Unexpected error', hint: 'See the stack below; re-run with AGENT_LOG_LEVEL=debug for detail.' };
}

export function handleTopLevel(err: unknown, deps: { runDir?: string; write?: (path: string, data: string) => void; log?: (s: string) => void } = {}): number {
  const write = deps.write ?? ((p, d) => writeFileSync(p, d));
  const log = deps.log ?? ((s) => process.stderr.write(`${s}\n`));
  const { title, hint } = explain(err);
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  log(`✖ ${title}: ${message}\n  → ${hint}`);
  if (deps.runDir) {
    try { write(join(deps.runDir, 'error.json'), JSON.stringify({ name, title, message, hint, at: new Date().toISOString() }, null, 2)); } catch { /* best-effort */ }
  }
  return 1;
}
```

- [ ] **Step 4: Wire into chat.ts + run tests**

Replace `src/cli/chat.ts:407-412` with:

```ts
if (import.meta.main) {
  main().catch((err) => { process.exit(handleTopLevel(err)); });
}
```
(import `handleTopLevel` from `../errors/boundary.ts`.)

Run: `bun test tests/errors/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/errors/boundary.ts tests/errors/boundary.test.ts src/cli/chat.ts
git commit -m "feat(errors): top-level boundary maps typed errors to actionable hints + persists error.json"
```

---

