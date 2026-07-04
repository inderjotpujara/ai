### Task 10: transpiler↔engine contract test (round-trip)

**Files:**
- Test: `tests/crew-builder/transpile-contract.test.ts` (no new source)

**Interfaces:**
- Consumes: `transpile` (Task 9), the generated source, `defineCrew`/`defineWorkflow`.

- [ ] **Step 1: Write the test** — write transpiled source to a temp file, dynamic-`import()` it, assert the default export is a valid def (the `define*` call inside runs at import → throws on an invalid graph).

```ts
// tests/crew-builder/transpile-contract.test.ts
import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transpile } from '../../src/crew-builder/transpile.ts';
import type { WorkflowIR } from '../../src/crew-builder/ir.ts';

test('generated workflow source imports + defines without throwing', async () => {
  const ir: WorkflowIR = { id: 'ct', steps: [
    { kind: 'tool', id: 'f', tool: 'fetch', input: { kind: 'fromInput' } },
    { kind: 'agent', id: 'a', agent: 'web_fetch', dependsOn: ['f'], input: { kind: 'fromStep', ref: 'f' } },
  ] };
  // NOTE: generated imports are '../src/...'; place the temp file at repo root depth-1 so relative paths resolve.
  const dir = mkdtempSync(join(process.cwd(), 'workflows', '.tmp-'));
  const file = join(dir, 'gen.ts');
  writeFileSync(file, transpile(ir, 'workflow'));
  const mod = await import(file);
  expect(mod.default.id).toBe('ct');
  expect(mod.default.steps.length).toBe(2);
});
```

> NOTE for implementer: the generated files use `'../src/...'` imports (they live in `crews/`/`workflows/` at repo root). The temp file MUST be created at the same directory depth (inside `workflows/`), as above, so relative imports resolve. Clean up the temp dir in an `afterEach`/`finally` with `rmSync(dir, { recursive: true, force: true })`. Add a crew variant of this test too.

- [ ] **Step 2: Run — FAIL then iterate** until the generated source imports cleanly. If it fails, the transpiler (Task 9) has a bug — fix Task 9's renderer, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/crew-builder/transpile-contract.test.ts
git commit -m "test(crew-builder): transpiler<->engine round-trip contract"
```

---

