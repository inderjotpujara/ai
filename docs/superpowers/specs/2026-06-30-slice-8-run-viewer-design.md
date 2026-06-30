# Slice 8 — Phase A Run-viewer (OpenTelemetry run tracing + terminal viewer) — design

**Date:** 2026-06-30
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 1 (run store), Slice 2 (orchestrator + delegation), Slice 4–7 (Model Manager: selection, footprint, dynamic context, KV-cache type)
**Feeds:** Phase A telemetry + eval harness (RAGAS-style scoring); Phase B (debugging surface for workflows/crews/agent-builder when they misroute); Phase F (TUI/local web UI = the visual layer over this data layer)

---

## 1. Problem & goal

The roadmap calls Phase A Run-viewer "renders the JSONL journals we **already write** — timeline of delegations, gaps, model loads, artifacts." But what we *already write* is **thin**: `src/run/journal.ts` appends only a `start` event and exactly **one** terminal event (`answer` | `gap` | `resource`) per run (`runs/<runId>/journal.jsonl`). The data that makes a run worth debugging — **delegations** (`delegate_to_*`), **model selection / load / eviction** (KV sizing, footprint, evictions), per-step **tool calls** and **token usage** — is computed *live* during a run and then **discarded** (it lives transiently in `generateText`'s `steps`, the select-hook `notify`, and the resource-capture seam).

So this slice is **instrument + render**, in that order:
1. **Instrument** the run as an **OpenTelemetry trace** — a span tree capturing the delegations, model lifecycle, agent turns, tool calls, and token usage.
2. **Render** it with a **terminal viewer** (`bun run runs`) — list runs, render one as a timeline tree, and `--follow` a live run.

**Hard constraint (user-mandated): follow OpenTelemetry**, so that *any* OSS observability backend (Jaeger, Grafana Tempo, Honeycomb, Arize Phoenix, …) can be plugged in later without re-instrumenting. The local terminal viewer reads a local span file; the **same spans** can be shipped over OTLP to any backend by adding an exporter — no code change in the instrumented call paths.

### Validated facts driving the design (researched 2026-06-30, current sources)
- Repo runs **`ai@6.0.214` (AI SDK v6 GA)** on **Bun**; **`@opentelemetry/api@1.9.0` is already a transitive dep**. ⚠ The live ai-sdk.dev telemetry docs render the **v7-beta** model (`@ai-sdk/otel`, `registerTelemetry`) — **NOT** what v6 uses. Ground truth = AI SDK v6 source + installed `node_modules/ai/dist/index.d.ts`.
- **AI SDK telemetry is free spans:** `experimental_telemetry: { isEnabled, functionId, metadata, recordInputs, recordOutputs, tracer? }` on `generateText` → emits `ai.generateText` → `ai.generateText.doGenerate` → `ai.toolCall` spans into the **global** OTel TracerProvider (or a passed `tracer`). Inner `*.doGenerate` spans carry **`gen_ai.*`** attributes (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`/`output_tokens`) plus `ai.usage.promptTokens`/`completionTokens`.
- **Bun-safe OTel setup (critical):** use **`BasicTracerProvider` + `AsyncLocalStorageContextManager` directly**. Do NOT use `NodeTracerProvider` / `@opentelemetry/auto-instrumentations-node` / `instrumentation-*` — Bun breaks Node module monkey-patching (`opendirSync` wrap error, bun#6546). AI SDK spans are created via the OTel API (not auto-instrumentation), so they export fine on Bun. `AsyncLocalStorage` nesting works on Bun; the known throughput cliff (bun#24324) is irrelevant for our few long-lived spans/run. Initialize the provider **programmatically at the top of the entry file** (no `--require`).
- **OTel JS is v2.x** — `ReadableSpan` gotchas to code against: `spanContext()` is a **method**; parent id is **`parentSpanContext?.spanId`** (was `parentSpanId`); `instrumentationScope` (was `instrumentationLibrary`); processors passed via **constructor `spanProcessors:[]`** (`addSpanProcessor()` removed). Use `SimpleSpanProcessor` for the local file (writes each span on `end()`), `BatchSpanProcessor` for OTLP.
- **OTLP plug-in path:** swapping/adding a backend = add a processor with `@opentelemetry/exporter-trace-otlp-proto` (OTLP/HTTP+protobuf; **avoid gRPC on Bun**, otel-js#5260). Jaeger (v1.35+/v2), Tempo, Honeycomb, Phoenix all ingest OTLP/HTTP natively.
- **`gen_ai.*` is still experimental** — `gen_ai.system` → `gen_ai.provider.name` mid-transition. The viewer reads `gen_ai.*` keys **generically** and tolerates both names.

### Locked decisions
1. **Architecture = OTel-native, global provider, thin `src/telemetry/` module** (Approach A). AI SDK spans nest under our manual spans via the active OTel context.
2. **Span set = root + delegation + model lifecycle** (manual); AI-SDK gives agent-turn / tool-call / token spans for free.
3. **`spans.jsonl` is canonical.** New `runs/<runId>/spans.jsonl` (one OTel span per line) is the viewer's single source of truth. **`journal.jsonl` is retired** (its `start`/`answer`/`gap`/`resource` semantics map onto the root span's start + status/attributes). Human-facing `answer.txt` / `gap.txt` / `resource.txt` artifacts **stay**.
4. **Viewer = terminal/CLI** (`bun run runs`), zero new UI deps; supports **`--follow`** (live-tail). Polished TUI/web stays in Phase F.
5. **OTLP seam is wired now**, env-gated (`AGENT_OTLP_ENDPOINT`) — the "plug in any OSS tool" promise is real and tested this slice (JSONL + OTLP processors run side-by-side).
6. **Telemetry is best-effort:** it never throws into the agent path; with no provider registered the AI SDK falls back to the no-op tracer (tests stay span-free unless they opt in).

---

## 2. Components

### 2.1 `src/telemetry/jsonl-exporter.ts` (new — local `SpanExporter`)
```ts
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { type ExportResult, ExportResultCode, hrTimeToMicroseconds } from '@opentelemetry/core';

/** Serialized span shape persisted to runs/<id>/spans.jsonl (one JSON per line). */
export type SpanRecord = {
  name: string;
  kind: number;                 // SpanKind enum
  traceId: string;
  spanId: string;
  parentSpanId: string | null;  // null ⇒ root
  startUnixNano: number;
  endUnixNano: number;
  durationMs: number;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  events: { name: string; timeUnixNano: number; attributes?: Record<string, unknown> }[];
};

/** Best-effort: append failure → ExportResultCode.FAILED, never throws into the run. */
export class JsonlFileExporter implements SpanExporter {
  constructor(filePath: string);
  export(spans: ReadableSpan[], done: (r: ExportResult) => void): void;
  shutdown(): Promise<void>;
}
```
Serialization notes: `s.spanContext()` is a method; parent = `s.parentSpanContext?.spanId ?? null`; `HrTime` `[s, ns]` → convert via `hrTimeToMicroseconds`.

### 2.2 `src/telemetry/provider.ts` (new — provider lifecycle + processor factory)
```ts
/** Build the processor list. JSONL always; OTLP added iff AGENT_OTLP_ENDPOINT is set. */
function buildProcessors(spansFilePath: string): SpanProcessor[];
//   → [ new SimpleSpanProcessor(new JsonlFileExporter(spansFilePath)),
//       ...(otlpEndpoint ? [ new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpEndpoint })) ] : []) ]

/** Register a per-run BasicTracerProvider (resource service.name=local-agent-framework)
 *  + a once-guarded global AsyncLocalStorageContextManager. Idempotent for tests. */
export function initRunTelemetry(runDir: string): { shutdown: () => Promise<void> };

/** Whether IO (prompt/response/tool args) is recorded. Default true; AGENT_TELEMETRY_RECORD_IO=0 disables. */
export function recordIoEnabled(): boolean;
```
- Context manager registered **once per process** (module-level guard; re-`enable()` is a no-op). Provider is per-run; `setGlobalTracerProvider` per run; `shutdown()` flushes all processors (so `spans.jsonl` is complete and OTLP is drained).
- One run = one OS process (`run-<PID>`), so per-run provider is correct and simple.

### 2.3 `src/telemetry/spans.ts` (new — semantic helpers + attribute keys)
```ts
export const ATTR = {
  RUN_ID: 'agent.run.id',
  TASK: 'agent.task',
  OUTCOME: 'agent.outcome',                  // 'answer' | 'gap' | 'resource'
  GAP_MISSING: 'agent.gap.missing_capability',
  DELEGATION_TARGET: 'agent.delegation.target',
  // model.* (manager story) + gen_ai.* (standard, read generically)
  MODEL_ID: 'gen_ai.request.model',
  MODEL_PROVIDER: 'gen_ai.provider.name',    // also set legacy gen_ai.system
  MODEL_SIZE_BYTES: 'model.size_bytes',
  MODEL_NUM_CTX: 'model.num_ctx',
  MODEL_KV_BYTES_PER_TOKEN: 'model.kv_bytes_per_token',
  MODEL_FOOTPRINT_BYTES: 'model.footprint_bytes',
  MODEL_KV_CACHE_TYPE: 'model.kv_cache_type',
  EVICT_REASON: 'model.evict.reason',
} as const;

/** Open the root run span; sets outcome attrs from the OrchestratorResult; ends on return/throw. */
export function withRunSpan<T>(runId: string, task: string, fn: () => Promise<T>): Promise<T>;
/** Open a delegation span (active context) so the sub-agent's AI-SDK spans nest under it. */
export function withDelegationSpan<T>(target: string, fn: () => Promise<T>): Promise<T>;
/** Record model selection as a span event on the current span (instantaneous). */
export function recordModelSelect(info: ModelSelectInfo): void;
/** Wrap a model load (has duration) in a child span. */
export function withModelLoadSpan<T>(modelId: string, fn: () => Promise<T>): Promise<T>;
/** Record an eviction (reason) as an event on the current span. */
export function recordEvict(modelId: string, reason: string): void;
```
All helpers are **no-ops-safe**: if no real provider is registered they use the API's no-op tracer and add ~nothing.

### 2.4 `src/run/run-trace.ts` (new — reader + tree builder, viewer side, pure)
```ts
export function readSpans(runDir: string): Promise<SpanRecord[]>;     // parse spans.jsonl; skip malformed lines (count them)
export type TraceNode = { span: SpanRecord; children: TraceNode[] };
export function buildTree(spans: SpanRecord[]): TraceNode[];          // group by traceId, link via parentSpanId, sort by start; orphans → roots
export type RunSummary = { id: string; startMs: number; durationMs: number; outcome: string; models: string[] };
export function summarizeRun(runDir: string): Promise<RunSummary>;    // from the root span + model spans
```

### 2.5 `src/cli/render-trace.ts` (new — pure tree → lines, snapshot-testable)
```ts
export function renderTimeline(tree: TraceNode[]): string;            // indented tree: name · durationMs · key attrs (model/tokens/outcome)
export function renderRunList(runs: RunSummary[]): string;            // newest-first table
```

### 2.6 `src/cli/runs.ts` (new — CLI entry)
- `bun run runs` → list all runs (newest-first) via `renderRunList`.
- `bun run runs <runId>` → `renderTimeline(buildTree(await readSpans(dir)))`.
- `bun run runs <runId> --follow` → poll/tail `spans.jsonl`, re-render as spans complete (root appears last); plain `console.log`, matches existing CLI style (`process.argv`, no CLI lib).

### 2.7 Wiring edits (existing files)
- `src/cli/chat.ts` — `const tel = initRunTelemetry(runDir)` before the run; `await tel.shutdown()` in a `finally`.
- `src/cli/run-chat.ts` — wrap orchestrator in `withRunSpan(runId, task, …)`; set outcome attrs from `OrchestratorResult`; **remove `appendJournal` calls**; keep `writeArtifact` (`answer/gap/resource.txt`).
- `src/core/agent.ts` / `src/core/agent-def.ts` — add `experimental_telemetry: { isEnabled: true, functionId: <agentName>, recordInputs: recordIoEnabled(), recordOutputs: recordIoEnabled() }` to the `generateText` call(s).
- `src/core/delegate.ts` — wrap `asDelegateTool` `execute` body in `withDelegationSpan(agent.name, …)`.
- `src/cli/select-hook.ts` — in `notify`, call `recordModelSelect(...)` with the resolved model + footprint/ctx/kv-type.
- **Model manager** (loads/evicts) — `withModelLoadSpan(...)` around a load; `recordEvict(...)` on eviction. *(Exact file + lines pinned during planning via a quick targeted read.)*

### 2.8 Retirements
- **Delete** `src/run/journal.ts` and `tests/run/journal.test.ts` (superseded by `spans.jsonl`).
- Update `tests/cli/run-chat.test.ts` to assert spans-based behavior (root-span outcome; no `journal.jsonl`; artifacts intact).

### 2.9 New dependencies
`@opentelemetry/api` (promote to direct), `@opentelemetry/sdk-trace-base`, `@opentelemetry/context-async-hooks`, `@opentelemetry/core`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@opentelemetry/exporter-trace-otlp-proto`. Pin `semantic-conventions` (experimental `gen_ai.*` names).

---

## 3. Span model (trace shape)

```
agent.run                          root · agent.run.id, agent.task, agent.outcome=answer|gap|resource, agent.gap.missing_capability?
└─ ai.generateText (router)        AI SDK (free) · functionId=router
   └─ ai.toolCall delegate_to_X    AI SDK (free) · tool args/result
      └─ agent.delegation          ours · agent.delegation.target=X
         ├─ (event) agent.model.select   resolved model id/provider/size/num_ctx/kv_bytes_per_token/footprint/kv_cache_type
         ├─ agent.model.load       ours · duration of load (when manager loads)
         ├─ (event) agent.model.evict    model + reason (when manager evicts under pressure)
         └─ ai.generateText (sub)  AI SDK (free) · functionId=<specialist>, gen_ai.* + token usage
```
Outcome → root span: `answer` ⇒ `OK` + `agent.outcome=answer`; `gap` ⇒ `OK` + `agent.outcome=gap` + `agent.gap.missing_capability`; `resource` ⇒ `ERROR` (status message) + `agent.outcome=resource`.

---

## 4. Error handling
- **Exporter** append/network failure → `ExportResultCode.FAILED`; the run is unaffected. Telemetry helpers swallow their own errors — tracing must never break a run.
- **Provider** re-init within one process is idempotent (guarded global context manager); `shutdown()` always called in `finally`.
- **Viewer:** malformed JSONL line → skipped, with a `"(N malformed span lines skipped)"` notice. Missing run dir / `spans.jsonl` → clear message, non-zero exit. Unclosed spans (live `--follow` or crashed run) → rendered with `(running…)` / no duration.
- **IO capture:** `recordInputs`/`recordOutputs` default **on** (local single-user, high debug value); `AGENT_TELEMETRY_RECORD_IO=0` disables (env is fallback-only, per project convention).

---

## 5. Testing (TDD)
- **Unit** — `JsonlFileExporter` (fake `ReadableSpan` → JSONL shape, append-failure path); `buildTree` (ordering, orphan promotion, malformed-line skipping); `renderTimeline`/`renderRunList` (snapshot); `provider` idempotency + actually writes a span file; `recordIoEnabled` env.
- **Bun ALS smoke** — register a `BasicTracerProvider` + `AsyncLocalStorageContextManager` + `ConsoleSpanExporter`/in-memory exporter, open parent → `await` → child, assert `child.parentSpanContext.spanId === parent.spanId` (validates Bun context propagation, which the research flagged as the one thing to verify).
- **Integration** — `run-chat` with a stubbed orchestrator: asserts root span with correct outcome attrs, **no `journal.jsonl`**, artifacts written; OTLP processor added iff `AGENT_OTLP_ENDPOINT` set (assert factory output, not a live endpoint).
- **Live (`*.live`, skipped unless Ollama up + models pulled)** — a real `chat` run produces `spans.jsonl` containing `agent.run` + `agent.delegation` + `agent.model.*` + `ai.generateText`/`ai.toolCall` spans; `bun run runs <id>` renders a non-empty timeline; `bun run runs` lists it.

---

## 6. Out of scope (future / later phases)
- Polished TUI / local web UI (Phase F — this slice is the data layer + a plain terminal renderer).
- Metrics/logs OTel signals (only **traces** this slice).
- Eval-harness / RAGAS faithfulness scoring (Phase A sister item, separate slice — but `gen_ai.*` token spans here are its substrate).
- Cross-process / distributed trace context propagation (single-process runs only).
- Shipping bundled OSS backends; we only emit OTLP — the user points it at their chosen backend.

---

## 7. Acceptance
- `bun run typecheck`, `bun run lint`, `bun test` all green (live tests skip cleanly when Ollama is down).
- A real run writes `runs/<id>/spans.jsonl`; `bun run runs` lists it; `bun run runs <id>` shows delegations + model loads + token usage; `--follow` updates live.
- Setting `AGENT_OTLP_ENDPOINT=http://localhost:4318/v1/traces` additionally streams the same spans to an OTLP backend with no code change.
- `journal.jsonl` is no longer written; `answer/gap/resource.txt` still are.
