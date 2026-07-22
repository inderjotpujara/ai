### Task 2: Config knobs + telemetry ATTR keys + a2a spans (+ `src/a2a/` docs stub)

**Files:**
- Modify: `src/config/schema.ts` (append an "A2A interop (Slice 31)" group after the `AGENT_TRIGGERS_*` block, `schema.ts:618`), `src/telemetry/spans.ts` (`ATTR`), `docs/architecture.md` (the stub — see Standing notes)
- Create: `src/a2a/spans.ts`
- Test: `tests/config/a2a-knobs.test.ts`, `tests/a2a/spans.test.ts`

**Interfaces:**
- Consumes: `ATTR`, `inSpan` from `../telemetry/spans.ts`; `trace` from `@opentelemetry/api`; `TaskStateWire`, `A2aMethod` from `../contracts/index.ts`.
- Produces:
  - `CONFIG_SPEC` entries (each `doc` names its read site, per the no-hardcode rule):
    - `AGENT_A2A_ENABLED` (boolean, def `false`) — "governs whether the EXPOSE surface is live: the card route (`server/a2a/card.ts`) 404s and `POST /api/a2a` (`server/a2a/rpc.ts`) rejects when off. Default OFF so the daemon exposes nothing until an operator authors an allowlist + issues a token from the Federation tab."
    - `AGENT_A2A_CARD_TTL` (number, def `300`) — "card `Cache-Control: max-age` seconds (`a2a/card.ts`)."
    - `AGENT_A2A_REPLAY_WINDOW_MS` (number, def `300_000`) — "inbound request replay window; a request whose timestamp is outside ±window is rejected (`a2a/enroll.ts` / `server/a2a/rpc.ts`, §7.2)."
    - `AGENT_A2A_SKILLS_PATH` (string, def `'a2a-skills.json'`) — "expose allowlist + issued-token-registry store path, mirroring `AGENT_QUEUE_PATH` (`a2a/allowlist.ts` / `a2a/enroll.ts`)."
    - `AGENT_A2A_REMOTES_PATH` (string, def `'~/.config/ai/a2a-remotes.json'`) — "consume remote-agent store; the leading `~` is expanded at the read site (`a2a/remotes.ts`), 0700 dir / 0600 file."
  - `ATTR` keys: `A2A_METHOD: 'a2a.method'`, `A2A_SKILL_ID: 'a2a.skill.id'`, `A2A_TASK_STATE: 'a2a.task.state'`, `A2A_PEER_HOST: 'a2a.peer.host'`, `A2A_OUTCOME: 'a2a.outcome'`.
  - `src/a2a/spans.ts`: `recordA2aCard(info: { cacheHit: boolean }): void`, `withA2aServerTaskSpan<T>(info: { method: A2aMethod; skillId?: string }, fn: (rec: { taskState: (s: TaskStateWire) => void; outcome: (o: string) => void }) => Promise<T>): Promise<T>`, `recordA2aClientDiscover(info: { peerHost: string; outcome: string }): void`, `recordA2aClientInvoke(info: { peerHost: string; method: A2aMethod; taskState?: TaskStateWire }): void`. Every helper is a no-op without a tracer (`trace.getTracer('agent').startSpan(...)` / `inSpan`, ended immediately) — mirror `src/daemon/spans.ts`.

- [ ] **Step 1: Write the failing tests** — knobs load with the documented defaults; the span helpers are a no-op without a tracer:

```ts
import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';
test('A2A knobs carry conventional defaults', () => {
  const { values } = loadConfig({});
  expect(values.AGENT_A2A_ENABLED).toBe(false);
  expect(values.AGENT_A2A_CARD_TTL).toBe(300);
  expect(values.AGENT_A2A_REPLAY_WINDOW_MS).toBe(300_000);
  expect(values.AGENT_A2A_SKILLS_PATH).toBe('a2a-skills.json');
  expect(values.AGENT_A2A_REMOTES_PATH).toBe('~/.config/ai/a2a-remotes.json');
});
```

```ts
import { expect, test } from 'bun:test';
import { A2aMethod, TaskStateWire } from '../../src/contracts/index.ts';
import { recordA2aCard, withA2aServerTaskSpan } from '../../src/a2a/spans.ts';
test('a2a span helpers are a no-op without a tracer', async () => {
  recordA2aCard({ cacheHit: false }); // must not throw
  const out = await withA2aServerTaskSpan(
    { method: A2aMethod.MessageSend, skillId: 's' },
    async (rec) => { rec.taskState(TaskStateWire.Submitted); rec.outcome('ok'); return 7; },
  );
  expect(out).toBe(7);
});
```

- [ ] **Step 2: Run tests to verify they fail** — `bun run test -- -t "A2A knobs"` → FAIL.
- [ ] **Step 3: Write minimal implementation** — append the five `CONFIG_SPEC` entries (`env`/`kind`/`def`/`doc` shape per `schema.ts:17`); add the five `ATTR` keys near the Slice-25 trigger block; write `src/a2a/spans.ts` mirroring `src/daemon/spans.ts` (`const tracer = () => trace.getTracer('agent')`; `inSpan('a2a.server.task', ...)` for the task span; `startSpan('a2a.server.card'|'a2a.client.discover'|'a2a.client.invoke')` one-shots). Set `A2A_METHOD`/`A2A_SKILL_ID` on the task span; `rec.taskState` sets `A2A_TASK_STATE`, `rec.outcome` sets `A2A_OUTCOME`; the client spans set `A2A_PEER_HOST` (**host only**, never a full URL). **Land the `src/a2a/` docs stub** in `docs/architecture.md` (near the §24 Queue/Daemon section) so `docs:check` passes from this first `src/a2a/` file:

```markdown
### `src/a2a/` — A2A interop (Slice 31, stub)

One A2A v1.0 layer over the Slice-24 daemon + queue. EXPOSE: an Agent Card
(`GET /.well-known/agent-card.json`) + JSON-RPC (`POST /api/a2a`) map an inbound
task onto `JobStore.enqueue` (`origin=Remote`) behind a least-privilege skill
allowlist and a separate A2A Bearer. CONSUME: remote A2A agents are discovered,
validated, hash-pinned, and mounted as `delegate_to_<name>` specialists through
the existing MCP mount path.

> Stub — expanded into the full subsystem writeup (module map, data-flow edges,
> the `POST /api/a2a` route class) in this slice's docs task (Task 29).
```

- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/config/schema.ts src/telemetry/spans.ts src/a2a/spans.ts tests/config/a2a-knobs.test.ts tests/a2a/spans.test.ts && bun run docs:check` (docs-check PASSES via the stub).

```bash
git add src/config/schema.ts src/telemetry/spans.ts src/a2a/spans.ts docs/architecture.md tests/config/a2a-knobs.test.ts tests/a2a/spans.test.ts
git commit -m "feat(a2a): config knobs + telemetry ATTR keys + a2a spans (+ src/a2a docs stub)"
```

*Model: Sonnet.*

