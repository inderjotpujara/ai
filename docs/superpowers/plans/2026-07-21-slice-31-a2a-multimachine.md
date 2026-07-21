# Slice 31 — Multi-Machine + A2A Interop (web-focused) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put **one A2A v1.0 layer** over the shipped Slice-24 daemon + queue, driven from the web console. **EXPOSE** our orchestrator (Agent Card at `GET /.well-known/agent-card.json` + JSON-RPC at `POST /api/a2a`, task states mapped onto `JobStore.enqueue`, streaming re-framed from the run-stream) behind a **least-privilege skill allowlist** and a **separate out-of-band A2A Bearer**; **CONSUME** external A2A agents as mounted `delegate_to_<name>` specialists (discover → validate → pin → mount via the existing MCP mount path). Primary UX = a new **Federation** tab under `web/src/features/ops/`; a thin `agent a2a …` CLI is the fallback. Fail-safe: `AGENT_A2A_ENABLED` default off.

**Architecture:** A new `src/a2a/` subsystem — small, loosely-coupled modules: `card.ts` (build/serve the card from the allowlist), `allowlist.ts` (the `a2a-skills.json` least-privilege store + skill→`JobKind`/ref resolution), `task-map.ts` (`OrchestratorResult`/`JobStatus` ↔ A2A `Task`-state bijection incl. fail-closed mid-run consent → typed `failed`), `server.ts` (JSON-RPC dispatch behind `POST /api/a2a`: `message/send`/`message/stream`/`tasks/get`/`tasks/cancel`/`tasks/resubscribe`), `stream.ts` (re-frames `handleRunStream` events as `TaskStatusUpdate`/`TaskArtifactUpdate`), `enroll.ts` (A2A Bearer HMAC-from-root issue/verify/revoke), `client.ts` (CONSUME: remote HTTP+SSE discover/validate/pin/invoke), `remotes.ts` (the `~/.config/ai/a2a-remotes.json` store), `spans.ts` (the `a2a.*` telemetry). Inbound tasks enqueue onto the **existing** `jobs.db` queue with `origin=RunOrigin.Remote`; the worker flips task state; streaming reuses the ONE SSE engine (`src/server/runs/stream.ts`). Consume mounts through `mountAll`→`MountedRegistry.forAgent`→`createSuperAgent` `toolsFor` so a remote agent inherits the guardrails/breaker/`agent.delegation` span for free. Contracts are isomorphic Zod (`src/contracts/a2a.ts`), guarded by a parity test. Web: a Federation tab (`web/src/features/ops/federation-tab.tsx`) with Expose + Consume panels, `apiFetch(path,{schema})` hooks, no query lib.

**Tech Stack:** Bun + TypeScript, Zod v4 contracts, `bun:sqlite` (reuses the Slice-24 `jobs.db`), Node `crypto` (HMAC / SHA-256 canonical card hash / constant-time compare), React 19 web console (`apiFetch`, no query lib, `@tanstack/react-router`), OpenTelemetry spans. **New deps: NONE** (hand-rolled JSON-RPC + SSE over the existing server; `@a2a-js/sdk` explicitly NOT adopted — D1).

**Model tiering (for the SDD controller):** **Sonnet** is the floor for contracts, config/telemetry keys, card build, routes, remotes store, the web Federation tab, the CLI, and docs. **Opus** for the shared-seam hard logic — `task-map.ts`, `server.ts`, `enroll.ts`, `client.ts`, mount wiring — and for the shared-seam reviews. **Opus/ultracode ADVERSARIAL-VERIFY** for the four §7 hard parts (7.1 task-state mapping + fail-closed no-hang consent, 7.2 inbound auth + untrusted-content boundary, 7.3 card spoofing/hash-pinning/SSRF, 7.4 least-privilege allowlist) — the §7-flagged tasks below carry an explicit ADVERSARIAL-VERIFY tag so the controller runs the extra verify. **Fable** whole-branch capstone before land (weekly-Fable headroom permitting; else Opus ultracode). Per-task loop = task-brief → implementer → review-package → task-reviewer → fix → ledger entry. Re-run `ccusage blocks --active` at every increment-boundary gate and throttle per the budget-tiering rule.

## Global Constraints

- **bun only, never npm.** Per-task gate = `bun run typecheck` AND `bun run lint:file -- <files>` AND focused `bun run test -- -t "<name>"` — all three (bun test type-checks nothing; pre-commit is docs:check only). Web tasks gate = `cd web && bun run typecheck && bun run test`.
- **Full `bun run check`** (docs-check · typecheck · lint · check:web · test) at each increment boundary-gate task. Don't merge red.
- **TDD every task:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. Implementers run FOCUSED tests inline + commit per task (conventional format `type(scope): summary`, ending with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer). The controller runs the full suite between tasks.
- **Repo style:** prefer `type` over `interface`; **string enums over literal unions** for finite named sets (`enum Foo { A = 'A' }`) — **`TaskStateWire` and the A2A method set are string enums**; discriminated object unions (`Part`) stay `type` with an enum/`z.literal` discriminant; early returns over nested conditionals; small focused files; **no `console.log`** (use `src/log/logger.ts` or the injected `print`).
- **Never hardcode model choices / budgets / limits.** New tunables go through `src/config/schema.ts` (`CONFIG_SPEC`, appended after the Slice-25 `AGENT_TRIGGERS_*` block at `schema.ts:618`); defaults are computed or conventional (the card `url` derives from the existing Slice-24 bind-address / tunnel-origin config — no new transport knob); env vars are fallback-only.
- **New deps: none.** Do not add `@a2a-js/sdk` (D1) or any transport/JSON-RPC library — the subset is hand-rolled over `Bun.serve` + Node `crypto`.
- **Provider/runtime-agnostic:** inbound tasks target existing `JobKind`s only and enqueue through the same `JobStore.enqueue` every launch path uses (`src/server/jobs/enqueue.ts:71`) — no per-runtime branching. Consume mounts through the ONE MCP mount path — no bespoke delegation path.
- **Security is not negotiable on the hard parts (§7.1–7.4):** constant-time Bearer compare (reuse the `timingSafeEqual`-with-length-guard idiom from `src/server/security/session-token.ts:57`), Bearer verify BEFORE JSON-RPC parse, a replay window/nonce on inbound requests, body-size cap (reuse `maxRequestBodySize`, `src/server/main.ts:573`), inbound `Message.parts` treated as UNTRUSTED (delimited, never instructions), card fetch with `redirect:'error'` (reuse `noRedirectFetch`, `src/mcp/http-redirect.ts`), SHA-256 pin over a **canonicalized** card body, the allowlist as the whole boundary (resolve-then-reject, never fall through to a generic run). **No secret** (A2A Bearer, full card body, untrusted task text) ever appears in a log / DTO / span.
- **Fail-safe:** `AGENT_A2A_ENABLED` defaults off; the card route 404s when disabled; an empty allowlist ⇒ the card is served with `skills:[]` (nothing callable). Discovery is public; invocation is Bearer-gated.
- **Docs hard line (all four surfaces, same push, or the pre-push slice-landing gate blocks):** `docs/architecture.md`, root `README.md` (Status line + slice table row + feature paragraph), `docs/ROADMAP.md` (flip the markers), and the SDD ledger `.superpowers/sdd/progress.md`. Regenerate the interactive architecture-snapshot Artifact (tooling can only remind).

## Standing notes (carried by every task; audited by the final review against the diff)

**Architecture-doc update (`docs/architecture.md`).** Add a new subsystem section **"§ `src/a2a/` — A2A interop"** (card → JSON-RPC server → task-map onto the queue → stream re-framer → enroll → client; the EXPOSE and CONSUME data-flow lanes matching `docs/diagrams/slice-31-a2a-multimachine/a2a-interop.png`). Update **§24 (daemon/queue)** for the new `POST /api/a2a` route class + `GET /.well-known/agent-card.json` served outside the `/api` guard, and the inbound-task → `JobStore.enqueue` (`origin=Remote`) edge. Update **§14/§15 (MCP mount registry)** to note the consume-side reuse (remote A2A agent mounted as a `ToolSet` via `mountAll`→`forAgent`). Update the **Jobs & Triggers Ops Console** section for the new **Federation tab**, and the module map / doc-map / README pointer if a living doc is added. `scripts/docs-check.ts` hard-fails on any undocumented top-level `src/<subsystem>`, and `.githooks/pre-commit` runs it with NO bypass — so the VERY FIRST `src/a2a/` file (Task 2) would block its own commit. To avoid that, **Task 2 lands a minimal `src/a2a/` STUB section in `docs/architecture.md` in the same commit** (so the `arch.includes('src/a2a')` substring check passes from the first commit on); Task 29 EXPANDS that stub into the full subsystem writeup. Consequently `bun run docs:check` passes throughout the slice — no boundary-gate needs a docs-check exemption.

**Telemetry to emit.** New spans via the existing `inSpan`/`ATTR` conventions (`src/telemetry/spans.ts`; no parallel emission path, no-op without a tracer — mirror `src/daemon/spans.ts`): `a2a.server.task` (inbound: method, skillId, mapped `JobKind`, final task state, outcome), `a2a.server.card` (card served / cache hit), `a2a.client.discover` (fetch+validate+pin outcome), `a2a.client.invoke` (remote base-URL **host only**, method, task state). New `ATTR` keys `A2A_METHOD`, `A2A_SKILL_ID`, `A2A_TASK_STATE`, `A2A_PEER_HOST`, `A2A_OUTCOME`. The consume-side delegation **reuses the existing `agent.delegation` span** (`withDelegationSpan`, `src/telemetry/spans.ts:447`) — **no duplicate span** for the mounted-remote hop. **No secret values** in any span/attr. The `POST /api/a2a` + `/api/a2a/*` + `/.well-known/agent-card.json` request spans nest under `withServerRequestSpan` (`spans.ts:301`) like every other route.

---

## File Structure (decomposition lock-in)

**New engine modules (`src/a2a/`):**
- `spans.ts` — `recordA2aCard` / `withA2aServerTaskSpan` / `recordA2aClientDiscover` / `recordA2aClientInvoke` (mirrors `src/daemon/spans.ts`).
- `allowlist.ts` — `createA2aAllowlist` (the `a2a-skills.json` store: `skillId → { kind: JobKind, ref }`, author-time + invoke-time ref resolution against `AGENTS`/`getCrew`/`getWorkflow`).
- `card.ts` — `buildAgentCard` (v1.0 card from the allowlist; ETag; `skills:[]` when empty).
- `task-map.ts` — `orchestratorResultToTask` / `jobStatusToTaskState` / `resultToJsonRpcError` (the §7.1 bijection).
- `server.ts` — `handleA2aRpc` (JSON-RPC dispatch: `message/send`, `tasks/get`, `tasks/cancel`; parts→payload UNTRUSTED; resolve-then-reject).
- `stream.ts` — `a2aStreamFromRun` (re-frames `handleRunStream` events; `message/stream` + `tasks/resubscribe`; fail-closed mid-run consent surfaces as a typed `failed`/`consent-unavailable` terminal frame — no round-trip).
- `enroll.ts` — `createA2aEnrollment` (A2A Bearer HMAC-from-root: issue/verify/revoke; the issued-token registry).
- `client.ts` — `createA2aClient` (discover→validate→pin→invoke; `canonicalizeCard` + `hashCard`; mount-as-`ToolSet`).
- `remotes.ts` — `createRemoteStore` (`~/.config/ai/a2a-remotes.json`, 0700/0600 atomic).

**New server routes:**
- `src/server/a2a/{rpc,card,config,skills,token,remotes,remotes-test}.ts` — the protocol handler + the console-backing API handlers.

**New CLI:**
- `src/cli/a2a.ts` — `agent a2a skills|token|remotes|call|card`.

**New web (`web/src/features/ops/`):**
- `use-a2a-config.ts`, `use-a2a-remotes.ts` — hooks (mirror `use-devices.ts`).
- `federation-tab.tsx` — Expose + Consume panels (`data-testid="ops-federation"`).
- `skill-allowlist-editor.tsx`, `card-preview.tsx`, `token-issue.tsx` — Expose-panel pieces.
- `add-remote-dialog.tsx` — Consume "Add remote agent" (mirrors `pair-device-dialog.tsx` + the MCP add form).

**Modified files:**
- `src/contracts/a2a.ts` (new; re-exported by `src/contracts/index.ts`'s `export *`).
- `src/config/schema.ts` — the five `AGENT_A2A_*` knobs (appended after the `AGENT_TRIGGERS_*` block).
- `src/telemetry/spans.ts` — the five `A2A_*` `ATTR` keys.
- `src/server/app.ts` — the `GET /.well-known/agent-card.json` branch (in `buildFetch`, after perimeter, before the `/api` guard), the `POST /api/a2a` session-guard exception + route, and the `/api/a2a/*` console API routes.
- `web/src/features/ops/index.tsx` — register the Federation tab (`OpsTab` enum + `TABS`).
- `web/src/app/router.tsx` — extend `OpsSearch`/`validateSearch` with `'federation'`.

---

## Increment 1 — Contracts + type spine + telemetry foundation

Establishes the isomorphic A2A contracts (parity-guarded), the config knobs, and the telemetry seam. Lands the `src/a2a/` docs stub so `docs:check` is green from the first `src/a2a/` file onward.

### Task 1: A2A wire contracts + parity test

**Files:**
- Create: `src/contracts/a2a.ts`
- Modify: `src/contracts/index.ts` (already `export *`; add `export * from './a2a.ts';`)
- Test: `tests/contracts/a2a-contracts.test.ts`

**Interfaces:**
- Consumes: `z` from `zod` only. (Contracts stay isomorphic — import only `zod` + other contracts/enums. **`JobKindWire` is deliberately NOT imported here**: no Task-1 schema uses it, so importing it would trip biome `noUnusedImports` and fail Task 1's `lint:file` gate. It is introduced in Task 17, the first task with a `JobKindWire`-typed wire schema — see the `A2aSkillEntryWireSchema` note there.)
- Produces (all exported from `src/contracts/a2a.ts`):
  - `enum TaskStateWire { Submitted='submitted', Working='working', Completed='completed', Failed='failed', Canceled='canceled', Rejected='rejected', InputRequired='input-required', AuthRequired='auth-required' }` — lowercase-hyphenated, the JSON-RPC casing.
  - `enum A2aMethod { MessageSend='message/send', MessageStream='message/stream', TasksGet='tasks/get', TasksCancel='tasks/cancel', TasksResubscribe='tasks/resubscribe' }`.
  - `PartSchema` — discriminated union on `kind`: `{ kind: z.literal('text'), text: z.string() }` | `{ kind: z.literal('file'), file: z.object({ name: z.string().optional(), mimeType: z.string().optional(), bytes: z.string() }) }` | `{ kind: z.literal('data'), data: z.record(z.string(), z.unknown()) }`.
  - `MessageSchema` / `A2aMessage`: `{ role: z.enum(['user','agent']), parts: z.array(PartSchema), messageId: z.string(), contextId: z.string().optional(), taskId: z.string().optional() }`.
  - `ArtifactSchema` / `A2aArtifact`: `{ artifactId: z.string(), name: z.string().optional(), parts: z.array(PartSchema) }`.
  - `TaskStatusSchema`: `{ state: z.enum(TaskStateWire), message: MessageSchema.optional(), timestamp: z.string().optional() }`.
  - `TaskSchema` / `A2aTask`: `{ id: z.string(), contextId: z.string(), status: TaskStatusSchema, artifacts: z.array(ArtifactSchema).default([]), history: z.array(MessageSchema).default([]), kind: z.literal('task') }`.
  - `AgentSkillSchema`: `{ id: z.string(), name: z.string(), description: z.string(), tags: z.array(z.string()).default([]), inputModes: z.array(z.string()).optional(), outputModes: z.array(z.string()).optional() }`.
  - `AgentCardSchema` / `A2aAgentCard`: `{ name, description, version, protocolVersion: z.literal('1.0'), url: z.string(), preferredTransport: z.string().default('JSONRPC'), skills: z.array(AgentSkillSchema), capabilities: z.object({ streaming: z.boolean(), pushNotifications: z.boolean() }), defaultInputModes: z.array(z.string()), defaultOutputModes: z.array(z.string()), securitySchemes: z.record(z.string(), z.unknown()), security: z.array(z.record(z.string(), z.array(z.string()))).default([]) }`.
  - JSON-RPC envelopes: `JsonRpcRequestSchema` (`{ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).nullable(), method: z.string(), params: z.unknown().optional() }`), `JsonRpcErrorSchema` (`{ code: z.number(), message: z.string(), data: z.unknown().optional() }`), `JsonRpcResponseSchema` (`{ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).nullable(), result: z.unknown().optional(), error: JsonRpcErrorSchema.optional() }`).

- [ ] **Step 1: Write the failing test** — `TaskStateWire` values, `Part` union round-trip, and a `protocolVersion !== "1.0"` reject:

```ts
import { expect, test } from 'bun:test';
import {
  AgentCardSchema,
  PartSchema,
  TaskStateWire,
} from '../../src/contracts/a2a.ts';

test('TaskStateWire holds the eight A2A v1.0 wire states', () => {
  expect(Object.values(TaskStateWire).sort()).toEqual(
    [
      'auth-required',
      'canceled',
      'completed',
      'failed',
      'input-required',
      'rejected',
      'submitted',
      'working',
    ],
  );
});

test('PartSchema round-trips a text part and rejects an unknown kind', () => {
  expect(PartSchema.parse({ kind: 'text', text: 'hi' })).toMatchObject({
    kind: 'text',
  });
  expect(() => PartSchema.parse({ kind: 'audio', text: 'x' })).toThrow();
});

test('AgentCardSchema rejects a non-1.0 protocolVersion', () => {
  const base = {
    name: 'n', description: 'd', version: '1', protocolVersion: '0.3',
    url: 'https://h/api/a2a', skills: [],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
    securitySchemes: {}, security: [],
  };
  expect(() => AgentCardSchema.parse(base)).toThrow();
  expect(AgentCardSchema.parse({ ...base, protocolVersion: '1.0' })).toMatchObject({
    protocolVersion: '1.0',
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "TaskStateWire holds"` → FAIL (module not found).
- [ ] **Step 3: Write minimal implementation** — create `src/contracts/a2a.ts` with the enums + schemas from the Produces block; add `export * from './a2a.ts';` to `src/contracts/index.ts`. Import only `zod` + `JobKindWire` (isomorphic — no engine imports).
- [ ] **Step 4: Run test to verify it passes** — `bun run test -- -t "TaskStateWire holds"` → PASS (all three).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/contracts/a2a.ts src/contracts/index.ts tests/contracts/a2a-contracts.test.ts`.

```bash
git add src/contracts/a2a.ts src/contracts/index.ts tests/contracts/a2a-contracts.test.ts
git commit -m "feat(contracts): A2A v1.0 wire contracts (card/message/task/part + JSON-RPC + TaskStateWire)"
```

*Model: Sonnet (mechanical schema definition mirroring the `dto.ts`/`enums.ts` convention).*

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

### Task 3: Increment 1 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check` (docs-check · typecheck · lint · check:web · test). Fully green including docs-check (the Task-2 stub satisfies the subsystem-documented check; no exemption needed at any gate this slice).
- [ ] **Step 2: Record the increment in the SDD ledger** (`.superpowers/sdd/progress.md`) with per-task commit refs.

*Model: controller (no code).*

---

## Increment 2 — EXPOSE: Agent Card + least-privilege allowlist

The discovery surface. Ends with a v1.0 card served at `GET /.well-known/agent-card.json`, built from an explicit skill allowlist that is the whole security boundary — empty ⇒ `skills:[]`, off ⇒ 404.

### Task 4: A2A skill allowlist store + ref resolution (HARD §7.4)

**Files:**
- Create: `src/a2a/allowlist.ts`
- Test: `tests/a2a/allowlist.test.ts`

**Interfaces:**
- Consumes: `JobKind` from `../queue/types.ts`; `AGENTS` from `../../agents/index.ts`; `getCrew` from `../../crews/index.ts`; `getWorkflow` from `../../workflows/index.ts`; the `~/.agent`-style atomic-write idiom from `src/server/security/device-registry.ts`; `loadConfig` for `AGENT_A2A_SKILLS_PATH`.
- Produces:

```ts
export type SkillEntry = {
  skillId: string;
  name: string;
  description: string;
  kind: JobKind;        // Chat | Crew | Workflow — the enqueue target kind
  ref: string;          // registered agent name (AGENTS) | crew name | workflow name
};
export type ResolvedTarget = { kind: JobKind; ref: string };
export type A2aAllowlist = {
  list(): SkillEntry[];
  /** Author-time validation: the ref MUST resolve to a REGISTERED agent/crew/
   *  workflow for its kind, else throw AllowlistError. NEVER a "run anything"
   *  entry (§7.4). */
  put(entry: SkillEntry): void;
  remove(skillId: string): void;
  /** Invoke-time re-check: resolve a presented skillId to its target, or
   *  undefined if unlisted (server resolves-then-rejects — never a fall-through
   *  to a generic orchestrator run, §7.4). */
  resolve(skillId: string): ResolvedTarget | undefined;
};
export function createA2aAllowlist(config: { path?: string }): A2aAllowlist;
export function refExistsFor(kind: JobKind, ref: string): boolean; // AGENTS/getCrew/getWorkflow lookup
```

  File format: `{ skills: SkillEntry[] }` at `AGENT_A2A_SKILLS_PATH` (0700 dir / 0600 file, atomic temp+rename — byte-for-byte `device-registry.ts persist`). `put` validates `refExistsFor(entry.kind, entry.ref)` (Chat/Crew→`getCrew` or `AGENTS`, Workflow→`getWorkflow`) — throws `AllowlistError` on a non-existent ref, so an operator cannot expose a skill that maps to nothing. `resolve` re-reads and returns `{ kind, ref }` only for a listed `skillId`. Fail-closed on a corrupt (present-but-unparseable) file (throw, never `{ skills: [] }` — the `device-registry.ts load` precedent).

- [ ] **Step 1: Write the failing tests** — a valid put/resolve round-trip; an unknown ref rejects at author-time; an unlisted skillId resolves to `undefined`:

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { createA2aAllowlist } from '../../src/a2a/allowlist.ts';

const p = () => join(mkdtempSync(join(tmpdir(), 'a2a-')), 'a2a-skills.json');

test('put a valid agent-backed skill; resolve returns its target', () => {
  const al = createA2aAllowlist({ path: p() });
  al.put({ skillId: 'ask', name: 'Ask', description: 'qa',
    kind: JobKind.Chat, ref: 'file_qa' }); // file_qa is a registered agent
  expect(al.resolve('ask')).toEqual({ kind: JobKind.Chat, ref: 'file_qa' });
  expect(al.list().map((s) => s.skillId)).toEqual(['ask']);
});
test('put rejects a skill whose ref is not a registered agent/crew/workflow (§7.4)', () => {
  const al = createA2aAllowlist({ path: p() });
  expect(() => al.put({ skillId: 'x', name: 'X', description: '',
    kind: JobKind.Crew, ref: 'no_such_crew' })).toThrow();
});
test('resolve returns undefined for an unlisted skill (resolve-then-reject)', () => {
  const al = createA2aAllowlist({ path: p() });
  expect(al.resolve('ghost')).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block; copy the `device-registry.ts` load/persist/atomic-write structure (fail-closed load). `refExistsFor`: `kind===Workflow ? !!getWorkflow(ref) : kind===Crew ? !!getCrew(ref) : (!!AGENTS[ref] || !!getCrew(ref))` (Chat may target an agent or a crew, per the launch surface).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/allowlist.ts tests/a2a/allowlist.test.ts`.

```bash
git add src/a2a/allowlist.ts tests/a2a/allowlist.test.ts
git commit -m "feat(a2a): least-privilege skill allowlist store + author-time ref resolution"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.4 least-privilege).** Reviewer probes: is there ANY path to expose an unregistered ref or a free-form "run anything" skill? Does `resolve` genuinely return `undefined` (never a default target) for an unlisted id? Is the load fail-closed on a corrupt file?*

### Task 5: Build the Agent Card

**Files:**
- Create: `src/a2a/card.ts`
- Test: `tests/a2a/card.test.ts`

**Interfaces:**
- Consumes: `A2aAllowlist`, `SkillEntry` (Task 4); `AgentCardSchema`, `AgentSkillSchema`, `A2aAgentCard` from `../contracts/index.ts`; `loadConfig` (for `AGENT_A2A_CARD_TTL` + the Slice-24 bind/tunnel-origin — the advertised `url`).
- Produces:
  - `buildAgentCard(deps: { allowlist: A2aAllowlist; publicBaseUrl: string; name?: string; version?: string }): A2aAgentCard` — maps each `SkillEntry` → `AgentSkill`; `capabilities: { streaming: true, pushNotifications: false }`; `protocolVersion: '1.0'`; `url = \`${publicBaseUrl}/api/a2a\``; one HTTP Bearer scheme in `securitySchemes` (`{ a2aBearer: { type: 'http', scheme: 'bearer' } }`) + `security: [{ a2aBearer: [] }]`; `defaultInputModes/OutputModes: ['text/plain','application/json']`. An empty allowlist ⇒ `skills: []`. Returns the `AgentCardSchema.parse`d object (self-validating).
  - `cardEtag(card: A2aAgentCard): string` — `sha256(canonical JSON)` (reuse Task 20's `canonicalizeCard` once it lands; for now a stable `JSON.stringify` of sorted keys — extract the shared canonicalizer in Task 20 and re-point).

- [ ] **Step 1: Write the failing tests** — a card with skills; an empty allowlist ⇒ `skills:[]`; url points at `/api/a2a`:

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { createA2aAllowlist } from '../../src/a2a/allowlist.ts';
import { buildAgentCard } from '../../src/a2a/card.ts';

test('empty allowlist yields a valid card with skills:[]', () => {
  const al = createA2aAllowlist({ path: join(mkdtempSync(join(tmpdir(), 'a2a-')), 's.json') });
  const card = buildAgentCard({ allowlist: al, publicBaseUrl: 'https://box.ts.net' });
  expect(card.skills).toEqual([]);
  expect(card.protocolVersion).toBe('1.0');
  expect(card.url).toBe('https://box.ts.net/api/a2a');
  expect(card.capabilities.pushNotifications).toBe(false);
});
test('a listed skill surfaces on the card', () => {
  const al = createA2aAllowlist({ path: join(mkdtempSync(join(tmpdir(), 'a2a-')), 's.json') });
  al.put({ skillId: 'ask', name: 'Ask', description: 'qa', kind: JobKind.Chat, ref: 'file_qa' });
  const card = buildAgentCard({ allowlist: al, publicBaseUrl: 'https://box.ts.net' });
  expect(card.skills.map((s) => s.id)).toEqual(['ask']);
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/card.ts tests/a2a/card.test.ts`.

```bash
git add src/a2a/card.ts tests/a2a/card.test.ts
git commit -m "feat(a2a): build v1.0 Agent Card from the skill allowlist (skills:[] when empty)"
```

*Model: Sonnet.*

### Task 6: Serve `GET /.well-known/agent-card.json` (fail-safe + ETag)

**Files:**
- Create: `src/server/a2a/card.ts`
- Modify: `src/server/app.ts` (a branch in `buildFetch`, after `enforcePerimeter`, before the `/api` guard — beside the `/hooks/:token` branch at `app.ts:254`)
- Test: `tests/server/a2a-card-route.test.ts`

**Interfaces:**
- Consumes: `buildAgentCard`, `cardEtag` (Task 5); `deps.a2a` (a new optional `ServerDeps.a2a` field — `{ allowlist, enrollment?, ... }`, added here as `{ allowlist: A2aAllowlist }` and grown in later tasks); `deps.publicBaseUrl`; `loadConfig` for `AGENT_A2A_ENABLED` + `AGENT_A2A_CARD_TTL`; `recordA2aCard` (Task 2).
- Produces:
  - `src/server/a2a/card.ts`: `handleAgentCard(req: Request, deps: { allowlist: A2aAllowlist; publicBaseUrl: string }): Response` — **404 when `AGENT_A2A_ENABLED` is off** (fail-safe: discovery reveals nothing until exposed); else build the card, compute the ETag, honor `If-None-Match` (→ `304`), return `200` with `content-type: application/json`, `ETag`, and `Cache-Control: public, max-age=<AGENT_A2A_CARD_TTL>`. `recordA2aCard({ cacheHit })`.
  - `app.ts` branch (in `buildFetch`, method GET, path `=== '/.well-known/agent-card.json'`): `if (!deps.a2a) return json({ error: 'a2a unavailable' }, 503); return handleAgentCard(req, { allowlist: deps.a2a.allowlist, publicBaseUrl: need(deps.publicBaseUrl, 'publicBaseUrl') });`. Placed OUTSIDE the `/api` session guard (public discovery) but INSIDE the Host/Origin perimeter (already enforced above).

- [ ] **Step 1: Write the failing tests:**

```ts
test('card route 404s when AGENT_A2A_ENABLED is off (fail-safe)', async () => { /* build fetch with a2a wired, flag off → GET /.well-known/agent-card.json → 404 */ });
test('card route serves the card + ETag when enabled, no bearer required', async () => { /* flag on → 200 + ETag + Cache-Control, reachable with NO Authorization header */ });
test('If-None-Match matching the ETag returns 304', async () => { /* second GET with the ETag → 304 */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. Add the optional `a2a?: { allowlist: A2aAllowlist }` field to `ServerDeps` (`src/server/app.ts:89`) — grown in Increments 3/5/6.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/a2a/card.ts src/server/app.ts tests/server/a2a-card-route.test.ts`.

```bash
git add src/server/a2a/card.ts src/server/app.ts tests/server/a2a-card-route.test.ts
git commit -m "feat(a2a): GET /.well-known/agent-card.json (public discovery, 404 when disabled, ETag)"
```

*Model: Opus (route placement is security-sensitive — the card must be outside the session guard yet inside the perimeter, and MUST 404 when the flag is off; a card leaked while disabled advertises internal capability).*

### Task 7: Increment 2 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check (Task-2 stub; no exemption).
- [ ] **Step 2: Update the SDD ledger** with Increment 2 commits + the §7.4 allowlist review verdict.

*Model: controller.*

---

## Increment 3 — EXPOSE: JSON-RPC server + task-state mapping onto the queue

The inbound protocol core: `message/send` → enqueue → `submitted`; `tasks/get`/`tasks/cancel`; the `OrchestratorResult`/`JobStatus` ↔ task-state bijection. Streaming is Increment 4; the Bearer gate is Increment 5.

### Task 8: task-map.ts — the OrchestratorResult/JobStatus ↔ task-state bijection (HARD §7.1)

**Files:**
- Create: `src/a2a/task-map.ts`
- Test: `tests/a2a/task-map.test.ts`

**Interfaces:**
- Consumes: `OrchestratorResult` from `../core/orchestrator.ts`; `JobStatus` from `../queue/types.ts`; `TaskStateWire`, `A2aTask`, `A2aArtifact`, `JsonRpcErrorSchema` from `../contracts/index.ts`.
- Produces:
  - `orchestratorResultToTaskState(r: OrchestratorResult): TaskStateWire` — `answer→Completed`, `gap→Failed`, `resource→Failed` (per the D3 table).
  - `orchestratorResultToArtifact(r: OrchestratorResult): A2aArtifact | undefined` — for `answer`, one text-part artifact carrying `r.text`; for `gap`/`resource`, `undefined` (the failure detail rides the JSON-RPC error / task-status message).
  - `resultToTaskError(r: OrchestratorResult): { code: number; message: string; data?: unknown } | undefined` — `gap → { code: -32001, message: 'missing-capability', data: { missingCapability } }`, `resource → { code: -32002, message: r.message }`, `answer → undefined`.
  - `jobStatusToTaskState(s: JobStatus): TaskStateWire` — `Queued→Submitted`, `Running→Working`, `Done→Completed`, `Failed→Failed`, `Canceled→Canceled`, `Interrupted→Failed` (the projection `tasks/get` uses before the orchestrator result is known).
  - `CONSENT_UNAVAILABLE_ERROR_CODE = -32003` + `consentUnavailableError(): { code; message: 'consent-unavailable'; data? }` — the typed error a **fail-closed** mid-run consent gate lands on (a remote A2A task runs as a queued job whose dispatch hardcodes `confirm: async () => false`, `src/server/jobs/dispatch.ts:200`, so a consent gate declines → the job goes `Failed`). Reused by Task 13's `Failed→failed` + typed-`consent-unavailable` mapping. (`TaskStateWire.InputRequired` stays in the enum for protocol completeness but is **never emitted** this slice — there is no live client / promptId round-trip substrate.)

- [ ] **Step 1: Write the failing tests** — every `OrchestratorResult` variant maps to the spec-table state; the `JobStatus` projection is total:

```ts
import { expect, test } from 'bun:test';
import { JobStatus } from '../../src/queue/types.ts';
import { TaskStateWire } from '../../src/contracts/index.ts';
import {
  jobStatusToTaskState,
  orchestratorResultToArtifact,
  orchestratorResultToTaskState,
  resultToTaskError,
} from '../../src/a2a/task-map.ts';

test('answer → completed with a text artifact', () => {
  const r = { kind: 'answer', text: 'done' } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Completed);
  expect(orchestratorResultToArtifact(r)?.parts[0]).toMatchObject({ kind: 'text', text: 'done' });
  expect(resultToTaskError(r)).toBeUndefined();
});
test('gap → failed + missing-capability error', () => {
  const r = { kind: 'gap', missingCapability: 'ocr', message: 'no ocr' } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Failed);
  expect(resultToTaskError(r)).toMatchObject({ message: 'missing-capability' });
});
test('resource → failed + resource error', () => {
  const r = { kind: 'resource', message: 'oom' } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Failed);
  expect(resultToTaskError(r)?.code).toBe(-32002);
});
test('jobStatus projection covers every queue status', () => {
  expect(jobStatusToTaskState(JobStatus.Queued)).toBe(TaskStateWire.Submitted);
  expect(jobStatusToTaskState(JobStatus.Running)).toBe(TaskStateWire.Working);
  expect(jobStatusToTaskState(JobStatus.Interrupted)).toBe(TaskStateWire.Failed);
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — pure switch functions; no I/O. Use early returns; the `JobStatus` switch is exhaustive over the enum.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/task-map.ts tests/a2a/task-map.test.ts`.

```bash
git add src/a2a/task-map.ts tests/a2a/task-map.test.ts
git commit -m "feat(a2a): OrchestratorResult/JobStatus ↔ A2A task-state bijection"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.1 task-state mapping).** Reviewer probes: is every `OrchestratorResult` and `JobStatus` variant mapped (no default-to-completed hole)? Does a `gap`/`resource` NEVER project to `completed`? Is the failure detail carried without leaking untrusted text as an instruction?*

### Task 9: server.ts — JSON-RPC dispatch (message/send, tasks/get, tasks/cancel) (HARD §7.2 + §7.4)

**Files:**
- Create: `src/a2a/server.ts`, `src/a2a/task-index.ts`
- Test: `tests/a2a/server.test.ts`

**Interfaces:**
- Consumes: `A2aAllowlist` (Task 4); `task-map.ts` (Task 8); `JobStore`, `JobKind` from `../queue/`; `RunOrigin` from `../contracts/index.ts`; `newRunId` from `../run/run-id.ts`; `createRun` from `../run/run-store.ts`; `MessageSchema`, `A2aTask`, `TaskStateWire`, `A2aMethod`, `JsonRpcRequestSchema` from `../contracts/index.ts`; `withA2aServerTaskSpan` (Task 2).
- Produces:
  - `src/a2a/task-index.ts`: `createTaskIndex(): { taskIdForJob(jobId): string; jobIdForTask(taskId): string | undefined; contextFor(taskId): string; bind(taskId, jobId, contextId): void }` — the A2A `taskId` IS the queue `jobId` (1:1); `contextId` groups a multi-turn conversation. A tiny in-memory bidirectional map seeded from the queue (durable identity = the jobId; the map only caches contextId grouping).
  - `src/a2a/server.ts`:

```ts
export type A2aServerDeps = {
  allowlist: A2aAllowlist;
  jobStore: JobStore;
  runsRoot: string;
  taskIndex: ReturnType<typeof createTaskIndex>;
};
export type A2aRpcResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: number; message: string; data?: unknown } };
export function handleMessageSend(params: unknown, deps: A2aServerDeps): Promise<A2aRpcResult>;
export function handleTasksGet(params: unknown, deps: A2aServerDeps): Promise<A2aRpcResult>;
export function handleTasksCancel(params: unknown, deps: A2aServerDeps): Promise<A2aRpcResult>;
/** Pure JSON-RPC dispatcher over the three (non-streaming) methods; streaming
 *  methods are handled at the route (Task 12). Unknown method → -32601. */
export function dispatchA2aRpc(rpc: unknown, deps: A2aServerDeps): Promise<A2aRpcResult>;
```

  Flow for `message/send`: `MessageSchema.parse(params.message)` (400/-32602 on bad shape); **the skillId comes from `params.metadata.skillId` (or a `data` part) and is resolved via `deps.allowlist.resolve(skillId)` — an unlisted/absent skill → `{ ok:false, error:{ code:-32004, message:'skill not allowed' } }` BEFORE any enqueue (resolve-then-reject, §7.4; never reaches a model)**; build the job payload from `message.parts` **treated as UNTRUSTED** — extract text via a delimited untrusted-transcript wrapper (reuse the existing delimited-untrusted handling; never let inbound text act as orchestrator instructions, §7.2); pre-mint `runId` + `createRun`; `deps.jobStore.enqueue({ kind: target.kind, payload: { ...built, a2aRef: target.ref }, origin: RunOrigin.Remote, runId })`; `deps.taskIndex.bind(job.id, job.id, contextId)`; return `A2aTask { id: job.id, contextId, status: { state: Submitted }, artifacts: [], history: [message], kind: 'task' }`. Wrap in `withA2aServerTaskSpan({ method, skillId })`. `tasks/get`: `jobIdForTask` → `jobStore.getJob` → project via `jobStatusToTaskState` (+ artifact from the job result when Done). `tasks/cancel`: fire the existing job cancel (`jobStore` cancel path / AbortSignal) → task `Canceled`.

- [ ] **Step 1: Write the failing tests** (fake `JobStore`):

```ts
test('message/send to a listed skill enqueues origin=Remote and returns a submitted Task', async () => { /* allowlist.put(ask→file_qa); resolve; assert enqueue called with origin=Remote + kind, task.status.state==='submitted' */ });
test('message/send to an UNLISTED skill rejects pre-enqueue (§7.4, no job)', async () => { /* skillId 'ghost' → error code -32004, enqueue spy NOT called */ });
test('inbound message parts are wrapped as UNTRUSTED in the payload (§7.2)', async () => { /* payload text is delimited/quoted, not spliced as an instruction */ });
test('tasks/get projects the job status to a task state', async () => { /* fake job Running → task working */ });
test('tasks/cancel fires the job cancel → canceled', async () => { /* assert cancel called, state canceled */ });
test('unknown method → -32601', async () => { /* dispatchA2aRpc({method:'foo'}) */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. Mirror `handleJobEnqueue` (`src/server/jobs/enqueue.ts:71`) for the pre-mint-run + enqueue shape.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/server.ts src/a2a/task-index.ts tests/a2a/server.test.ts`.

```bash
git add src/a2a/server.ts src/a2a/task-index.ts tests/a2a/server.test.ts
git commit -m "feat(a2a): JSON-RPC server (message/send→enqueue, tasks/get, tasks/cancel)"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.2 untrusted-content + §7.4 invoke-time resolve-then-reject).** Reviewer probes: is the allowlist resolve genuinely BEFORE any enqueue (no fall-through to a generic run)? Are inbound parts provably UNTRUSTED (delimited, never instructions)? Does the taskId↔jobId identity hold across get/cancel?*

### Task 10: Wire `POST /api/a2a` route (session-guard exception)

**Files:**
- Create: `src/server/a2a/rpc.ts`
- Modify: `src/server/app.ts` (the `/api/telemetry`-style session-guard exception at `app.ts:290`, + the route in `handleApi`)
- Test: `tests/server/a2a-rpc-route.test.ts`

**Interfaces:**
- Consumes: `dispatchA2aRpc`, `A2aServerDeps` (Task 9); `JsonRpcRequestSchema`, `JsonRpcResponseSchema` from `../contracts/index.ts`; `deps.a2a` (grown to carry `{ allowlist, jobStore, runsRoot, taskIndex }`).
- Produces:
  - `src/server/a2a/rpc.ts`: `handleA2aRpc(req: Request, deps: A2aServerDeps): Promise<Response>` — parse the JSON-RPC envelope, `dispatchA2aRpc`, wrap the result/error as a `JsonRpcResponse` (same `id`). **(Bearer verification is added in Task 16 — this task wires the reachable route; the whole surface is gated by `AGENT_A2A_ENABLED` and, in Task 16, the A2A Bearer.)** 404 when `AGENT_A2A_ENABLED` off.
  - `app.ts`: extend the beacon-style guard exception (`app.ts:290`) so `POST /api/a2a` is let past the **device session** guard (it authenticates with the **A2A Bearer**, not a device token — the D5 two-stores split); the handler owns its own auth. In `handleApi`, add `if (req.method === 'POST' && url.pathname === '/api/a2a') { return handleA2aRpc(req, need(deps.a2a, 'a2a')); }`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('POST /api/a2a is reachable without a device session token (owns its own auth)', async () => { /* no Authorization → not a 401-from-session-guard; reaches the handler */ });
test('POST /api/a2a message/send returns a JSON-RPC response with a submitted task', async () => { /* enabled + allowlisted skill → result.status.state submitted */ });
test('POST /api/a2a 404s when AGENT_A2A_ENABLED is off', async () => { /* flag off → 404 */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/a2a/rpc.ts src/server/app.ts tests/server/a2a-rpc-route.test.ts`.

```bash
git add src/server/a2a/rpc.ts src/server/app.ts tests/server/a2a-rpc-route.test.ts
git commit -m "feat(a2a): POST /api/a2a JSON-RPC route (session-guard exception, A2A-Bearer-owned auth)"
```

*Model: Opus (the session-guard exception is security-sensitive — the route must be past the DEVICE guard yet still fronted by the perimeter, and must not accidentally accept a device token in place of the A2A Bearer, D5).*

### Task 11: Increment 3 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check.
- [ ] **Step 2: Update the SDD ledger** with Increment 3 commits + the §7.1/§7.2/§7.4 review verdicts.

*Model: controller.*

---

## Increment 4 — EXPOSE: streaming + fail-closed mid-run consent

`message/stream` / `tasks/resubscribe` re-frame the ONE run-stream engine as A2A SSE events. A mid-run consent gate is handled **fail-closed** (matching the existing queued-job posture — dispatch runs with `confirm: async () => false`): the task lands as a typed `failed` (`consent-unavailable`), never a hang and never a cross-machine round-trip (there is no live-client/promptId substrate this slice — see §7.1 and the non-goals).

### Task 12: stream.ts — re-frame the run-stream as A2A SSE events

**Files:**
- Create: `src/a2a/stream.ts`, `src/server/a2a/stream-route.ts`
- Modify: `src/server/a2a/rpc.ts` (detect `message/stream` / `tasks/resubscribe` → delegate to the stream route)
- Test: `tests/a2a/stream.test.ts`, `tests/server/a2a-stream-route.test.ts`

**Interfaces:**
- Consumes: `handleRunStream`, `RunStreamOpts` from `../../server/runs/stream.ts`; `SpanDTO`, `RunLifecycle` from `../contracts/index.ts`; `jobStatusToTaskState`, `orchestratorResultToArtifact` (Task 8); `A2aServerDeps` (Task 9).
- Produces:
  - `src/a2a/stream.ts`: `frameRunSpanAsA2a(span: SpanDTO, ctx: { taskId: string; contextId: string }): string | undefined` — maps a run span to a `TaskStatusUpdateEvent` (state transition `submitted→working→completed/failed`) or a `TaskArtifactUpdateEvent` (text/data artifact) as an SSE `data:` frame keyed by the span's wire id (so `Last-Event-ID` replay works); a span with no A2A meaning returns `undefined` (skipped). Pure, unit-testable.
  - `src/server/a2a/stream-route.ts`: `handleA2aStream(params: unknown, method: A2aMethod, req: Request, deps: A2aServerDeps): Promise<Response>` — for `message/stream`: enqueue (reuse `handleMessageSend`), then open a `text/event-stream` that **delegates to `handleRunStream`** for the run and pipes each frame through `frameRunSpanAsA2a` (ONE SSE engine, two framings — never a parallel stream). For `tasks/resubscribe`: resolve the running task's runId and re-attach via `handleRunStream` with `Last-Event-ID` replay (`RunStreamOpts.lastEventId`).

- [ ] **Step 1: Write the failing tests** (fake span sequence):

```ts
test('frameRunSpanAsA2a maps run lifecycle spans to TaskStatusUpdate submitted→working→completed', () => { /* feed spans, assert the 3 status frames */ });
test('an answer span becomes a TaskArtifactUpdate with a text part', () => { /* ... */ });
test('message/stream emits status then an artifact then completed (re-framing handleRunStream)', async () => { /* inject a fake run producing spans; assert A2A frame sequence */ });
test('tasks/resubscribe replays by Last-Event-ID (only newer frames)', async () => { /* set Last-Event-ID; assert seeded replay */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. Route `message/stream`/`tasks/resubscribe` from `rpc.ts` to `handleA2aStream` (they return an SSE Response, not a JSON-RPC body).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/stream.ts src/server/a2a/stream-route.ts src/server/a2a/rpc.ts tests/a2a/stream.test.ts tests/server/a2a-stream-route.test.ts`.

```bash
git add src/a2a/stream.ts src/server/a2a/stream-route.ts src/server/a2a/rpc.ts tests/a2a/stream.test.ts tests/server/a2a-stream-route.test.ts
git commit -m "feat(a2a): message/stream + tasks/resubscribe re-framing the run-stream as A2A SSE"
```

*Model: Opus (SSE re-framing correctness — the Last-Event-ID replay contract must survive across the A2A framing; a lost terminal frame is the §7.1-adjacent reconnect gap).*

### Task 13: fail-closed mid-run consent → typed `failed` (no hang) (HARD §7.1)

**Reality (verified, drives this task's shape):** a remote A2A task runs as a **queued job** dispatched by `src/server/jobs/dispatch.ts`, which already runs with consent hardcoded **fail-closed** (`confirm: async () => false`, `dispatch.ts:200`; `events: noopEventSink`, `dispatch.ts:180`). There is **no live client**, the consent seam is keyed by `promptId` (not `runId`), and a consent prompt is a `StatusEvent` (not the `SpanDTO` the Task 12 stream framer sees). So there is **no substrate** for a cross-machine consent round-trip. **Decision (locked): fail-closed.** A remote task that hits a mid-run consent gate lands as a typed **`failed`** — exactly matching the existing queued-job posture. This task does NOT build a promptId round-trip; it makes the fail-closed outcome a *typed, no-hang* A2A `failed`. (The full durable promptId-carrying ConfirmPort/EventSink injection — which would also serve non-A2A queued jobs — is a scoped future **queue-consent** capability, see §2 non-goals. `TaskStateWire.InputRequired` stays in the enum for protocol completeness but is **never emitted** this slice; `TaskStateWire.AuthRequired` likewise.)

**Files:**
- Modify: `src/a2a/task-map.ts` (add the fail-closed consent projection, reusing Task 8's `jobStatusToTaskState` `Failed→failed` + the `consentUnavailableError()` typed error), `src/server/a2a/rpc.ts` / `src/a2a/stream.ts` (surface the typed `consent-unavailable` error on the terminal frame + `tasks/get` result when a job failed on a declined consent gate)
- Test: `tests/a2a/consent-fail-closed.test.ts`

**Interfaces:**
- Consumes: `jobStatusToTaskState`, `orchestratorResultToArtifact`, `CONSENT_UNAVAILABLE_ERROR_CODE`, `consentUnavailableError` (Task 8); `JobStatus` from `../queue/types.ts`; `TaskStateWire` from `../contracts/index.ts`; `A2aServerDeps`, `task-index.ts` (Task 9); the `dispatch.ts` fail-closed posture (`confirm: async () => false`) — **not modified**, just relied on.
- Produces:
  - `src/a2a/task-map.ts` (additive): `consentDeclinedToTaskError(job): { state: TaskStateWire.Failed; error } | undefined` — when a job's terminal failure is a declined-consent gate, project it to `failed` + `consentUnavailableError()`; otherwise `undefined` (a plain `Failed` keeps its existing error). Total over `JobStatus` (reuses Task 8's projection; `Failed→failed`).
  - `src/server/a2a/rpc.ts` / `src/a2a/stream.ts` (wiring): a task whose backing job settled `Failed` because dispatch declined consent surfaces, on `tasks/get` and as the terminal `TaskStatusUpdate`, a `failed` state carrying the typed `consent-unavailable` error — and **reaches a terminal state within the run's wall-clock**, never hanging waiting for a reply that can't arrive. `message/stream` / `tasks/resubscribe` framing (Task 12) is otherwise unchanged.

- [ ] **Step 1: Write the failing tests:**

```ts
import { expect, test } from 'bun:test';
import { JobStatus } from '../../src/queue/types.ts';
import { TaskStateWire } from '../../src/contracts/index.ts';
import { consentDeclinedToTaskError, jobStatusToTaskState } from '../../src/a2a/task-map.ts';

test('a job that failed on a declined consent gate maps to failed + consent-unavailable', () => {
  const proj = consentDeclinedToTaskError({ status: JobStatus.Failed, failure: 'consent-declined' } as never);
  expect(proj?.state).toBe(TaskStateWire.Failed);
  expect(proj?.error).toMatchObject({ message: 'consent-unavailable' });
});
test('Failed still projects to the failed task state (reusing Task 8)', () => {
  expect(jobStatusToTaskState(JobStatus.Failed)).toBe(TaskStateWire.Failed);
});
test('a task whose dispatch needs consent reaches a terminal failed state (never hangs)', async () => {
  // drive a fake job through dispatch (confirm:()=>false) → job Failed →
  // tasks/get / terminal stream frame resolves to a terminal `failed`
  // (consent-unavailable) within the wall-clock; assert NO pending/hanging state.
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block; add `consentDeclinedToTaskError` to `task-map.ts` and wire the terminal-frame / `tasks/get` typed error in `stream.ts`/`rpc.ts`. Do NOT add any `input-required` emission or promptId resume path.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/task-map.ts src/a2a/stream.ts src/server/a2a/rpc.ts tests/a2a/consent-fail-closed.test.ts`.

```bash
git add src/a2a/task-map.ts src/a2a/stream.ts src/server/a2a/rpc.ts tests/a2a/consent-fail-closed.test.ts
git commit -m "feat(a2a): fail-closed mid-run consent → typed failed (consent-unavailable, no hang)"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.1 state-mapping totality + no-hang fail-closed).** Reviewer probes (with Task 8): is the `OrchestratorResult`/`JobStatus`→task-state mapping total (no default-to-completed hole)? Does a declined-consent job DETERMINISTICALLY reach a terminal `failed` (`consent-unavailable`) within the wall-clock — never a hang, never `input-required` emitted? Is the fail-closed posture provably identical to the existing queued-job dispatch (`confirm: async () => false`)?*

### Task 14: Increment 4 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check.
- [ ] **Step 2: Update the SDD ledger** with Increment 4 commits + the §7.1 streaming/consent verdicts.

*Model: controller.*

---

## Increment 5 — Auth & enrollment (the separate out-of-band A2A Bearer)

The D5 credential that solves the loopback-only enrollment gap: an A2A Bearer HMAC-derived from the root token, revocable, issued from the console; the Bearer gate on `POST /api/a2a`; the token issue/revoke API. Kept strictly distinct from device session tokens.

### Task 15: enroll.ts — A2A Bearer issue/verify/revoke (HARD §7.2)

**Files:**
- Create: `src/a2a/enroll.ts`
- Test: `tests/a2a/enroll.test.ts`

**Interfaces:**
- Consumes: `createHmac`, `timingSafeEqual`, `randomBytes` from `node:crypto`; `RootTokenStore` from `../server/security/root-token.ts` (the root is resolved PER CALL, never captured — the `session-token.ts:76` `currentRoot()` idiom, so `rotate()` invalidates every A2A Bearer at once); the `device-registry.ts` atomic-write idiom; `loadConfig` for `AGENT_A2A_SKILLS_PATH` (the issued-token registry lives beside the allowlist).
- Produces:

```ts
export type IssuedToken = { id: string; label: string; createdAt: number };
export type A2aEnrollment = {
  /** Mint an A2A Bearer HMAC-derived from the root; PRINTED ONCE (never stored
   *  raw — only its id + a hash go to the registry). */
  issue(label: string): { id: string; token: string };
  /** Constant-time verify: true iff `raw` is an unrevoked A2A Bearer signed by
   *  the CURRENT root. */
  verify(raw: string): boolean;
  revoke(id: string): void;
  list(): IssuedToken[];   // metadata only — NEVER the secret
};
export function createA2aEnrollment(deps: {
  rootTokens: RootTokenStore;
  registryPath?: string;
}): A2aEnrollment;
```

  Token shape mirrors `session-token.ts` but with an A2A discriminator so it can NEVER be mistaken for a device session token (D5): `payload = base64url({ tokenId, kind: 'a2a' })`, `sig = HMAC-SHA256(root, payload)`, `token = \`${payload}.${sig}\``. `verify` recomputes the sig with `currentRoot()`, constant-time compares (`timingSafeEqual` + length guard), then checks the `tokenId` is present-and-not-revoked in the registry. The registry stores `{ id, label, createdAt }` + `sigOrHash` (never the raw token). **The secret is never logged, never returned in a DTO beyond the one-time `issue`, never a span attribute (§7.2).**

- [ ] **Step 1: Write the failing tests:**

```ts
test('issue → verify round-trip; verify is constant-time (length-guarded)', () => { /* issue().token verifies true; a truncated/garbage token verifies false */ });
test('revoke invalidates a previously-valid token', () => { /* issue, verify true, revoke(id), verify false */ });
test('rotating the root invalidates every A2A Bearer at once', () => { /* fake rootTokens whose getOrCreateRoot changes → old token verify false */ });
test('a device session token is NOT accepted by A2A verify, and vice-versa (D5 separation)', () => { /* mint a session token → A2A verify false; issue an A2A token → session verify false */ });
test('the registry never stores or returns the raw secret', () => { /* list() rows have no token field; the on-disk file has no raw token */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block; reuse the `session-token.ts` sign/`sigMatches` pattern (constant-time) and the `device-registry.ts` atomic-write/fail-closed-load structure for the registry.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/enroll.ts tests/a2a/enroll.test.ts`.

```bash
git add src/a2a/enroll.ts tests/a2a/enroll.test.ts
git commit -m "feat(a2a): A2A Bearer enrollment (HMAC-from-root, revocable, D5 two-stores separation)"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.2 inbound auth).** Reviewer probes: constant-time compare (no `===` on secret material), root resolved per-call (rotate invalidates), the A2A/device token domains provably disjoint (the `kind:'a2a'` discriminator + separate stores), the secret never on disk/DTO/span.*

### Task 16: Bearer gate on POST /api/a2a — verify-before-parse + replay + body cap (HARD §7.2)

**Files:**
- Modify: `src/server/a2a/rpc.ts` (verify FIRST), `src/server/app.ts` (thread `deps.a2a.enrollment`)
- Create: `src/a2a/replay-guard.ts`
- Test: `tests/a2a/replay-guard.test.ts`, `tests/server/a2a-auth.test.ts`

**Interfaces:**
- Consumes: `A2aEnrollment` (Task 15); `AGENT_A2A_REPLAY_WINDOW_MS`; the `MAX_BEARER_TOKEN_LEN` cap idiom (`src/server/security/token.ts:21`); the request-body cap (`maxRequestBodySize`, already enforced by `Bun.serve` → over-cap yields 413 before the handler runs).
- Produces:
  - `src/a2a/replay-guard.ts`: `createReplayGuard(windowMs: number, now?: () => number): { check(nonce: string, tsMs: number): { ok: true } | { ok: false; status: 401 | 409 } }` — rejects a timestamp outside ±window (`409`) and a nonce already seen within the window (`409`); a bounded LRU of seen nonces (evicted past the window).
  - `rpc.ts` `handleA2aRpc`: **BEFORE reading/parsing the JSON-RPC body** — extract the `Authorization: Bearer` header (length-cap it up front, `token.ts:21`), `deps.enrollment.verify(raw)` (constant-time); on failure return `401` (never parse the body). Then apply the replay guard against the `x-a2a-timestamp` (seconds→ms) + `x-a2a-nonce` headers (`401`/`409`). Only then read the body (the `maxRequestBodySize` 413 fronts it) and dispatch. The Bearer/timestamp/nonce **never** appear in a log/DTO/span.

- [ ] **Step 1: Write the failing tests:**

```ts
test('replay guard rejects a stale timestamp (409) and a repeated nonce (409)', () => { /* ... */ });
test('POST /api/a2a with no/absent Bearer → 401 BEFORE the body is parsed', async () => { /* a malformed-body request with no Bearer still 401s, proving verify precedes parse */ });
test('POST /api/a2a with a valid A2A Bearer reaches dispatch', async () => { /* issue a token, send it → message/send works */ });
test('POST /api/a2a with a DEVICE session token → 401 (D5: not accepted here)', async () => { /* ... */ });
test('a replayed request (same nonce within window) → 409', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block; grow `ServerDeps.a2a` to `{ allowlist, enrollment, jobStore, runsRoot, taskIndex }`.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/replay-guard.ts src/server/a2a/rpc.ts src/server/app.ts tests/a2a/replay-guard.test.ts tests/server/a2a-auth.test.ts`.

```bash
git add src/a2a/replay-guard.ts src/server/a2a/rpc.ts src/server/app.ts tests/a2a/replay-guard.test.ts tests/server/a2a-auth.test.ts
git commit -m "feat(a2a): Bearer gate on POST /api/a2a (verify-before-parse, replay window, body cap)"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.2 inbound auth boundary).** Reviewer probes: does the Bearer verify GENUINELY precede the JSON-RPC parse (no body read on an unauthenticated request)? Is the replay window enforced before dispatch? Is a device token provably rejected here? No secret in any log/span.*

### Task 17: Token issue/revoke API (behind requireTrustedLocal)

**Files:**
- Create: `src/server/a2a/token.ts`, `src/server/a2a/skills.ts`, `src/server/a2a/config.ts`
- Modify: `src/server/app.ts` (route the `/api/a2a/config`, `/api/a2a/skills`, `/api/a2a/token*` endpoints), `src/contracts/a2a.ts` (the console DTOs)
- Test: `tests/server/a2a-token-api.test.ts`

**Interfaces:**
- Consumes: `requireTrustedLocal` (`src/server/security/trusted-local.ts:16`); `A2aEnrollment`, `A2aAllowlist`; `buildAgentCard`; **`JobKindWire` from `../../contracts/enums.ts`** (first live use in the wire layer — imported into `src/contracts/a2a.ts` here, keeping Task 1 lint-clean).
- Produces (new contracts in `src/contracts/a2a.ts`): `A2aSkillEntryWireSchema` = `{ skillId, name, description, kind: z.enum(JobKindWire), ref }` (the isomorphic wire form of Task 4's `SkillEntry`; `kind` is a `JobKindWire` — this is the schema that consumes the `JobKindWire` import); `A2aConfigResponseSchema` = `{ enabled: z.boolean(), skills: z.array(A2aSkillEntryWireSchema), cardPreview: AgentCardSchema, tokens: z.array(IssuedTokenSchema) }`; `A2aSkillsPutRequestSchema` = `{ skills: z.array(A2aSkillEntryWireSchema) }`; `A2aTokenIssueRequestSchema` = `{ label: z.string() }`; `A2aTokenIssueResponseSchema` = `{ id, token }` (the raw token transmitted EXACTLY ONCE — the `DevicePairResponseSchema` precedent).
- Produces (handlers):
  - `config.ts`: `handleA2aConfig(deps): Response` → `{ enabled, skills: SkillEntry[], cardPreview: A2aAgentCard, tokens: IssuedToken[] }` (metadata only; never a secret).
  - `skills.ts`: `handleA2aSkillsPut(req, deps, guard): Promise<Response>` — `requireTrustedLocal` FIRST; parse `A2aSkillsPutRequestSchema`; validate each entry's ref (`allowlist.put` throws → 400); return the updated config.
  - `token.ts`: `handleA2aTokenIssue(req, deps, guard): Promise<Response>` (trusted-local; `enrollment.issue(label)` → `{ id, token }` ONCE) + `handleA2aTokenRevoke(id, deps, guard): Response` (trusted-local; `enrollment.revoke(id)` → 200).
  - `app.ts`: `GET /api/a2a/config`, `PUT /api/a2a/skills`, `POST /api/a2a/token`, `DELETE /api/a2a/token/:id` — **all behind `requireTrustedLocal`** (issuing an exposure token / editing the allowlist is privileged config), action-before-`:id` ordering.

- [ ] **Step 1: Write the failing tests:**

```ts
test('token issue requires trusted-local (403 from a non-loopback principal, no token minted)', async () => { /* ... */ });
test('token issue returns the raw token ONCE; GET /api/a2a/config never returns it', async () => { /* ... */ });
test('PUT /api/a2a/skills rejects an entry with an unknown ref (400)', async () => { /* ... */ });
test('DELETE /api/a2a/token/:id revokes (trusted-local)', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block (mutating handlers call `requireTrustedLocal(req, guard, deps.policy)` FIRST — the `handleDeviceRevoke` precedent).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/a2a/token.ts src/server/a2a/skills.ts src/server/a2a/config.ts src/server/app.ts src/contracts/a2a.ts tests/server/a2a-token-api.test.ts`.

```bash
git add src/server/a2a/token.ts src/server/a2a/skills.ts src/server/a2a/config.ts src/server/app.ts src/contracts/a2a.ts tests/server/a2a-token-api.test.ts
git commit -m "feat(a2a): expose config/skills/token API behind requireTrustedLocal (token shown once)"
```

*Model: **Opus implementer + adversarial verify.** Reviewer probes: trusted-local is FIRST (zero side effect on reject) in ALL mutating handlers; the token is returned exactly once and never persisted raw; the config DTO never leaks a secret.*

### Task 18: Wire `deps.a2a` at daemon/server boot

Nothing yet constructs the concrete `deps.a2a`, so the real daemon would 503 on every A2A route (`app.ts` Task 6 branch: `if (!deps.a2a) return 503`) and the §10 live-verify Step 1 would fail. This task builds + injects `deps.a2a` exactly where the Slice-25 triggers engine is constructed + injected, so the card/RPC/console routes resolve a live instance when `AGENT_A2A_ENABLED` is on. Fail-safe: default off ⇒ `deps.a2a` undefined ⇒ the routes report unavailable (Task 6's 503 deps-guard; Task 6/Task 10 also 404 in-handler when the flag is off), advertising nothing.

**Verified substrate (CodeGraph/Read, cited):** `startWebServer` (`src/server/main.ts:238`) builds the `deps: ServerDeps` object at `src/server/main.ts:506` and wires the injected/auto-constructed `triggers` onto it at `main.ts:555` (standalone auto-construct guarded by `AGENT_TRIGGERS_ENABLED` at `main.ts:457-464`); `jobStore`, `runsRoot`, `rootStore` (as `deps.rootTokens`, `main.ts:551`) and `publicBaseUrl` (`main.ts:552`) are all in scope at that point. `ServerDeps` is defined at `src/server/app.ts:89` (`triggers?` field at `app.ts:198`, `publicBaseUrl?` at `app.ts:191`). The daemon injects the engine through `opts.startWebServer({ … , triggers: opts.triggers })` at `src/daemon/core.ts:143` (the `triggers` handoff at `core.ts:153`). Unlike the pool/triggers, the A2A stores are file-backed + an in-memory `taskIndex` with **no start/stop lifecycle** — so there is no drain/double-instantiation hazard; the wiring is a pure deps handoff (no `start()`/`stop()` forwarding).

**Files:**
- Modify: `src/server/main.ts` (add an optional `opts.a2a?: ServerDeps['a2a']` to `StartOptions`; build `deps.a2a` from config when enabled), `src/server/app.ts` (finalize the `ServerDeps.a2a` type to the fully-grown shape), `src/daemon/core.ts` (construct + pass `a2a` at the triggers wiring site)
- Create: `src/server/a2a/wire.ts` (`buildA2aServerDeps` — the single constructor, so `main.ts` and the CLI (Task 27) share it)
- Test: `tests/server/a2a-boot-wiring.test.ts`

**Interfaces:**
- Consumes: `createA2aAllowlist` (Task 4), `createA2aEnrollment` (Task 15, signature `{ rootTokens: RootTokenStore; registryPath? }`), `createRemoteStore` (Task 22, `{ path? }`), `createA2aClient` (Task 20), `createTaskIndex` (Task 9); `loadConfig` for `AGENT_A2A_ENABLED`/`AGENT_A2A_SKILLS_PATH`/`AGENT_A2A_REMOTES_PATH`; `JobStore`, `runsRoot`, `RootTokenStore` (all already in `startWebServer` scope).
- Produces:
  - `src/server/a2a/wire.ts`: `buildA2aServerDeps(cfg, ctx: { jobStore: JobStore; runsRoot: string; rootTokens: RootTokenStore }): NonNullable<ServerDeps['a2a']>` — constructs `{ allowlist: createA2aAllowlist({ path: cfg.AGENT_A2A_SKILLS_PATH }), enrollment: createA2aEnrollment({ rootTokens, registryPath: cfg.AGENT_A2A_SKILLS_PATH }), remotes: createRemoteStore({ path: cfg.AGENT_A2A_REMOTES_PATH }), client: createA2aClient(), jobStore, runsRoot, taskIndex: createTaskIndex() }` — the fully-grown `ServerDeps.a2a` shape (matches Tasks 6/9/16/22's monotonic growth: `allowlist` + `jobStore/runsRoot/taskIndex` + `enrollment` + `remotes/client`).
  - `main.ts` (in `startWebServer`, at the `deps` object `main.ts:506`, beside the `triggers` field): `a2a: opts.a2a ?? ((cfg.AGENT_A2A_ENABLED as boolean) ? buildA2aServerDeps(cfg, { jobStore, runsRoot, rootTokens: rootStore }) : undefined)`. When off ⇒ `undefined` ⇒ routes report unavailable.
  - `daemon/core.ts` (at the `opts.startWebServer({ … })` call, `core.ts:143`, beside `triggers: opts.triggers`): pass `a2a: opts.a2a` when the daemon constructs one (or let `startWebServer` self-construct from cfg — same result, since A2A has no daemon-owned lifecycle). Thread an optional `opts.a2a` on the daemon `StartOptions` for parity/testing.

- [ ] **Step 1: Write the failing tests:**

```ts
test('with AGENT_A2A_ENABLED on + a temp skills file, the server boots with deps.a2a defined and serves the card', async () => {
  // loadConfig({ AGENT_A2A_ENABLED: '1', AGENT_A2A_SKILLS_PATH: <temp> });
  // startWebServer({ ... }) → GET /.well-known/agent-card.json → 200 with a card body (NOT 503)
});
test('with AGENT_A2A_ENABLED off, deps.a2a is undefined and the card route reports unavailable (no card served)', async () => {
  // flag off → GET /.well-known/agent-card.json → 404/503 (Task 6 guard), no card body
});
test('buildA2aServerDeps yields the fully-grown ServerDeps.a2a shape (allowlist+enrollment+remotes+client+jobStore+runsRoot+taskIndex)', () => {
  // assert every field present
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block; mirror the `triggers` construction (`main.ts:457-464`) + injection (`daemon/core.ts:153`). Do NOT add any `start()/stop()` — A2A stores have no lifecycle.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/a2a/wire.ts src/server/main.ts src/server/app.ts src/daemon/core.ts tests/server/a2a-boot-wiring.test.ts`.

```bash
git add src/server/a2a/wire.ts src/server/main.ts src/server/app.ts src/daemon/core.ts tests/server/a2a-boot-wiring.test.ts
git commit -m "feat(a2a): wire deps.a2a at daemon/server boot (AGENT_A2A_ENABLED-gated, mirrors triggers injection)"
```

*Model: Opus (boot/injection placement is security-sensitive — `deps.a2a` must be constructed only when enabled and the two-stores/root wiring must match the triggers precedent exactly; a mis-wire either 503s the whole surface or exposes it while disabled).*

### Task 19: Increment 5 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check.
- [ ] **Step 2: Update the SDD ledger** with Increment 5 commits + the §7.2 enroll/gate verdicts.

*Model: controller.*

---

## Increment 6 — CONSUME: discover → validate → PIN → mount-as-delegate

The client side: fetch a peer card safely, validate + hash-pin it, mount its skills through the existing MCP mount path so the orchestrator sees `delegate_to_<name>`, and persist the remote registry with its API.

### Task 20: client.ts — remote discover/validate/PIN (HARD §7.3)

**Files:**
- Create: `src/a2a/client.ts`, `src/a2a/canonical.ts`
- Test: `tests/a2a/client.test.ts`, `tests/a2a/canonical.test.ts`
- Modify: `src/a2a/card.ts` (re-point `cardEtag` to the shared `canonicalizeCard`)

**Interfaces:**
- Consumes: `noRedirectFetch` from `../mcp/http-redirect.ts` (the SSRF guard — `redirect:'error'`); `createHash` from `node:crypto`; `AgentCardSchema`, `A2aAgentCard`, `A2aMethod`, `MessageSchema` from `../contracts/index.ts`; `recordA2aClientDiscover`, `recordA2aClientInvoke` (Task 2).
- Produces:
  - `src/a2a/canonical.ts`: `canonicalizeCard(card: A2aAgentCard): string` — deterministic serialization with **stable key ordering** (recursively sorted keys) so a benign re-serialize can't false-trip the pin and a field-swap can't slip under the hash. `hashCard(card): string` = `sha256(canonicalizeCard(card))`.
  - `src/a2a/client.ts`:

```ts
export type RemoteAgent = { name: string; baseUrl: string; cardUrl: string; token: string; pinnedCardHash: string };
export type DiscoverResult =
  | { ok: true; card: A2aAgentCard; pinnedCardHash: string }
  | { ok: false; reason: string };
export function createA2aClient(deps?: { fetchImpl?: typeof fetch }): {
  /** GET the card with redirect:'error', validate (reject protocolVersion!=='1.0'),
   *  compute the pin hash. Never follows a redirect (SSRF). */
  discover(cardUrl: string): Promise<DiscoverResult>;
  /** Re-fetch + validate a KNOWN remote; a hash != the pin is a hard reject. */
  verifyPin(remote: RemoteAgent): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** message/send (or /stream) against remote.baseUrl with its Bearer. */
  invoke(remote: RemoteAgent, method: A2aMethod, params: unknown): Promise<unknown>;
};
```

- [ ] **Step 1: Write the failing tests** (mock peer):

```ts
test('canonicalizeCard is stable under key reordering (no false pin trip)', () => { /* two equal cards with shuffled keys → same hash */ });
test('discover happy path: validate + pin a 1.0 card', async () => { /* fetch stub returns a card → ok:true, pinnedCardHash set */ });
test('discover rejects protocolVersion !== "1.0"', async () => { /* card 0.3 → ok:false */ });
test('verifyPin hard-rejects a card whose body changed since the pin (§7.3)', async () => { /* re-fetch returns an altered card → ok:false */ });
test('discover blocks a redirecting card host (redirect:error SSRF guard)', async () => { /* fetch stub 302 → rejected */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block; `discover` uses `noRedirectFetch` (defense-in-depth on top of `redirect:'error'`). Re-point `card.ts cardEtag` at `hashCard`.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/client.ts src/a2a/canonical.ts src/a2a/card.ts tests/a2a/client.test.ts tests/a2a/canonical.test.ts`.

```bash
git add src/a2a/client.ts src/a2a/canonical.ts src/a2a/card.ts tests/a2a/client.test.ts tests/a2a/canonical.test.ts
git commit -m "feat(a2a): remote client discover/validate/PIN (canonical hash, redirect:error SSRF guard)"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.3 card spoofing/hash-pinning/SSRF).** Reviewer probes: is the canonicalization order-stable (no false trip) AND swap-safe (a moved field changes the hash)? Is `redirect:'error'` enforced (no SSRF to an internal address)? Is a hash mismatch a HARD reject surfaced to the operator, never a silent re-pin?*

### Task 21: Mount a remote agent as a delegate ToolSet (reuse the MCP mount path)

**Files:**
- Create: `src/a2a/mount.ts`
- Test: `tests/a2a/mount.test.ts`
- Modify: `src/mcp/mount.ts` (only if a shared seam is needed — prefer producing a `ToolSet` that `mountAll`/`forAgent` consumes unchanged)

**Interfaces:**
- Consumes: `createA2aClient`, `RemoteAgent` (Task 20); `wrapToolsWithBreaker` from `../mcp/client.ts` (per-remote breaker); `withDelegationSpan` from `../telemetry/spans.ts` (**reuse `agent.delegation` — no new span**); `tool` from `ai`; `z` from `zod`; `MountedRegistry.forAgent` / `mountAll` (`src/mcp/mount.ts:98,204`).
- Produces:
  - `src/a2a/mount.ts`: `remoteAsToolSet(remote: RemoteAgent, client: ReturnType<typeof createA2aClient>): ToolSet` — one tool per remote skill named `delegate_to_<remote.name>` whose `inputSchema` is `{ task: z.string() }` and whose `execute` runs `client.invoke(remote, MessageSend, ...)` and returns the completed artifact text (or a structured error) — SAME failure-returns-not-throws contract as `asDelegateTool` (`src/core/delegate.ts:122`), wrapped with `wrapToolsWithBreaker(\`a2a:${remote.name}\`, ...)` so a dead peer fast-fails. The mounted remote surfaces to the orchestrator via `forAgent`→`createSuperAgent` `toolsFor` and inherits the guardrails/depth-guard/breaker/`agent.delegation` span for free. `mountRemotes(remotes: RemoteAgent[]): ToolSet` merges them (name-collision warns, the `mountAll` idiom).

- [ ] **Step 1: Write the failing tests** (fake client):

```ts
test('a remote mounts as delegate_to_<name> and calls message/send on execute', async () => { /* execute({task}) → client.invoke called with MessageSend; returns the artifact text */ });
test('a failing remote returns a structured error (never throws) + trips the breaker', async () => { /* invoke rejects repeatedly → CircuitOpenError fast-fail */ });
test('the mounted tool set feeds forAgent → toolsFor (delegate_to_<name> visible to the orchestrator)', () => { /* merge + forAgent slice includes the tool */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. Do NOT emit a second delegation span — `withDelegationSpan` already fires when the orchestrator calls the tool through `runGuardedAgent`; the A2A hop is the tool `execute`, which nests under it.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/mount.ts tests/a2a/mount.test.ts`.

```bash
git add src/a2a/mount.ts tests/a2a/mount.test.ts
git commit -m "feat(a2a): mount a remote A2A agent as a delegate_to_<name> ToolSet (reuse MCP mount + agent.delegation)"
```

*Model: Opus (the delegate contract must match `asDelegateTool` exactly — failure returns, breaker wrap, no duplicate span — so the mounted remote is indistinguishable from a local specialist to the orchestrator).*

### Task 22: Remote store + remotes API

**Files:**
- Create: `src/a2a/remotes.ts`, `src/server/a2a/remotes.ts`, `src/server/a2a/remotes-test.ts`
- Modify: `src/server/app.ts` (route `/api/a2a/remotes*`), `src/contracts/a2a.ts` (remote DTOs)
- Test: `tests/a2a/remotes.test.ts`, `tests/server/a2a-remotes-api.test.ts`

**Interfaces:**
- Consumes: `RemoteAgent` (Task 20); `createA2aClient`; `requireTrustedLocal`; the `device-registry.ts` atomic-write idiom + `~`-expansion; `loadConfig` for `AGENT_A2A_REMOTES_PATH`; new contracts `A2aRemoteDtoSchema` (never returns `token`), `A2aRemoteAddRequestSchema`, `A2aRemoteTestResponseSchema`.
- Produces:
  - `src/a2a/remotes.ts`: `createRemoteStore(config: { path?: string }): { list(): RemoteAgent[]; get(name): RemoteAgent | undefined; add(r: RemoteAgent): void; remove(name): void }` — `~/.config/ai/a2a-remotes.json`, 0700 dir / 0600 file (the token is stored here, never round-tripped to a DTO/span), fail-closed load.
  - `src/server/a2a/remotes.ts`: `handleRemoteList/Add/Delete` (all `requireTrustedLocal`) — `Add` validates + pins (`client.discover`) before persisting; the DTO **omits `token`**.
  - `src/server/a2a/remotes-test.ts`: `handleRemoteTest(req, deps, guard)` — the discover→validate→pin **dry-run** (mirrors `POST /api/mcp/test-mount`), returns `{ card, pinnedCardHash }` without persisting.
  - `app.ts`: `GET`/`POST`/`DELETE /api/a2a/remotes`, `POST /api/a2a/remotes/test` — all `requireTrustedLocal`, action-before-`:id`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('remote store round-trips a remote; the file is 0600 and DTO omits token', async () => { /* ... */ });
test('POST /api/a2a/remotes requires trusted-local + pins before persisting', async () => { /* non-loopback → 403; loopback → discover+persist */ });
test('POST /api/a2a/remotes/test dry-runs discover/validate/pin without persisting', async () => { /* store unchanged after test */ });
test('GET /api/a2a/remotes never returns the token', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/a2a/remotes.ts src/server/a2a/remotes.ts src/server/a2a/remotes-test.ts src/server/app.ts src/contracts/a2a.ts tests/a2a/remotes.test.ts tests/server/a2a-remotes-api.test.ts`.

```bash
git add src/a2a/remotes.ts src/server/a2a/remotes.ts src/server/a2a/remotes-test.ts src/server/app.ts src/contracts/a2a.ts tests/a2a/remotes.test.ts tests/server/a2a-remotes-api.test.ts
git commit -m "feat(a2a): consume remote store (~/.config/ai/a2a-remotes.json) + remotes API (trusted-local, token never in DTO)"
```

*Model: Sonnet (store + REST CRUD mirror the devices/MCP precedent) — light review that the token never crosses into a DTO/span and trusted-local fronts every mutation.*

### Task 23: Increment 6 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check.
- [ ] **Step 2: Update the SDD ledger** with Increment 6 commits + the §7.3 client review verdict.

*Model: controller.*

---

## Increment 7 — Console Federation tab (primary UX) + thin CLI

Replace nothing (new tab): a live `apiFetch`-driven Federation tab with Expose + Consume panels; the add-remote dialog mirroring the MCP add/test-mount + `pair-device-dialog.tsx`; watch a remote task via the existing Runs waterfall. Plain `apiFetch` hooks, no query lib. **Every operator/peer string is React-escaped — never `dangerouslySetInnerHTML`** (the stored-XSS lesson). Web gate = `cd web && bun run typecheck && bun run test`.

### Task 24: use-a2a-config + use-a2a-remotes hooks

**Files:**
- Create: `web/src/features/ops/use-a2a-config.ts`, `web/src/features/ops/use-a2a-remotes.ts`
- Test: `web/src/features/ops/use-a2a-config.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `../../shared/contract/client.ts`; `A2aConfigResponseSchema`, `A2aTokenIssueResponseSchema`, `A2aSkillsPutRequestSchema`, `A2aRemoteDtoSchema`, `A2aRemoteTestResponseSchema` from `@contracts`.
- Produces:
  - `useA2aConfig()` → `{ config, error, refresh, putSkills(skills), issueToken(label), revokeToken(id) }` — mirrors `use-devices.ts` (a `tick` bump-to-refetch; `apiFetch('/a2a/config', { schema: A2aConfigResponseSchema })`). `issueToken` POSTs `/a2a/token` and returns the once-only token; each mutation `refresh()`es.
  - `useA2aRemotes()` → `{ remotes, error, refresh, addRemote(body), removeRemote(name), testRemote(body) }` — `apiFetch('/a2a/remotes', { schema })`; `testRemote` POSTs `/a2a/remotes/test` (the dry-run) returning `{ card, pinnedCardHash }`.

- [ ] **Step 1: Write the failing test** (`vi.stubGlobal('fetch', ...)`; a probe component; `waitFor`) — the `use-devices.test.tsx` structure:

```ts
test('useA2aConfig loads config and refetches after issueToken', async () => { /* stub fetch, render probe, assert config then a token-issue refetch */ });
```

- [ ] **Step 2: Run test to verify it fails** — `cd web && bun run test -- use-a2a-config` → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block (copy `use-devices.ts`'s `let cancelled` effect + mutations-refresh shape).
- [ ] **Step 4: Run test to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `cd web && bun run typecheck && bun run test -- use-a2a-config`.

```bash
git add web/src/features/ops/use-a2a-config.ts web/src/features/ops/use-a2a-remotes.ts web/src/features/ops/use-a2a-config.test.tsx
git commit -m "feat(web): useA2aConfig + useA2aRemotes hooks (apiFetch, no query lib)"
```

*Model: Sonnet.*

### Task 25: Federation tab — Expose panel (allowlist editor + card preview + token issue)

**Files:**
- Create: `web/src/features/ops/federation-tab.tsx`, `web/src/features/ops/skill-allowlist-editor.tsx`, `web/src/features/ops/card-preview.tsx`, `web/src/features/ops/token-issue.tsx`
- Modify: `web/src/features/ops/index.tsx` (register the tab: `OpsTab.Federation='federation'` + a `TABS` row), `web/src/app/router.tsx` (extend `OpsSearch` + `validateSearch` with `'federation'`)
- Test: `web/src/features/ops/federation-tab.test.tsx`

**Interfaces:**
- Consumes: `useA2aConfig`; the wire enums/DTOs (`JobKindWire`, `A2aConfigResponseSchema`).
- Produces: `federation-tab.tsx` with `data-testid="ops-federation"` and two panels; the **Expose panel** = `skill-allowlist-editor.tsx` (add/remove `{ skillId, name, description, kind, ref }` rows; `kind` a `JobKindWire` select; a bad ref surfaces the API 400), `card-preview.tsx` (renders `config.cardPreview` live — skills, url, capabilities), `token-issue.tsx` (issue → shows the secret ONCE with a "won't be shown again" note — the `PairDeviceDialog` precedent — + a revoke list). All operator/peer strings render via `{value}` (React-escaped); assert an `<img onerror>`-shaped skill name renders inert.

- [ ] **Step 1: Write the failing tests** (`renderAt('/ops?tab=federation')` + a URL-routing `mockFetch`):

```ts
test('federation tab renders the Expose panel (data-testid ops-federation)', async () => { /* findByTestId('ops-federation') + card preview */ });
test('issuing a token shows the secret exactly once', async () => { /* click issue → token visible; refresh → gone */ });
test('a malicious skill name renders as inert text (no dangerouslySetInnerHTML)', () => { /* <img src=x onerror> shows as text */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — register the tab in `index.tsx` (`OpsTab` enum + `TABS` + the `t.id === OpsTab.Federation && <FederationTab />` panel dispatch) and extend `router.tsx` `validateSearch` to accept `'federation'`. Reuse the shared `CARD_CLASS`/`Button`/`Dialog` UI.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `cd web && bun run typecheck && bun run test -- federation-tab`.

```bash
git add web/src/features/ops/federation-tab.tsx web/src/features/ops/skill-allowlist-editor.tsx web/src/features/ops/card-preview.tsx web/src/features/ops/token-issue.tsx web/src/features/ops/index.tsx web/src/app/router.tsx web/src/features/ops/federation-tab.test.tsx
git commit -m "feat(web): Federation tab Expose panel (allowlist editor + card preview + token issue, XSS-safe)"
```

*Model: Sonnet.*

### Task 26: Federation tab — Consume panel + add-remote dialog + watch-remote-task

**Files:**
- Create: `web/src/features/ops/add-remote-dialog.tsx`
- Modify: `web/src/features/ops/federation-tab.tsx` (mount the Consume panel + dialog)
- Test: `web/src/features/ops/add-remote-dialog.test.tsx`

**Interfaces:**
- Consumes: `useA2aRemotes`; the router `Link` to `/runs/$runId` (`RunDetail`/`Waterfall` — the existing Runs waterfall, no new viewer); `A2aRemoteTestResponseSchema`.
- Produces: the **Consume panel** = the remote list (name · baseUrl · pinned-hash-short · a remove button) + an "Add remote agent" button opening `add-remote-dialog.tsx` (paste `cardUrl` + `token` → `testRemote` dry-run shows the card preview + pin → confirm calls `addRemote` = validate+pin+persist, mirroring the MCP add/test-mount + `pair-device-dialog.tsx`). Watching a delegated remote task deep-links via `Link` to `/runs/$runId` (the Jobs-tab precedent) — the run is watched in the existing waterfall.

- [ ] **Step 1: Write the failing tests:**

```ts
test('add-remote dialog dry-runs test then persists on confirm', async () => { /* paste url+token → test shows card → confirm → addRemote called + list refreshes */ });
test('the remote list deep-links a task to /runs/:id', () => { /* a remote task row has a working /runs/<id> Link */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `cd web && bun run typecheck && bun run test -- add-remote-dialog`.

```bash
git add web/src/features/ops/add-remote-dialog.tsx web/src/features/ops/federation-tab.tsx web/src/features/ops/add-remote-dialog.test.tsx
git commit -m "feat(web): Federation Consume panel + add-remote dialog (test→pin→mount) + watch via Runs waterfall"
```

*Model: Sonnet.*

### Task 27: Thin `agent a2a` CLI

**Files:**
- Create: `src/cli/a2a.ts`
- Modify: `package.json` (add `"a2a": "bun run src/cli/a2a.ts"`)
- Test: `tests/cli/a2a.test.ts`

**Interfaces:**
- Consumes: `createA2aAllowlist`, `createA2aEnrollment`, `createRemoteStore`, `createA2aClient`, `buildAgentCard`; `createRootTokenStore`; `loadConfig`; the `runDaemonCli` injected-deps shape (`src/cli/daemon.ts`).
- Produces:

```ts
export type A2aCliDeps = {
  skills: { list(): SkillEntry[]; put(e: SkillEntry): void; remove(id: string): void };
  token: { issue(label: string): { id: string; token: string }; revoke(id: string): void; list(): IssuedToken[] };
  remotes: { list(): RemoteAgent[]; add(cardUrl: string, token: string): Promise<RemoteAgent>; remove(name: string): void };
  call(name: string, task: string): Promise<unknown>;   // message/send to a mounted remote
  card(): unknown;                                       // print the local card
  print: (s: string) => void;
};
export async function runA2aCli(argv: string[], deps: A2aCliDeps): Promise<void>;
```

  Subcommands: `skills [list|add '<json>'|remove <id>]`, `token [issue <label>|revoke <id>|list]` (print the once-only secret on issue), `remotes [list|add <cardUrl> <token>|remove <name>]`, `call <name> '<task>'`, `card`. Pure dispatch over `deps` (the `runDaemonCli` pattern); `buildRealA2aDeps()` builds the stores over the configured paths + root token; `if (import.meta.main)` strips a leading `a2a` token and dispatches. No `console.log` in the dispatch body — use `deps.print`.

- [ ] **Step 1: Write the failing tests** (inject fake deps; assert dispatch):

```ts
test('a2a token issue prints the secret once; skills list prints rows', async () => { /* spy deps.print */ });
test('a2a remotes add calls deps.remotes.add and prints the pinned hash', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/cli/a2a.ts tests/cli/a2a.test.ts`.

```bash
git add src/cli/a2a.ts package.json tests/cli/a2a.test.ts
git commit -m "feat(a2a): agent a2a CLI (skills|token|remotes|call|card)"
```

*Model: Sonnet.*

### Task 28: Increment 7 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check` (root + web). Fully green including docs-check.
- [ ] **Step 2: Update the SDD ledger** with Increment 7 commits + the XSS-safety confirmation.

*Model: controller.*

---

## Increment 8 — Docs (4 surfaces) + ledger + Artifact + live-verify + capstone + land

Closes the docs hard line, runs the mandatory §10 live-verify (with the two-box notify), the Fable whole-branch capstone, and lands the slice.

### Task 29: The four living doc surfaces + Artifact regen

**Files:**
- Modify: `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`
- Artifact: regenerate the architecture-snapshot (not a repo file)

- [ ] **Step 1: `docs/architecture.md`** — **EXPAND the `src/a2a/` stub landed in Task 2** into the full subsystem section (card → allowlist → JSON-RPC server → task-map onto the queue → stream re-framer → enroll → client → mount → remotes; the EXPOSE + CONSUME lanes matching the diagram; module map + data-flow edges to Queue/Daemon/MCP/Ops-console + the two external-peer nodes). Replace the stub's "expanded later" note. Update **§24** for the `POST /api/a2a` route class + `GET /.well-known/agent-card.json` outside the `/api` guard + the inbound-task→`JobStore.enqueue` (`origin=Remote`) edge. Update **§14/§15** for the consume-side reuse (remote mounted via `mountAll`→`forAgent`). Update the doc-map / README pointer if a living doc was added.
- [ ] **Step 2: `README.md`** — update the **Status line**; add the **Slice 31 row** to the slice status table (✅ Done); update the "Next" line + any feature paragraph so A2A interop reads as shipped.
- [ ] **Step 3: `docs/ROADMAP.md`** — flip the **"Multi-machine / A2A interop"** markers (gap table, phase table, recommended sequence) ❌/🟡 → ✅ shipped (Slice 31).
- [ ] **Step 4: SDD ledger** (`.superpowers/sdd/progress.md`) — a `SLICE 31` section with per-task commits, review verdicts, and the increment gates (the Slice-25 section is the template).
- [ ] **Step 5: Artifact** — regenerate the interactive architecture snapshot from `architecture.md`: add an `a2a` subsystem node + edges to Queue/Daemon/MCP/Ops-console + two external-peer nodes; update the footer slice count "31" + the real test count (run the suite for the number). Validate with `node --check` + referential-integrity + the real test-count gate (the `reference-artifact-regen-mechanics` memory).
- [ ] **Step 6: Gate + commit** — `bun run docs:check && bun run check`.

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(a2a): architecture + README + ROADMAP + SDD ledger for Slice 31"
```

*Model: Sonnet (mechanical doc edits) — the final whole-branch review (Task 31) audits these claims against the diff for TRUTH, not just presence.*

### Task 30: Live-verify gate (§10, mandatory before merge)

> **⚠️ Two-box over Tailscale — the second Mac (`100.121.49.105`) is normally powered OFF.** BEFORE running the cross-machine portion, **notify the user via `PushNotification` that they must power on the second Mac** and confirm it is reachable over Tailscale + its launchd daemon + real Ollama are up. This box = A2A **client**; second Mac = A2A **server**. Record each result in the ledger.

- [ ] **Step 0 — NOTIFY:** send the user the power-on-the-second-Mac notification and wait for confirmation before the cross-machine steps. The single-box loopback portion (Step 1) runs without it.
- [ ] **Step 1 — Single-box loopback (deterministic CI portion; the cross-machine `.live` part gated off in CI):** on this box, EXPOSE + CONSUME against itself — enable `AGENT_A2A_ENABLED`, author an allowlist + issue a token in the console, fetch the card, `message/send` a real run → streamed artifacts → `completed`; bad token → `401`; altered card hash → rejected; unlisted skill → not callable.
- [ ] **Step 2 — Discover (cross-machine):** from this box fetch the peer's `GET /.well-known/agent-card.json`; validate + pin the hash in the Federation tab.
- [ ] **Step 3 — Delegate:** `message/send` a **real crew run** from this box to the peer → `submitted → working` → **streamed artifacts back** → `completed`; the run is watchable in the peer's Runs waterfall (and, via the mounted `delegate_to_<name>`, from an orchestrator run here).
- [ ] **Step 4 — Cancel:** `tasks/cancel` a running remote task → `canceled`; the peer's job actually aborts.
- [ ] **Step 5 — Bad token:** a wrong/absent Bearer on `POST /api/a2a` → **401**.
- [ ] **Step 6 — Spoofed card:** re-fetch a peer card whose body was altered so the hash differs from the pin → **rejected** (§7.3), surfaced in the console.
- [ ] **Step 7 — Least-privilege:** attempt `message/send` to a skill **not** in the peer's allowlist → **rejected**, never runs (§7.4).
- [ ] **Step 8 — Invariants + record:** throughout, confirm `a2a.*` spans present and **secret-free**, and the two-stores separation holds (an A2A Bearer is not accepted on a device route and vice-versa). Record PASS/FAIL per step in the ledger; any defect found is fixed in-slice (no deferrals) before proceeding.

*Model: controller-driven live session (real models + browser via native `/chrome`).*

### Task 31: Fable whole-branch capstone review

- [ ] **Step 1:** Dispatch the **Fable** whole-branch adversarial review over the full `slice-31-a2a-multimachine` diff (weekly-Fable headroom permitting; else Opus ultracode). Focus the four hard parts: §7.1 task-state mapping + fail-closed mid-run consent (state-mapping totality, deterministic typed `failed`/`consent-unavailable`, no hang, `input-required` never emitted), §7.2 inbound auth + untrusted-content (verify-before-parse, replay window, body cap, parts never instructions, no secret leak), §7.3 card spoofing/hash-pinning/SSRF (canonical hash order-stable AND swap-safe, `redirect:'error'`, hard reject on mismatch), §7.4 least-privilege (resolve-then-reject, no free-form skill). Also audit: docs claims vs the diff (truth, not presence), trusted-local on ALL mutating `/api/a2a/*` routes, the A2A Bearer ≠ device session token separation, no secrets in logs/DTOs/spans, the card 404s when disabled.
- [ ] **Step 2:** Fix every finding in-slice (no deferrals). Re-run `bun run check`.
- [ ] **Step 3:** Record the verdict + any fixes in the ledger.

*Model: **Fable** (premium whole-branch capstone).*

### Task 32: Land + notify

- [ ] **Step 1:** Confirm `bun run check` green (scope-excluding any known pre-existing `.live` model-nondeterminism flake, documented as in the Slice-24/25 ledger).
- [ ] **Step 2:** Publish the regenerated Artifact (final counts).
- [ ] **Step 3:** Merge `slice-31-a2a-multimachine` → `main` with `--no-ff` and push (the four doc surfaces + ledger in the same push satisfy the pre-push slice-landing gate).
- [ ] **Step 4:** Notify the user via `PushNotification` that Slice 31 landed (headline: one A2A v1.0 layer — EXPOSE card + JSON-RPC + streaming onto the queue behind a least-privilege allowlist + A2A Bearer, CONSUME remote agents as delegates, Federation console tab + CLI), with the merge commit ref.

*Model: controller. Autonomous merge+push+notify per the standing multi-slice authorization.*

---

## Self-Review (run before handing off; fixed inline)

**1. Spec coverage (every D1–D7, §4, §7, §8, §9, §10, §11 → a task):**
- **D1** unify on A2A v1.0, hand-rolled JSON-RPC subset, new `src/a2a/` (no `@a2a-js/sdk`) → the whole plan; six methods across Tasks 9 (send/get/cancel) + 12 (stream/resubscribe); modules across Tasks 2,4,5,8,9,12,13,15,16,20,21,22.
- **D2** card + least-privilege allowlist, `GET /.well-known/agent-card.json` (ETag, `skills:[]` when empty, 404 when disabled) → Tasks 4,5,6.
- **D3** JSON-RPC server + task-state mapping onto the Slice-24 queue → Tasks 8,9,10 (the D3 mapping table = Task 8).
- **D4** CONSUME discover→validate→PIN→mount-as-delegate via the MCP mount path → Tasks 20,21,22.
- **D5** separate out-of-band A2A Bearer (HMAC-from-root, revocable, two-stores split) → Tasks 15,16,17,22 + 18 (boot-wiring constructs+injects the enrollment + both stores) (the A2A/device disjointness is tested in 15 + 16).
- **D6** isomorphic contracts + parity → Task 1 (+ console DTOs in 17,22; the `JobKindWire`-typed skill-entry wire schema first used in 17).
- **D7** Federation tab (primary UX) + thin CLI + API routes → Tasks 17 (config/skills/token API), 22 (remotes API), 24–26 (tab), 27 (CLI).
- **§4** backend-delta table — every ADD row mapped: card (5,6), server (9,10), task-map (8), client (20), consume-as-delegate (21), enroll (15,16), allowlist+token registry (4,15), remote store (22), contracts (1), config/preview API (17), token API (17), remotes API (22), CLI (27); the two `reuse` rows (`JobStore.enqueue`, `handleRunStream` re-framed) in Tasks 9 + 12; the concrete `deps.a2a` that makes all ADD rows reachable is constructed+injected at boot in Task 18.
- **§7 hard parts, ALL flagged ADVERSARIAL-VERIFY:** §7.1 → Task 8 (state-mapping totality) + Task 13 (fail-closed no-hang consent → typed `failed`); §7.2 → Task 9 (untrusted content) + Task 15 (enroll auth) + Task 16 (Bearer gate/replay/body cap); §7.3 → Task 20 (spoof/pin/SSRF); §7.4 → Task 4 (author-time) + Task 9 (invoke-time resolve-then-reject). **Seven §7-flagged adversarial-verify tasks: 4, 8, 9, 13, 15, 16, 20.** (Task 18 — daemon/server boot-wiring of `deps.a2a` — is Opus but NOT a §7 adversarial-verify task.)
- **§8** arch-doc + telemetry → Task 29 (docs) + Task 2 (spans/ATTR; `agent.delegation` reused in Task 21, no dup).
- **§9** testing strategy — contracts parity + protocolVersion reject (1); message/send→submitted + mapped JobKind + each OrchestratorResult variant + tasks/cancel + unlisted-skill reject + bad-Bearer-before-parse + over-cap + replay (8,9,16); streaming submitted→working→completed + resubscribe replay + fail-closed mid-run consent → typed `failed`/`consent-unavailable` (no hang, `input-required` never emitted) (12,13); consume discover/validate/pin + hash-mismatch + redirect-block + delegate_to_<name> inherits breaker/span (20,21); enrollment constant-time + revoke + A2A≠device separation (15,16); boot-wiring serves the card when enabled / unavailable when off (18) → all embedded.
- **§10** live-verify (single-box loopback + the six cross-machine steps + the ⚠️ notify-before) → Task 30.
- **§11** deps (NONE) + env knobs (all five, `AGENT_A2A_*`) → Task 2; the card `url` derives from the existing bind/tunnel-origin config (no new transport knob) → Task 5.

**2. Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N". Every code step shows real test code and a precise Produces contract; the hard-part signatures (`orchestratorResultToTaskState`/`resultToTaskError`, `handleMessageSend` resolve-then-reject, `createA2aEnrollment` HMAC-from-root, `createReplayGuard`, `canonicalizeCard`/`hashCard`, `remoteAsToolSet`, `consentDeclinedToTaskError`) are written in full. Test bodies for the pure/critical functions are literal; a few multi-fixture server/web tests give exact assertions in prose (matching the Slice-25 template's convention for fixture-heavy route/UI tests).

**3. Type consistency across tasks:** `TaskStateWire`/`A2aMethod`/`A2aTask`/`A2aMessage`/`A2aArtifact`/`Part` names identical from Task 1 through 8,9,12,13,20,21; `SkillEntry`/`ResolvedTarget`/`A2aAllowlist` match between Task 4 (def) and 5,9,17,18,27 (use); `A2aServerDeps` matches between Task 9 (def) and 10,12,13,16,18; `RemoteAgent`/`DiscoverResult` match between Task 20 (def) and 21,22,27 (use); `A2aEnrollment`/`IssuedToken` match between Task 15 (def) and 16,17,18,27; `ServerDeps.a2a` grows monotonically (`{ allowlist }` in Task 6 → `{ allowlist, jobStore, runsRoot, taskIndex }` in 9/10 → `+ enrollment` in 16 → `+ remotes/client` in 22) with no field rename, then is **constructed with the fully-grown shape and injected** by `buildA2aServerDeps` in Task 18; the five `AGENT_A2A_*` knob names + five `A2A_*` `ATTR` keys (Task 2) are referenced by their live names only (5,6,16,18,22,2); `canonicalizeCard`/`hashCard` (Task 20) are the single card-hash source, re-pointed from `card.ts cardEtag` (Task 5→20); the consume delegation reuses `withDelegationSpan`/`agent.delegation` (Task 21) — no new span defined. Web: `apiFetch(path,{schema})` + `@contracts` imports + the `use-devices.ts` reloadTick pattern are used identically in Tasks 24–26; the tab is registered in `ops/index.tsx` + `router.tsx` (Task 25) with `data-testid="ops-federation"`.
