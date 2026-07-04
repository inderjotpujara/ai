### Task 1: Add `RuntimeKind` + extend `ProviderKind` + `downloadKindFor`

**Files:**
- Modify: `src/core/types.ts` (enum `ProviderKind` at lines 2-5; `ModelDeclaration` at ~line 50)
- Create: `src/core/kind-map.ts`
- Test: `tests/core/kind-map.test.ts`

**Interfaces:**
- Produces:
  - `enum ProviderKind { Ollama='Ollama', HfGguf='HfGguf', HfSnapshot='HfSnapshot', LmStudio='LmStudio' }`
  - `enum RuntimeKind { Ollama='Ollama', MlxServer='MlxServer', LmStudio='LmStudio' }`
  - `ModelDeclaration.runtime: RuntimeKind` (was `.provider: ProviderKind`)
  - `Candidate.provider: ProviderKind` (unchanged field name; retyped — see Task 2)
  - `downloadKindFor(runtime: RuntimeKind, repoShape: 'gguf-file' | 'snapshot' | 'ollama'): ProviderKind`

- [ ] **Step 1: Write the failing test** — `tests/core/kind-map.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { RuntimeKind, ProviderKind } from '../../src/core/types.ts';
import { downloadKindFor } from '../../src/core/kind-map.ts';

describe('downloadKindFor', () => {
  it('maps Ollama runtime to Ollama download', () => {
    expect(downloadKindFor(RuntimeKind.Ollama, 'ollama')).toBe(ProviderKind.Ollama);
  });
  it('maps MLX runtime + snapshot repo to HfSnapshot download', () => {
    expect(downloadKindFor(RuntimeKind.MlxServer, 'snapshot')).toBe(ProviderKind.HfSnapshot);
  });
  it('maps a single-file gguf under Ollama runtime to HfGguf download', () => {
    expect(downloadKindFor(RuntimeKind.Ollama, 'gguf-file')).toBe(ProviderKind.HfGguf);
  });
  it('maps LmStudio runtime to LmStudio download', () => {
    expect(downloadKindFor(RuntimeKind.LmStudio, 'snapshot')).toBe(ProviderKind.LmStudio);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/core/kind-map.test.ts"`
Expected: FAIL — `RuntimeKind`/`downloadKindFor` not exported.

- [ ] **Step 3: Edit `src/core/types.ts`**

Replace the two-member `ProviderKind` with the download enum, add `RuntimeKind`, and rename the declaration field:

```ts
/** Which downloader fetches a model's weights. String enum per project style. */
export enum ProviderKind {
  Ollama = 'Ollama', // pull via the local Ollama daemon
  HfGguf = 'HfGguf', // single GGUF file from a HuggingFace repo (repo::file.gguf)
  HfSnapshot = 'HfSnapshot', // whole-repo snapshot (MLX weights) from HuggingFace
  LmStudio = 'LmStudio', // download via the local LM Studio REST server
}

/** Which local engine runs inference for a model. */
export enum RuntimeKind {
  Ollama = 'Ollama', // GGUF via llama.cpp Metal (MLX engine auto on >32GB hosts)
  MlxServer = 'MlxServer', // MLX via a local OpenAI-compatible server (mlx_lm / LM Studio)
  LmStudio = 'LmStudio', // reserved: LM Studio as an inference runtime (download-only in Slice 18)
}
```

In `ModelDeclaration`, change `provider: ProviderKind` → `runtime: RuntimeKind`.

- [ ] **Step 4: Create `src/core/kind-map.ts`**

```ts
import { ProviderKind, RuntimeKind } from './types.ts';

export type RepoShape = 'gguf-file' | 'snapshot' | 'ollama';

/** Map an inference runtime + repo shape to the download provider that fetches it. */
export function downloadKindFor(runtime: RuntimeKind, shape: RepoShape): ProviderKind {
  if (runtime === RuntimeKind.LmStudio) return ProviderKind.LmStudio;
  if (runtime === RuntimeKind.MlxServer) return ProviderKind.HfSnapshot;
  // RuntimeKind.Ollama:
  if (shape === 'gguf-file') return ProviderKind.HfGguf;
  return ProviderKind.Ollama;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:file -- "tests/core/kind-map.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/kind-map.ts tests/core/kind-map.test.ts
git commit -m "feat(core): split ProviderKind (download) from RuntimeKind (inference) + downloadKindFor"
```
(Typecheck will be red across consumers until Task 2–4 — that is expected and fixed within WS1.)

---

