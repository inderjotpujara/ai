## Task 4: Embeddings port (`RuntimeControl.embed` + probe + manager-backed wrapper)

**Files:**
- Modify: `src/runtime/runtime.ts` (add `embed` to `RuntimeControl`)
- Modify: `src/runtime/ollama.ts` (implement `embed`)
- Modify: `src/runtime/mlx-server.ts` (`embed` throws `MemoryError`)
- Create: `src/memory/embed.ts`
- Test: `tests/memory/embed.test.ts`

**Interfaces:**
- Produces: `RuntimeControl.embed(model: string, texts: string[]): Promise<number[][]>`; `probeEmbedder(model: string, baseUrl?: string): Promise<{ dim: number; maxInput: number }>`; `embedderDecl(model: string): ModelDeclaration` (weights-only: `footprint.kvBytesPerToken = 0`); `makeEmbedder(deps): { embed(texts: string[]): Promise<number[][]> }` that ensure-loads via the Model Manager then calls `control.embed`, wrapped in `withMemoryEmbedSpan`.
- Consumes: `createOllama` pattern from `src/providers/ollama.ts`; `getModelMaxContext`/`/api/show` pattern from `src/runtime/ollama-control.ts`; `ensureReady` from the Model Manager; `ModelDeclaration` from `src/core/types.ts`.

- [ ] **Step 1: Write the failing test** (probe parsing + weights-only decl; embed itself is covered live in Task 12's live test)
```ts
// tests/memory/embed.test.ts
import { describe, expect, test } from 'vitest';
import { embedderDecl } from '../../src/memory/embed.ts';

describe('embedder declaration', () => {
  test('is weights-only (no KV budget)', () => {
    const d = embedderDecl('qwen3-embedding:0.6b');
    expect(d.model).toBe('qwen3-embedding:0.6b');
    expect(d.footprint.kvBytesPerToken).toBe(0);
    expect(d.footprint.approxParamsBillions).toBeGreaterThan(0);
  });
});
```
> Inspect `ModelDeclaration` in `src/core/types.ts` and populate `embedderDecl` with the minimum valid fields (provider Ollama, a small `approxParamsBillions` like 0.6, `bytesPerWeight` matching the quant, `kvBytesPerToken: 0`). Adjust the assertion to the real field names if they differ.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/embed.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Add `embed` to `RuntimeControl`** in `src/runtime/runtime.ts`:
```ts
// inside RuntimeControl type:
embed(model: string, texts: string[]): Promise<number[][]>;
```

- [ ] **Step 4: Implement `embed` in `src/runtime/ollama.ts`** (via AI SDK `embedMany`):
```ts
import { embedMany } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
// baseURL must include /api (see src/providers/ollama.ts)
async function ollamaEmbed(model: string, texts: string[]): Promise<number[][]> {
  const ollama = createOllama({ baseURL: 'http://localhost:11434/api' });
  const { embeddings } = await embedMany({ model: ollama.textEmbeddingModel(model), values: texts });
  return embeddings;
}
// wire ollamaEmbed into the runtime's `control.embed`
```
> If `ollama.textEmbeddingModel` isn't the exact accessor in the installed `ollama-ai-provider-v2@3.6.0`, check its exports (`textEmbeddingModel`/`embedding`) and use the correct one.

- [ ] **Step 5: Implement `embed` in `src/runtime/mlx-server.ts`**:
```ts
import { MemoryError } from '../core/errors.ts';
// control.embed:
async embed(): Promise<number[][]> {
  throw new MemoryError('embeddings are not supported on the MLX runtime yet');
}
```

- [ ] **Step 6: Write `src/memory/embed.ts`**
```ts
import { embedderDecl as _decl } from './embed.ts'; // (placeholder note: define below, don't self-import)
import type { ModelDeclaration } from '../core/types.ts';
import { ProviderKind } from '../core/types.ts';
import { withMemoryEmbedSpan } from '../telemetry/spans.ts';

const DEFAULT_BASE = 'http://localhost:11434';

/** Weights-only model declaration for an embedder (no KV cache). */
export function embedderDecl(model: string): ModelDeclaration {
  return {
    model,
    provider: ProviderKind.Ollama,
    footprint: { approxParamsBillions: 0.6, bytesPerWeight: 1, kvBytesPerToken: 0 },
  } as ModelDeclaration; // fill required fields per src/core/types.ts
}

/** Probe embedder dim + max input via /api/show (mirror getModelMaxContext). */
export async function probeEmbedder(model: string, baseUrl = DEFAULT_BASE): Promise<{ dim: number; maxInput: number }> {
  const res = await fetch(`${baseUrl}/api/show`, { method: 'POST', body: JSON.stringify({ model }) });
  const data = (await res.json()) as { model_info?: Record<string, unknown> };
  const info = data.model_info ?? {};
  const arch = info['general.architecture'];
  if (typeof arch !== 'string') throw new Error(`cannot probe embedder ${model}`);
  const dim = info[`${arch}.embedding_length`];
  const maxInput = info[`${arch}.context_length`];
  return {
    dim: typeof dim === 'number' ? dim : 768,
    maxInput: typeof maxInput === 'number' ? maxInput : 2048,
  };
}

export type EmbedderDeps = {
  ensureReady: (decl: ModelDeclaration) => Promise<number>;
  control: { embed(model: string, texts: string[]): Promise<number[][]> };
  model: string;
};

/** Manager-backed embedder: ensure-loaded (weights-only) then embed, traced. */
export function makeEmbedder(deps: EmbedderDeps) {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      await deps.ensureReady(embedderDecl(deps.model));
      return withMemoryEmbedSpan({ model: deps.model, count: texts.length }, () =>
        deps.control.embed(deps.model, texts),
      );
    },
  };
}
```
> Remove the bogus self-import line; it's only there to flag "define `embedderDecl` in this file." Fill `embedderDecl` with the REAL required `ModelDeclaration` fields (open `src/core/types.ts`). `MemoryError` import only where used.

- [ ] **Step 7: Run tests + typecheck**
Run: `bun test tests/memory/embed.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add src/runtime/runtime.ts src/runtime/ollama.ts src/runtime/mlx-server.ts src/memory/embed.ts tests/memory/embed.test.ts
git commit -m "feat(memory): embeddings via runtime port (weights-only, manager-backed)"
```

---

