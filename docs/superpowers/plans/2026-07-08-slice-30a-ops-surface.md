# Slice 30a — Ops Surface + CI — Implementation Plan (part 2 of 30a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the framework the operability surface an established, served product needs — a structured leveled logger, a single validated config schema, `status`/`start`/`--version` commands, a top-level error boundary with persisted error records, an aggregate usage/cost view, and the repo's first real CI pipeline.

**Architecture:** Small new modules (`src/log/`, `src/config/`, `src/usage/`, `src/errors/boundary.ts`, `src/cli/{status,start,config,usage}.ts`) plus a `.github/workflows/ci.yml`. Reuses data that already exists (OTel spans for usage; `src/core/errors.ts` typed errors for the boundary; the run-router's run-id for log stamping). Depends on **Plan 1 (concurrency & lifecycle core)** — specifically the run-router's run-context (for run-id stamping) and collision-free run ids.

**Tech Stack:** Bun + TypeScript (ESM, `.ts` extensions), `bun:test`, Zod v4 (already a dep), Biome, GitHub Actions.

## Global Constraints

- Bun only; tests `bun test`; lint Biome; full gate `bun run check`. AI SDK stays v6.
- Style: `type` over `interface`; `enum` for finite sets; early returns; small files; no stray `console.log`; `.ts` import extensions.
- **"Compute live; env vars fallback-only"** — the config schema encodes *defaults*; env overrides. Mirror `src/reliability/config.ts`'s `envNumber` semantics (a present-but-invalid value falls back to the default).
- Depends on Plan 1: `withRunContext`/a new `currentRunId()` from `src/telemetry/run-router.ts`.
- Docs hard line + conventional commits + no push/PR without confirmation (as Plan 1).
- Test conventions: `mkdtemp` temp dirs cleaned in `afterEach`; injected fakes over real runtimes; read spans from disk via `readSpans` where relevant.

---

### Task 1: Structured leveled logger

**Files:**
- Create: `src/log/logger.ts`
- Create: `tests/log/logger.test.ts`
- Modify: `src/telemetry/run-router.ts` (export `currentRunId(): string | undefined`)
- Modify: `src/cli/chat.ts` (replace the representative status `console.error` calls at `:191`, `:195` with `log.info(...)`)

**Interfaces:**
- Consumes: OTel context run-id set by Plan 1's `withRunContext`.
- Produces:
  - `currentRunId(): string | undefined` (added to `run-router.ts`) — reads `RUN_ID_KEY` from the active context.
  - `createLogger(name: string): Logger` where `Logger = { debug; info; warn; error }`, each `(msg: string, fields?: Record<string, unknown>) => void`. Emits one record to stderr: pretty (`HH:MM:SS LEVEL name msg`) when stderr is a TTY, else a JSON line `{ ts, level, name, runId, msg, ...fields }`. Level gate via `AGENT_LOG_LEVEL` (default `info`; order debug<info<warn<error).
  - `setLogSink(fn: (line: string) => void): void` — test seam to capture output.

- [ ] **Step 1: Write the failing test**

```ts
// tests/log/logger.test.ts
import { afterEach, expect, test } from 'bun:test';
import { createLogger, setLogSink } from '../../src/log/logger.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';

afterEach(() => { setLogSink(undefined); delete process.env.AGENT_LOG_LEVEL; });

test('emits JSON with level, name, msg, fields and stamps runId from context', () => {
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));
  const log = createLogger('test');
  withRunContext('run-xyz', () => log.info('hello', { k: 1 }));
  const rec = JSON.parse(lines[0]);
  expect(rec).toMatchObject({ level: 'info', name: 'test', msg: 'hello', k: 1, runId: 'run-xyz' });
});

test('respects AGENT_LOG_LEVEL gate', () => {
  process.env.AGENT_LOG_LEVEL = 'warn';
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));
  const log = createLogger('t');
  log.info('skip'); log.warn('keep');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).msg).toBe('keep');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/log/logger.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: Add `currentRunId` to run-router**

In `src/telemetry/run-router.ts`, export:

```ts
import { context } from '@opentelemetry/api'; // already imported
// RUN_ID_KEY already defined in Plan 1
export function currentRunId(): string | undefined {
  return context.active().getValue(RUN_ID_KEY) as string | undefined;
}
```

- [ ] **Step 4: Implement the logger**

```ts
// src/log/logger.ts
import { currentRunId } from '../telemetry/run-router.ts';

export type Logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
};
const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ORDER;

let sink: ((line: string) => void) | undefined;
export function setLogSink(fn: ((line: string) => void) | undefined): void { sink = fn; }

function level(): Level {
  const v = (process.env.AGENT_LOG_LEVEL ?? 'info').toLowerCase();
  return (v in ORDER ? v : 'info') as Level;
}
function emit(name: string, lvl: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[lvl] < ORDER[level()]) return;
  const rec = { ts: new Date().toISOString(), level: lvl, name, runId: currentRunId(), msg, ...fields };
  const line = sink || !process.stderr.isTTY
    ? JSON.stringify(rec)
    : `${rec.ts.slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} ${name}  ${msg}`;
  (sink ?? ((l: string) => process.stderr.write(`${l}\n`)))(line);
}
export function createLogger(name: string): Logger {
  return {
    debug: (m, f) => emit(name, 'debug', m, f),
    info: (m, f) => emit(name, 'info', m, f),
    warn: (m, f) => emit(name, 'warn', m, f),
    error: (m, f) => emit(name, 'error', m, f),
  };
}
```

- [ ] **Step 5: Replace representative console calls in chat.ts + run tests**

In `src/cli/chat.ts` add `const log = createLogger('chat');` (import from `../log/logger.ts`) and replace the two status `console.error(...)` at `:191`/`:195` with `log.info(...)`. (Leave the usage-error `console.error` at `:181` — that path exits before a logger is useful; the error boundary in Task 5 handles top-level errors.)

Run: `bun test tests/log/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/log/logger.ts tests/log/logger.test.ts src/telemetry/run-router.ts src/cli/chat.ts
git commit -m "feat(log): structured leveled logger stamped with run-id (replaces ad-hoc console.* status)"
```

---

### Task 2: Central config schema + `bun run config`

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/cli/config.ts`
- Create: `tests/config/schema.test.ts`
- Modify: `package.json` (add `"config": "bun run src/cli/config.ts"` script)
- Modify: `src/cli/chat.ts` (call `loadConfig()` once at the top of `main` to fail-fast on an invalid env value)

**Interfaces:**
- Produces:
  - `CONFIG_SPEC: ConfigEntry[]` where `type ConfigEntry = { env: string; kind: 'number'|'boolean'|'string'; def: number|boolean|string; doc: string }` — the single documented source of truth for every `AGENT_*` knob.
  - `loadConfig(env?: Record<string,string|undefined>): { values: Record<string, number|boolean|string>; sources: Record<string,'env'|'default'> }` — coerces + validates each entry (invalid → default, mirroring `envNumber`), returns effective values + where each came from.
  - Note (scope): this task establishes the schema + validation + dump; migrating the ~63 existing scattered read sites to read from `loadConfig` is a **follow-on** (tracked in the ops-surface follow-ups), not done here — the schema is the documented contract now.

- [ ] **Step 1: Write the failing test**

```ts
// tests/config/schema.test.ts
import { expect, test } from 'bun:test';
import { CONFIG_SPEC, loadConfig } from '../../src/config/schema.ts';

test('every entry has a doc string and a default', () => {
  for (const e of CONFIG_SPEC) { expect(e.doc.length).toBeGreaterThan(0); expect(e.def).toBeDefined(); }
});
test('loadConfig applies defaults and records source', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(5);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('default');
});
test('a valid env override wins and is marked env', () => {
  const { values, sources } = loadConfig({ AGENT_MAX_DELEGATION_DEPTH: '8' });
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(8);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('env');
});
test('an invalid number falls back to the default (env-fallback-only rule)', () => {
  const { values, sources } = loadConfig({ AGENT_MAX_DELEGATION_DEPTH: 'notanumber' });
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(5);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('default');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/config/schema.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the spec + loader**

```ts
// src/config/schema.ts
export type ConfigKind = 'number' | 'boolean' | 'string';
export type ConfigEntry = { env: string; kind: ConfigKind; def: number | boolean | string; doc: string };

// The documented source of truth for every AGENT_* knob. Enumerate ALL of them
// (the full 63-var list is in the Slice-30a spec + the extraction report). Sample below;
// the implementer transcribes the complete list, grouped by concern, one entry each.
export const CONFIG_SPEC: ConfigEntry[] = [
  { env: 'AGENT_MAX_DELEGATION_DEPTH', kind: 'number', def: 5, doc: 'Max router→specialist delegation depth.' },
  { env: 'AGENT_RUN_TIMEOUT_MS', kind: 'number', def: 120_000, doc: 'Hard wall-clock cap per agent run.' },
  { env: 'AGENT_IDLE_TIMEOUT_MS', kind: 'number', def: 90_000, doc: 'Idle-stall timeout.' },
  { env: 'AGENT_MEMORY_TOP_K', kind: 'number', def: 6, doc: 'Default recall top-K.' },
  { env: 'AGENT_MEMORY_RERANK', kind: 'boolean', def: true, doc: 'Enable reranking on recall.' },
  { env: 'AGENT_TELEMETRY_RECORD_IO', kind: 'boolean', def: true, doc: 'Record prompts/responses into run spans.' },
  { env: 'AGENT_UNCENSORED', kind: 'boolean', def: true, doc: 'Allow uncensored models + disable image safety checker.' },
  { env: 'AGENT_RUNS_ROOT', kind: 'string', def: 'runs', doc: 'Directory for run artifacts/traces.' },
  { env: 'AGENT_LOG_LEVEL', kind: 'string', def: 'info', doc: 'Logger threshold: debug|info|warn|error.' },
  // … transcribe the remaining ~54 AGENT_* vars here, grouped (reliability, memory,
  //   media, voice, verify, provisioning, breaker, mcp, otlp, etc.) …
];

function coerce(entry: ConfigEntry, raw: string | undefined): { value: number | boolean | string; source: 'env' | 'default' } {
  if (raw === undefined || raw === '') return { value: entry.def, source: 'default' };
  if (entry.kind === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n, source: 'env' } : { value: entry.def, source: 'default' };
  }
  if (entry.kind === 'boolean') return { value: raw !== '0' && raw.toLowerCase() !== 'false', source: 'env' };
  return { value: raw, source: 'env' };
}
export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const values: Record<string, number | boolean | string> = {};
  const sources: Record<string, 'env' | 'default'> = {};
  for (const e of CONFIG_SPEC) { const { value, source } = coerce(e, env[e.env]); values[e.env] = value; sources[e.env] = source; }
  return { values, sources };
}
```

```ts
// src/cli/config.ts
import { CONFIG_SPEC, loadConfig } from '../config/schema.ts';
function main() {
  const { values, sources } = loadConfig();
  for (const e of CONFIG_SPEC) {
    const src = sources[e.env] === 'env' ? 'env ' : 'def ';
    process.stdout.write(`${src} ${e.env.padEnd(32)} ${String(values[e.env]).padEnd(12)} ${e.doc}\n`);
  }
}
if (import.meta.main) main();
```

- [ ] **Step 4: Wire fail-fast + script**

Add `"config": "bun run src/cli/config.ts"` to `package.json` scripts. In `src/cli/chat.ts` `main`, add `loadConfig();` near the top (validates the environment eagerly; today it's lazy per-read).

Run: `bun test tests/config/ && bun run config | head -5 && bun run typecheck`
Expected: tests PASS; `bun run config` prints the effective table.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/cli/config.ts tests/config/schema.test.ts package.json src/cli/chat.ts
git commit -m "feat(config): single documented AGENT_* schema + 'bun run config' dump (was 63 scattered env reads)"
```

---

### Task 3: `bun run status`

**Files:**
- Create: `src/cli/status.ts`
- Create: `tests/cli/status.test.ts`
- Modify: `package.json` (`"status": "bun run src/cli/status.ts"`)

**Interfaces:**
- Produces:
  - `collectStatus(deps: StatusDeps): Promise<StatusReport>` where `StatusDeps = { ollamaReachable: () => Promise<boolean>; loadedModels: () => Promise<string[]>; freeBudgetBytes: () => Promise<number>; version: string }` and `StatusReport = { version: string; ollama: boolean; loaded: string[]; freeGb: number }`.
  - `renderStatus(r: StatusReport): string` — a compact human summary.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/status.test.ts
import { expect, test } from 'bun:test';
import { collectStatus, renderStatus } from '../../src/cli/status.ts';

test('collectStatus assembles a report from injected probes', async () => {
  const r = await collectStatus({
    ollamaReachable: async () => true,
    loadedModels: async () => ['qwen2.5:14b'],
    freeBudgetBytes: async () => 12_000_000_000,
    version: '0.2.0',
  });
  expect(r).toEqual({ version: '0.2.0', ollama: true, loaded: ['qwen2.5:14b'], freeGb: 12 });
  expect(renderStatus(r)).toContain('qwen2.5:14b');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/cli/status.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/cli/status.ts
export type StatusDeps = {
  ollamaReachable: () => Promise<boolean>;
  loadedModels: () => Promise<string[]>;
  freeBudgetBytes: () => Promise<number>;
  version: string;
};
export type StatusReport = { version: string; ollama: boolean; loaded: string[]; freeGb: number };

export async function collectStatus(deps: StatusDeps): Promise<StatusReport> {
  const [ollama, loaded, free] = await Promise.all([deps.ollamaReachable(), deps.loadedModels(), deps.freeBudgetBytes()]);
  return { version: deps.version, ollama, loaded, freeGb: Math.round(free / 1e9) };
}
export function renderStatus(r: StatusReport): string {
  return [
    `agent-framework ${r.version}`,
    `ollama:  ${r.ollama ? 'reachable' : 'DOWN'}`,
    `models:  ${r.loaded.length ? r.loaded.join(', ') : '(none resident)'}`,
    `budget:  ~${r.freeGb} GB free`,
  ].join('\n');
}
```

Wire a `main()` that builds real deps (Ollama version ping via `src/runtime/ollama.ts`, `listLoaded` via `runtimeFor('ollama').control`, `liveBudgetBytes`, version from Task 4's `APP_VERSION`) and prints `renderStatus`. Add the `status` script to `package.json`.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/cli/status.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/status.ts tests/cli/status.test.ts package.json
git commit -m "feat(cli): 'bun run status' — Ollama/models/budget/version at a glance (feeds the 30b live panel)"
```

---

### Task 4: App version + `--version` + `start` scaffold

**Files:**
- Create: `src/version.ts`
- Create: `src/cli/start.ts`
- Create: `tests/version.test.ts`
- Modify: `package.json` (`version` → `0.2.0`; add `"start": "bun run src/cli/start.ts"`)

**Interfaces:**
- Produces: `APP_VERSION: string` (read once from `package.json`); `start` prints a scaffold message (the web server lands in Slice 30b).

- [ ] **Step 1: Write the failing test**

```ts
// tests/version.test.ts
import { expect, test } from 'bun:test';
import { APP_VERSION } from '../src/version.ts';
test('APP_VERSION is a semver string', () => { expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/); });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/version.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Bump `package.json` `"version"` to `"0.2.0"`. Then:

```ts
// src/version.ts
import pkg from '../package.json' with { type: 'json' };
export const APP_VERSION: string = pkg.version;
```

```ts
// src/cli/start.ts
import { APP_VERSION } from '../version.ts';
function main() {
  if (process.argv.includes('--version')) { process.stdout.write(`${APP_VERSION}\n`); return; }
  process.stdout.write(`agent-framework ${APP_VERSION}\nWeb UI starts here in Slice 30b. For now use: bun run src/cli/chat.ts "<task>"\n`);
}
if (import.meta.main) main();
```

Add `"start": "bun run src/cli/start.ts"` to `package.json`.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/version.test.ts && bun run start --version && bun run typecheck`
Expected: PASS; `--version` prints `0.2.0`.

- [ ] **Step 5: Commit**

```bash
git add src/version.ts src/cli/start.ts tests/version.test.ts package.json
git commit -m "feat(cli): app version + --version + 'bun run start' scaffold (web server lands in 30b)"
```

---

### Task 5: Top-level error boundary + persisted `error.json`

**Files:**
- Create: `src/errors/boundary.ts`
- Create: `tests/errors/boundary.test.ts`
- Modify: `src/cli/chat.ts:407-412` (replace `main().catch(console.error)`)

**Interfaces:**
- Consumes: the exported error classes from `src/core/errors.ts` (`ProviderError`, `ToolError`, `ResourceError`, `WorkflowError`, `CrewError`, `MemoryError`, `VerificationError`, `MaxStepsError`).
- Produces:
  - `explain(err: unknown): { title: string; hint: string }` — maps a `FrameworkError` subclass to an actionable message; unknown errors get a generic pair.
  - `handleTopLevel(err: unknown, deps?: { runDir?: string; write?: (path: string, data: string) => void; log?: (s: string) => void }): number` — logs the explained error, persists `error.json` to `runDir` if provided, returns exit code `1`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors/boundary.test.ts
import { expect, test } from 'bun:test';
import { explain, handleTopLevel } from '../../src/errors/boundary.ts';
import { ResourceError, ProviderError } from '../../src/core/errors.ts';

test('explain maps typed errors to actionable hints', () => {
  expect(explain(new ResourceError('no fit')).title).toMatch(/memory budget|resource/i);
  expect(explain(new ProviderError('ollama down')).hint).toMatch(/ollama|provider/i);
  expect(explain(new Error('weird')).title).toBeDefined();
});
test('handleTopLevel persists error.json and returns exit 1', () => {
  const writes: Record<string, string> = {};
  const code = handleTopLevel(new ProviderError('x'), { runDir: '/tmp/r', write: (p, d) => { writes[p] = d; }, log: () => {} });
  expect(code).toBe(1);
  expect(JSON.parse(writes['/tmp/r/error.json'])).toMatchObject({ name: 'ProviderError' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/errors/boundary.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/errors/boundary.ts
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ProviderError, ToolError, ResourceError, WorkflowError, CrewError, MemoryError, VerificationError, MaxStepsError } from '../core/errors.ts';

export function explain(err: unknown): { title: string; hint: string } {
  if (err instanceof ResourceError) return { title: 'No model fits the memory budget', hint: 'Free memory, pick a smaller model, or run `bun run provision`.' };
  if (err instanceof ProviderError) return { title: 'A model provider/runtime failed', hint: 'Check the provider (e.g. Ollama running: `bun run status`).' };
  if (err instanceof ToolError) return { title: 'A tool failed', hint: 'Check the tool/MCP server; see the run trace with `bun run runs`.' };
  if (err instanceof MemoryError) return { title: 'A memory/RAG error', hint: 'Check the space/embedder; a reindex may be required.' };
  if (err instanceof VerificationError) return { title: 'Verification was misused', hint: 'Ensure a memory store is configured for --verify.' };
  if (err instanceof WorkflowError || err instanceof CrewError) return { title: 'A workflow/crew error', hint: 'Inspect the failing step with `bun run runs`.' };
  if (err instanceof MaxStepsError) return { title: 'The agent hit its step ceiling', hint: 'The task may need a crew/workflow, or a higher step budget.' };
  return { title: 'Unexpected error', hint: 'See the stack below; re-run with AGENT_LOG_LEVEL=debug for detail.' };
}

export function handleTopLevel(err: unknown, deps: { runDir?: string; write?: (path: string, data: string) => void; log?: (s: string) => void } = {}): number {
  const write = deps.write ?? ((p, d) => writeFileSync(p, d));
  const log = deps.log ?? ((s) => process.stderr.write(`${s}\n`));
  const { title, hint } = explain(err);
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  log(`✖ ${title}: ${message}\n  → ${hint}`);
  if (deps.runDir) {
    try { write(join(deps.runDir, 'error.json'), JSON.stringify({ name, title, message, hint, at: new Date().toISOString() }, null, 2)); } catch { /* best-effort */ }
  }
  return 1;
}
```

- [ ] **Step 4: Wire into chat.ts + run tests**

Replace `src/cli/chat.ts:407-412` with:

```ts
if (import.meta.main) {
  main().catch((err) => { process.exit(handleTopLevel(err)); });
}
```
(import `handleTopLevel` from `../errors/boundary.ts`.)

Run: `bun test tests/errors/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/errors/boundary.ts tests/errors/boundary.test.ts src/cli/chat.ts
git commit -m "feat(errors): top-level boundary maps typed errors to actionable hints + persists error.json"
```

---

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

### Task 7: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:** none (CI config). Verification is a valid workflow that runs `bun run check` (the mock-only fast suite) on push + PR. The live-model suite stays manual/self-hosted (out of scope — Tier-2 Slice 40).

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun test
```

(Note: `bun run check` also runs `docs:check`, which is fine in CI; if `docs:check` needs git history it already handles CI checkouts. Split into explicit steps above so a failure is legible per-stage.)

- [ ] **Step 2: Validate locally**

Run: `bun run typecheck && bun run lint && bun test`
Expected: PASS locally (proves the CI steps are green before the workflow ever runs).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run typecheck + lint + tests on push/PR (first CI pipeline; was git-hooks only)"
```

---

### Task 8: Docs + full-suite gate (close 30a)

**Files:**
- Modify: `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`

**Interfaces:** none.

- [ ] **Step 1: Update architecture.md** — add sections for `src/log/`, `src/config/`, `src/usage/`, `src/errors/boundary.ts`, and the new `src/cli/{status,start,config,usage}.ts` commands + `src/version.ts`; note the CI pipeline in the enforcement/testing section. Add the new `src/` subsystems to the registry table + Mermaid diagram.

- [ ] **Step 2: Update README + ROADMAP + ledger** — README: new commands (`status`, `start`, `config`, `usage`, `--version`) + the ✅ Slice 30a (complete) row; ROADMAP: flip Slice 30a fully shipped; append the ops-surface per-task entries to `.superpowers/sdd/progress.md`.

- [ ] **Step 3: Run the full gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(sdd): Slice 30a ops surface — architecture, README, ROADMAP, ledger; 30a complete"
```

---

## Self-Review

**Spec coverage (30a spec F7–F11 + CI):** F7 logger → Task 1 ✓. F8 config schema + `bun run config` → Task 2 ✓ (read-site migration explicitly deferred + noted). F9 status/start/version → Tasks 3+4 ✓. F10 error boundary + `error.json` → Task 5 ✓. F11 usage rollup → Task 6 ✓. CI pipeline → Task 7 ✓. (F11's "token roll-up on spans" gap from the telemetry audit is addressed at read-time here via `aggregateSpans` tolerating missing tokens; emitting an explicit per-run roll-up span was folded into Plan 1 Task-adjacent telemetry — if not present, the usage view still works from AI-SDK gen spans.)

**Placeholder scan:** the only intentional "transcribe the rest" is the `CONFIG_SPEC` list — a mechanical enumeration of the fully-known 63-var list (present in the spec + extraction), not an undefined requirement; the loader/tests are complete. No other TBD/TODO.

**Type consistency:** `createLogger`/`setLogSink` (T1) consistent with tests; `currentRunId()` added to run-router and consumed by the logger; `loadConfig`/`CONFIG_SPEC` (T2) consistent; `collectStatus`/`StatusReport` (T3) reused by the status CLI; `APP_VERSION` (T4) consumed by status (T3) + start; `explain`/`handleTopLevel` (T5) consistent; `aggregateSpans`/`UsageRow` (T6) consistent with the `SpanRecord` shape from `jsonl-exporter.ts`.

**Cross-plan note:** Task 1 depends on Plan 1's `run-router.ts` (`RUN_ID_KEY`, `withRunContext`) — Plan 1 lands first, so `currentRunId()` can be added to the existing file.
