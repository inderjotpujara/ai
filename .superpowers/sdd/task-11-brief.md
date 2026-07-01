### Task 11: `discover` CLI + chat wiring + registry rename

**Files:**
- Create: `src/cli/discover.ts`
- Modify: `models/registry.ts` (rename `REGISTRY` → `BOOTSTRAP`)
- Modify: `src/discovery/build-registry.ts` (import `BOOTSTRAP`)
- Modify: `src/cli/chat.ts` (use `await buildRegistry()`)
- Modify: `tests/models/registry.test.ts`, `tests/cli/select-hook.test.ts`, `tests/resource/select-degrade.test.ts`, `tests/integration/selection.live.test.ts` (rename import)
- Modify: `package.json` (add `discover` script)

**Interfaces:**
- Consumes: `runDiscovery`, `buildRegistry`, `createSelectHook`.
- Produces: `bun run discover`; `BOOTSTRAP` export; chat reads the merged registry.

- [ ] **Step 1: Rename the bootstrap export** — `models/registry.ts`
```ts
export const BOOTSTRAP: ModelDeclaration[] = [qwenRouter, qwenFast];
```
Update consumers (replace `REGISTRY` → `BOOTSTRAP` in the import + usages):
- `tests/models/registry.test.ts` (rename import + the two assertions' variable)
- `tests/cli/select-hook.test.ts`, `tests/resource/select-degrade.test.ts`, `tests/integration/selection.live.test.ts`
- `src/discovery/build-registry.ts` (`import { BOOTSTRAP } from '../../models/registry.ts'` and use it)

- [ ] **Step 2: Wire chat to the merged registry** — `src/cli/chat.ts`

Replace the `REGISTRY` import with the builder, and build the registry once at startup:
```ts
import { buildRegistry } from '../discovery/build-registry.ts';
```
Replace `registry: REGISTRY,` in the `createSelectHook` call with a value computed just above it:
```ts
  const registry = await buildRegistry();
  const onBeforeDelegate = createSelectHook({
    registry,
    ensureReady: (decl, opts) => manager.ensureReady(decl, opts),
    listLoaded: () => listLoadedModels(),
    pinned: [qwenRouter.model],
    capture,
    onAttempt: notify,
  });
```
(Keep everything else in `chat.ts` unchanged.)

- [ ] **Step 3: Create the `discover` command** — `src/cli/discover.ts`
```ts
import { runDiscovery } from '../discovery/discover.ts';

async function main(): Promise<void> {
  console.error('Discovering models from Hugging Face (this needs internet)...');
  try {
    const r = await runDiscovery();
    console.error(
      `Found ${r.found} candidate(s), ${r.fits} fit the budget. ` +
      `Pre-pulled: ${r.pulled.length ? r.pulled.join(', ') : 'none'}. Catalog: ${r.path}`,
    );
  } catch (err) {
    console.error(`Discovery failed (using any existing catalog): ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
main();
```
Add to `package.json` scripts: `"discover": "bun run src/cli/discover.ts"`.

- [ ] **Step 4: Run the full suite** — `bun test` → all unit tests PASS (live auto-skip). `bun run typecheck` → clean. `bun run lint` → exit 0.

- [ ] **Step 5: Commit**
```bash
git add models/registry.ts src/discovery/build-registry.ts src/cli/chat.ts src/cli/discover.ts package.json tests/
git commit -m "feat(cli): discover command + chat reads merged registry (REGISTRY->BOOTSTRAP)"
```

---

