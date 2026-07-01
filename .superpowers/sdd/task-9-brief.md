### Task 9: Manual spans at delegation / model-select / model-load·evict + live e2e

**Files:**
- Modify: `src/core/delegate.ts`, `src/cli/select-hook.ts`, `src/resource/model-manager.ts`
- Test: `tests/core/delegate.test.ts` (add), `tests/integration/run-viewer.live.test.ts` (create)

**Interfaces:**
- Consumes: `withDelegationSpan`, `recordModelSelect`, `withModelLoadSpan`, `recordEvict` (Task 3); `activeKvCacheType` (`src/resource/kv-cache.ts`), `kvCacheBytes` (`src/resource/footprint.ts`).

- [ ] **Step 1: Write the failing delegation test**

Create/extend `tests/core/delegate.test.ts` with:
```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { asDelegateTool } from '../../src/core/delegate.ts';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
});
afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
});

test('asDelegateTool opens an agent.delegation span tagged with the target', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'done' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
  const agent: Agent = { name: 'web_fetch', description: 'fetches', model, systemPrompt: 's', tools: {} };
  const tool = asDelegateTool(agent);
  await tool.execute?.({ task: 'go' }, { toolCallId: 't', messages: [] });
  const del = exporter.getFinishedSpans().find((s) => s.name === 'agent.delegation');
  expect(del).toBeDefined();
  expect(del?.attributes['agent.delegation.target']).toBe('web_fetch');
});
```
> Verify the second arg shape `asDelegateTool(...).execute` expects in this AI-SDK build; if `execute` needs no second arg in tests, call `tool.execute?.({ task: 'go' })` and adjust.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/delegate.test.ts`
Expected: FAIL — no `agent.delegation` span.

- [ ] **Step 3: Wrap delegate execute in a delegation span**

In `src/core/delegate.ts`, add `import { withDelegationSpan } from '../telemetry/spans.ts';` and wrap the `execute` body:
```typescript
    execute: async ({ task }) =>
      withDelegationSpan(agent.name, async () => {
        try {
          const pre = onBeforeDelegate ? await onBeforeDelegate(agent) : undefined;
          if (pre?.abort) {
            return { error: pre.abort };
          }
          const { text } = await runDefinedAgent(agent, task, pre?.numCtx, pre?.model);
          return { text };
        } catch (cause) {
          return { error: `Agent ${agent.name} failed: ${(cause as Error).message}` };
        }
      }),
```

- [ ] **Step 4: Run delegation test to verify it passes**

Run: `bun test tests/core/delegate.test.ts`
Expected: PASS.

- [ ] **Step 5: Emit `agent.model.select` in the select hook**

In `src/cli/select-hook.ts`, add `import { recordModelSelect } from '../telemetry/spans.ts';`, and immediately after `resolveModel` returns `{ decl, numCtx }` (before `deps.notify`), add:
```typescript
      recordModelSelect({
        modelId: decl.model,
        provider: decl.provider,
        numCtx,
        paramsBillions: decl.footprint.approxParamsBillions,
      });
```

- [ ] **Step 6: Wrap load + record eviction in the model manager**

In `src/resource/model-manager.ts`:
- Add imports: `import { recordEvict, withModelLoadSpan } from '../telemetry/spans.ts';` and `import { activeKvCacheType } from './kv-cache.ts';` (confirm `kvCacheBytes` is already imported; it is used at line ~129).
- At the eviction call (current line 152 `await c.unload(evict.name);`), prepend:
```typescript
      const evictReason = pinned.has(evict.name)
        ? 'budget-too-low-evicting-pinned'
        : 'lru-fit';
      recordEvict(evict.name, evict.sizeBytes, evictReason);
```
- Replace the load call (current line 171 `await c.warm(target, chosenCtx);`) with:
```typescript
    await withModelLoadSpan(
      target,
      {
        weightsBytes: weights,
        kvF16PerToken: f16Base,
        kvEffectivePerToken: kvPerToken,
        kvCacheType: activeKvCacheType(),
        chosenCtx,
        requestedCtx: desired,
        footprintBytes: weights + kvCacheBytes(chosenCtx, kvPerToken),
        budgetBytes: freeBudget,
      },
      () => c.warm(target, chosenCtx),
    );
```
> Confirm the in-scope names (`weights`, `f16Base`, `kvPerToken`, `chosenCtx`, `desired`, `freeBudget`) and `kvCacheBytes` signature against the current file before saving.

- [ ] **Step 7: Run the unit suite, typecheck, lint**

Run: `bun run typecheck && bun run lint && bun test`
Expected: green (live tests skip if Ollama down).

- [ ] **Step 8: Create the live e2e test**

Create `tests/integration/run-viewer.live.test.ts`:
```typescript
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Reuse the project's existing live setup helpers (match orchestrator.live.test.ts):
//   building a real orchestrator + manager, and the ollamaReady(...) gate + unloadModel cleanup.
import { ollamaReady } from '../helpers/ollama-ready.ts'; // adjust path to the existing helper
import { readSpans } from '../../src/run/run-trace.ts';
import { renderRun } from '../../src/cli/runs.ts';

const ready = await ollamaReady('qwen3.5:4b');

describe.skipIf(!ready)('live run-viewer (real Ollama)', () => {
  test(
    'a real run writes spans.jsonl with delegation + model spans, and renders',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'rv-live-'));
      try {
        // Build the same orchestrator/manager wiring chat.ts uses, then:
        //   await runChat({ orchestrator, task: 'Read <file> and summarize', runsRoot: root, runId: 'live-1', ... });
        // (Construct via the existing live helpers; see orchestrator.live.test.ts for the exact setup.)
        const { spans } = await readSpans(join(root, 'live-1'));
        expect(spans.some((s) => s.name === 'agent.run')).toBe(true);
        expect(spans.some((s) => s.name === 'agent.delegation')).toBe(true);
        expect(
          spans.some((s) => s.name.startsWith('ai.generateText')),
        ).toBe(true);
        const out = await renderRun(root, 'live-1');
        expect(out).toContain('agent.run');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
```
> Mirror the EXACT live-setup pattern from `tests/integration/orchestrator.live.test.ts` (gate import, orchestrator/manager construction, `afterAll` `unloadModel`). Fill the run-construction block from that file's helpers rather than re-inventing it.

- [ ] **Step 9: Run the live test if Ollama is up**

Run (only meaningful with `bun run serve` running + models pulled): `bun test tests/integration/run-viewer.live.test.ts`
Expected: PASS, or cleanly SKIPPED when Ollama is down.

- [ ] **Step 10: Final gate + commit**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all green; live skips cleanly.
```bash
git add src/core/delegate.ts src/cli/select-hook.ts src/resource/model-manager.ts tests/core/delegate.test.ts tests/integration/run-viewer.live.test.ts
git commit -m "feat: instrument delegation + model select/load/evict spans; live e2e

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §1.1 OTel-native global provider → Tasks 2, 3, 7. ✓
- §1.2 root + delegation + model lifecycle spans → Tasks 3 (helpers), 7 (root), 9 (delegation/model). ✓
- §1.3 `spans.jsonl` canonical, retire `journal.jsonl`, keep `.txt` → Tasks 1, 7. ✓
- §1.4 terminal viewer + `--follow` → Tasks 5, 6. ✓
- §1.5 OTLP seam wired now → Task 2 (`buildProcessors` + dep). ✓
- §1.6 best-effort / no-op safe → Task 1 (exporter), Task 3 (`getActiveSpan` guards), Task 8 (`isEnabled` w/ no-op fallback). ✓
- §2.1–2.6 components → Tasks 1–6. ✓
- §2.7 wiring (chat/run-chat/agent/delegate/select-hook/manager) → Tasks 7, 8, 9. (Refinement: telemetry lifecycle moved from `chat.ts` to `runChat` for testability — documented in Task 7.) ✓
- §2.8 retirements → Task 7. ✓
- §2.9 deps → Task 1. ✓
- §3 span model → Tasks 3, 7, 8, 9. ✓
- §4 error handling → Task 1 (FAILED), Task 6 (malformed/missing), Task 3 (guards). ✓
- §5 testing (unit/ALS smoke/integration/live) → every task + Task 9 live. ✓
- §7 acceptance → covered by Task 9 live + gates.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to". The two `>` verify-before-save notes (exact in-scope names in manager; AI-SDK `execute` arg shape) are explicit verification instructions with the expected values stated, not deferred work.

**3. Type consistency:** `SpanRecord` (Task 1) used identically in Tasks 4/5/6 tests. `TraceNode`/`RunSummary` (Task 4) consumed by Task 5/6. `ATTR` keys defined once (Task 3) and referenced by string-equal literals in tests. `ModelLoadInfo` fields (Task 3) match the manager call (Task 9). `functionId` added in Task 8 to `RunAgentInput` and passed from `runDefinedAgent`. Consistent.

**Note for executor:** `chat.ts` is intentionally NOT modified — `runChat` now owns telemetry init/shutdown (Task 7). Router pre-warm spans in `chat.ts` are out of trace scope by design.
