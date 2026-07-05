### Task 7: Degradation ledger

**Files:**
- Create: `src/reliability/ledger.ts`
- Test: `tests/reliability/ledger.test.ts`

**Interfaces:**
- Produces:
  - `enum DegradeKind { ModelDegraded, AgentDropped, ToolSkipped, Retried, CircuitOpen }`
  - `type DegradeEvent = { kind: DegradeKind; subject: string; reason: string; detail?: string }`
  - `type DegradationLedger = { events: DegradeEvent[]; record(e: DegradeEvent): void }`
  - `createLedger(): DegradationLedger`
  - `formatLedger(ledger: DegradationLedger): string` (concise multi-line user summary; `''` when empty)
  - `serializeLedger(ledger: DegradationLedger): string` (JSONL, one event per line)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/ledger.test.ts
import { describe, expect, it } from 'bun:test';
import { DegradeKind, createLedger, formatLedger, serializeLedger } from '../../src/reliability/ledger.ts';

describe('DegradationLedger', () => {
  it('records events in order', () => {
    const l = createLedger();
    l.record({ kind: DegradeKind.AgentDropped, subject: 'pdf_agent', reason: 'mcp server down' });
    l.record({ kind: DegradeKind.ModelDegraded, subject: 'writer', reason: 'runtime unreachable', detail: 'mlx→ollama' });
    expect(l.events).toHaveLength(2);
    expect(l.events[0].subject).toBe('pdf_agent');
  });

  it('formatLedger returns empty string with no events', () => {
    expect(formatLedger(createLedger())).toBe('');
  });

  it('formatLedger summarizes events for the user', () => {
    const l = createLedger();
    l.record({ kind: DegradeKind.AgentDropped, subject: 'pdf_agent', reason: 'mcp server down' });
    const out = formatLedger(l);
    expect(out).toContain('pdf_agent');
    expect(out).toContain('mcp server down');
  });

  it('serializeLedger emits one JSON object per line', () => {
    const l = createLedger();
    l.record({ kind: DegradeKind.Retried, subject: 'download', reason: 'ECONNRESET' });
    const lines = serializeLedger(l).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).subject).toBe('download');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/ledger.test.ts`
Expected: FAIL — cannot resolve `ledger.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/ledger.ts
/** In-run record of degradation events; surfaced to the user + telemetry. */
export enum DegradeKind {
  ModelDegraded = 'model_degraded',
  AgentDropped = 'agent_dropped',
  ToolSkipped = 'tool_skipped',
  Retried = 'retried',
  CircuitOpen = 'circuit_open',
}

export type DegradeEvent = {
  kind: DegradeKind;
  subject: string;
  reason: string;
  detail?: string;
};

export type DegradationLedger = {
  events: DegradeEvent[];
  record(e: DegradeEvent): void;
};

export function createLedger(): DegradationLedger {
  const events: DegradeEvent[] = [];
  return {
    events,
    record(e) {
      events.push(e);
    },
  };
}

const LABEL: Record<DegradeKind, string> = {
  [DegradeKind.ModelDegraded]: 'degraded model',
  [DegradeKind.AgentDropped]: 'dropped agent',
  [DegradeKind.ToolSkipped]: 'skipped tool',
  [DegradeKind.Retried]: 'retried',
  [DegradeKind.CircuitOpen]: 'circuit open',
};

/** Concise user-facing summary; empty string when nothing degraded. */
export function formatLedger(ledger: DegradationLedger): string {
  if (ledger.events.length === 0) return '';
  const lines = ledger.events.map((e) => {
    const tail = e.detail ? ` (${e.detail})` : '';
    return `  ⚠ ${LABEL[e.kind]}: ${e.subject} — ${e.reason}${tail}`;
  });
  return `Degraded during this run:\n${lines.join('\n')}`;
}

/** JSONL for persistence into run.dir. */
export function serializeLedger(ledger: DegradationLedger): string {
  return ledger.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/ledger.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/ledger.ts" "tests/reliability/ledger.test.ts"
git add src/reliability/ledger.ts tests/reliability/ledger.test.ts
git commit -m "feat(reliability): degradation ledger (record/format/serialize)"
```

---

