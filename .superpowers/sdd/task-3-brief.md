## Task 3: Telemetry spans (additive)

**Files:**
- Modify: `src/telemetry/spans.ts`
- Test: `tests/memory/spans.test.ts`

**Interfaces:**
- Produces: `ATTR.MEMORY_SPACE`, `MEMORY_NAMESPACE`, `MEMORY_CANDIDATES`, `MEMORY_RETURNED`, `MEMORY_RERANKED`, `MEMORY_EMBED_MODEL`; `withMemoryRecallSpan<T>(info, fn)`, `withMemoryIngestSpan<T>(info, fn)`, `withMemoryEmbedSpan<T>(info, fn)`.
- Consumes: the existing `inSpan`/`ATTR` and OTel test provider (`tests/helpers/otel-test-provider.ts`).

> Follow the EXACT pattern already used by `withWorkflowSpan`/`withStepSpan` in `src/telemetry/spans.ts` (open a span named `memory.recall`/`memory.ingest`/`memory.embed`, set attributes, run `fn`, record errors). Read that file first and mirror it.

- [ ] **Step 1: Write the failing test**
```ts
// tests/memory/spans.test.ts
import { describe, expect, test } from 'vitest';
import { withTestTelemetry } from '../helpers/otel-test-provider.ts';
import { withMemoryRecallSpan } from '../../src/telemetry/spans.ts';

describe('memory spans', () => {
  test('recall span records space + counts', async () => {
    const spans = await withTestTelemetry(async () => {
      await withMemoryRecallSpan(
        { space: 'default', namespace: 'crew:x', candidates: 20, returned: 5, reranked: false },
        async () => 'ok',
      );
    });
    const s = spans.find((sp) => sp.name === 'memory.recall');
    expect(s).toBeDefined();
    expect(s?.attributes['memory.space']).toBe('default');
    expect(s?.attributes['memory.returned']).toBe(5);
  });
});
```
> If the project's OTel test helper has a different name/shape, adapt this test to match `tests/helpers/otel-test-provider.ts` and the way `tests/**` assert on `withWorkflowSpan`.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/spans.test.ts`
Expected: FAIL (`withMemoryRecallSpan` undefined).

- [ ] **Step 3: Extend `ATTR` and add the three span helpers** in `src/telemetry/spans.ts`, mirroring `withStepSpan`:
```ts
// add to ATTR object:
MEMORY_SPACE: 'memory.space',
MEMORY_NAMESPACE: 'memory.namespace',
MEMORY_CANDIDATES: 'memory.candidates',
MEMORY_RETURNED: 'memory.returned',
MEMORY_RERANKED: 'memory.reranked',
MEMORY_EMBED_MODEL: 'memory.embed_model',

// new helpers (shape mirrors existing withStepSpan):
export function withMemoryRecallSpan<T>(
  info: { space: string; namespace?: string; candidates?: number; returned?: number; reranked?: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('memory.recall', async (span) => {
    span.setAttribute(ATTR.MEMORY_SPACE, info.space);
    if (info.namespace) span.setAttribute(ATTR.MEMORY_NAMESPACE, info.namespace);
    if (info.candidates != null) span.setAttribute(ATTR.MEMORY_CANDIDATES, info.candidates);
    if (info.returned != null) span.setAttribute(ATTR.MEMORY_RETURNED, info.returned);
    if (info.reranked != null) span.setAttribute(ATTR.MEMORY_RERANKED, info.reranked);
    return fn();
  });
}
export function withMemoryIngestSpan<T>(
  info: { space: string; source: string; chunks?: number }, fn: () => Promise<T>,
): Promise<T> {
  return inSpan('memory.ingest', async (span) => {
    span.setAttribute(ATTR.MEMORY_SPACE, info.space);
    span.setAttribute('memory.source', info.source);
    if (info.chunks != null) span.setAttribute('memory.chunks', info.chunks);
    return fn();
  });
}
export function withMemoryEmbedSpan<T>(
  info: { model: string; count: number }, fn: () => Promise<T>,
): Promise<T> {
  return inSpan('memory.embed', async (span) => {
    span.setAttribute(ATTR.MEMORY_EMBED_MODEL, info.model);
    span.setAttribute('memory.count', info.count);
    return fn();
  });
}
```
> Use the real `inSpan` signature from the file. If `inSpan` isn't exported/available, mirror however `withStepSpan` opens its span.

- [ ] **Step 4: Run tests to verify they pass**
Run: `bun test tests/memory/spans.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/telemetry/spans.ts tests/memory/spans.test.ts
git commit -m "feat(telemetry): memory recall/ingest/embed spans + ATTR.MEMORY_*"
```

---

