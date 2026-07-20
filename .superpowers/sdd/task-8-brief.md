### Task 8: Config knobs + telemetry keys + trigger spans

**Files:**
- Modify: `src/config/schema.ts` (append a "Triggers (Slice 25)" group), `src/telemetry/spans.ts` (`ATTR`)
- Create: `src/triggers/spans.ts`
- Test: `tests/triggers/spans.test.ts`, `tests/config/trigger-knobs.test.ts`

**Interfaces:**
- Consumes: `ATTR`, `inSpan` from `../telemetry/spans.ts`; `trace` from `@opentelemetry/api`; `Trigger`, `TriggerOutcome` from `./types.ts`.
- Produces:
  - `CONFIG_SPEC` entries (each `doc` names its read site, per the no-hardcode rule):
    - `AGENT_TRIGGERS_POLL_MS` (number, def `1000`) — scheduler tick cadence (`scheduler.ts`).
    - `AGENT_TRIGGERS_MAX_CHAIN_DEPTH` (number, def `8`) — §7.3 chain-cycle cap (`fire.ts`).
    - `AGENT_TRIGGERS_WATCH_ROOT` (string, def `'~/.agent/inbox'`) — documented as "the file-watch confinement root; the leading `~` is expanded against the live home dir at the watcher read site (`watcher.ts`/`confine.ts`), the dir is created `0700` on first watcher start, and every file-trigger path is confined under it (§7.4)".
    - `AGENT_TRIGGERS_ENABLED` (boolean, def `false`) — documented as "governs ONLY whether a **standalone** `startWebServer` (no injected daemon queue) auto-constructs and starts its own triggers engine. Defaults OFF so an existing/ad-hoc `startWebServer()` (as every current server test calls it) never spins a scheduler, watches files, or leaves an open handle — the I3 invariant. The **daemon** always constructs+injects its engine explicitly (via `opts.triggers`, ignoring this flag), so the real deployment runs triggers unconditionally; the flag is the standalone-server opt-in (`AGENT_TRIGGERS_ENABLED=1`)." **(No `AGENT_TRIGGERS_PATH` knob — the repo registry is the compile-time `triggers/index.ts` import, so a path override would have no consumer.)**
  - `ATTR` keys: `TRIGGER_ID: 'trigger.id'`, `TRIGGER_TYPE: 'trigger.type'`, `TRIGGER_ORIGIN: 'trigger.origin'`, `TRIGGER_OUTCOME: 'trigger.outcome'`.
  - `src/triggers/spans.ts`: `recordTriggerRegister(t: Trigger): void`, `withTriggerFireSpan<T>(t: Trigger, fn: (rec: { outcome: (o: TriggerOutcome) => void }) => Promise<T>): Promise<T>`, `recordTriggerSkip(t: Trigger, outcome: TriggerOutcome): void`.

- [ ] **Step 1: Write the failing tests** — knobs load with the documented defaults; a fire span sets `TRIGGER_OUTCOME` via the recorder (assert against an in-memory span exporter using the repo's existing test tracer harness, or minimally that the helpers run without a tracer as a no-op):

```ts
import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';
test('trigger knobs carry computed/conventional defaults', () => {
  const { values } = loadConfig({});
  expect(values.AGENT_TRIGGERS_POLL_MS).toBe(1000);
  expect(values.AGENT_TRIGGERS_MAX_CHAIN_DEPTH).toBe(8);
  expect(values.AGENT_TRIGGERS_WATCH_ROOT).toBe('~/.agent/inbox');
  expect(values.AGENT_TRIGGERS_ENABLED).toBe(false);
});
```

```ts
import { expect, test } from 'bun:test';
import { JobKind } from '../../src/queue/types.ts';
import { recordTriggerRegister, withTriggerFireSpan } from '../../src/triggers/spans.ts';
import { TriggerOrigin, TriggerOutcome, TriggerType } from '../../src/triggers/types.ts';
const t = { id: 't1', name: 'n', type: TriggerType.Cron, enabled: true,
  target: { kind: JobKind.Chat, payload: {} }, config: { schedule: '* * * * *' },
  origin: TriggerOrigin.Console, createdAt: 0, updatedAt: 0 };
test('trigger span helpers are a no-op without a tracer', async () => {
  recordTriggerRegister(t); // must not throw
  const out = await withTriggerFireSpan(t, async (rec) => { rec.outcome(TriggerOutcome.Fired); return 42; });
  expect(out).toBe(42);
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — add the four `CONFIG_SPEC` entries (each with a `doc` referencing the read site, per the no-hardcode rule); add the four `ATTR` keys near the Slice-24 daemon block; write `src/triggers/spans.ts` mirroring `src/daemon/spans.ts` exactly (`const tracer = () => trace.getTracer('agent')`, `inSpan('trigger.fire', ...)` for the fire span, `startSpan('trigger.register'|'trigger.skip')` for the one-shots). Set `TRIGGER_ID`/`TYPE`/`ORIGIN` on all three; `withTriggerFireSpan` exposes `rec.outcome` that sets `TRIGGER_OUTCOME`; `recordTriggerSkip` sets `TRIGGER_OUTCOME` from its arg.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/config/schema.ts src/telemetry/spans.ts src/triggers/spans.ts tests/triggers/spans.test.ts tests/config/trigger-knobs.test.ts`.

```bash
git add src/config/schema.ts src/telemetry/spans.ts src/triggers/spans.ts tests/triggers/spans.test.ts tests/config/trigger-knobs.test.ts
git commit -m "feat(triggers): config knobs + telemetry ATTR keys + trigger spans"
```

*Model: Sonnet.*

