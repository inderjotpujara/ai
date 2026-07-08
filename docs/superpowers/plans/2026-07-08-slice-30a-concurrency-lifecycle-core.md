# Slice 30a — Concurrency & Lifecycle Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine correct and safe when driven as a long-lived process running multiple concurrent, cancellable runs — collision-free run IDs, per-run (not process-global) telemetry, cooperative cancellation, signal-clean shutdown with a central child registry, concurrency-safe stores, and schema migrations.

**Architecture:** These are surgical changes to the existing engine, not new subsystems (except three tiny modules: `src/run/run-id.ts`, `src/telemetry/run-router.ts`, `src/process/`, `src/db/migrate.ts`). The single root cause being fixed: the engine assumes *one run per process that exits when done*; the coming web UI (Slice 30b) is *many runs in one long-lived process*. The keystone is Task 2 (per-run telemetry via a routing span-processor keyed on OTel context) — everything else is independent.

**Tech Stack:** Bun + TypeScript (ESM, `.ts` import extensions), `bun:test`, `bun:sqlite`, `@opentelemetry/*` (already deps), Biome, AI SDK v6.

## Global Constraints

- **Runtime/tooling:** Bun only (never npm). Tests are `bun test`. Lint/format is Biome (`bun run lint`). Typecheck `bun run typecheck`. The full gate is `bun run check` (docs:check · typecheck · lint · test).
- **AI SDK stays v6** — do not touch `ai`/`@ai-sdk/*` versions.
- **Code style:** prefer `type` over `interface`; `enum` for finite named sets; early returns; small focused files; descriptive names; no leftover `console.log`. `.ts` import specifiers include the extension.
- **"Compute live; env vars are fallback-only"** — never hardcode budgets/limits; read `process.env` with a computed default (mirror `src/reliability/config.ts`'s `envNumber` pattern).
- **Docs hard line:** any `src/**` change requires a `docs/architecture.md` update in the same push (pre-push hook enforces). This plan's doc updates land in the final task.
- **Commits:** conventional format, subject `type(scope): summary`. Commit after each task's tests pass. Do not push/PR without explicit user confirmation.
- **Test conventions (mirror existing):** `MockLanguageModelV3` from `ai/test` with `doGenerate` returning `{ content, finishReason: {unified, raw}, usage, warnings }`; temp dirs via `mkdtemp(join(tmpdir(), 'prefix-'))` cleaned in `afterEach` with `rm(dir, {recursive:true, force:true})`; injected fakes + `mock()` over real runtimes; telemetry read back from `spans.jsonl` on disk or via `tests/helpers/otel-test-provider.ts`.

---

### Task 1: Collision-free run IDs

**Files:**
- Create: `src/run/run-id.ts`
- Create: `tests/run/run-id.test.ts`
- Modify: `src/cli/chat.ts:237` (replace `run-${process.pid}`)

**Interfaces:**
- Produces: `newRunId(now?: number, rand?: () => number): string` — a sortable, collision-free run id of the form `run-<base36 ms>-<base36 rand>` (e.g. `run-lz4k9c-a1b2c3`). Chronologically sortable by string compare within the same magnitude of ms.

- [ ] **Step 1: Write the failing test**

```ts
// tests/run/run-id.test.ts
import { describe, expect, test } from 'bun:test';
import { newRunId } from '../../src/run/run-id.ts';

describe('newRunId', () => {
  test('is unique across rapid calls in one process', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRunId()));
    expect(ids.size).toBe(1000);
  });
  test('is chronologically sortable by string compare', () => {
    const a = newRunId(1_000_000, () => 0.1);
    const b = newRunId(2_000_000, () => 0.1);
    expect(a < b).toBe(true);
  });
  test('has the run- prefix', () => {
    expect(newRunId()).toMatch(/^run-[0-9a-z]+-[0-9a-z]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run/run-id.test.ts`
Expected: FAIL — cannot resolve `../../src/run/run-id.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/run/run-id.ts
/** Collision-free, chronologically-sortable run id: run-<base36 ms>-<base36 rand>. */
export function newRunId(now: number = Date.now(), rand: () => number = Math.random): string {
  const ms = Math.floor(now).toString(36).padStart(9, '0');
  const r = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0');
  return `run-${ms}-${r}`;
}
```

- [ ] **Step 4: Wire it into chat.ts and run tests**

In `src/cli/chat.ts`: add `import { newRunId } from '../run/run-id.ts';` and change the `withMcpRun` options from `{ runsRoot: 'runs', runId: \`run-${process.pid}\` }` to `{ runsRoot: 'runs', runId: newRunId() }`.

Run: `bun test tests/run/run-id.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/run/run-id.ts tests/run/run-id.test.ts src/cli/chat.ts
git commit -m "fix(run): collision-free run ids (was run-<pid>, collides on concurrent runs)"
```

---

### Task 2: Per-run telemetry via a routing span-processor (kill the process-global provider)

**Files:**
- Create: `src/telemetry/run-router.ts`
- Create: `tests/telemetry/run-router.test.ts`
- Modify: `src/telemetry/provider.ts` (`initRunTelemetry` signature → `(runDir, runId)`, stop calling `trace.setGlobalTracerProvider` per run)
- Modify: `src/cli/with-mcp-run.ts` (pass `run.id`, wrap `body` in run context)
- Modify: `tests/telemetry/provider.test.ts` (update to the new signature)

**Interfaces:**
- Consumes: `buildProcessors(spansFilePath)` from `src/telemetry/provider.ts` (unchanged), `newRunId` (Task 1).
- Produces:
  - `ensureGlobalTelemetry(): void` — idempotently installs ONE global `BasicTracerProvider` + the single `RunRoutingSpanProcessor` + the async-hooks context manager.
  - `registerRun(runId: string, processors: SpanProcessor[]): void` / `unregisterRun(runId: string): Promise<void>` (flushes then removes).
  - `withRunContext<T>(runId: string, fn: () => T): T` — runs `fn` with `runId` bound into the active OTel context so every span emitted inside is routed to that run.
  - `initRunTelemetry(runDir: string, runId: string): { shutdown: () => Promise<void> }` (modified — now requires `runId`, no longer sets a global provider).

- [ ] **Step 1: Write the failing test (two overlapping runs stay isolated)**

```ts
// tests/telemetry/run-router.test.ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { trace } from '@opentelemetry/api';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';
import { readSpans } from '../../src/run/run-trace.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'router-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('two overlapping runs in one process write to separate spans.jsonl', async () => {
  const a = initRunTelemetry(join(root, 'A'), 'A');
  const b = initRunTelemetry(join(root, 'B'), 'B');
  // Interleave: emit a span under each run's context while both are open.
  withRunContext('A', () => trace.getTracer('t').startSpan('span-A').end());
  withRunContext('B', () => trace.getTracer('t').startSpan('span-B').end());
  await a.shutdown();
  await b.shutdown();
  const aSpans = (await readSpans(join(root, 'A'))).spans.map((s) => s.name);
  const bSpans = (await readSpans(join(root, 'B'))).spans.map((s) => s.name);
  expect(aSpans).toEqual(['span-A']);
  expect(bSpans).toEqual(['span-B']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/run-router.test.ts`
Expected: FAIL — `withRunContext` not exported / current global-provider design cross-contaminates (B's provider replaces A's), so both spans land in B (or A is empty).

- [ ] **Step 3: Implement the router**

```ts
// src/telemetry/run-router.ts
import { context, trace, createContextKey } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, type ReadableSpan, type Span, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const RUN_ID_KEY = createContextKey('agent.run.id');

/** Routes each span to the processors registered for the run active in its context. */
class RunRoutingSpanProcessor implements SpanProcessor {
  private readonly byRun = new Map<string, SpanProcessor[]>();
  private readonly spanRun = new WeakMap<ReadableSpan, string>();

  register(runId: string, procs: SpanProcessor[]) { this.byRun.set(runId, procs); }
  async unregister(runId: string) {
    const procs = this.byRun.get(runId);
    if (!procs) return;
    this.byRun.delete(runId);
    await Promise.all(procs.map((p) => p.forceFlush().catch(() => {})));
    await Promise.all(procs.map((p) => p.shutdown().catch(() => {})));
  }
  onStart(span: Span, parentContext: import('@opentelemetry/api').Context) {
    const runId = parentContext.getValue(RUN_ID_KEY) as string | undefined;
    if (runId) this.spanRun.set(span, runId);
  }
  onEnd(span: ReadableSpan) {
    const runId = this.spanRun.get(span);
    const procs = runId ? this.byRun.get(runId) : undefined;
    if (procs) for (const p of procs) p.onEnd(span);
  }
  async forceFlush() { for (const procs of this.byRun.values()) await Promise.all(procs.map((p) => p.forceFlush())); }
  async shutdown() { for (const runId of [...this.byRun.keys()]) await this.unregister(runId); }
}

let router: RunRoutingSpanProcessor | undefined;
let installed = false;

export function ensureGlobalTelemetry(): RunRoutingSpanProcessor {
  if (!installed) {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    router = new RunRoutingSpanProcessor();
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'local-agent-framework' }),
      spanProcessors: [router],
    });
    trace.setGlobalTracerProvider(provider);
    installed = true;
  }
  return router as RunRoutingSpanProcessor;
}

export function registerRun(runId: string, procs: SpanProcessor[]): void {
  ensureGlobalTelemetry().register(runId, procs);
}
export function unregisterRun(runId: string): Promise<void> {
  return ensureGlobalTelemetry().unregister(runId);
}
export function withRunContext<T>(runId: string, fn: () => T): T {
  return context.with(context.active().setValue(RUN_ID_KEY, runId), fn);
}
```

- [ ] **Step 4: Refactor `initRunTelemetry` onto the router**

In `src/telemetry/provider.ts`, replace the body of `initRunTelemetry` (keep `buildProcessors`/`recordIoEnabled` as-is):

```ts
import { registerRun, unregisterRun, ensureGlobalTelemetry } from './run-router.ts';

/** Register this run's processors on the shared router. No process-global swap. */
export function initRunTelemetry(runDir: string, runId: string): { shutdown: () => Promise<void> } {
  ensureGlobalTelemetry();
  registerRun(runId, buildProcessors(join(runDir, 'spans.jsonl')));
  return { shutdown: async () => { await unregisterRun(runId); } };
}
```

Then in `src/cli/with-mcp-run.ts`, change `const tel = initRunTelemetry(run.dir);` to `const tel = initRunTelemetry(run.dir, run.id);` and wrap the body call in run context:

```ts
  try {
    return await withRunContext(run.id, () => body({ run, reg, config, ledger }));
  } finally { /* ...existing teardown unchanged... */ }
```
(add `import { withRunContext } from '../telemetry/run-router.ts';`). Update `tests/telemetry/provider.test.ts` call sites to `initRunTelemetry(dir, 'run-x')` and wrap span emission in `withRunContext('run-x', () => ...)`.

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/telemetry/ tests/cli/run-chat.test.ts && bun run typecheck`
Expected: PASS — the two-overlapping-runs test passes; existing telemetry/run-chat tests still green (adjust any that relied on the old single-arg `initRunTelemetry`).

- [ ] **Step 6: Commit**

```bash
git add src/telemetry/run-router.ts src/telemetry/provider.ts src/cli/with-mcp-run.ts tests/telemetry/
git commit -m "fix(telemetry): per-run routing span-processor (was a process-global provider that cross-contaminated concurrent runs)"
```

---

### Task 3: Cooperative cancellation (AbortController) + wall-clock that actually aborts

**Files:**
- Modify: `src/reliability/timeout.ts` (`withWallClock` gains an optional external signal + aborts its own work on timeout)
- Modify: `src/cli/run-chat.ts` (`ChatDeps.signal?`, thread to `runOrchestrator`)
- Modify: `src/core/orchestrator.ts` (`runOrchestrator(..., signal?)` → `runDefinedAgent`)
- Modify: `src/core/agent-def.ts` (`runDefinedAgent` passes `signal` into `RunAgentInput.abortSignal`)
- Modify: `tests/reliability/timeout.test.ts`, `tests/cli/run-chat.test.ts`

**Interfaces:**
- Consumes: `RunAgentInput.abortSignal` (already exists, already forwarded into `generateText` — `src/core/agent.ts:53-84`).
- Produces:
  - `withWallClock<T>(ms, fn: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T>` — creates an internal `AbortController`, aborts it on timeout OR when `external` aborts, passes the signal to `fn`, still rejects `Error('timeout')` on expiry.
  - `runChat(deps: ChatDeps)` where `ChatDeps` gains `signal?: AbortSignal`.
  - `runOrchestrator(orchestrator, task, numCtx?, capture?, signal?)`.

- [ ] **Step 1: Write the failing tests**

```ts
// add to tests/reliability/timeout.test.ts
test('withWallClock aborts the work signal on timeout', async () => {
  let seen: AbortSignal | undefined;
  await expect(
    withWallClock(10, (signal) => new Promise((_, rej) => {
      seen = signal;
      signal.addEventListener('abort', () => rej(new Error('aborted-by-clock')));
    })),
  ).rejects.toThrow('timeout');
  expect(seen?.aborted).toBe(true);
});
test('withWallClock aborts when an external signal aborts', async () => {
  const ext = new AbortController();
  const p = withWallClock(10_000, (s) => new Promise((_, rej) => s.addEventListener('abort', () => rej(new Error('x')))), ext.signal);
  ext.abort();
  await expect(p).rejects.toThrow('x');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/reliability/timeout.test.ts`
Expected: FAIL — current `withWallClock(ms, fn)` takes a no-arg `fn` and never aborts.

- [ ] **Step 3: Implement**

```ts
// src/reliability/timeout.ts — replace withWallClock
export function withWallClock<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onExt = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExt, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, ms);
  });
  return Promise.race([fn(controller.signal), clock]).finally(() => {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExt);
  });
}
```

- [ ] **Step 4: Thread the signal through the call chain**

`src/core/agent.ts` `runAgent`: change the wall-clock call to pass the signal into `generateText` and honor an incoming `input.abortSignal`:

```ts
  const result = await withWallClock(runTimeoutMs(), (signal) =>
    generateText({
      /* ...unchanged... */
      abortSignal: input.abortSignal ?? signal,
    }),
    input.abortSignal,
  );
```

`src/cli/run-chat.ts`: add `signal?: AbortSignal;` to `ChatDeps`; pass `deps.signal` as the new 5th arg to `runOrchestrator`.
`src/core/orchestrator.ts`: add `signal?: AbortSignal` param to `runOrchestrator`; pass it into `runDefinedAgent(orchestrator, task, numCtx, undefined, signal)` (matching that function's arity).
`src/core/agent-def.ts`: `runDefinedAgent` forwards the signal into the `RunAgentInput.abortSignal` it builds.

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/reliability/timeout.test.ts tests/core/agent-abort.test.ts tests/core/agent-timeout.test.ts && bun run typecheck`
Expected: PASS (the existing abort/timeout tests still hold; new abort-on-timeout passes).

- [ ] **Step 6: Commit**

```bash
git add src/reliability/timeout.ts src/cli/run-chat.ts src/core/orchestrator.ts src/core/agent-def.ts src/core/agent.ts tests/reliability/timeout.test.ts
git commit -m "feat(reliability): cooperative cancellation — withWallClock aborts its work; thread AbortSignal run->orchestrator->agent"
```

---

### Task 4: Central child-process registry

**Files:**
- Create: `src/process/child-registry.ts`
- Create: `tests/process/child-registry.test.ts`
- Modify: `src/runtime/process-supervisor.ts`, `src/media/spawn.ts`, `src/voice/cli-io.ts`, `src/voice/transcribe.ts` (register spawned children)

**Interfaces:**
- Produces:
  - `registerChild(handle: { kill: (sig?: string) => void }): () => void` — adds a live child, returns an unregister fn (call on the child's own exit).
  - `killAllChildren(sig?: string): void` — best-effort kills every registered child (used by the signal handler in Task 5).
  - `childCount(): number` (for tests).

- [ ] **Step 1: Write the failing test**

```ts
// tests/process/child-registry.test.ts
import { expect, test } from 'bun:test';
import { registerChild, killAllChildren, childCount } from '../../src/process/child-registry.ts';

test('killAllChildren kills every registered child and respects unregister', () => {
  const killed: string[] = [];
  const off1 = registerChild({ kill: () => killed.push('a') });
  const off2 = registerChild({ kill: () => killed.push('b') });
  expect(childCount()).toBe(2);
  off2();                       // 'b' exited on its own
  killAllChildren('SIGTERM');
  expect(killed).toEqual(['a']); // only the still-live child is killed
  off1();
  expect(childCount()).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/process/child-registry.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/process/child-registry.ts
type Killable = { kill: (sig?: string) => void };
const live = new Set<Killable>();

/** Track a live child; call the returned fn when it exits so we don't kill a dead pid. */
export function registerChild(handle: Killable): () => void {
  live.add(handle);
  return () => { live.delete(handle); };
}
/** Best-effort terminate every tracked child (used on SIGINT/SIGTERM). */
export function killAllChildren(sig: string = 'SIGTERM'): void {
  for (const h of live) { try { h.kill(sig); } catch { /* already exited */ } }
  live.clear();
}
export function childCount(): number { return live.size; }
```

- [ ] **Step 4: Register at each long-lived spawn site**

In `src/runtime/process-supervisor.ts` `superviseServer` (after `const child = spawn(...)`): `const off = registerChild(child); child.onExit(() => off());`. Do the same in `src/media/generate/adapter.ts` (the `child` at line 176 — `const off = registerChild(child); child.onExit(() => off());` alongside the existing onExit), `src/voice/cli-io.ts` (the mic `child` — register, and call `off()` inside `stop()`), and `src/voice/transcribe.ts` `defaultNodeSpawn` (register `{ kill }`, unregister when `done` settles). Each site keeps its own existing kill logic; the registry is an additional safety net.

Run: `bun test tests/process/child-registry.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/process/child-registry.ts tests/process/child-registry.test.ts src/runtime/process-supervisor.ts src/media/generate/adapter.ts src/voice/cli-io.ts src/voice/transcribe.ts
git commit -m "feat(process): central child-process registry (foundation for signal-clean shutdown)"
```

---

### Task 5: Signal-clean shutdown

**Files:**
- Create: `src/process/lifecycle.ts`
- Create: `tests/process/lifecycle.test.ts`
- Modify: `src/cli/chat.ts` (install handlers in `main`)

**Interfaces:**
- Consumes: `killAllChildren` (Task 4).
- Produces:
  - `onShutdown(fn: () => void | Promise<void>): void` — register a teardown callback.
  - `installSignalHandlers(deps?: { on?: (sig: string, cb: () => void) => void; exit?: (code: number) => void }): void` — SIGINT/SIGTERM → run all `onShutdown` callbacks + `killAllChildren`, then exit. `deps` is injectable for tests.

- [ ] **Step 1: Write the failing test**

```ts
// tests/process/lifecycle.test.ts
import { expect, test } from 'bun:test';
import { installSignalHandlers, onShutdown } from '../../src/process/lifecycle.ts';
import { registerChild } from '../../src/process/child-registry.ts';

test('SIGINT runs teardown callbacks and kills children before exit', async () => {
  const events: string[] = [];
  let killed = false;
  registerChild({ kill: () => { killed = true; } });
  onShutdown(() => { events.push('teardown'); });
  const handlers: Record<string, () => void> = {};
  installSignalHandlers({ on: (sig, cb) => { handlers[sig] = cb; }, exit: () => { events.push('exit'); } });
  await handlers.SIGINT();
  expect(events).toEqual(['teardown', 'exit']);
  expect(killed).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/process/lifecycle.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/process/lifecycle.ts
import { killAllChildren } from './child-registry.ts';

const callbacks: Array<() => void | Promise<void>> = [];
export function onShutdown(fn: () => void | Promise<void>): void { callbacks.push(fn); }

export function installSignalHandlers(deps: {
  on?: (sig: string, cb: () => void) => void;
  exit?: (code: number) => void;
} = {}): void {
  const on = deps.on ?? ((sig, cb) => { process.on(sig as NodeJS.Signals, cb); });
  const exit = deps.exit ?? ((code) => process.exit(code));
  let shuttingDown = false;
  const handle = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const cb of callbacks) { try { await cb(); } catch { /* best-effort */ } }
    killAllChildren('SIGTERM');
    exit(130);
  };
  on('SIGINT', handle);
  on('SIGTERM', handle);
}
```

- [ ] **Step 4: Wire into chat.ts main**

In `src/cli/chat.ts` `main`, near the top, add `installSignalHandlers();` and register the manager teardown: `onShutdown(() => manager.unloadAll());` (import from `../process/lifecycle.ts`). Keep the existing `finally { await manager.unloadAll(); }` for the normal path (idempotent).

Run: `bun test tests/process/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/process/lifecycle.ts tests/process/lifecycle.test.ts src/cli/chat.ts
git commit -m "feat(process): SIGINT/SIGTERM handlers run teardown + kill tracked children (was: Ctrl-C orphaned every child)"
```

---

### Task 6: Concurrency-safe SQLite (WAL + busy_timeout)

**Files:**
- Modify: `src/memory/sqlite-store.ts:22-24` (constructor)
- Create: `tests/memory/sqlite-store-wal.test.ts`

**Interfaces:**
- Consumes/Produces: no signature change — `new SqliteStore(dbPath)` still, but the opened DB now runs in WAL with a busy timeout.

- [ ] **Step 1: Write the failing test**

```ts
// tests/memory/sqlite-store-wal.test.ts
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { SqliteStore } from '../../src/memory/sqlite-store.ts';

const DB = '/tmp/mem-wal-test.db';
afterEach(() => { try { rmSync(DB); rmSync(`${DB}-wal`); rmSync(`${DB}-shm`); } catch {} });

test('SqliteStore opens the database in WAL mode', () => {
  const s = new SqliteStore(DB);
  const mode = new Database(DB).query('PRAGMA journal_mode').get() as { journal_mode: string };
  expect(mode.journal_mode.toLowerCase()).toBe('wal');
  s.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/memory/sqlite-store-wal.test.ts`
Expected: FAIL — journal_mode is `delete` (default), not `wal`.

- [ ] **Step 3: Implement**

In `src/memory/sqlite-store.ts`, immediately after `this.db = new Database(dbPath);` add:

```ts
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA busy_timeout = 5000');
    this.db.run('PRAGMA foreign_keys = ON');
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/memory/ && bun run typecheck`
Expected: PASS (existing memory tests unaffected; WAL test passes).

- [ ] **Step 5: Commit**

```bash
git add src/memory/sqlite-store.ts tests/memory/sqlite-store-wal.test.ts
git commit -m "fix(memory): open sqlite in WAL + busy_timeout (concurrent web-server access was unsafe)"
```

---

### Task 7: Serialize model-manager admission (eviction lock)

**Files:**
- Modify: `src/resource/model-manager.ts` (wrap `ensureReady` body in a per-manager async mutex)
- Create: `tests/resource/model-manager-lock.test.ts`

**Interfaces:**
- Consumes: existing `createModelManager(deps)` → `{ ensureReady, unloadAll }` (unchanged signature).
- Produces: `ensureReady` calls are serialized per manager instance — no two concurrent calls interleave the listLoaded→evict→warm section.

- [ ] **Step 1: Write the failing test**

```ts
// tests/resource/model-manager-lock.test.ts
import { expect, mock, test } from 'bun:test';
import { createModelManager } from '../../src/resource/model-manager.ts';
import type { ModelDeclaration } from '../../src/core/types.ts';

function decl(model: string): ModelDeclaration {
  return { runtime: 'ollama', model, params: { numCtx: 4096 }, role: 'general',
    footprint: { approxParamsBillions: 1, bytesPerWeight: 1 } } as ModelDeclaration;
}

test('concurrent ensureReady calls are serialized (warm never overlaps)', async () => {
  let active = 0, maxActive = 0;
  const control = {
    isInstalled: mock(async () => true),
    listLoaded: mock(async () => []),
    pull: mock(async () => {}), unload: mock(async () => {}),
    getModelMax: mock(async () => 8192), getModelKvArch: mock(async () => undefined),
    embed: mock(async () => []),
    warm: mock(async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 20)); active--; }),
  };
  const m = createModelManager({ budgetBytes: 1e12, warn: () => {}, controlFor: () => control as never });
  await Promise.all([m.ensureReady(decl('a')), m.ensureReady(decl('b'))]);
  expect(maxActive).toBe(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/resource/model-manager-lock.test.ts`
Expected: FAIL — `maxActive` is 2 (both admissions interleave).

- [ ] **Step 3: Implement a tiny promise-chain mutex**

At the top of `createModelManager` (near the per-instance maps ~`:49`):

```ts
  let admissionLock: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = admissionLock.then(fn, fn);
    admissionLock = run.catch(() => {});
    return run;
  }
```

Rename the current `ensureReady` to `ensureReadyInner` and expose a wrapper:

```ts
  function ensureReady(decl: ModelDeclaration, opts: EnsureOpts = {}): Promise<number> {
    return serialize(() => ensureReadyInner(decl, opts));
  }
```

(`return { ensureReady, unloadAll };` stays.)

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/resource/ && bun run typecheck`
Expected: PASS (existing 25 model-manager tests still green; lock test passes).

- [ ] **Step 5: Commit**

```bash
git add src/resource/model-manager.ts tests/resource/model-manager-lock.test.ts
git commit -m "fix(resource): serialize model-manager admission (concurrent ensureReady raced eviction/VRAM budget)"
```

---

### Task 8: Schema migrations + embedder-mismatch guard

**Files:**
- Create: `src/db/migrate.ts`
- Create: `tests/db/migrate.test.ts`
- Modify: `src/memory/sqlite-store.ts` (run migrations instead of bare `CREATE TABLE IF NOT EXISTS`)
- Modify: `src/memory/store.ts:34` (`ensureSpace` embedder guard)
- Create: `tests/memory/ensure-space-guard.test.ts`

**Interfaces:**
- Consumes: `bun:sqlite` `Database`.
- Produces:
  - `migrate(db: Database, migrations: Migration[]): number` — applies migrations whose index ≥ `PRAGMA user_version`, bumps `user_version`, returns the new version. `type Migration = { name: string; up: (db: Database) => void }`.
  - `ensureSpace` now throws `MemoryError` when a space exists but its stored `embedModel` differs from the configured one (instead of silently returning the stale space).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/migrate.test.ts
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../../src/db/migrate.ts';

test('migrate applies pending migrations once and is idempotent', () => {
  const db = new Database(':memory:');
  const ms = [
    { name: 'init', up: (d: Database) => d.run('CREATE TABLE t (id INTEGER)') },
    { name: 'add-col', up: (d: Database) => d.run('ALTER TABLE t ADD COLUMN v TEXT') },
  ];
  expect(migrate(db, ms)).toBe(2);
  expect(migrate(db, ms)).toBe(2); // no-op second time
  const cols = db.query('PRAGMA table_info(t)').all() as { name: string }[];
  expect(cols.map((c) => c.name)).toEqual(['id', 'v']);
});
```

```ts
// tests/memory/ensure-space-guard.test.ts
import { afterEach, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { createMemoryStore } from '../../src/memory/store.ts';

const DIR = '/tmp/embguard-test';
afterEach(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

function deps(dim: number) {
  return { embedTexts: async () => [], embedQuery: async () => [],
    probe: async () => ({ dim, maxInput: 512 }) };
}
test('ensureSpace refuses a configured embedder that differs from the stored one', async () => {
  const a = createMemoryStore({ path: DIR, embedModel: 'model-a' }, deps(8));
  await a.remember('hello', { space: 'default' }); a.close();
  const b = createMemoryStore({ path: DIR, embedModel: 'model-b' }, deps(8));
  await expect(b.remember('again', { space: 'default' })).rejects.toThrow(/embedder/i);
  b.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/db/migrate.test.ts tests/memory/ensure-space-guard.test.ts`
Expected: FAIL — `migrate` missing; the guard test currently *passes silently corrupting* (no throw), so it fails the `rejects`.

- [ ] **Step 3: Implement the migration runner**

```ts
// src/db/migrate.ts
import type { Database } from 'bun:sqlite';
export type Migration = { name: string; up: (db: Database) => void };

/** Apply migrations past the DB's user_version, in order, in a transaction each. Returns new version. */
export function migrate(db: Database, migrations: Migration[]): number {
  const row = db.query('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  for (let i = version; i < migrations.length; i++) {
    const tx = db.transaction(() => { migrations[i].up(db); });
    tx();
    version = i + 1;
    db.run(`PRAGMA user_version = ${version}`);
  }
  return version;
}
```

- [ ] **Step 4: Use migrations in SqliteStore + add the guard**

In `src/memory/sqlite-store.ts`, replace the two `CREATE TABLE IF NOT EXISTS` calls with `migrate(this.db, MEMORY_MIGRATIONS)` where `MEMORY_MIGRATIONS` (module const) wraps the two existing `CREATE TABLE` statements as migration `up`s (v1). Import `migrate`.

In `src/memory/store.ts` `ensureSpace`, change the early return:

```ts
    const existing = sql.getSpace(space);
    if (existing) {
      if (existing.embedModel !== cfg.embedModel) {
        throw new MemoryError(
          `space '${space}' was built with embedder '${existing.embedModel}' but '${cfg.embedModel}' is configured — run 'memory reindex ${space} ${cfg.embedModel}' (destructive) or restore the original embedder.`,
        );
      }
      return existing;
    }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/db/ tests/memory/ && bun run typecheck`
Expected: PASS (existing memory tests unaffected — v1 migration reproduces the same schema).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrate.ts tests/db/migrate.test.ts src/memory/sqlite-store.ts src/memory/store.ts tests/memory/ensure-space-guard.test.ts
git commit -m "feat(db): user_version migration runner + memory embedder-mismatch guard (was silent corruption)"
```

---

### Task 9: Docs + full-suite gate (close the slice)

**Files:**
- Modify: `docs/architecture.md` (new subsystems + changed mechanisms)
- Modify: `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`

**Interfaces:** none (documentation + verification).

- [ ] **Step 1: Update architecture.md** — add sections for `src/run/run-id.ts`, `src/telemetry/run-router.ts` (per-run routing processor + run context), `src/process/` (child-registry + lifecycle signal handling), `src/db/migrate.ts`; update the telemetry section (no more process-global provider), the reliability section (`withWallClock` now aborts), the model-manager section (admission lock), and the memory section (WAL + migrations + embedder guard). Add the four new `src/` subsystems to the subsystem-registry table and the Mermaid module diagram.

- [ ] **Step 2: Update README + ROADMAP + ledger** — README status line + a ✅ Slice 30a row; ROADMAP flip the Slice 30a line to shipped; append the Slice 30a per-task entries to `.superpowers/sdd/progress.md`.

- [ ] **Step 3: Run the full gate**

Run: `bun run check`
Expected: PASS — docs:check green, typecheck clean, Biome clean, full `bun test` suite green.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(sdd): Slice 30a concurrency/lifecycle core — architecture, README, ROADMAP, ledger"
```

---

## Self-Review

**Spec coverage (vs the 30a spec F1–F6):** F1 run-ids → Task 1 ✓. F2 per-run telemetry → Task 2 ✓. F3 cancellation + wall-clock-aborts → Task 3 ✓. F4 signals + child registry → Tasks 4+5 ✓. F5 store concurrency (WAL) + manager eviction lock → Tasks 6+7 ✓. F6 migrations + embedder guard → Task 8 ✓. (F7 logger, F8 config, F9 status/start/version, F10 error boundary, F11 usage, and the CI pipeline are **Plan 2 — Ops Surface**, by the deliberate split noted at top.)

**Placeholder scan:** no TBD/TODO; every code step shows real code; every command has an expected result.

**Type consistency:** `newRunId` (T1) used verbatim in T2 tests; `withRunContext`/`initRunTelemetry(dir, runId)` consistent across T2 + its provider/with-mcp-run edits; `withWallClock(ms, fn(signal), external?)` signature consistent T3; `registerChild`/`killAllChildren` consistent T4→T5; `migrate(db, migrations)` consistent T8. `RunAgentInput.abortSignal` reused (already exists) rather than renamed.

**Note for the implementer:** Task 2 is the keystone and the riskiest — land and verify its two-overlapping-runs test before proceeding; the other tasks are independent and can be done in any order after it.
