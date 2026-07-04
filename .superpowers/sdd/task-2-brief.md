### Task 2: Reroute the download registry + wire LM Studio

**Files:**
- Modify: `src/provisioning/registry.ts` (full file, `providerFor` at :20, `catalogSourcesFor` at :32, `enrichSize` at :44)
- Modify: `src/provisioning/providers/lmstudio.ts:27` (kind field)
- Modify: `src/provisioning/providers/hf-fetch.ts:22,30` (accept split kinds — interim, WS2 completes behavior)
- Test: `tests/provisioning/registry.test.ts` *(new)*

**Interfaces:**
- Consumes: `ProviderKind` (Task 1), `createLmStudioProvider` (`lmstudio.ts`), `createHfFetchProvider` (`hf-fetch.ts`).
- Produces: `providerFor(kind: ProviderKind): DownloadProvider` routing all four kinds.

- [ ] **Step 1: Write the failing test** — `tests/provisioning/registry.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { providerFor } from '../../src/provisioning/registry.ts';

describe('providerFor', () => {
  it('routes HfGguf and HfSnapshot to the HF fetcher (kind preserved)', () => {
    expect(providerFor(ProviderKind.HfGguf).kind).toBe(ProviderKind.HfGguf);
    expect(providerFor(ProviderKind.HfSnapshot).kind).toBe(ProviderKind.HfSnapshot);
  });
  it('routes LmStudio to the LM Studio provider', () => {
    expect(providerFor(ProviderKind.LmStudio).kind).toBe(ProviderKind.LmStudio);
  });
  it('routes Ollama to the Ollama provider', () => {
    expect(providerFor(ProviderKind.Ollama).kind).toBe(ProviderKind.Ollama);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file -- "tests/provisioning/registry.test.ts"`
Expected: FAIL — `providerFor` doesn't handle the new kinds / LM Studio kind mismatch.

- [ ] **Step 3: Edit `src/provisioning/registry.ts`**

Import `createLmStudioProvider`; rewrite `providerFor`:

```ts
import { createLmStudioProvider } from './providers/lmstudio.ts';
// ...
export function providerFor(kind: ProviderKind): DownloadProvider {
  switch (kind) {
    case ProviderKind.Ollama:
      return createOllamaProvider();
    case ProviderKind.HfGguf:
      return createHfFetchProvider(ProviderKind.HfGguf);
    case ProviderKind.HfSnapshot:
      return createHfFetchProvider(ProviderKind.HfSnapshot);
    case ProviderKind.LmStudio:
      return createLmStudioProvider();
    default:
      return createOllamaProvider();
  }
}
```

In `catalogSourcesFor`, change `createHfCatalogSource(ProviderKind.MlxServer)` → `createHfCatalogSource(ProviderKind.HfSnapshot)`. In `enrichSize`, the non-Ollama branch already sums the HF tree — leave as-is (works for both HF kinds).

- [ ] **Step 4: Edit `src/provisioning/providers/lmstudio.ts:27`**

Change `kind: ProviderKind.MlxServer` → `kind: ProviderKind.LmStudio` (drop the shared-kind comment).

- [ ] **Step 5: Run to verify it passes**

Run: `bun run test:file -- "tests/provisioning/registry.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/provisioning/registry.ts src/provisioning/providers/lmstudio.ts tests/provisioning/registry.test.ts
git commit -m "feat(provisioning): route HfGguf/HfSnapshot/LmStudio download kinds + wire dead LM Studio provider"
```

---

