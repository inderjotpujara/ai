### Task 6: Usage/cost rollup + `bun run usage`

**Files:**
- Create: `src/usage/aggregate.ts`
- Create: `src/cli/usage.ts`
- Create: `tests/usage/aggregate.test.ts`
- Modify: `package.json` (`"usage": "bun run src/cli/usage.ts"`)

**Interfaces:**
- Consumes: `readSpans` from `src/run/run-trace.ts` (returns `{ spans: SpanRecord[] }`); span attrs `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `span.durationMs`.
- Produces:
  - `aggregateSpans(spans: SpanRecord[]): UsageRow[]` where `UsageRow = { model: string; inputTokens: number; outputTokens: number; durationMs: number; calls: number }` (grouped by model; tolerant of missing token attrs — treats absent as 0).
  - `renderUsage(rows: UsageRow[]): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/usage/aggregate.test.ts
import { expect, test } from 'bun:test';
import { aggregateSpans } from '../../src/usage/aggregate.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(model: string, inp?: number, out?: number, dur = 100): SpanRecord {
  return { name: 'agent.delegation', kind: 0, traceId: 't', spanId: 's', parentSpanId: null,
    startUnixNano: 0, endUnixNano: 0, durationMs: dur, status: { code: 0 },
    attributes: { 'gen_ai.request.model': model, ...(inp !== undefined ? { 'gen_ai.usage.input_tokens': inp } : {}), ...(out !== undefined ? { 'gen_ai.usage.output_tokens': out } : {}) },
    events: [] };
}
test('aggregates tokens + duration + calls by model, tolerating missing tokens', () => {
  const rows = aggregateSpans([span('qwen2.5:14b', 100, 50), span('qwen2.5:14b'), span('qwen-fast', 10, 5, 40)]);
  const big = rows.find((r) => r.model === 'qwen2.5:14b');
  expect(big).toEqual({ model: 'qwen2.5:14b', inputTokens: 100, outputTokens: 50, durationMs: 200, calls: 2 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/usage/aggregate.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/usage/aggregate.ts
import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';
export type UsageRow = { model: string; inputTokens: number; outputTokens: number; durationMs: number; calls: number };

export function aggregateSpans(spans: SpanRecord[]): UsageRow[] {
  const by = new Map<string, UsageRow>();
  for (const s of spans) {
    const model = s.attributes['gen_ai.request.model'] as string | undefined;
    if (!model) continue;
    const row = by.get(model) ?? { model, inputTokens: 0, outputTokens: 0, durationMs: 0, calls: 0 };
    row.inputTokens += Number(s.attributes['gen_ai.usage.input_tokens'] ?? 0);
    row.outputTokens += Number(s.attributes['gen_ai.usage.output_tokens'] ?? 0);
    row.durationMs += s.durationMs;
    row.calls += 1;
    by.set(model, row);
  }
  return [...by.values()].sort((a, b) => b.durationMs - a.durationMs);
}
export function renderUsage(rows: UsageRow[]): string {
  const head = 'MODEL                         IN      OUT     MS      CALLS';
  const body = rows.map((r) => `${r.model.padEnd(28)}  ${String(r.inputTokens).padEnd(6)}  ${String(r.outputTokens).padEnd(6)}  ${String(r.durationMs).padEnd(6)}  ${r.calls}`);
  return [head, ...body].join('\n');
}
```

`src/cli/usage.ts`: `readdir(AGENT_RUNS_ROOT)`, `readSpans` each, flat-map, `aggregateSpans`, print `renderUsage`. Add the `usage` script.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/usage/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/usage/aggregate.ts src/cli/usage.ts tests/usage/aggregate.test.ts package.json
git commit -m "feat(usage): aggregate token/latency by model + 'bun run usage' (from existing span data)"
```

---

