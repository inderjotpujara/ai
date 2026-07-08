### Task 3: `bun run status`

**Files:**
- Create: `src/cli/status.ts`
- Create: `tests/cli/status.test.ts`
- Modify: `package.json` (`"status": "bun run src/cli/status.ts"`)

**Interfaces:**
- Produces:
  - `collectStatus(deps: StatusDeps): Promise<StatusReport>` where `StatusDeps = { ollamaReachable: () => Promise<boolean>; loadedModels: () => Promise<string[]>; freeBudgetBytes: () => Promise<number>; version: string }` and `StatusReport = { version: string; ollama: boolean; loaded: string[]; freeGb: number }`.
  - `renderStatus(r: StatusReport): string` — a compact human summary.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/status.test.ts
import { expect, test } from 'bun:test';
import { collectStatus, renderStatus } from '../../src/cli/status.ts';

test('collectStatus assembles a report from injected probes', async () => {
  const r = await collectStatus({
    ollamaReachable: async () => true,
    loadedModels: async () => ['qwen2.5:14b'],
    freeBudgetBytes: async () => 12_000_000_000,
    version: '0.2.0',
  });
  expect(r).toEqual({ version: '0.2.0', ollama: true, loaded: ['qwen2.5:14b'], freeGb: 12 });
  expect(renderStatus(r)).toContain('qwen2.5:14b');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/cli/status.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/cli/status.ts
export type StatusDeps = {
  ollamaReachable: () => Promise<boolean>;
  loadedModels: () => Promise<string[]>;
  freeBudgetBytes: () => Promise<number>;
  version: string;
};
export type StatusReport = { version: string; ollama: boolean; loaded: string[]; freeGb: number };

export async function collectStatus(deps: StatusDeps): Promise<StatusReport> {
  const [ollama, loaded, free] = await Promise.all([deps.ollamaReachable(), deps.loadedModels(), deps.freeBudgetBytes()]);
  return { version: deps.version, ollama, loaded, freeGb: Math.round(free / 1e9) };
}
export function renderStatus(r: StatusReport): string {
  return [
    `agent-framework ${r.version}`,
    `ollama:  ${r.ollama ? 'reachable' : 'DOWN'}`,
    `models:  ${r.loaded.length ? r.loaded.join(', ') : '(none resident)'}`,
    `budget:  ~${r.freeGb} GB free`,
  ].join('\n');
}
```

Wire a `main()` that builds real deps (Ollama version ping via `src/runtime/ollama.ts`, `listLoaded` via `runtimeFor('ollama').control`, `liveBudgetBytes`, version from Task 4's `APP_VERSION`) and prints `renderStatus`. Add the `status` script to `package.json`.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/cli/status.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/status.ts tests/cli/status.test.ts package.json
git commit -m "feat(cli): 'bun run status' — Ollama/models/budget/version at a glance (feeds the 30b live panel)"
```

---

