### Task 8: Model-degradation chain

**Files:**
- Create: `src/reliability/degrade.ts`
- Test: `tests/reliability/degrade.test.ts`

**Interfaces:**
- Consumes: `ModelDeclaration` from `src/core/types.ts` (fields used: `model: string`, `runtime: RuntimeKind`, `fallbackModel?: string`); `RuntimeKind` from `src/core/types.ts`.
- Produces:
  - `type FailureDomain = string` — an identity for "the thing that could be down" (runtime + endpoint). Two declarations sharing a domain must not be tried back-to-back on a RouteWorthy failure.
  - `failureDomain(decl: ModelDeclaration): FailureDomain`
  - `degradeChain(candidates: ModelDeclaration[]): ModelDeclaration[]` — reorders so consecutive entries never share a failure domain where a differing-domain candidate exists (stable otherwise).

Note: `resolveModel` already walks candidates best-first; `degrade.ts` supplies the failure-domain-aware ORDERING it should walk, so an unreachable Ollama daemon isn't retried by picking another Ollama model next when an MLX candidate exists.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/degrade.test.ts
import { describe, expect, it } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { degradeChain, failureDomain } from '../../src/reliability/degrade.ts';
import type { ModelDeclaration } from '../../src/core/types.ts';

function decl(model: string, runtime: RuntimeKind): ModelDeclaration {
  return { role: 'general', model, runtime, requires: [] } as unknown as ModelDeclaration;
}

describe('failureDomain', () => {
  it('same runtime → same domain; different runtime → different domain', () => {
    expect(failureDomain(decl('a', RuntimeKind.Ollama))).toBe(
      failureDomain(decl('b', RuntimeKind.Ollama)),
    );
    expect(failureDomain(decl('a', RuntimeKind.Ollama))).not.toBe(
      failureDomain(decl('a', RuntimeKind.MlxServer)),
    );
  });
});

describe('degradeChain', () => {
  it('interleaves so consecutive entries avoid the same failure domain', () => {
    const chain = degradeChain([
      decl('o1', RuntimeKind.Ollama),
      decl('o2', RuntimeKind.Ollama),
      decl('m1', RuntimeKind.MlxServer),
    ]);
    // first is still the best (o1); second must switch domain (m1), not o2
    expect(chain[0].model).toBe('o1');
    expect(failureDomain(chain[1])).not.toBe(failureDomain(chain[0]));
  });

  it('is a stable passthrough when all share one domain', () => {
    const input = [decl('o1', RuntimeKind.Ollama), decl('o2', RuntimeKind.Ollama)];
    expect(degradeChain(input).map((d) => d.model)).toEqual(['o1', 'o2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/degrade.test.ts`
Expected: FAIL — cannot resolve `degrade.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/degrade.ts
import type { ModelDeclaration } from '../core/types.ts';

/** Identity of the thing that could be down. Today: the runtime. */
export type FailureDomain = string;

export function failureDomain(decl: ModelDeclaration): FailureDomain {
  return String(decl.runtime);
}

/**
 * Reorder candidates (already best-first) so no two CONSECUTIVE entries share a
 * failure domain when a different-domain candidate is available — so a dead
 * daemon isn't "degraded" to another model behind the same daemon. Stable:
 * relative order within a domain is preserved; falls back to the input order
 * when only one domain exists.
 */
export function degradeChain(candidates: ModelDeclaration[]): ModelDeclaration[] {
  const remaining = [...candidates];
  const out: ModelDeclaration[] = [];
  let lastDomain: FailureDomain | undefined;
  while (remaining.length > 0) {
    let idx = remaining.findIndex((d) => failureDomain(d) !== lastDomain);
    if (idx === -1) idx = 0; // only same-domain left
    const [picked] = remaining.splice(idx, 1);
    out.push(picked);
    lastDomain = failureDomain(picked);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/degrade.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/degrade.ts" "tests/reliability/degrade.test.ts"
git add src/reliability/degrade.ts tests/reliability/degrade.test.ts
git commit -m "feat(reliability): failure-domain-aware model-degrade chain"
```

---

