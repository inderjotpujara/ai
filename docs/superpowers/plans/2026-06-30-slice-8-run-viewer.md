# Slice 8 — Phase A Run-viewer (OpenTelemetry tracing + terminal viewer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument each run as an OpenTelemetry trace (root + delegation + model-lifecycle spans; AI-SDK gives agent/tool/token spans free) written to `runs/<id>/spans.jsonl`, and add a `bun run runs` terminal viewer that lists runs and renders one as a timeline (with `--follow`).

**Architecture:** OTel-native, global provider (Approach A). A thin `src/telemetry/` module owns a Bun-safe `BasicTracerProvider` + `AsyncLocalStorageContextManager`, a custom `JsonlFileExporter`, and semantic span helpers. `runChat` owns the provider lifecycle and the root span; manual spans at the delegation / model-select / model-load·evict seams ride the active OTel context so AI-SDK `generateText`/`toolCall`/token spans nest underneath automatically. A pure reader + renderer back the `runs` CLI. The same spans stream to any OSS backend by setting `AGENT_OTLP_ENDPOINT`.

**Tech Stack:** TypeScript on Bun; AI SDK `ai@6.0.214` (`experimental_telemetry`); OpenTelemetry JS v2.x (`@opentelemetry/{api,sdk-trace-base,context-async-hooks,core,resources,semantic-conventions,exporter-trace-otlp-proto}`); `bun:test`; Biome.

## Global Constraints

- **Runtime:** Bun. **AI SDK is v6** (`ai@6.0.214`) — use `experimental_telemetry`, NOT the v7-beta `@ai-sdk/otel`/`registerTelemetry`.
- **Bun-safe OTel only:** `BasicTracerProvider` + `AsyncLocalStorageContextManager` registered programmatically. Do NOT add `NodeTracerProvider`, `@opentelemetry/auto-instrumentations-node`, or any `@opentelemetry/instrumentation-*` (Bun breaks Node monkey-patching).
- **OTel JS v2.x API:** `span.spanContext()` is a **method**; parent id = `span.parentSpanContext?.spanId` (NOT `parentSpanId`); processors passed via constructor `spanProcessors:[]` (no `addSpanProcessor`); `HrTime` is `[seconds, nanos]`. OTLP uses HTTP/proto (`exporter-trace-otlp-proto`) — never gRPC on Bun.
- **Telemetry is best-effort:** helpers must NEVER throw into the agent path; with no provider registered they fall back to the OTel no-op tracer (zero spans, no breakage).
- **Telemetry is a reusable, extensible subsystem (standing rule, not just this slice):** keep `src/telemetry/` modular so later features extend it by adding a `withXSpan`/`recordX` helper + `ATTR` keys in `spans.ts` — never by touching the transport (`provider.ts`/`jsonl-exporter.ts`) or the OTLP seam. New spans flow to the local viewer AND any OTLP backend for free. (See spec §6½ and ROADMAP's "observable by default" principle.) Build the helpers in this slice with that extension pattern visible and uniform.
- **`gen_ai.*` is experimental:** emit both `gen_ai.provider.name` and legacy `gen_ai.system`; the viewer reads `gen_ai.*` keys generically.
- **Env is fallback-only:** `AGENT_TELEMETRY_RECORD_IO` (default on), `AGENT_OTLP_ENDPOINT` (unset = JSONL only), `AGENT_RUNS_ROOT` (default `runs`).
- **Code style (Biome):** single quotes, always semicolons, 2-space indent, organize-imports on. **Imports use explicit `.ts` extensions.** `verbatimModuleSyntax` → use `import type` for types. `strict` + `noUncheckedIndexedAccess` — guard array/object access. Prefer `enum` for finite named sets, but reuse existing string-union shapes structurally where they already exist.
- **Tests:** `bun:test` (`describe`/`test`/`expect`/`mock`/`beforeEach`/`afterEach`). Temp dirs via `mkdtemp(join(tmpdir(), 'prefix-'))` + `rm(dir,{recursive:true,force:true})`. Mock models via `MockLanguageModelV3` from `ai/test`. Live tests: file suffix `*.live.test.ts`, gate `const ready = await ollamaReady(...); describe.skipIf(!ready)(...)`, timeout `120_000`.
- **Every commit message ends with the trailer:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Gates between/within tasks:** `bun run typecheck` and `bun run lint` clean; `bun test` green (live tests skip when Ollama is down).

---

## File Structure

**Create:**
- `src/telemetry/jsonl-exporter.ts` — `SpanRecord` type + `JsonlFileExporter` (custom `SpanExporter`).
- `src/telemetry/provider.ts` — `initRunTelemetry`, `buildProcessors`, `recordIoEnabled`.
- `src/telemetry/spans.ts` — `ATTR` keys, span helpers (`withRunSpan`, `setRunOutcome`, `withDelegationSpan`, `recordModelSelect`, `withModelLoadSpan`, `recordEvict`), info types.
- `src/run/run-trace.ts` — `readSpans`, `buildTree`, `summarizeRun` (pure reader).
- `src/cli/render-trace.ts` — `renderTimeline`, `renderRunList` (pure string renderers).
- `src/cli/runs.ts` — `listRuns`, `renderRun`, `main` (CLI).
- Tests mirroring each under `tests/telemetry/`, `tests/run/`, `tests/cli/`, plus `tests/integration/run-viewer.live.test.ts`.

**Modify:**
- `package.json` — deps + `"runs"` script.
- `src/cli/run-chat.ts` — root span + telemetry lifecycle; remove `appendJournal`.
- `src/core/agent.ts`, `src/core/agent-def.ts` — `functionId` + `experimental_telemetry`.
- `src/core/delegate.ts` — `withDelegationSpan`.
- `src/cli/select-hook.ts` — `recordModelSelect`.
- `src/resource/model-manager.ts` — `withModelLoadSpan` + `recordEvict`.
- `tests/cli/run-chat.test.ts` — spans-based assertions.

**Delete:**
- `src/run/journal.ts`, `tests/run/journal.test.ts` (superseded by `spans.jsonl`; only `run-chat.ts` imports it).

---

### Task 1: `JsonlFileExporter` + `SpanRecord`

**Files:**
- Modify: `package.json` (dependencies)
- Create: `src/telemetry/jsonl-exporter.ts`
- Test: `tests/telemetry/jsonl-exporter.test.ts`

**Interfaces:**
- Produces: `type SpanRecord` (consumed by `run-trace.ts`, `render-trace.ts`); `class JsonlFileExporter implements SpanExporter` (consumed by `provider.ts`).

- [ ] **Step 1: Add OpenTelemetry dependencies**

Run:
```bash
bun add @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/context-async-hooks @opentelemetry/core @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/exporter-trace-otlp-proto
```
Expected: packages added to `package.json` `dependencies`; `bun.lock` updated. Then `bun run typecheck` → clean.

- [ ] **Step 2: Write the failing test**

Create `tests/telemetry/jsonl-exporter.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';
import { JsonlFileExporter } from '../../src/telemetry/jsonl-exporter.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spans-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('writes one JSON line per ended span with parent linkage', async () => {
  const file = join(dir, 'spans.jsonl');
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new JsonlFileExporter(file))],
  });
  const tracer = provider.getTracer('test');
  const parent = tracer.startSpan('parent');
  parent.setAttribute('k', 'v');
  parent.end();
  await provider.shutdown();

  const lines = (await readFile(file, 'utf8'))
    .split('\n')
    .filter((l) => l.length > 0);
  expect(lines.length).toBe(1);
  const rec = JSON.parse(lines[0] as string) as SpanRecord;
  expect(rec.name).toBe('parent');
  expect(rec.parentSpanId).toBeNull();
  expect(rec.traceId).toHaveLength(32);
  expect(rec.spanId).toHaveLength(16);
  expect(rec.attributes.k).toBe('v');
  expect(typeof rec.durationMs).toBe('number');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/telemetry/jsonl-exporter.test.ts`
Expected: FAIL — cannot resolve `../../src/telemetry/jsonl-exporter.ts`.

- [ ] **Step 4: Write minimal implementation**

Create `src/telemetry/jsonl-exporter.ts`:
```typescript
import { appendFile } from 'node:fs/promises';
import {
  type ExportResult,
  ExportResultCode,
  hrTimeToMicroseconds,
} from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/** One serialized span per line in runs/<id>/spans.jsonl. */
export type SpanRecord = {
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  startUnixNano: number;
  endUnixNano: number;
  durationMs: number;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  events: {
    name: string;
    timeUnixNano: number;
    attributes?: Record<string, unknown>;
  }[];
};

function toRecord(span: ReadableSpan): SpanRecord {
  const ctx = span.spanContext();
  return {
    name: span.name,
    kind: span.kind,
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    startUnixNano: hrTimeToMicroseconds(span.startTime) * 1000,
    endUnixNano: hrTimeToMicroseconds(span.endTime) * 1000,
    durationMs: hrTimeToMicroseconds(span.duration) / 1000,
    status: { code: span.status.code, message: span.status.message },
    attributes: { ...span.attributes },
    events: span.events.map((e) => ({
      name: e.name,
      timeUnixNano: hrTimeToMicroseconds(e.time) * 1000,
      attributes: e.attributes ? { ...e.attributes } : undefined,
    })),
  };
}

/** Best-effort local span sink. Never throws into the run. */
export class JsonlFileExporter implements SpanExporter {
  constructor(private readonly filePath: string) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    const payload = `${spans.map((s) => JSON.stringify(toRecord(s))).join('\n')}\n`;
    appendFile(this.filePath, payload)
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error: Error) =>
        resultCallback({ code: ExportResultCode.FAILED, error }),
      );
  }

  async shutdown(): Promise<void> {}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/telemetry/jsonl-exporter.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/telemetry/jsonl-exporter.ts tests/telemetry/jsonl-exporter.test.ts`
Expected: clean.
```bash
git add package.json bun.lock src/telemetry/jsonl-exporter.ts tests/telemetry/jsonl-exporter.test.ts
git commit -m "feat(telemetry): JsonlFileExporter + SpanRecord (OTel local span sink)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `provider.ts` — provider lifecycle, processor factory, IO flag

**Files:**
- Create: `src/telemetry/provider.ts`
- Test: `tests/telemetry/provider.test.ts`

**Interfaces:**
- Consumes: `JsonlFileExporter` (Task 1).
- Produces: `initRunTelemetry(runDir: string): { shutdown: () => Promise<void> }`; `recordIoEnabled(): boolean`; `buildProcessors(spansFilePath: string): SpanProcessor[]` (exported for testing).

- [ ] **Step 1: Write the failing test**

Create `tests/telemetry/provider.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from '@opentelemetry/api';
import {
  buildProcessors,
  initRunTelemetry,
  recordIoEnabled,
} from '../../src/telemetry/provider.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prov-'));
});
afterEach(async () => {
  delete process.env.AGENT_OTLP_ENDPOINT;
  delete process.env.AGENT_TELEMETRY_RECORD_IO;
  await rm(dir, { recursive: true, force: true });
});

test('initRunTelemetry registers a provider that writes spans.jsonl', async () => {
  const tel = initRunTelemetry(dir);
  const span = trace.getTracer('t').startSpan('hello');
  span.end();
  await tel.shutdown();
  const raw = await readFile(join(dir, 'spans.jsonl'), 'utf8');
  expect(raw).toContain('"name":"hello"');
});

test('initRunTelemetry is idempotent across runs (re-register ok)', async () => {
  const a = initRunTelemetry(dir);
  await a.shutdown();
  const b = initRunTelemetry(dir);
  await b.shutdown();
  expect(true).toBe(true); // no throw on second context-manager registration
});

test('buildProcessors adds OTLP only when AGENT_OTLP_ENDPOINT is set', () => {
  expect(buildProcessors(join(dir, 's.jsonl'))).toHaveLength(1);
  process.env.AGENT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
  expect(buildProcessors(join(dir, 's.jsonl'))).toHaveLength(2);
});

test('recordIoEnabled defaults true, off when set to 0', () => {
  expect(recordIoEnabled()).toBe(true);
  process.env.AGENT_TELEMETRY_RECORD_IO = '0';
  expect(recordIoEnabled()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/provider.test.ts`
Expected: FAIL — cannot resolve `provider.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/telemetry/provider.ts`:
```typescript
import { join } from 'node:path';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { JsonlFileExporter } from './jsonl-exporter.ts';

/** Whether prompts/responses/tool-IO are captured. Default on; AGENT_TELEMETRY_RECORD_IO=0 disables. */
export function recordIoEnabled(): boolean {
  return process.env.AGENT_TELEMETRY_RECORD_IO !== '0';
}

/** JSONL always; OTLP/HTTP added iff AGENT_OTLP_ENDPOINT is set (the swappable-backend seam). */
export function buildProcessors(spansFilePath: string): SpanProcessor[] {
  const processors: SpanProcessor[] = [
    new SimpleSpanProcessor(new JsonlFileExporter(spansFilePath)),
  ];
  const endpoint = process.env.AGENT_OTLP_ENDPOINT;
  if (endpoint) {
    processors.push(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
    );
  }
  return processors;
}

let contextManagerSet = false;

/** Register a per-run global TracerProvider writing to runDir/spans.jsonl. */
export function initRunTelemetry(runDir: string): {
  shutdown: () => Promise<void>;
} {
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'local-agent-framework',
    }),
    spanProcessors: buildProcessors(join(runDir, 'spans.jsonl')),
  });
  if (!contextManagerSet) {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    contextManagerSet = true;
  }
  trace.setGlobalTracerProvider(provider);
  return {
    shutdown: async () => {
      await provider.shutdown();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry/provider.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/telemetry/provider.ts tests/telemetry/provider.test.ts`
```bash
git add src/telemetry/provider.ts tests/telemetry/provider.test.ts
git commit -m "feat(telemetry): Bun-safe OTel provider + OTLP seam + IO flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `spans.ts` — semantic span helpers (+ Bun ALS nesting smoke)

**Files:**
- Create: `src/telemetry/spans.ts`
- Test: `tests/telemetry/spans.test.ts`

**Interfaces:**
- Consumes: `recordIoEnabled` (Task 2).
- Produces:
  - `const ATTR` (attribute-key constants);
  - `type ModelSelectInfo = { modelId: string; provider: string; numCtx: number; paramsBillions?: number }`;
  - `type ModelLoadInfo = { weightsBytes: number; kvF16PerToken: number; kvEffectivePerToken: number; kvCacheType: string; chosenCtx: number; requestedCtx: number; footprintBytes: number; budgetBytes: number }`;
  - `withRunSpan<T>(runId: string, task: string, fn: () => Promise<T>): Promise<T>`;
  - `setRunOutcome(result: { kind: string; message?: string; missingCapability?: string }): void`;
  - `withDelegationSpan<T>(target: string, fn: () => Promise<T>): Promise<T>`;
  - `recordModelSelect(info: ModelSelectInfo): void`;
  - `withModelLoadSpan<T>(modelId: string, info: ModelLoadInfo, fn: () => Promise<T>): Promise<T>`;
  - `recordEvict(modelId: string, sizeBytes: number, reason: string): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/telemetry/spans.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR,
  recordEvict,
  setRunOutcome,
  withDelegationSpan,
  withRunSpan,
} from '../../src/telemetry/spans.ts';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  ); // returns false if already set — harmless
  trace.setGlobalTracerProvider(provider);
});
afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
});

test('delegation span nests under the run span (Bun ALS context propagation)', async () => {
  await withRunSpan('run-x', 'do a thing', async () => {
    setRunOutcome({ kind: 'answer' });
    await withDelegationSpan('file_qa', async () => {
      recordEvict('old:model', 123, 'lru-fit');
    });
  });
  const spans = exporter.getFinishedSpans();
  const run = spans.find((s) => s.name === 'agent.run');
  const del = spans.find((s) => s.name === 'agent.delegation');
  expect(run).toBeDefined();
  expect(del).toBeDefined();
  expect(del?.parentSpanContext?.spanId).toBe(run?.spanContext().spanId);
  expect(run?.attributes[ATTR.RUN_ID]).toBe('run-x');
  expect(run?.attributes[ATTR.OUTCOME]).toBe('answer');
  expect(del?.attributes[ATTR.DELEGATION_TARGET]).toBe('file_qa');
  expect(del?.events.find((e) => e.name === 'agent.model.evict')).toBeDefined();
});

test('resource outcome sets ERROR status on the run span', async () => {
  await withRunSpan('run-y', 'x', async () => {
    setRunOutcome({ kind: 'resource', message: 'no fit' });
  });
  const run = exporter.getFinishedSpans().find((s) => s.name === 'agent.run');
  expect(run?.status.code).toBe(2); // SpanStatusCode.ERROR
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/spans.test.ts`
Expected: FAIL — cannot resolve `spans.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/telemetry/spans.ts`:
```typescript
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { recordIoEnabled } from './provider.ts';

export const ATTR = {
  RUN_ID: 'agent.run.id',
  TASK: 'agent.task',
  OUTCOME: 'agent.outcome',
  GAP_MISSING: 'agent.gap.missing_capability',
  DELEGATION_TARGET: 'agent.delegation.target',
  MODEL_ID: 'gen_ai.request.model',
  MODEL_PROVIDER: 'gen_ai.provider.name',
  MODEL_PARAMS_B: 'model.params_billions',
  MODEL_NUM_CTX: 'model.num_ctx',
  MODEL_REQUESTED_CTX: 'model.requested_num_ctx',
  MODEL_WEIGHTS_BYTES: 'model.weights_bytes',
  MODEL_KV_F16_PER_TOKEN: 'model.kv_f16_bytes_per_token',
  MODEL_KV_BYTES_PER_TOKEN: 'model.kv_bytes_per_token',
  MODEL_KV_CACHE_TYPE: 'model.kv_cache_type',
  MODEL_FOOTPRINT_BYTES: 'model.footprint_bytes',
  MODEL_BUDGET_BYTES: 'model.budget_bytes',
  MODEL_SIZE_BYTES: 'model.size_bytes',
  EVICT_REASON: 'model.evict.reason',
} as const;

export type ModelSelectInfo = {
  modelId: string;
  provider: string;
  numCtx: number;
  paramsBillions?: number;
};

export type ModelLoadInfo = {
  weightsBytes: number;
  kvF16PerToken: number;
  kvEffectivePerToken: number;
  kvCacheType: string;
  chosenCtx: number;
  requestedCtx: number;
  footprintBytes: number;
  budgetBytes: number;
};

const tracer = () => trace.getTracer('agent');

async function inSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer().startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

export function withRunSpan<T>(runId: string, task: string, fn: () => Promise<T>): Promise<T> {
  return inSpan('agent.run', async (span) => {
    span.setAttribute(ATTR.RUN_ID, runId);
    if (recordIoEnabled()) span.setAttribute(ATTR.TASK, task);
    return fn();
  });
}

export function setRunOutcome(result: {
  kind: string;
  message?: string;
  missingCapability?: string;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttribute(ATTR.OUTCOME, result.kind);
  if (result.kind === 'gap' && result.missingCapability) {
    span.setAttribute(ATTR.GAP_MISSING, result.missingCapability);
  }
  if (result.kind === 'resource') {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: result.message ?? 'resource error',
    });
  }
}

export function withDelegationSpan<T>(target: string, fn: () => Promise<T>): Promise<T> {
  return inSpan('agent.delegation', async (span) => {
    span.setAttribute(ATTR.DELEGATION_TARGET, target);
    return fn();
  });
}

export function recordModelSelect(info: ModelSelectInfo): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('agent.model.select', {
    [ATTR.MODEL_ID]: info.modelId,
    [ATTR.MODEL_PROVIDER]: info.provider,
    'gen_ai.system': info.provider,
    [ATTR.MODEL_NUM_CTX]: info.numCtx,
    ...(info.paramsBillions !== undefined
      ? { [ATTR.MODEL_PARAMS_B]: info.paramsBillions }
      : {}),
  });
}

export function withModelLoadSpan<T>(
  modelId: string,
  info: ModelLoadInfo,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('agent.model.load', async (span) => {
    span.setAttribute(ATTR.MODEL_ID, modelId);
    span.setAttribute(ATTR.MODEL_WEIGHTS_BYTES, info.weightsBytes);
    span.setAttribute(ATTR.MODEL_KV_F16_PER_TOKEN, info.kvF16PerToken);
    span.setAttribute(ATTR.MODEL_KV_BYTES_PER_TOKEN, info.kvEffectivePerToken);
    span.setAttribute(ATTR.MODEL_KV_CACHE_TYPE, info.kvCacheType);
    span.setAttribute(ATTR.MODEL_NUM_CTX, info.chosenCtx);
    span.setAttribute(ATTR.MODEL_REQUESTED_CTX, info.requestedCtx);
    span.setAttribute(ATTR.MODEL_FOOTPRINT_BYTES, info.footprintBytes);
    span.setAttribute(ATTR.MODEL_BUDGET_BYTES, info.budgetBytes);
    return fn();
  });
}

export function recordEvict(modelId: string, sizeBytes: number, reason: string): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('agent.model.evict', {
    [ATTR.MODEL_ID]: modelId,
    [ATTR.MODEL_SIZE_BYTES]: sizeBytes,
    [ATTR.EVICT_REASON]: reason,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry/spans.test.ts`
Expected: PASS (2 tests; confirms Bun ALS parent/child nesting works).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/telemetry/spans.ts tests/telemetry/spans.test.ts`
```bash
git add src/telemetry/spans.ts tests/telemetry/spans.test.ts
git commit -m "feat(telemetry): semantic span helpers + ATTR keys (run/delegation/model)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `run-trace.ts` — reader + tree builder + summary

**Files:**
- Create: `src/run/run-trace.ts`
- Test: `tests/run/run-trace.test.ts`

**Interfaces:**
- Consumes: `type SpanRecord` (Task 1), `ATTR` (Task 3).
- Produces:
  - `readSpans(runDir: string): Promise<{ spans: SpanRecord[]; malformed: number }>`;
  - `type TraceNode = { span: SpanRecord; children: TraceNode[] }`;
  - `buildTree(spans: SpanRecord[]): TraceNode[]`;
  - `type RunSummary = { id: string; startMs: number; durationMs: number; outcome: string; models: string[] }`;
  - `summarizeRun(runsRoot: string, id: string): Promise<RunSummary | undefined>`.

- [ ] **Step 1: Write the failing test**

Create `tests/run/run-trace.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';
import {
  buildTree,
  readSpans,
  summarizeRun,
} from '../../src/run/run-trace.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return {
    kind: 0,
    traceId: 't1',
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 1_000_000,
    durationMs: 1,
    status: { code: 0 },
    attributes: {},
    events: [],
    ...p,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rt-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('buildTree links children to parents and sorts by start time', () => {
  const spans = [
    span({ name: 'agent.run', spanId: 'a', startUnixNano: 0 }),
    span({ name: 'agent.delegation', spanId: 'c', parentSpanId: 'a', startUnixNano: 20 }),
    span({ name: 'ai.generateText', spanId: 'b', parentSpanId: 'a', startUnixNano: 10 }),
  ];
  const tree = buildTree(spans);
  expect(tree).toHaveLength(1);
  expect(tree[0]?.span.name).toBe('agent.run');
  expect(tree[0]?.children.map((c) => c.span.name)).toEqual([
    'ai.generateText',
    'agent.delegation',
  ]);
});

test('buildTree promotes orphans (missing parent) to roots', () => {
  const tree = buildTree([
    span({ name: 'orphan', spanId: 'x', parentSpanId: 'missing' }),
  ]);
  expect(tree).toHaveLength(1);
  expect(tree[0]?.span.name).toBe('orphan');
});

test('readSpans parses good lines and counts malformed ones', async () => {
  const dir = join(root, 'run-1');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${JSON.stringify(span({ name: 'agent.run', spanId: 'a' }))}\nNOT JSON\n`,
  );
  const { spans, malformed } = await readSpans(dir);
  expect(spans).toHaveLength(1);
  expect(malformed).toBe(1);
});

test('summarizeRun derives outcome + models from the root and model attrs', async () => {
  const dir = join(root, 'run-2');
  await mkdir(dir, { recursive: true });
  const rootSpan = span({
    name: 'agent.run',
    spanId: 'a',
    durationMs: 42,
    attributes: { 'agent.outcome': 'answer' },
  });
  const loadSpan = span({
    name: 'agent.model.load',
    spanId: 'b',
    parentSpanId: 'a',
    attributes: { 'gen_ai.request.model': 'qwen3.5:9b' },
  });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${JSON.stringify(rootSpan)}\n${JSON.stringify(loadSpan)}\n`,
  );
  const s = await summarizeRun(root, 'run-2');
  expect(s?.outcome).toBe('answer');
  expect(s?.durationMs).toBe(42);
  expect(s?.models).toContain('qwen3.5:9b');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run/run-trace.test.ts`
Expected: FAIL — cannot resolve `run-trace.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/run/run-trace.ts`:
```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ATTR } from '../telemetry/spans.ts';
import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';

export async function readSpans(
  runDir: string,
): Promise<{ spans: SpanRecord[]; malformed: number }> {
  let raw: string;
  try {
    raw = await readFile(join(runDir, 'spans.jsonl'), 'utf8');
  } catch {
    return { spans: [], malformed: 0 };
  }
  const spans: SpanRecord[] = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      spans.push(JSON.parse(line) as SpanRecord);
    } catch {
      malformed += 1;
    }
  }
  return { spans, malformed };
}

export type TraceNode = { span: SpanRecord; children: TraceNode[] };

export function buildTree(spans: SpanRecord[]): TraceNode[] {
  const byId = new Map<string, TraceNode>();
  for (const s of spans) byId.set(s.spanId, { span: s, children: [] });
  const roots: TraceNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.span.parentSpanId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortByStart = (a: TraceNode, b: TraceNode) =>
    a.span.startUnixNano - b.span.startUnixNano;
  const sortDeep = (n: TraceNode) => {
    n.children.sort(sortByStart);
    for (const c of n.children) sortDeep(c);
  };
  roots.sort(sortByStart);
  for (const r of roots) sortDeep(r);
  return roots;
}

export type RunSummary = {
  id: string;
  startMs: number;
  durationMs: number;
  outcome: string;
  models: string[];
};

export async function summarizeRun(
  runsRoot: string,
  id: string,
): Promise<RunSummary | undefined> {
  const { spans } = await readSpans(join(runsRoot, id));
  if (spans.length === 0) return undefined;
  const root = spans.find((s) => s.name === 'agent.run');
  const models = new Set<string>();
  for (const s of spans) {
    const m = s.attributes[ATTR.MODEL_ID];
    if (typeof m === 'string') models.add(m);
  }
  return {
    id,
    startMs: (root ?? spans[0])?.startUnixNano
      ? Math.round(((root ?? spans[0]) as SpanRecord).startUnixNano / 1e6)
      : 0,
    durationMs: root?.durationMs ?? 0,
    outcome:
      typeof root?.attributes[ATTR.OUTCOME] === 'string'
        ? (root.attributes[ATTR.OUTCOME] as string)
        : 'unknown',
    models: [...models],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/run/run-trace.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/run/run-trace.ts tests/run/run-trace.test.ts`
```bash
git add src/run/run-trace.ts tests/run/run-trace.test.ts
git commit -m "feat(run): span reader + trace tree builder + run summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `render-trace.ts` — pure string renderers

**Files:**
- Create: `src/cli/render-trace.ts`
- Test: `tests/cli/render-trace.test.ts`

**Interfaces:**
- Consumes: `type TraceNode`, `type RunSummary` (Task 4); `ATTR` (Task 3).
- Produces: `renderTimeline(tree: TraceNode[]): string`; `renderRunList(runs: RunSummary[]): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/cli/render-trace.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';
import type { TraceNode } from '../../src/run/run-trace.ts';
import { renderRunList, renderTimeline } from '../../src/cli/render-trace.ts';

function node(name: string, attrs: Record<string, unknown>, children: TraceNode[] = []): TraceNode {
  const span: SpanRecord = {
    name,
    kind: 0,
    traceId: 't',
    spanId: name,
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 1_000_000,
    durationMs: 5,
    status: { code: 0 },
    attributes: attrs,
    events: [],
  };
  return { span, children };
}

test('renderTimeline indents children and shows model + duration', () => {
  const tree = [
    node('agent.run', { 'agent.outcome': 'answer' }, [
      node('agent.delegation', { 'agent.delegation.target': 'file_qa' }, [
        node('agent.model.load', { 'gen_ai.request.model': 'qwen3.5:9b' }),
      ]),
    ]),
  ];
  const out = renderTimeline(tree);
  expect(out).toContain('agent.run');
  expect(out).toContain('answer');
  expect(out).toContain('file_qa');
  expect(out).toContain('qwen3.5:9b');
  // child is indented deeper than parent
  const runLine = out.split('\n').find((l) => l.includes('agent.run')) ?? '';
  const loadLine = out.split('\n').find((l) => l.includes('agent.model.load')) ?? '';
  expect(loadLine.indexOf('agent.model.load')).toBeGreaterThan(
    runLine.indexOf('agent.run'),
  );
});

test('renderRunList lists newest-first with id, outcome, duration', () => {
  const out = renderRunList([
    { id: 'run-2', startMs: 200, durationMs: 5, outcome: 'answer', models: ['m'] },
    { id: 'run-1', startMs: 100, durationMs: 9, outcome: 'gap', models: [] },
  ]);
  const lines = out.split('\n').filter((l) => l.includes('run-'));
  expect(lines[0]).toContain('run-2'); // newest first
  expect(out).toContain('answer');
  expect(out).toContain('gap');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/render-trace.test.ts`
Expected: FAIL — cannot resolve `render-trace.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/render-trace.ts`:
```typescript
import { ATTR } from '../telemetry/spans.ts';
import type { RunSummary, TraceNode } from '../run/run-trace.ts';

function spanLabel(node: TraceNode): string {
  const a = node.span.attributes;
  const bits: string[] = [`${node.span.name} (${node.span.durationMs}ms)`];
  const model = a[ATTR.MODEL_ID];
  if (typeof model === 'string') bits.push(model);
  const target = a[ATTR.DELEGATION_TARGET];
  if (typeof target === 'string') bits.push(`→ ${target}`);
  const outcome = a[ATTR.OUTCOME];
  if (typeof outcome === 'string') bits.push(`[${outcome}]`);
  const inTok = a['gen_ai.usage.input_tokens'];
  const outTok = a['gen_ai.usage.output_tokens'];
  if (typeof inTok === 'number' || typeof outTok === 'number') {
    bits.push(`tok ${inTok ?? '?'}/${outTok ?? '?'}`);
  }
  if (node.span.status.code === 2) bits.push('ERROR');
  return bits.join('  ');
}

function renderNode(node: TraceNode, depth: number, lines: string[]): void {
  lines.push(`${'  '.repeat(depth)}${spanLabel(node)}`);
  for (const child of node.children) renderNode(child, depth + 1, lines);
}

export function renderTimeline(tree: TraceNode[]): string {
  const lines: string[] = [];
  for (const root of tree) renderNode(root, 0, lines);
  return lines.join('\n');
}

export function renderRunList(runs: RunSummary[]): string {
  const sorted = [...runs].sort((a, b) => b.startMs - a.startMs);
  const lines = sorted.map(
    (r) =>
      `${r.id}\t${r.outcome}\t${r.durationMs}ms\t${r.models.join(',') || '-'}`,
  );
  return ['RUN\tOUTCOME\tDURATION\tMODELS', ...lines].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/render-trace.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/cli/render-trace.ts tests/cli/render-trace.test.ts`
```bash
git add src/cli/render-trace.ts tests/cli/render-trace.test.ts
git commit -m "feat(cli): pure trace timeline + run-list renderers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `runs.ts` CLI + `runs` script

**Files:**
- Create: `src/cli/runs.ts`
- Modify: `package.json` (scripts)
- Test: `tests/cli/runs.test.ts`

**Interfaces:**
- Consumes: `readSpans`, `buildTree`, `summarizeRun` (Task 4); `renderTimeline`, `renderRunList` (Task 5).
- Produces: `listRuns(runsRoot: string): Promise<string>`; `renderRun(runsRoot: string, id: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `tests/cli/runs.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';
import { listRuns, renderRun } from '../../src/cli/runs.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return {
    kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0,
    endUnixNano: 1_000_000, durationMs: 3, status: { code: 0 },
    attributes: {}, events: [], ...p,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'runs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(id: string, spans: SpanRecord[]): Promise<void> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
}

test('renderRun shows the timeline for a run', async () => {
  await writeRun('run-1', [
    span({ name: 'agent.run', spanId: 'a', attributes: { 'agent.outcome': 'answer' } }),
  ]);
  const out = await renderRun(root, 'run-1');
  expect(out).toContain('agent.run');
  expect(out).toContain('answer');
});

test('renderRun reports a clear message when the run is missing', async () => {
  const out = await renderRun(root, 'nope');
  expect(out.toLowerCase()).toContain('no spans');
});

test('listRuns lists runs found under the root', async () => {
  await writeRun('run-1', [span({ name: 'agent.run', spanId: 'a' })]);
  const out = await listRuns(root);
  expect(out).toContain('run-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/runs.test.ts`
Expected: FAIL — cannot resolve `runs.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/runs.ts`:
```typescript
import { readdir } from 'node:fs/promises';
import { buildTree, readSpans, summarizeRun } from '../run/run-trace.ts';
import type { RunSummary } from '../run/run-trace.ts';
import { renderRunList, renderTimeline } from './render-trace.ts';

function runsRootDir(): string {
  return process.env.AGENT_RUNS_ROOT ?? 'runs';
}

export async function renderRun(runsRoot: string, id: string): Promise<string> {
  const { spans, malformed } = await readSpans(join0(runsRoot, id));
  if (spans.length === 0) return `No spans for run '${id}'.`;
  const body = renderTimeline(buildTree(spans));
  return malformed > 0
    ? `${body}\n(${malformed} malformed span line(s) skipped)`
    : body;
}

export async function listRuns(runsRoot: string): Promise<string> {
  let ids: string[];
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return 'No runs found.';
  }
  const summaries: RunSummary[] = [];
  for (const id of ids) {
    const s = await summarizeRun(runsRoot, id);
    if (s) summaries.push(s);
  }
  if (summaries.length === 0) return 'No runs found.';
  return renderRunList(summaries);
}

// local join to avoid an extra import line churn in this file
import { join as join0 } from 'node:path';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const follow = args.includes('--follow');
  const id = args.find((a) => !a.startsWith('--'));
  const root = runsRootDir();
  if (!id) {
    console.log(await listRuns(root));
    return;
  }
  if (follow) {
    let last = '';
    const tick = async () => {
      const out = await renderRun(root, id);
      if (out !== last) {
        console.clear();
        console.log(out);
        last = out;
      }
    };
    await tick();
    const timer = setInterval(() => {
      void tick();
    }, 500);
    // Stop once the root run span has been written (run finished).
    const stopper = setInterval(async () => {
      const { spans } = await readSpans(join0(root, id));
      if (spans.some((s) => s.name === 'agent.run')) {
        clearInterval(timer);
        clearInterval(stopper);
        await tick();
      }
    }, 500);
    return;
  }
  console.log(await renderRun(root, id));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```
> Note: keep the `join` import at the top per organize-imports; the inline comment above is illustrative — place `import { join } from 'node:path';` with the other imports and use `join` (not `join0`). Biome's organize-imports will enforce ordering.

- [ ] **Step 4: Fix imports to satisfy Biome**

Move `import { join } from 'node:path';` to the top import block, replace `join0` usages with `join`, and remove the illustrative comment. Run: `bun run lint:file -- src/cli/runs.ts` → clean (organize-imports passes).

- [ ] **Step 5: Add the `runs` script**

Edit `package.json` `scripts`, add after `"discover"`:
```json
    "runs": "bun run src/cli/runs.ts"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/cli/runs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/cli/runs.ts`
```bash
git add src/cli/runs.ts package.json tests/cli/runs.test.ts
git commit -m "feat(cli): runs viewer (list + render + --follow) and bun run runs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire `runChat` (root span + telemetry lifecycle); retire `journal.ts`

**Files:**
- Modify: `src/cli/run-chat.ts`
- Delete: `src/run/journal.ts`, `tests/run/journal.test.ts`
- Test: `tests/cli/run-chat.test.ts` (update)

**Interfaces:**
- Consumes: `initRunTelemetry` (Task 2); `withRunSpan`, `setRunOutcome` (Task 3).
- Produces: `runChat` now writes `runs/<id>/spans.jsonl` (root `agent.run` span) and no longer writes `journal.jsonl`.

- [ ] **Step 1: Update the failing test**

Edit `tests/cli/run-chat.test.ts`. Add these tests (keep existing artifact assertions; remove any `journal.jsonl`/`readJournal` references if present):
```typescript
import { stat } from 'node:fs/promises';
import { readSpans } from '../../src/run/run-trace.ts';

test('runChat writes spans.jsonl with a root run span carrying the outcome', async () => {
  const result = await runChat({
    orchestrator: gapOrchestrator(),
    task: 'email my boss',
    runsRoot: root,
    runId: 'run-span',
  });
  expect(result.kind).toBe('gap');
  const { spans } = await readSpans(join(root, 'run-span'));
  const runSpan = spans.find((s) => s.name === 'agent.run');
  expect(runSpan).toBeDefined();
  expect(runSpan?.attributes['agent.outcome']).toBe('gap');
});

test('runChat no longer writes journal.jsonl', async () => {
  await runChat({
    orchestrator: gapOrchestrator(),
    task: 'x',
    runsRoot: root,
    runId: 'run-nojournal',
  });
  await expect(stat(join(root, 'run-nojournal', 'journal.jsonl'))).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/run-chat.test.ts`
Expected: FAIL — `spans.jsonl` not written / `agent.run` span absent.

- [ ] **Step 3: Rewrite `runChat`**

Replace the body of `src/cli/run-chat.ts`. New file:
```typescript
import { createRun, writeArtifact } from '../run/run-store.ts';
import { runOrchestrator } from '../core/orchestrator.ts';
import type { Agent } from '../core/agent-def.ts';
import type { OrchestratorResult } from '../core/orchestrator.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { setRunOutcome, withRunSpan } from '../telemetry/spans.ts';

export type ChatDeps = {
  orchestrator: Agent;
  task: string;
  runsRoot: string;
  runId: string;
  routerNumCtx?: number;
  capture?: ResourceCapture;
};

export async function runChat(deps: ChatDeps): Promise<OrchestratorResult> {
  const run = await createRun(deps.runsRoot, deps.runId);
  const tel = initRunTelemetry(run.dir);
  try {
    return await withRunSpan(deps.runId, deps.task, async () => {
      const result = await runOrchestrator(
        deps.orchestrator,
        deps.task,
        deps.routerNumCtx,
        deps.capture,
      );
      setRunOutcome(result);
      if (result.kind === 'answer') {
        await writeArtifact(run, 'answer.txt', result.text);
      } else if (result.kind === 'gap') {
        await writeArtifact(run, 'gap.txt', result.message);
      } else {
        await writeArtifact(run, 'resource.txt', result.message);
      }
      return result;
    });
  } finally {
    await tel.shutdown();
  }
}
```
> Verify the exact import paths/names for `runOrchestrator`, `OrchestratorResult`, `Agent`, `ResourceCapture`, `createRun`, `writeArtifact` against the current files before saving (they match today's `run-chat.ts` imports except `appendJournal`/`journal.ts` is removed).

- [ ] **Step 4: Delete the journal module**

Run:
```bash
git rm src/run/journal.ts tests/run/journal.test.ts
```
Then `grep -rn "journal" src/ tests/` → expect zero remaining imports of `journal.ts` (only `journal.jsonl`-string mentions, if any, should be gone too).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/run-chat.test.ts`
Expected: PASS (existing artifact tests + 2 new span tests).

- [ ] **Step 6: Full suite, typecheck, lint, commit**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all green (live tests skip if Ollama down).
```bash
git add src/cli/run-chat.ts tests/cli/run-chat.test.ts
git commit -m "feat(run): runChat emits OTel root span to spans.jsonl; retire journal.jsonl

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: AI-SDK telemetry — thread `functionId` + `experimental_telemetry`

**Files:**
- Modify: `src/core/agent.ts`, `src/core/agent-def.ts`
- Test: `tests/core/agent-telemetry.test.ts`

**Interfaces:**
- Consumes: `recordIoEnabled` (Task 2).
- Produces: `RunAgentInput` gains `functionId?: string`; `generateText` is called with `experimental_telemetry`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/agent-telemetry.test.ts`:
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
import { runDefinedAgent } from '../../src/core/agent-def.ts';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  trace.setGlobalTracerProvider(provider);
});
afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
});

test('runDefinedAgent emits an ai.generateText span tagged with the agent name', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
  const agent: Agent = {
    name: 'file_qa',
    description: 'answers from files',
    model,
    systemPrompt: 'you answer',
    tools: {},
  };
  await runDefinedAgent(agent, 'hello');
  const spans = exporter.getFinishedSpans();
  const gen = spans.find((s) => s.name.startsWith('ai.generateText'));
  expect(gen).toBeDefined();
  expect(gen?.attributes['ai.telemetry.functionId']).toBe('file_qa');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/agent-telemetry.test.ts`
Expected: FAIL — no `ai.generateText` span (telemetry not enabled yet).

- [ ] **Step 3: Add `functionId` to `RunAgentInput` and `experimental_telemetry` to `generateText`**

In `src/core/agent.ts`:
- Add to the `RunAgentInput` type: `functionId?: string;`
- Add `import { recordIoEnabled } from '../telemetry/provider.ts';`
- In the `generateText({ ... })` call, add:
```typescript
    experimental_telemetry: {
      isEnabled: true,
      functionId: input.functionId,
      recordInputs: recordIoEnabled(),
      recordOutputs: recordIoEnabled(),
    },
```

In `src/core/agent-def.ts`, in `runDefinedAgent`'s `runAgent({ ... })` call, add:
```typescript
    functionId: agent.name,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/agent-telemetry.test.ts`
Expected: PASS.
> If the attribute key differs in this AI-SDK build, inspect `gen?.attributes` (log it) and assert the actual functionId key; per v6 docs it is `ai.telemetry.functionId`.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/core/agent.ts src/core/agent-def.ts tests/core/agent-telemetry.test.ts`
```bash
git add src/core/agent.ts src/core/agent-def.ts tests/core/agent-telemetry.test.ts
git commit -m "feat(core): enable AI-SDK experimental_telemetry with per-agent functionId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

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
