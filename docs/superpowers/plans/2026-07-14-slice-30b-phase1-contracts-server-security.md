# Slice 30b Phase 1 — Contracts + Thin Server + Perimeter Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation of the framework's first web UI — an isomorphic `src/contracts/` wire protocol, a thin transport-agnostic `Bun.serve` BFF that owns no business logic, and the full localhost perimeter security (per-session bearer token, Host/Origin allowlist, inbound Zod validation, media-path confinement, served-mode record-IO default-off).

**Architecture:** `src/contracts/` (Zod schemas + inferred TS types) is the single source of truth for the wire, imported by both the server and (later) the browser, and depends on *nothing* but `zod`. `src/server/` adapts the engine to HTTP: a request pipeline (perimeter → token → route) wraps a handful of endpoints in a `server.request` telemetry span and typed-error handling, serving static assets under COOP/COEP. Phase 1 stops at the security perimeter, `/api/health`, and the `bun run web` entry point — the streaming chat handler, DTO mappers, and the React frontend (`web/`) are later phases/plans.

**Tech Stack:** Bun · TypeScript (strict, ESM, `.ts` import extensions) · Zod v4 (`zod@^4.4.3`) · OpenTelemetry (existing `src/telemetry/spans.ts`) · Bun.serve · `bun:test`.

## Global Constraints

- **Runtime is Bun, never npm.** Tests: `bun test`, files `tests/**/*.test.ts`, style `import { expect, test } from 'bun:test';`. Typecheck: `bun run typecheck`. Lint: `bun run lint`. Full gate: `bun run check`.
- **TypeScript strict, ESM, `.ts` extension in every relative import** (`allowImportingTsExtensions`, `moduleResolution: bundler`).
- **Code style:** prefer `type` over `interface`; prefer string `enum` over string-literal unions for finite named sets (`enum Foo { A = 'A' }`); **discriminated object unions stay `type`** (their discriminant value comes from an enum); early returns over nested conditionals; small focused files; descriptive names.
- **Zod is v4** — `import { z } from 'zod'`. Use `z.enum(NativeTsEnum)` for native enums, `z.record(z.string(), z.unknown())` (two-arg), `z.discriminatedUnion('type', [...])`, `z.infer<typeof Schema>`.
- **Isomorphic rule (critical, enforced by a test):** `src/contracts/**` may import **only** `zod` and sibling `./` files inside `src/contracts/`. NO `node:*`, NO `../` (engine/reliability/telemetry), NO `ai` / `@ai-sdk/*`. It is imported by both server and browser.
- **Contracts never re-export or import AI-SDK types.** Status events and request schemas are OUR Zod types.
- **Server degrades gracefully, never crashes.** Every `/api` handler is wrapped so a thrown typed error becomes a JSON error response (reuse `explain()` from `src/errors/boundary.ts`); no endpoint may throw out of the fetch handler.
- **Entry-point script is `bun run web`, NOT `bun run serve`.** `serve` already maps to `scripts/serve.sh` (starts Ollama with the project model store) — do not touch or overload it. The new web BFF gets its own `web` script.
- **Phase 1 does NOT build the chat handler.** The chat inbound schema + validation land now (context for their shape: the Phase-2 handler will `createUIMessageStream` + `streamText` + `await convertToModelMessages(msgs)` — note `convertToModelMessages` is **async** in AI SDK v6.0.217 — and needs `Bun.serve({ idleTimeout: 0 })` for SSE). Building that handler is Phase 2.
- **Phase 1 does NOT create `web/` or add frontend deps.** The Vitest/Testing-Library harness, design tokens, app shell, and ⌘K skeleton are the sibling **Phase 1b** plan. (`react`, `react-dom`, `@ai-sdk/react` already sit in the root `package.json` from Spike A; leave them.)
- **Owner/principal is reserved now, constant `"local"`.** The `server.request` span sets a `server.principal` attr (default `"local"`) reserved for Slice-35 audit-grade logging. No auth identity is derived in Phase 1.
- **Served-mode record-IO defaults OFF** (`AGENT_WEB_RECORD_IO`, default false), distinct from the CLI's `AGENT_TELEMETRY_RECORD_IO` (default on).

---

## File Structure

**Created:**
- `src/contracts/enums.ts` — every string enum used across the wire (Task 1).
- `src/contracts/dto.ts` — `RunDTO`/`SpanDTO`/`DegradeDTO`/`ChatMessageDTO` schemas + types (Task 2).
- `src/contracts/events.ts` — the `StatusEvent` transient-SSE discriminated union (Task 3).
- `src/contracts/requests.ts` — inbound `ChatRequest`/`RespondRequest` + `UiMessageLike` schemas (Task 4).
- `src/contracts/index.ts` — barrel re-export (Task 4).
- `src/server/security/token.ts` — session bearer token mint + guard (Task 6).
- `src/server/security/origin.ts` — Host allowlist + Origin rejection (Task 7).
- `src/server/security/media-path.ts` — realpath confinement util (Task 8).
- `src/server/app.ts` — the thin BFF fetch pipeline + `/api/health` + static serving (Task 10).
- `src/server/main.ts` — `bun run web` entry: config → mint token → boot → inject token into HTML (Task 11).
- Tests mirror each under `tests/contracts/**` and `tests/server/**`.

**Modified:**
- `src/config/schema.ts` — add `strict?: boolean` to `ConfigEntry`, thread it, add three `AGENT_WEB_*` entries (Task 5).
- `src/telemetry/spans.ts` — add server `ATTR` constants + `withServerRequestSpan` (Task 9).
- `package.json` — add the `web` script (Task 11).
- `docs/architecture.md` — add `## Contracts` + `## Server (web BFF)` stub sections so `docs-check` passes (Task 12).

---

### Task 1: Contracts foundation — string enums + isomorphic-purity guard

**Files:**
- Create: `src/contracts/enums.ts`
- Test: `tests/contracts/enums.test.ts`, `tests/contracts/isomorphic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: enums `RunOrigin`, `RunLifecycle`, `SpanStatus`, `ArtifactKind`, `DegradeKind`, `ChatRole`, `ModelLoadAction`, `StatusEventType` (all string enums). These are imported by Tasks 2–4.

- [ ] **Step 1: Write the failing enum test**

```ts
// tests/contracts/enums.test.ts
import { expect, test } from 'bun:test';
import {
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  StatusEventType,
} from '../../src/contracts/enums.ts';

test('RunOrigin carries the reserved provenance values', () => {
  expect(Object.values(RunOrigin)).toEqual([
    'manual',
    'schedule',
    'webhook',
    'api',
    'remote',
  ]);
});

test('RunLifecycle is not just terminal states', () => {
  expect(RunLifecycle.PausedAwaitingInput).toBe('paused-awaiting-input');
  expect(RunLifecycle.Resumable).toBe('resumable');
});

test('DegradeKind mirrors reliability ledger string values', () => {
  expect(Object.values(DegradeKind)).toEqual([
    'model_degraded',
    'agent_dropped',
    'tool_skipped',
    'retried',
    'circuit_open',
  ]);
});

test('StatusEventType discriminants are the data-part names', () => {
  expect(StatusEventType.Confirm).toBe('data-confirm');
  expect(StatusEventType.RunStart).toBe('data-run-start');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/enums.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/enums.ts`.

- [ ] **Step 3: Write the enums**

```ts
// src/contracts/enums.ts
/**
 * Every finite named value on the web wire. Isomorphic: this file imports
 * nothing (not even zod). Enums (not string-literal unions) per repo style;
 * discriminated unions elsewhere take their discriminant from `StatusEventType`.
 */

/** Run provenance (reserved; Slice 25 sets the non-`manual` values). */
export enum RunOrigin {
  Manual = 'manual',
  Schedule = 'schedule',
  Webhook = 'webhook',
  Api = 'api',
  Remote = 'remote',
}

/** Run lifecycle — not just terminal outcome (Slices 24/25/34/38 use the rest). */
export enum RunLifecycle {
  Queued = 'queued',
  Running = 'running',
  PausedAwaitingInput = 'paused-awaiting-input',
  Done = 'done',
  Failed = 'failed',
  Resumable = 'resumable',
}

export enum SpanStatus {
  Ok = 'ok',
  Error = 'error',
}

/** Run-artifact classification (mapper-side readdir+classify; Slice 30b Phase 3). */
export enum ArtifactKind {
  Answer = 'answer',
  Gap = 'gap',
  Spans = 'spans',
  Degradation = 'degradation',
  Other = 'other',
}

/**
 * Wire mirror of `src/reliability/ledger.ts` DegradeKind. The contract MUST NOT
 * import reliability (isomorphic rule), so we redeclare the identical string
 * values here; `tests/contracts/degrade-kind-parity.test.ts` guards they stay equal.
 */
export enum DegradeKind {
  ModelDegraded = 'model_degraded',
  AgentDropped = 'agent_dropped',
  ToolSkipped = 'tool_skipped',
  Retried = 'retried',
  CircuitOpen = 'circuit_open',
}

export enum ChatRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

/** Model-lifecycle transition carried by `data-model-load`. */
export enum ModelLoadAction {
  Pull = 'pull',
  Evict = 'evict',
  Warm = 'warm',
}

/** Transient SSE data-part discriminants (also the AI-SDK data-part type names). */
export enum StatusEventType {
  RunStart = 'data-run-start',
  Provision = 'data-provision',
  McpMount = 'data-mcp-mount',
  Delegation = 'data-delegation',
  ModelSelect = 'data-model-select',
  ModelLoad = 'data-model-load',
  Degrade = 'data-degrade',
  Confirm = 'data-confirm',
  RunEnd = 'data-run-end',
}
```

- [ ] **Step 4: Run enum test to verify it passes**

Run: `bun test tests/contracts/enums.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing isomorphic-purity guard test**

```ts
// tests/contracts/isomorphic.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const CONTRACTS_DIR = join(import.meta.dir, '../../src/contracts');

/** Extract every module specifier from `import ... from '...'` / `export ... from '...'`. */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

test('src/contracts imports only zod or sibling ./ files', () => {
  const files = readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const src = readFileSync(join(CONTRACTS_DIR, file), 'utf8');
    for (const spec of importSpecifiers(src)) {
      const ok = spec === 'zod' || spec.startsWith('./');
      expect(ok, `${file} has forbidden import "${spec}"`).toBe(true);
    }
  }
});
```

- [ ] **Step 6: Run the guard test to verify it passes**

Run: `bun test tests/contracts/isomorphic.test.ts`
Expected: PASS — `enums.ts` has zero imports; the guard now protects every future contracts file.

- [ ] **Step 7: Commit**

```bash
git add src/contracts/enums.ts tests/contracts/enums.test.ts tests/contracts/isomorphic.test.ts
git commit -m "feat(contracts): add wire enums + isomorphic-purity guard test"
```

---

### Task 2: Contract DTOs — RunDTO / SpanDTO / DegradeDTO / ChatMessageDTO

**Files:**
- Create: `src/contracts/dto.ts`
- Test: `tests/contracts/dto.test.ts`, `tests/contracts/degrade-kind-parity.test.ts`

**Interfaces:**
- Consumes: `RunOrigin`, `RunLifecycle`, `SpanStatus`, `ArtifactKind`, `DegradeKind`, `ChatRole` from `./enums.ts`.
- Produces: `DegradeDtoSchema`/`DegradeDTO`, `SpanDtoSchema`/`SpanDTO`, `RunDtoSchema`/`RunDTO`, `ChatMessageDtoSchema`/`ChatMessageDTO`.

- [ ] **Step 1: Write the failing DTO round-trip test**

```ts
// tests/contracts/dto.test.ts
import { expect, test } from 'bun:test';
import {
  ArtifactKind,
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  SpanStatus,
} from '../../src/contracts/enums.ts';
import {
  RunDtoSchema,
  SpanDtoSchema,
} from '../../src/contracts/dto.ts';

const minimalSpan = {
  spanId: 's1',
  parentSpanId: null,
  name: 'agent.run',
  offsetMs: 0,
  durationMs: 12,
  depth: 0,
  status: SpanStatus.Ok,
  degraded: false,
  attributes: {},
  events: [],
};

test('SpanDTO parses with only required fields (forward-compat optionals absent)', () => {
  const parsed = SpanDtoSchema.parse(minimalSpan);
  expect(parsed.spanId).toBe('s1');
  expect(parsed.agent).toBeUndefined();
});

test('SpanDTO survives a JSON serialize/parse round-trip with optionals present', () => {
  const rich = {
    ...minimalSpan,
    statusMessage: 'ok',
    agent: 'researcher',
    delegation: { target: 'researcher', depth: 1, ancestors: ['router'] },
    model: { id: 'qwen3.5:4b', provider: 'ollama', numCtx: 8192, footprintBytes: 42, runtimeDegraded: false },
    tokens: { input: 10, output: 20 },
    node: 'reserved-slice-31',
    attributes: { 'crew.id': 'x' },
    events: [{ name: 'agent.model.select', offsetMs: 3, attributes: { m: 1 } }],
  };
  const wire = JSON.parse(JSON.stringify(SpanDtoSchema.parse(rich)));
  expect(SpanDtoSchema.parse(wire)).toEqual(rich);
});

test('RunDTO parses with reserved owner + lifecycle + origin and nested spans', () => {
  const run = {
    id: 'run-123',
    owner: 'local',
    origin: RunOrigin.Manual,
    lifecycle: RunLifecycle.Done,
    startMs: 1000,
    durationMs: 50,
    outcome: 'answer',
    models: ['qwen3.5:4b'],
    degraded: true,
    degrades: [{ kind: DegradeKind.Retried, label: 'retried', subject: 'ollama', reason: 'timeout', attempts: 2 }],
    malformedSpans: 0,
    spanCount: 1,
    roots: ['s1'],
    spans: [minimalSpan],
    artifacts: [{ name: 'answer.txt', bytes: 12, kind: ArtifactKind.Answer }],
  };
  const parsed = RunDtoSchema.parse(run);
  expect(parsed.owner).toBe('local');
  expect(parsed.tokens).toBeUndefined();
  expect(parsed.degrades[0].kind).toBe(DegradeKind.Retried);
});

test('RunDTO rejects an unknown lifecycle value', () => {
  expect(() => RunDtoSchema.parse({ ...{}, lifecycle: 'exploded' })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/dto.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/dto.ts`.

- [ ] **Step 3: Write the DTO schemas**

```ts
// src/contracts/dto.ts
import { z } from 'zod';
import {
  ArtifactKind,
  ChatRole,
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  SpanStatus,
} from './enums.ts';

/** Optional token roll-up; mapper tolerates absence (telemetry gap #1). */
const TokensSchema = z
  .object({ input: z.number().optional(), output: z.number().optional() })
  .optional();

export const DegradeDtoSchema = z.object({
  kind: z.enum(DegradeKind),
  label: z.string(),
  subject: z.string(),
  reason: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  attempts: z.number().optional(),
  lane: z.string().optional(),
  spanId: z.string().optional(),
});
export type DegradeDTO = z.infer<typeof DegradeDtoSchema>;

export const SpanDtoSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  offsetMs: z.number(),
  durationMs: z.number(),
  depth: z.number(),
  status: z.enum(SpanStatus),
  statusMessage: z.string().optional(),
  agent: z.string().optional(),
  delegation: z
    .object({
      target: z.string(),
      depth: z.number(),
      ancestors: z.array(z.string()),
    })
    .optional(),
  model: z
    .object({
      id: z.string(),
      provider: z.string().optional(),
      numCtx: z.number().optional(),
      footprintBytes: z.number().optional(),
      runtimeDegraded: z.boolean().optional(),
    })
    .optional(),
  tokens: TokensSchema,
  degraded: z.boolean(),
  /** Reserved for Slices 31/38 (node/location). */
  node: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()),
  events: z.array(
    z.object({
      name: z.string(),
      offsetMs: z.number(),
      attributes: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});
export type SpanDTO = z.infer<typeof SpanDtoSchema>;

export const RunDtoSchema = z.object({
  id: z.string(),
  /** Reserved now, constant "local"; backfilling ownership later (Slices 24/33). */
  owner: z.string(),
  origin: z.enum(RunOrigin),
  lifecycle: z.enum(RunLifecycle),
  startMs: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  models: z.array(z.string()),
  contentPolicy: z.string().optional(),
  tokens: TokensSchema,
  degraded: z.boolean(),
  degrades: z.array(DegradeDtoSchema),
  malformedSpans: z.number(),
  spanCount: z.number(),
  roots: z.array(z.string()),
  spans: z.array(SpanDtoSchema),
  artifacts: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      kind: z.enum(ArtifactKind),
    }),
  ),
});
export type RunDTO = z.infer<typeof RunDtoSchema>;

export const ChatMessageDtoSchema = z.object({
  id: z.string(),
  role: z.enum(ChatRole),
  text: z.string(),
  /** Slice 37 taint/trust marker. */
  degraded: z.boolean().optional(),
});
export type ChatMessageDTO = z.infer<typeof ChatMessageDtoSchema>;
```

- [ ] **Step 4: Run DTO test to verify it passes**

Run: `bun test tests/contracts/dto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the DegradeKind parity test**

```ts
// tests/contracts/degrade-kind-parity.test.ts
import { expect, test } from 'bun:test';
import { DegradeKind as ContractDegradeKind } from '../../src/contracts/enums.ts';
import { DegradeKind as LedgerDegradeKind } from '../../src/reliability/ledger.ts';

test('contract DegradeKind values stay isomorphic with the reliability ledger', () => {
  const contract = Object.values(ContractDegradeKind).sort();
  const ledger = Object.values(LedgerDegradeKind).sort();
  expect(contract).toEqual(ledger);
});
```

(This test lives in `tests/`, not `src/contracts/`, so it MAY import both — that is exactly how we keep the wire mirror honest without the contract importing reliability.)

- [ ] **Step 6: Run the parity test to verify it passes**

Run: `bun test tests/contracts/degrade-kind-parity.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/contracts/dto.ts tests/contracts/dto.test.ts tests/contracts/degrade-kind-parity.test.ts
git commit -m "feat(contracts): add Run/Span/Degrade/ChatMessage DTO schemas + parity guard"
```

---

### Task 3: Contract status events — the transient-SSE discriminated union

**Files:**
- Create: `src/contracts/events.ts`
- Test: `tests/contracts/events.test.ts`

**Interfaces:**
- Consumes: `StatusEventType`, `DegradeKind`, `ModelLoadAction` from `./enums.ts`.
- Produces: `StatusEventSchema`/`StatusEvent` (discriminated union) plus the per-variant schemas (`RunStartEventSchema`, `ProvisionEventSchema`, `McpMountEventSchema`, `DelegationEventSchema`, `ModelSelectEventSchema`, `ModelLoadEventSchema`, `DegradeEventSchema`, `ConfirmEventSchema`, `RunEndEventSchema`).

- [ ] **Step 1: Write the failing status-event test**

```ts
// tests/contracts/events.test.ts
import { expect, test } from 'bun:test';
import {
  DegradeKind,
  ModelLoadAction,
  StatusEventType,
} from '../../src/contracts/enums.ts';
import { StatusEventSchema } from '../../src/contracts/events.ts';

test('parses a data-delegation event and discriminates on type', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.Delegation,
    agent: 'researcher',
    depth: 1,
    parentAgent: 'router',
    ancestors: ['router'],
  });
  expect(e.type).toBe('data-delegation');
});

test('parses a data-model-load event with an enum action', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.ModelLoad,
    model: 'qwen3.5:4b',
    action: ModelLoadAction.Warm,
  });
  expect(e.type === StatusEventType.ModelLoad && e.action).toBe('warm');
});

test('parses the bidirectional data-confirm ask', () => {
  const e = StatusEventSchema.parse({
    type: StatusEventType.Confirm,
    promptId: 'cap-abc123',
    kind: 'mcp-mount',
    question: 'Mount github MCP server?',
  });
  expect(e.type === StatusEventType.Confirm && e.promptId).toBe('cap-abc123');
});

test('data-degrade survives a JSON round-trip', () => {
  const src = {
    type: StatusEventType.Degrade,
    kind: DegradeKind.CircuitOpen,
    subject: 'ollama',
    reason: 'threshold hit',
    spanId: 's7',
  };
  const wire = JSON.parse(JSON.stringify(StatusEventSchema.parse(src)));
  expect(StatusEventSchema.parse(wire)).toEqual(src);
});

test('rejects an unknown event type', () => {
  expect(() => StatusEventSchema.parse({ type: 'data-nope' })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/events.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/events.ts`.

- [ ] **Step 3: Write the status-event schemas**

```ts
// src/contracts/events.ts
import { z } from 'zod';
import { DegradeKind, ModelLoadAction, StatusEventType } from './enums.ts';

export const RunStartEventSchema = z.object({
  type: z.literal(StatusEventType.RunStart),
  runId: z.string(),
  task: z.string().optional(),
});

export const ProvisionEventSchema = z.object({
  type: z.literal(StatusEventType.Provision),
  phase: z.string(),
  model: z.string().optional(),
});

export const McpMountEventSchema = z.object({
  type: z.literal(StatusEventType.McpMount),
  server: z.string(),
  outcome: z.string(),
});

export const DelegationEventSchema = z.object({
  type: z.literal(StatusEventType.Delegation),
  agent: z.string(),
  depth: z.number(),
  parentAgent: z.string().optional(),
  ancestors: z.array(z.string()),
});

export const ModelSelectEventSchema = z.object({
  type: z.literal(StatusEventType.ModelSelect),
  agent: z.string(),
  model: z.string(),
  numCtx: z.number().optional(),
  footprintBytes: z.number().optional(),
  install: z.boolean().optional(),
  degraded: z.boolean().optional(),
});

export const ModelLoadEventSchema = z.object({
  type: z.literal(StatusEventType.ModelLoad),
  model: z.string(),
  action: z.enum(ModelLoadAction),
});

export const DegradeEventSchema = z.object({
  type: z.literal(StatusEventType.Degrade),
  kind: z.enum(DegradeKind),
  subject: z.string(),
  reason: z.string(),
  spanId: z.string().optional(),
});

/**
 * `kind` is a free string, not an enum: consent kinds come from many engine
 * seams (mcp-mount, provision, build, reuse, archive, gen-download, clone, mic,
 * disk-shortfall…) and grow per future slice, so a closed enum would churn.
 */
export const ConfirmEventSchema = z.object({
  type: z.literal(StatusEventType.Confirm),
  promptId: z.string(),
  kind: z.string(),
  question: z.string(),
});

export const RunEndEventSchema = z.object({
  type: z.literal(StatusEventType.RunEnd),
  runId: z.string(),
  outcome: z.string(),
});

export const StatusEventSchema = z.discriminatedUnion('type', [
  RunStartEventSchema,
  ProvisionEventSchema,
  McpMountEventSchema,
  DelegationEventSchema,
  ModelSelectEventSchema,
  ModelLoadEventSchema,
  DegradeEventSchema,
  ConfirmEventSchema,
  RunEndEventSchema,
]);
export type StatusEvent = z.infer<typeof StatusEventSchema>;
```

- [ ] **Step 4: Run status-event test to verify it passes**

Run: `bun test tests/contracts/events.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/contracts/events.ts tests/contracts/events.test.ts
git commit -m "feat(contracts): add StatusEvent transient-SSE discriminated union"
```

---

### Task 4: Contract inbound request schemas + barrel

**Files:**
- Create: `src/contracts/requests.ts`, `src/contracts/index.ts`
- Test: `tests/contracts/requests.test.ts`

**Interfaces:**
- Consumes: `ChatRole` from `./enums.ts`.
- Produces: `UiMessagePartSchema`, `UiMessageLikeSchema`/`UiMessageLike`, `ChatRequestSchema`/`ChatRequest`, `RespondRequestSchema`/`RespondRequest`; barrel `src/contracts/index.ts` re-exporting `./enums.ts`, `./dto.ts`, `./events.ts`, `./requests.ts`.

- [ ] **Step 1: Write the failing inbound-request test**

```ts
// tests/contracts/requests.test.ts
import { expect, test } from 'bun:test';
import { ChatRole } from '../../src/contracts/enums.ts';
import {
  ChatRequestSchema,
  RespondRequestSchema,
  UiMessageLikeSchema,
} from '../../src/contracts/requests.ts';

test('a minimal UIMessage-like body validates (no AI-SDK types)', () => {
  const parsed = UiMessageLikeSchema.parse({
    id: 'm1',
    role: ChatRole.User,
    parts: [{ type: 'text', text: 'hello' }],
  });
  expect(parsed.parts[0].text).toBe('hello');
});

test('ChatRequest validates a messages array + optional sessionId', () => {
  const parsed = ChatRequestSchema.parse({
    messages: [{ id: 'm1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] }],
  });
  expect(parsed.messages.length).toBe(1);
  expect(parsed.sessionId).toBeUndefined();
});

test('ChatRequest rejects a malformed body (missing messages)', () => {
  expect(() => ChatRequestSchema.parse({ foo: 1 })).toThrow();
});

test('RespondRequest requires a promptId and accepts an opaque value', () => {
  const parsed = RespondRequestSchema.parse({ promptId: 'cap-x', value: { ok: true } });
  expect(parsed.promptId).toBe('cap-x');
  expect(() => RespondRequestSchema.parse({ value: 1 })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/requests.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/requests.ts`.

- [ ] **Step 3: Write the request schemas + barrel**

```ts
// src/contracts/requests.ts
import { z } from 'zod';
import { ChatRole } from './enums.ts';

/**
 * A minimal, structural UIMessage-like shape. We deliberately do NOT import
 * AI-SDK's UIMessage type (Slice 23 forward-compat). The Phase-2 chat handler
 * `await convertToModelMessages(...)` (async in AI SDK v6.0.217) on the parsed
 * value; Phase 1 only validates the wire body before any engine call.
 */
export const UiMessagePartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

export const UiMessageLikeSchema = z.object({
  id: z.string(),
  role: z.enum(ChatRole),
  parts: z.array(UiMessagePartSchema),
});
export type UiMessageLike = z.infer<typeof UiMessageLikeSchema>;

export const ChatRequestSchema = z.object({
  messages: z.array(UiMessageLikeSchema),
  sessionId: z.string().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const RespondRequestSchema = z.object({
  promptId: z.string(),
  value: z.unknown(),
});
export type RespondRequest = z.infer<typeof RespondRequestSchema>;
```

```ts
// src/contracts/index.ts
export * from './enums.ts';
export * from './dto.ts';
export * from './events.ts';
export * from './requests.ts';
```

- [ ] **Step 4: Run request test to verify it passes**

Run: `bun test tests/contracts/requests.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm the isomorphic guard still passes over all 5 contract files**

Run: `bun test tests/contracts/isomorphic.test.ts`
Expected: PASS — every file imports only `zod` / `./` siblings.

- [ ] **Step 6: Commit**

```bash
git add src/contracts/requests.ts src/contracts/index.ts tests/contracts/requests.test.ts
git commit -m "feat(contracts): add inbound request schemas + barrel export"
```

---

### Task 5: Config — `ConfigEntry.strict?` flag + server (`AGENT_WEB_*`) entries

**Files:**
- Modify: `src/config/schema.ts`
- Test: `tests/config/web-config.test.ts`

**Interfaces:**
- Consumes: existing `ConfigEntry`, `CONFIG_SPEC`, `loadConfig` from `src/config/schema.ts`.
- Produces: `ConfigEntry` gains optional `strict?: boolean`; three new entries `AGENT_WEB_PORT` (number, 4130), `AGENT_WEB_ORIGIN_ALLOWLIST` (string), `AGENT_WEB_RECORD_IO` (boolean, false, `strict: true`); `strict: true` added to `AGENT_MCP_AUTO_APPROVE` and `AGENT_PROVISION_AUTO_YES`. No behavior change in `coerce`/`loadConfig`.

- [ ] **Step 1: Write the failing config test**

```ts
// tests/config/web-config.test.ts
import { expect, test } from 'bun:test';
import { CONFIG_SPEC, loadConfig } from '../../src/config/schema.ts';

const byEnv = (env: string) => CONFIG_SPEC.find((e) => e.env === env);

test('the three AGENT_WEB_* entries exist with documented defaults', () => {
  expect(byEnv('AGENT_WEB_PORT')?.def).toBe(4130);
  expect(byEnv('AGENT_WEB_ORIGIN_ALLOWLIST')?.kind).toBe('string');
  expect(byEnv('AGENT_WEB_RECORD_IO')?.def).toBe(false);
});

test('strict flag marks the === "1" default-off booleans', () => {
  expect(byEnv('AGENT_WEB_RECORD_IO')?.strict).toBe(true);
  expect(byEnv('AGENT_MCP_AUTO_APPROVE')?.strict).toBe(true);
  expect(byEnv('AGENT_PROVISION_AUTO_YES')?.strict).toBe(true);
  // A default-on boolean carries no strict flag.
  expect(byEnv('AGENT_TELEMETRY_RECORD_IO')?.strict).toBeUndefined();
});

test('loadConfig behavior is unchanged: web record-IO defaults off, env overrides', () => {
  expect(loadConfig({}).values.AGENT_WEB_RECORD_IO).toBe(false);
  expect(loadConfig({ AGENT_WEB_RECORD_IO: '1' }).values.AGENT_WEB_RECORD_IO).toBe(true);
  expect(loadConfig({ AGENT_WEB_PORT: '5555' }).values.AGENT_WEB_PORT).toBe(5555);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config/web-config.test.ts`
Expected: FAIL — `AGENT_WEB_PORT` entry not found (`?.def` is `undefined`).

- [ ] **Step 3: Add the `strict?` flag to the `ConfigEntry` type**

In `src/config/schema.ts`, replace the `ConfigEntry` type:

```ts
export type ConfigEntry = {
  env: string;
  kind: ConfigKind;
  def: number | boolean | string;
  doc: string;
  /**
   * Marks a default-OFF boolean whose REAL read site uses a stricter `=== '1'`
   * check (e.g. AGENT_MCP_AUTO_APPROVE, AGENT_PROVISION_AUTO_YES). The schema
   * `coerce` rule below is unchanged (any non-`0`/`false` reads true); this flag
   * only lets a future settings UI surface the stricter real-world semantics.
   */
  strict?: boolean;
};
```

- [ ] **Step 4: Add `strict: true` to the two existing default-off booleans**

In `src/config/schema.ts`, the `AGENT_PROVISION_AUTO_YES` entry — add the flag:

```ts
  {
    env: 'AGENT_PROVISION_AUTO_YES',
    kind: 'boolean',
    def: false,
    doc: "Non-interactive auto-confirm for model provisioning prompts; real code only checks '1' exactly (cli/provision.ts, cli/chat.ts).",
    strict: true,
  },
```

The `AGENT_MCP_AUTO_APPROVE` entry — add the flag:

```ts
  {
    env: 'AGENT_MCP_AUTO_APPROVE',
    kind: 'boolean',
    def: false,
    doc: "Non-interactive auto-approve for new MCP server consent; real code only checks '1' exactly (mcp/mount.ts).",
    strict: true,
  },
```

- [ ] **Step 5: Add the server (web BFF) config group**

In `src/config/schema.ts`, insert a new group in `CONFIG_SPEC` immediately before the closing `];`:

```ts
  // --- Server / web BFF (Slice 30b) ---
  {
    env: 'AGENT_WEB_PORT',
    kind: 'number',
    def: 4130,
    doc: 'Port the local web BFF (bun run web) listens on (server/main.ts). Distinct from Ollama :11434 (bun run serve).',
  },
  {
    env: 'AGENT_WEB_ORIGIN_ALLOWLIST',
    kind: 'string',
    def: 'http://localhost,http://127.0.0.1',
    doc: 'Comma-separated extra allowed Origins beyond localhost/127.0.0.1:PORT; config-driven so a Slice-24 tunnel can add its origin (server/security/origin.ts).',
  },
  {
    env: 'AGENT_WEB_RECORD_IO',
    kind: 'boolean',
    def: false,
    doc: "Record prompt/response IO into spans for SERVED (web) runs; default OFF, only '1' enables (D17). Distinct from AGENT_TELEMETRY_RECORD_IO (CLI, default on).",
    strict: true,
  },
```

- [ ] **Step 6: Run config test + typecheck to verify pass**

Run: `bun test tests/config/web-config.test.ts && bun run typecheck`
Expected: PASS (3 tests) and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts tests/config/web-config.test.ts
git commit -m "feat(config): add ConfigEntry.strict flag + AGENT_WEB_* server entries"
```

---

### Task 6: Security — per-session bearer token mint + guard

**Files:**
- Create: `src/server/security/token.ts`
- Test: `tests/server/token.test.ts`

**Interfaces:**
- Consumes: `node:crypto`.
- Produces: `mintSessionToken(): string`; `type TokenGuard = { verify(req: Request): boolean }`; `createTokenGuard(token: string): TokenGuard`.

- [ ] **Step 1: Write the failing token test**

```ts
// tests/server/token.test.ts
import { expect, test } from 'bun:test';
import { createTokenGuard, mintSessionToken } from '../../src/server/security/token.ts';

const withAuth = (value: string) =>
  new Request('http://localhost:4130/api/health', { headers: { authorization: value } });

test('mintSessionToken returns a 64-char hex string, unique per call', () => {
  const a = mintSessionToken();
  const b = mintSessionToken();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(b);
});

test('guard accepts the exact bearer token', () => {
  const token = mintSessionToken();
  expect(createTokenGuard(token).verify(withAuth(`Bearer ${token}`))).toBe(true);
});

test('guard rejects a wrong, missing, or non-bearer token', () => {
  const guard = createTokenGuard(mintSessionToken());
  expect(guard.verify(withAuth(`Bearer ${mintSessionToken()}`))).toBe(false);
  expect(guard.verify(withAuth('deadbeef'))).toBe(false);
  expect(guard.verify(new Request('http://localhost:4130/api/health'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/token.test.ts`
Expected: FAIL — cannot resolve `../../src/server/security/token.ts`.

- [ ] **Step 3: Write the token module**

```ts
// src/server/security/token.ts
import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Mint a per-session bearer token at launch (256 bits of entropy, hex). */
export function mintSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export type TokenGuard = { verify(req: Request): boolean };

/** Constant-time bearer verification against the session token. */
export function createTokenGuard(token: string): TokenGuard {
  const expected = Buffer.from(token);
  const prefix = 'Bearer ';
  return {
    verify(req) {
      const header = req.headers.get('authorization');
      if (header === null || !header.startsWith(prefix)) return false;
      const got = Buffer.from(header.slice(prefix.length));
      if (got.length !== expected.length) return false;
      return timingSafeEqual(got, expected);
    },
  };
}
```

- [ ] **Step 4: Run token test to verify it passes**

Run: `bun test tests/server/token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/security/token.ts tests/server/token.test.ts
git commit -m "feat(server): add per-session bearer token mint + constant-time guard"
```

---

### Task 7: Security — Host-header allowlist + cross-origin Origin rejection

**Files:**
- Create: `src/server/security/origin.ts`
- Test: `tests/server/origin.test.ts`

**Interfaces:**
- Consumes: nothing (pure `Request` header inspection).
- Produces: `type OriginPolicy = { port: number; allowedOrigins: string[] }`; `hostAllowed(req: Request, port: number): boolean`; `originAllowed(req: Request, policy: OriginPolicy): boolean`; `enforcePerimeter(req: Request, policy: OriginPolicy): Response | null` (returns a 403 `Response` on violation, else `null`).

- [ ] **Step 1: Write the failing perimeter test**

```ts
// tests/server/origin.test.ts
import { expect, test } from 'bun:test';
import {
  type OriginPolicy,
  enforcePerimeter,
  hostAllowed,
  originAllowed,
} from '../../src/server/security/origin.ts';

const policy: OriginPolicy = { port: 4130, allowedOrigins: ['http://localhost', 'http://127.0.0.1'] };

const req = (headers: Record<string, string>) =>
  new Request('http://localhost:4130/api/health', { headers });

test('accepts a localhost/127.0.0.1 Host on the configured port', () => {
  expect(hostAllowed(req({ host: 'localhost:4130' }), 4130)).toBe(true);
  expect(hostAllowed(req({ host: '127.0.0.1:4130' }), 4130)).toBe(true);
});

test('rejects a rebinding Host (attacker domain) and a missing Host', () => {
  expect(hostAllowed(req({ host: 'evil.example.com:4130' }), 4130)).toBe(false);
  expect(hostAllowed(new Request('http://localhost:4130/x'), 4130)).toBe(false);
});

test('allows an absent Origin (same-origin nav) and a listed origin; rejects cross-origin', () => {
  expect(originAllowed(req({ host: 'localhost:4130' }), policy)).toBe(true);
  expect(originAllowed(req({ host: 'localhost:4130', origin: 'http://localhost:4130' }), policy)).toBe(true);
  expect(originAllowed(req({ host: 'localhost:4130', origin: 'https://evil.example.com' }), policy)).toBe(false);
});

test('enforcePerimeter returns 403 on a bad host, null when clean', () => {
  const bad = enforcePerimeter(req({ host: 'evil.example.com:4130' }), policy);
  expect(bad?.status).toBe(403);
  expect(enforcePerimeter(req({ host: 'localhost:4130' }), policy)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/origin.test.ts`
Expected: FAIL — cannot resolve `../../src/server/security/origin.ts`.

- [ ] **Step 3: Write the origin module**

```ts
// src/server/security/origin.ts
export type OriginPolicy = { port: number; allowedOrigins: string[] };

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** The Host header must name a loopback host on the configured port (DNS-rebinding defense). */
export function hostAllowed(req: Request, port: number): boolean {
  const host = req.headers.get('host');
  if (host === null) return false;
  return LOCAL_HOSTS.some((h) => host === `${h}:${port}` || host === h);
}

/**
 * A cross-origin Origin is rejected (CSRF / 0.0.0.0-day defense). An absent
 * Origin (same-origin navigation / non-CORS GET) is allowed. Loopback origins
 * on the configured port are always allowed; extra origins come from config
 * (a Slice-24 tunnel adds its origin via AGENT_WEB_ORIGIN_ALLOWLIST).
 */
export function originAllowed(req: Request, policy: OriginPolicy): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return true;
  const loopback = LOCAL_HOSTS.flatMap((h) => [
    `http://${h}:${policy.port}`,
    `http://${h}`,
  ]);
  return loopback.includes(origin) || policy.allowedOrigins.includes(origin);
}

/** Returns a 403 Response when the request fails the perimeter, else null. */
export function enforcePerimeter(req: Request, policy: OriginPolicy): Response | null {
  if (!hostAllowed(req, policy.port)) {
    return new Response('forbidden host', { status: 403 });
  }
  if (!originAllowed(req, policy)) {
    return new Response('forbidden origin', { status: 403 });
  }
  return null;
}
```

- [ ] **Step 4: Run perimeter test to verify it passes**

Run: `bun test tests/server/origin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/security/origin.ts tests/server/origin.test.ts
git commit -m "feat(server): add Host allowlist + cross-origin Origin rejection"
```

---

### Task 8: Security — media-path confinement (realpath ∈ dir)

**Files:**
- Create: `src/server/security/media-path.ts`
- Test: `tests/server/media-path.test.ts`

**Interfaces:**
- Consumes: `node:fs`, `node:path`, `node:os` (test only).
- Produces: `class MediaPathError extends Error`; `confineToDir(candidate: string, root: string): string` — returns the realpath when it resolves inside `root`, else throws `MediaPathError`.

- [ ] **Step 1: Write the failing confinement test**

```ts
// tests/server/media-path.test.ts
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { MediaPathError, confineToDir } from '../../src/server/security/media-path.ts';

test('a file inside the root resolves to its realpath', () => {
  const root = mkdtempSync(join(tmpdir(), 'mp-'));
  writeFileSync(join(root, 'upload.png'), 'x');
  expect(confineToDir('upload.png', root)).toBe(join(root, 'upload.png'));
});

test('a ../ traversal is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'mp-'));
  expect(() => confineToDir('../../etc/passwd', root)).toThrow(MediaPathError);
});

test('an absolute path outside the root is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'mp-'));
  expect(() => confineToDir('/etc/hosts', root)).toThrow(MediaPathError);
});

test('a symlink escaping the root is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'mp-'));
  const outside = mkdtempSync(join(tmpdir(), 'out-'));
  writeFileSync(join(outside, 'secret.txt'), 's');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
  expect(() => confineToDir('link.txt', root)).toThrow(MediaPathError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/media-path.test.ts`
Expected: FAIL — cannot resolve `../../src/server/security/media-path.ts`.

- [ ] **Step 3: Write the media-path module**

```ts
// src/server/security/media-path.ts
import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** A network-supplied media path resolved outside its allowed directory. */
export class MediaPathError extends Error {
  constructor(readonly candidate: string) {
    super(`media path escapes the allowed directory: ${candidate}`);
    this.name = 'MediaPathError';
  }
}

/**
 * Resolve `candidate` (relative to `root`, or absolute) and assert its REALPATH
 * is `root` itself or a descendant of it — defeating `../` traversal and symlink
 * escapes. Used to confine network-supplied media to the run/upload dir; the
 * server also disables `ingestMedia`'s filesystem auto-detect (that wiring lands
 * with the chat/media endpoints in a later phase — this util is its primitive).
 */
export function confineToDir(candidate: string, root: string): string {
  const realRoot = realpathSync(resolve(root));
  let real: string;
  try {
    real = realpathSync(resolve(realRoot, candidate));
  } catch {
    throw new MediaPathError(candidate);
  }
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (real !== realRoot && !real.startsWith(prefix)) {
    throw new MediaPathError(candidate);
  }
  return real;
}
```

- [ ] **Step 4: Run confinement test to verify it passes**

Run: `bun test tests/server/media-path.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/security/media-path.ts tests/server/media-path.test.ts
git commit -m "feat(server): add realpath media-path confinement util"
```

---

### Task 9: Telemetry — `server.request` span helper

**Files:**
- Modify: `src/telemetry/spans.ts`
- Test: `tests/telemetry/server-request-span.test.ts`

**Interfaces:**
- Consumes: existing `inSpan`, `ATTR`, `trace`, `SpanStatusCode` in `src/telemetry/spans.ts`; test uses `tests/helpers/otel-test-provider.ts` `registerTestProvider()`.
- Produces: new `ATTR` keys `SERVER_ROUTE`/`SERVER_METHOD`/`SERVER_STATUS`/`SERVER_DURATION_MS`/`SERVER_PRINCIPAL`; `withServerRequestSpan<T>(info: { route: string; method: string; principal?: string }, fn: (rec: { status: (code: number) => void }) => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing span test**

```ts
// tests/telemetry/server-request-span.test.ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SpanStatusCode } from '@opentelemetry/api';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';
import { withServerRequestSpan } from '../../src/telemetry/spans.ts';

// registerTestProvider() returns { exporter, provider }; shutdown is on .provider.
let h: ReturnType<typeof registerTestProvider>;
beforeAll(() => {
  h = registerTestProvider();
});
afterAll(() => h.provider.shutdown());

test('withServerRequestSpan emits a server.request span with route/method/status/principal', async () => {
  await withServerRequestSpan({ route: '/api/health', method: 'GET' }, async (rec) => {
    rec.status(200);
  });
  const span = h.exporter.getFinishedSpans().find((s) => s.name === 'server.request');
  expect(span).toBeDefined();
  expect(span?.attributes['server.route']).toBe('/api/health');
  expect(span?.attributes['http.request.method']).toBe('GET');
  expect(span?.attributes['http.response.status_code']).toBe(200);
  expect(span?.attributes['server.principal']).toBe('local');
  expect(typeof span?.attributes['server.duration_ms']).toBe('number');
});

test('a throwing handler records an error status and still ends the span', async () => {
  await expect(
    withServerRequestSpan({ route: '/api/boom', method: 'POST' }, async () => {
      throw new Error('kaboom');
    }),
  ).rejects.toThrow('kaboom');
  const span = h.exporter.getFinishedSpans().find((s) => s.name === 'server.request' && s.attributes['server.route'] === '/api/boom');
  expect(span?.status.code).toBe(SpanStatusCode.ERROR);
});
```

(Verified 2026-07-14: `registerTestProvider()` in `tests/helpers/otel-test-provider.ts` returns `{ exporter: InMemorySpanExporter; provider }` — read spans via `h.exporter.getFinishedSpans()`, shut down via `h.provider.shutdown()`, exactly as above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/server-request-span.test.ts`
Expected: FAIL — `withServerRequestSpan` is not exported.

- [ ] **Step 3: Add the server ATTR constants**

In `src/telemetry/spans.ts`, inside the `ATTR` object, add (alongside the other groups, e.g. after the `VOICE_*` block, before the closing `} as const;`):

```ts
  // Server / web BFF (Slice 30b)
  SERVER_ROUTE: 'server.route',
  SERVER_METHOD: 'http.request.method',
  SERVER_STATUS: 'http.response.status_code',
  SERVER_DURATION_MS: 'server.duration_ms',
  /** Request principal/owner; reserved "local" now, upgrades to audit-grade in Slice 35. */
  SERVER_PRINCIPAL: 'server.principal',
```

- [ ] **Step 4: Add the `withServerRequestSpan` helper**

In `src/telemetry/spans.ts`, append (near the other `with*Span` helpers, e.g. after `withRunSpan`):

```ts
/**
 * Span for one HTTP request handled by the web BFF (Slice 30b). Follows the
 * recorder-callback pattern (`withRuntimeSpan`): opens a `server.request` span,
 * sets route/method + the reserved principal, runs `fn` (which reports the final
 * status via `rec.status`), records the duration in a `finally`, and — via
 * `inSpan` — records an error status if `fn` throws.
 */
export function withServerRequestSpan<T>(
  info: { route: string; method: string; principal?: string },
  fn: (rec: { status: (code: number) => void }) => Promise<T>,
): Promise<T> {
  return inSpan('server.request', async (span) => {
    const startedAt = performance.now();
    span.setAttribute(ATTR.SERVER_ROUTE, info.route);
    span.setAttribute(ATTR.SERVER_METHOD, info.method);
    span.setAttribute(ATTR.SERVER_PRINCIPAL, info.principal ?? 'local');
    try {
      return await fn({
        status: (code) => span.setAttribute(ATTR.SERVER_STATUS, code),
      });
    } finally {
      span.setAttribute(
        ATTR.SERVER_DURATION_MS,
        Math.round(performance.now() - startedAt),
      );
    }
  });
}
```

- [ ] **Step 5: Run span test + typecheck to verify pass**

Run: `bun test tests/telemetry/server-request-span.test.ts && bun run typecheck`
Expected: PASS (2 tests) and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/telemetry/spans.ts tests/telemetry/server-request-span.test.ts
git commit -m "feat(telemetry): add server.request span helper for the web BFF"
```

---

### Task 10: Server — thin Bun.serve BFF (pipeline + `/api/health` + static/COOP-COEP)

**Files:**
- Create: `src/server/app.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Consumes: `enforcePerimeter`, `type OriginPolicy` from `./security/origin.ts`; `createTokenGuard` from `./security/token.ts`; `withServerRequestSpan` from `../telemetry/spans.ts`; `explain` from `../errors/boundary.ts`.
- Produces: `type ServerDeps = { token: string; policy: OriginPolicy; staticDir?: string; recordIo: boolean; indexHtml: string }`; `buildFetch(deps: ServerDeps): (req: Request) => Promise<Response>`.

- [ ] **Step 1: Write the failing BFF integration test (booted Bun.serve)**

```ts
// tests/server/app.test.ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ServerDeps, buildFetch } from '../../src/server/app.ts';

const TOKEN = 'a'.repeat(64);
const policy = { port: 0, allowedOrigins: [] as string[] };
const deps: ServerDeps = {
  token: TOKEN,
  policy,
  recordIo: false,
  indexHtml: '<!doctype html><title>t</title>',
};

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  policy.port = server.port; // reconcile the ephemeral port so Host allowlist matches
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

test('GET / serves the index HTML under COOP/COEP', async () => {
  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  expect(await res.text()).toContain('<!doctype html>');
});

test('/api/health requires the bearer token', async () => {
  const unauth = await fetch(`${base}/api/health`);
  expect(unauth.status).toBe(401);
  const ok = await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });
});

test('a cross-origin request is rejected at the perimeter (403) before auth', async () => {
  const res = await fetch(`${base}/api/health`, {
    headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example.com' },
  });
  expect(res.status).toBe(403);
});

test('an unknown /api route returns a JSON 404 (never throws)', async () => {
  const res = await fetch(`${base}/api/does-not-exist`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/app.test.ts`
Expected: FAIL — cannot resolve `../../src/server/app.ts`.

- [ ] **Step 3: Write the BFF**

```ts
// src/server/app.ts
import { join } from 'node:path';
import { explain } from '../errors/boundary.ts';
import { withServerRequestSpan } from '../telemetry/spans.ts';
import { type OriginPolicy, enforcePerimeter } from './security/origin.ts';
import { createTokenGuard } from './security/token.ts';

/**
 * The thin BFF's dependencies. It owns NO business logic: it enforces the
 * perimeter, checks the token, routes, and maps typed errors to JSON. Engine
 * wiring (chat/runs/crews/…) attaches in later phases.
 */
export type ServerDeps = {
  token: string;
  policy: OriginPolicy;
  staticDir?: string;
  recordIo: boolean;
  indexHtml: string;
};

/** COOP/COEP so the frontend can later use sherpa WASM SharedArrayBuffer. */
const ISOLATION_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

export function buildFetch(deps: ServerDeps): (req: Request) => Promise<Response> {
  const guard = createTokenGuard(deps.token);
  return async (req) => {
    const blocked = enforcePerimeter(req, deps.policy);
    if (blocked) return blocked;

    const url = new URL(req.url);
    if (url.pathname.startsWith('/api')) {
      if (!guard.verify(req)) return json({ error: 'unauthorized' }, 401);
      return handleApi(req, url);
    }
    return serveStatic(url, deps);
  };
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  return withServerRequestSpan({ route: url.pathname, method: req.method }, async (rec) => {
    try {
      if (url.pathname === '/api/health') {
        rec.status(200);
        return json({ ok: true });
      }
      rec.status(404);
      return json({ error: 'not found' }, 404);
    } catch (err) {
      // Never crash the handler: map the typed error to an actionable JSON body.
      rec.status(500);
      return json({ error: explain(err).title }, 500);
    }
  });
}

async function serveStatic(url: URL, deps: ServerDeps): Promise<Response> {
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response(deps.indexHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...ISOLATION_HEADERS,
      },
    });
  }
  // Reject traversal before any filesystem touch.
  if (deps.staticDir && !url.pathname.includes('..')) {
    const file = Bun.file(join(deps.staticDir, url.pathname));
    if (await file.exists()) {
      return new Response(file, { headers: { ...ISOLATION_HEADERS } });
    }
  }
  return new Response('not found', { status: 404, headers: { ...ISOLATION_HEADERS } });
}
```

- [ ] **Step 4: Run BFF test + typecheck to verify pass**

Run: `bun test tests/server/app.test.ts && bun run typecheck`
Expected: PASS (4 tests) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts tests/server/app.test.ts
git commit -m "feat(server): add thin Bun.serve BFF pipeline, /api/health, COOP/COEP static serving"
```

---

### Task 11: Server — `bun run web` entry point (config → mint token → boot → inject into HTML)

**Files:**
- Create: `src/server/main.ts`
- Modify: `package.json`
- Test: `tests/server/main.test.ts`

**Interfaces:**
- Consumes: `loadConfig` from `../config/schema.ts`; `buildFetch`, `type ServerDeps` from `./app.ts`; `mintSessionToken` from `./security/token.ts`.
- Produces: `renderIndexHtml(token: string): string`; `type StartOptions`; `startWebServer(opts?: StartOptions): { server: ReturnType<typeof Bun.serve>; token: string; port: number }`; a `web` script in `package.json`.

- [ ] **Step 1: Write the failing entry-point smoke test**

```ts
// tests/server/main.test.ts
import { expect, test } from 'bun:test';
import { renderIndexHtml, startWebServer } from '../../src/server/main.ts';

test('renderIndexHtml injects the session token into the served page', () => {
  const html = renderIndexHtml('tok-123');
  expect(html).toContain('tok-123');
  expect(html.toLowerCase()).toContain('<!doctype html>');
});

test('startWebServer boots on an ephemeral port, mints a token, and serves it', async () => {
  const { server, token, port } = startWebServer({ port: 0 });
  try {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(port).toBeGreaterThan(0);

    const index = await fetch(`http://localhost:${port}/`);
    expect(await index.text()).toContain(token);

    const health = await fetch(`http://localhost:${port}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(health.status).toBe(200);

    const unauth = await fetch(`http://localhost:${port}/api/health`);
    expect(unauth.status).toBe(401);
  } finally {
    server.stop(true);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/main.test.ts`
Expected: FAIL — cannot resolve `../../src/server/main.ts`.

- [ ] **Step 3: Write the entry point**

```ts
// src/server/main.ts
import { loadConfig } from '../config/schema.ts';
import { type ServerDeps, buildFetch } from './app.ts';
import { mintSessionToken } from './security/token.ts';

/**
 * Minimal served page for Phase 1 (no web/ build yet). The token is injected as
 * `window.__AGENT_TOKEN__` so the future frontend reads it from the served HTML
 * rather than a network round-trip. Phase 1b replaces this with the Vite build.
 */
export function renderIndexHtml(token: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<title>AI Local Agent</title>' +
    `<script>window.__AGENT_TOKEN__=${JSON.stringify(token)};</script>` +
    '</head><body><div id="root"></div></body></html>'
  );
}

export type StartOptions = {
  port?: number;
  allowedOrigins?: string[];
  recordIo?: boolean;
  staticDir?: string;
  token?: string;
};

/** Boot the local web BFF. Returns the server handle for tests/shutdown. */
export function startWebServer(opts: StartOptions = {}): {
  server: ReturnType<typeof Bun.serve>;
  token: string;
  port: number;
} {
  const cfg = loadConfig().values;
  const port = opts.port ?? (cfg.AGENT_WEB_PORT as number);
  const allowedOrigins =
    opts.allowedOrigins ??
    String(cfg.AGENT_WEB_ORIGIN_ALLOWLIST)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const recordIo = opts.recordIo ?? (cfg.AGENT_WEB_RECORD_IO as boolean);
  const token = opts.token ?? mintSessionToken();

  const policy = { port, allowedOrigins };
  const deps: ServerDeps = {
    token,
    policy,
    recordIo,
    staticDir: opts.staticDir,
    indexHtml: renderIndexHtml(token),
  };
  // idleTimeout: 0 is required so future SSE streams are not idle-closed.
  const server = Bun.serve({ port, fetch: buildFetch(deps), idleTimeout: 0 });
  policy.port = server.port; // reconcile when port === 0 (ephemeral)
  return { server, token, port: server.port };
}

if (import.meta.main) {
  const { server } = startWebServer();
  process.stderr.write(
    `web BFF on http://localhost:${server.port} ` +
      '(session token minted + injected into served HTML)\n',
  );
}
```

- [ ] **Step 4: Add the `web` script to `package.json`**

In `package.json` `scripts`, add (do NOT touch the existing `serve`):

```json
    "web": "bun run src/server/main.ts",
```

- [ ] **Step 5: Run smoke test + typecheck to verify pass**

Run: `bun test tests/server/main.test.ts && bun run typecheck`
Expected: PASS (2 tests) and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/main.ts package.json tests/server/main.test.ts
git commit -m "feat(server): add bun run web entry point with token minting + HTML injection"
```

---

### Task 12: Docs — `## Contracts` + `## Server (web BFF)` subsystem sections (docs-check gate)

**Files:**
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: nothing.
- Produces: two new sections naming the substrings `src/contracts` and `src/server` so `scripts/docs-check.ts` rule 3 passes (it hard-fails on any undocumented `src/<subsystem>`).

- [ ] **Step 1: Confirm docs-check currently FAILS on the new subsystems**

Run: `bun run docs:check`
Expected: FAIL — `subsystem src/contracts/ is not documented ...` and `subsystem src/server/ is not documented ...`.

- [ ] **Step 2: Append the two subsystem sections**

Add to the end of `docs/architecture.md` (before the final trailing content if any; a new top-level `##` section each):

```markdown
---

## Contracts (web wire protocol — `src/contracts/`, Slice 30b Phase 1)

**Feature.** `src/contracts/` is the single source of truth for the local web
UI's wire protocol: Zod schemas plus their inferred TypeScript types. It is
**isomorphic** — imported by both the server (`src/server/`) and the future
browser (`web/`) — and depends on **nothing but `zod`** (a test,
`tests/contracts/isomorphic.test.ts`, enforces this; no `node:*`, no engine,
no AI-SDK types, per Slice-23 forward-compat).

**Mechanism.** `enums.ts` holds the finite named sets (`RunOrigin`,
`RunLifecycle`, `SpanStatus`, `ArtifactKind`, `DegradeKind`, `ChatRole`,
`ModelLoadAction`, `StatusEventType`). `dto.ts` defines the read-model DTOs
(`RunDTO`/`SpanDTO`/`DegradeDTO`/`ChatMessageDTO`) with forward-compat fields
optional (reserved `owner`, run `lifecycle`/`origin`, span `degraded`/`node`,
token roll-ups). `events.ts` defines the transient-SSE `StatusEvent`
discriminated union (`data-run-start` … `data-confirm` … `data-run-end`) —
OUR types, never re-exported AI-SDK `UIMessage` parts. `requests.ts` defines the
inbound bodies the server validates before any engine call (`ChatRequest` over a
minimal structural `UiMessageLike`, and `RespondRequest` for the consent
back-channel). `index.ts` is the barrel.

**Data flow.** browser/server ⇄ `contracts` schemas: the server parses inbound
requests (`ChatRequestSchema.parse`) at the perimeter and (later phases) maps
engine spans → `RunDTO`/`SpanDTO` and writes `StatusEvent`s as transient SSE
data-parts. The `DegradeKind` wire enum mirrors `src/reliability/ledger.ts` by
value (guarded by `tests/contracts/degrade-kind-parity.test.ts`) without
importing it.

## Server (web BFF — `src/server/`, Slice 30b Phase 1)

**Feature.** `src/server/` is a thin, transport-agnostic `Bun.serve` BFF that
owns **no business logic** — it adapts the engine to HTTP and enforces the
localhost security perimeter (D17). Phase 1 ships the perimeter, `/api/health`,
static serving, and the `bun run web` entry; the streaming chat handler, DTO
mappers, and remaining endpoints attach in later phases.

**Mechanism.** `main.ts` (`bun run web`) reads the `AGENT_WEB_*` config, mints a
per-session bearer token, injects it into the served HTML, and boots
`Bun.serve({ idleTimeout: 0 })`. `app.ts` (`buildFetch`) is the request
pipeline: **perimeter → token → route**. `security/origin.ts` enforces a
Host-header allowlist (`localhost`/`127.0.0.1:PORT`) plus cross-origin `Origin`
rejection (DNS-rebinding/CSRF defense); `security/token.ts` mints + constant-time
verifies the bearer; `security/media-path.ts` confines network-supplied media
paths to a realpath inside the run/upload dir. Static assets are served under
**COOP/COEP** (`same-origin` / `require-corp`) for future sherpa WASM
`SharedArrayBuffer`. Every `/api` handler is wrapped in a `server.request`
telemetry span (`src/telemetry/spans.ts`, with a reserved `server.principal`
attribute) and typed-error handling via `explain()` (`src/errors/boundary.ts`) —
so an endpoint degrades to a JSON error, never crashes.

**Data flow.** `request → enforcePerimeter → token guard → withServerRequestSpan
→ route (/api/health | static) → JSON/HTML response`. Served-mode record-IO is
OFF by default (`AGENT_WEB_RECORD_IO`), distinct from the CLI's
`AGENT_TELEMETRY_RECORD_IO`.
```

- [ ] **Step 3: Run docs-check to verify it passes**

Run: `bun run docs:check`
Expected: PASS — `✔ docs-check: living docs present + linked; every src subsystem documented.`

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): add Contracts + Server (web BFF) subsystem sections (Slice 30b Phase 1)"
```

---

### Final gate (run after Task 12)

- [ ] **Run the full pre-PR gate**

Run: `bun run check`
Expected: PASS — docs-check ✔, typecheck ✔, lint ✔, all tests green (the new `tests/contracts/**` and `tests/server/**` suites included).

> Note: `bun run check` runs `lint` (`biome check .`) across the repo. If Biome flags style on any new file (import ordering, quote style), fix in place and re-run — this is not a plan step to skip.

---

## Self-Review

I ran the writing-plans self-review checklist against the Phase-1 spec scope (§Build order item 1 "Foundations + perimeter security", D15 forward-compat fields, D17 perimeter, the M3 config carry-forward, the Spike-A findings) and the repo conventions supplied:

- **Spec coverage.** Every Phase-1 deliverable maps to a task: contract DTOs + forward-compat optionals (Task 2), status events (Task 3), inbound request schemas (Task 4), isomorphic no-forbidden-imports guard (Task 1) + DegradeKind parity (Task 2), `ConfigEntry.strict?` M3 carry-forward + `AGENT_WEB_*` (Task 5), bearer token (Task 6), Host/Origin allowlist (Task 7), media-path confinement (Task 8), `server.request` span with reserved principal (Task 9), thin BFF + COOP/COEP + `/api/health` + typed-error handling (Task 10), `bun run web` entry + HTML token injection (Task 11), docs-check subsystem stubs (Task 12). Explicitly out of Phase 1 and NOT tasked: the chat/SSE handler, DTO mappers, `web/` frontend harness/tokens/shell (Phase 1b), persistence/`SessionStore` — all called out in Global Constraints.
- **Placeholder scan.** No `TBD`/"add error handling"/"write tests for the above"; every code step carries complete, real code and exact run/commit commands.
- **Type consistency.** Names are stable across tasks: enums (Task 1) feed `z.enum(...)` in Tasks 2–4; `OriginPolicy`/`ServerDeps` defined in Tasks 7/10 are consumed verbatim in Tasks 10/11; `withServerRequestSpan`'s `{ status }` recorder (Task 9) is called exactly in Task 10; `ServerDeps.policy` object-identity mutation (port reconcile) is used consistently in the Task 10 test and Task 11 entry.

Two verification points I could not fully pin from static reading and flagged inline for the implementer: (a) the exact `registerTestProvider()` accessor/shutdown surface in `tests/helpers/otel-test-provider.ts` (Task 9 step 1 notes to mirror the existing `tests/telemetry/*.test.ts` usage); (b) Zod v4's `z.enum(NativeEnum)` / `z.record(key, value)` signatures (stated in Global Constraints; a `bun run typecheck` at Task 2/4 will catch any drift immediately). I am leaving the deeper adversarial correctness review to the orchestrator per subagent-driven-development's two-stage review.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-14-slice-30b-phase1-contracts-server-security.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review.

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
- Batch execution with checkpoints for review.
