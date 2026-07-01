## Task 1: `MemoryError` + core types + config validation

**Files:**
- Modify: `src/core/errors.ts`
- Create: `src/memory/types.ts`
- Create: `src/memory/define.ts`
- Test: `tests/memory/define.test.ts`

**Interfaces:**
- Produces: `MemoryError`; all types in §2.1 of the spec; `defineMemory(config: MemoryConfig): Required<Pick<MemoryConfig,'path'|'embedModel'>>` (resolves env fallbacks, validates).

- [ ] **Step 1: Write the failing test**
```ts
// tests/memory/define.test.ts
import { describe, expect, test } from 'vitest';
import { defineMemory } from '../../src/memory/define.ts';
import { MemoryError } from '../../src/core/errors.ts';

describe('defineMemory', () => {
  test('applies fallback defaults', () => {
    const cfg = defineMemory({});
    expect(cfg.path).toBe('memory');
    expect(cfg.embedModel).toBe('qwen3-embedding:0.6b');
  });
  test('honors explicit values', () => {
    const cfg = defineMemory({ path: '/tmp/mem', embedModel: 'bge-m3' });
    expect(cfg.path).toBe('/tmp/mem');
    expect(cfg.embedModel).toBe('bge-m3');
  });
  test('rejects empty path', () => {
    expect(() => defineMemory({ path: '  ' })).toThrow(MemoryError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/define.test.ts`
Expected: FAIL (module not found / `defineMemory` undefined).

- [ ] **Step 3: Add `MemoryError`**
```ts
// append to src/core/errors.ts
/** A memory/RAG definition, storage, or retrieval error. */
export class MemoryError extends FrameworkError {}
```

- [ ] **Step 4: Write `src/memory/types.ts`** — copy the type block from spec §2.1 verbatim (`MemoryKind` enum, `MemoryRecord`, `SpaceMeta`, `Chunk`, `RetrievalResult`, `RecallOptions`, `MemoryConfig`).

- [ ] **Step 5: Write `src/memory/define.ts`**
```ts
import { MemoryError } from '../core/errors.ts';
import type { MemoryConfig } from './types.ts';

const DEFAULT_PATH = 'memory';
const DEFAULT_EMBED = 'qwen3-embedding:0.6b';

export type ResolvedMemoryConfig = { path: string; embedModel: string };

/** Resolve + validate memory config. Env is fallback-only. */
export function defineMemory(config: MemoryConfig = {}): ResolvedMemoryConfig {
  const path = (config.path ?? process.env.AGENT_MEMORY_PATH ?? DEFAULT_PATH).trim();
  if (!path) throw new MemoryError('memory path must be non-empty');
  const embedModel = (config.embedModel ?? process.env.AGENT_MEMORY_EMBED_MODEL ?? DEFAULT_EMBED).trim();
  if (!embedModel) throw new MemoryError('embed model must be non-empty');
  return { path, embedModel };
}
```

- [ ] **Step 6: Run tests to verify they pass**
Run: `bun test tests/memory/define.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**
```bash
git add src/core/errors.ts src/memory/types.ts src/memory/define.ts tests/memory/define.test.ts
git commit -m "feat(memory): MemoryError, core types, config validation"
```

---

