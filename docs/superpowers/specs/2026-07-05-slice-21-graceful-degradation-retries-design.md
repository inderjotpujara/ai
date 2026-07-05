# Slice 21 — Graceful degradation + retries (design)

**Date:** 2026-07-05
**Phase:** A (reliability) — the **last Phase-A gap**. Reliability the Slice-24 daemon leans on.
**Branch:** `slice-21-graceful-degradation-retries`
**Status:** design approved (brainstorm), spec authored.

Grounding research (validated 2026-07-05 against primary sources — AI SDK docs/GitHub, LangGraph "Fault Tolerance" Jun 2026, Portkey Jul 2025, OTel gen_ai semconv, TianPan retry-budget Apr 2026): see memory `reference-graceful-degradation-retries-findings`. Builds on Slice 2 (orchestrator/delegation), Slice 3 (MCP mounts), Slice 8 (OTel spans), Slice 10/11 (workflow/crew engines), Slice 14 (provisioning supervisor `withRetry`/`StallWatchdog`).

---

## 1. Problem

A single dead dependency can still sink a run, and retry/timeout logic is duplicated 8 ways with no shared contract.

Concretely today:
- **No unified error taxonomy.** Every call site decides ad hoc whether to retry, and most retry nothing. There is no notion of "this error is transient (back off), this one means route elsewhere, this one is terminal (stop)."
- **Retry is fragmented.** The only reusable primitive is `provisioning/supervisor.ts` `withRetry`+`StallWatchdog`, used by 2 call sites that duplicate near-identical config. `verified-build` has its own `withWallClock`+`repairLoop`; both builders duplicate a `MAX_REGENERATIONS` loop; `agent-builder/deps.ts` hand-rolls retry-once-with-feedback; runtimes scatter `AbortSignal.timeout(1500)` literals; `verification/expand.ts` unrolls corrective retries into the graph. Exponential backoff + jitter exists in exactly one place.
- **Degradation is siloed and invisible to the user.** `selector.resolveModel` walks candidates best-first (implicit largest→smaller degrade); `select-hook.ts` degrades a non-Ollama runtime to Ollama via `fallbackModel`; `mcp/config.ts`+`mount.ts` degrade per-entry at load/mount; `workflow/engine.ts` has per-step `onError`. But when a specialist's dependency dies **mid-run**, `runGuardedAgent` returns a structured `{ error }` string that only the *model* sees — the **user is never told** "I dropped agent X because its MCP server was unreachable." There is no persisted, user-facing degradation record.
- **No circuit breaker.** A persistently-flaky MCP server is retried/hammered on every invocation and can stall a whole crew — the exact failure the charter calls out.

This slice adds one canonical **`src/reliability/`** layer (error-lane classification, retry with backoff+`Retry-After`, run/idle timeouts, a hand-rolled circuit breaker, a failure-domain-aware model-degradation chain, and a user-facing degradation ledger), wires it into delegation/workflow/crew/MCP/selector, and migrates the clear retry/timeout duplicates onto it — so a dead dependency **drops that agent/step and tells the user** instead of sinking the run.

## 2. Approved decisions (from brainstorming)

- **D1 — Scope = in-run reliability ONLY.** Everything that keeps a *single* run alive. Persistence / checkpointing / resume-after-crash / durable execution stays in **Slice 24** (daemon + resumable jobs); token-budgeted retries revisit when the **Slice 22** Codex cloud tier lands. These are chartered elsewhere, **not** deferred debt.
- **D2 — Circuit breaker = hand-rolled** (~closed/open/half-open state machine + a registry keyed by dependency id so breakers are *shared across invocations*). No new dependency (cockatiel rejected) per the zero-heavy-dep house style. Wraps cross-boundary deps only (MCP servers, remote tools, remote model daemons) — **not** in-process local calls.
- **D3 — Retry budget = attempt-cap + wall-clock**, plus an idle-timeout that resets on streamed/observed progress. **Not** token-budgeted (local = free compute; wall-clock covers the latency-compounding concern). All thresholds computed/env-overridable — hardcode nothing.
- **D4 — Consolidation = new module + migrate clear dupes.** Create `src/reliability/`; migrate the provisioning `withRetry`/`StallWatchdog`/`abortableSleep` and the two duplicated config blocks, `verified-build`'s `withWallClock`, and the scattered probe `AbortSignal.timeout` literals onto it. **Leave alone** the paradigm-different `verification/expand.ts` graph-unrolling and the builders' *regenerate-with-feedback* semantics (that is repair, not transport retry — though its mechanical loop may share a tiny helper).
- **D5 — Don't double-retry the LLM call; our `withRetry` is for cross-boundary ops we own.** AI SDK v6 already does exponential-backoff transport retry (`maxRetries: 2`) *inside* `generateText`. We do **not** wrap an LLM turn in a second backoff loop (multiplicative replay-storm anti-pattern) — a Transient error that *escapes* the SDK means transport retry is already exhausted, so we treat it as **route-worthy** (try a different model/runtime) or drop, never re-backoff. `reliability/withRetry` applies only to cross-boundary operations **we own and that are NOT behind the SDK**: MCP server mounts/tool calls, provisioning downloads (already), runtime `isAvailable()` probes, and direct HTTP (hf-client/catalogs). For the LLM turn we add only what the SDK misses: a **wall-clock `run_timeout`** (via the already-plumbed `abortSignal`) and **`Retry-After` respect** on the HTTP we retry ourselves. Structured-output regeneration stays a separate bounded loop (the existing repair/regen, not HTTP backoff).

## 3. Error taxonomy — the three lanes

A pure classifier, no new fields on error classes (errors keep extending `FrameworkError`):

```ts
export enum Lane {
  Transient,   // back off + retry
  RouteWorthy, // don't backoff — degrade/fallback/skip
  Terminal,    // fail fast — no retry, surface to user
}
export function classify(err: unknown): Lane
```

Mapping (by `instanceof` + AI SDK `APICallError` inspection + `finishReason`):

| Lane | Triggers |
|---|---|
| **Transient** | For **ops we own** (MCP/download/probe/direct-HTTP): `APICallError` with `isRetryable === true` (429/408/409/5xx/conn-reset per SDK), network `ECONNRESET`/`ETIMEDOUT`, abort due to *idle* stall (not user abort). **Note:** a Transient error that *escapes an LLM `generateText` call* is transport-retry-exhausted → treated as **RouteWorthy** by the delegation/workflow wiring, not re-backed-off (D5). |
| **RouteWorthy** | `ProviderError` (pull/warm/runtime unreachable); `ResourceError` (no fit); `CircuitOpenError` (new); `finishReason: 'content-filter'`; MLX/runtime `isAvailable()` false. |
| **Terminal** | 4xx client errors (400/401/403), zod/validation failures, `ToolError` for bad args / unknown tool, `MaxStepsError` (capability gap — already handled as `gap`), context-length-exceeded, hallucinated tool name. |

Classification is advisory data used by the retry/degrade/partial-failure wiring; it never itself throws. Unknown/unclassifiable → **Terminal** (fail safe — never silently retry the unknown).

## 4. Architecture — `src/reliability/`

Small, single-purpose modules (house style):

```
src/reliability/
  classify.ts   Lane enum + classify(err) — the taxonomy above.
  config.ts     Computed, env-fallback-only knobs: maxAttempts(), runTimeoutMs(),
                idleTimeoutMs(), breakerThreshold(), breakerCooldownMs(),
                breakerHalfOpenProbes(), retryBaseMs(), retryCapMs(), probeTimeoutMs().
  retry.ts      withRetry<T>(fn, opts) — full-jitter exp backoff, attempt-cap, AbortSignal,
                onRetry, retries ONLY Lane.Transient, respects Retry-After (parseRetryAfter()).
                Re-exports abortableSleep. (Moved+generalized from supervisor.ts.)
  timeout.ts    withWallClock(ms, fn)        — hard run_timeout (Promise.race; moved from dry-run.ts).
                withIdleTimeout(fn, { idleMs, onProgress }) — resets on progress heartbeat.
                IdleWatchdog                 — StallWatchdog generalized to any progress signal.
  breaker.ts    CircuitBreaker (Closed/Open/HalfOpen) + breakerFor(id) registry.
                run<T>(fn): throws CircuitOpenError when open; records success/failure.
  degrade.ts    degradeChain(primary, registry) — failure-domain-aware ordered fallbacks;
                nextOnRouteWorthy(err, chain) — advance without re-hitting a dead daemon.
                (Generalizes selector candidate-walk + select-hook MLX→Ollama.)
  ledger.ts     DegradationLedger — in-run record of degrade/drop/retry events; attached to the
                run context, persisted to run.dir, and surfaced to the user + telemetry.
  errors.ts     CircuitOpenError extends FrameworkError (RouteWorthy).
```

### 4.1 Circuit breaker (`breaker.ts`)
Trivial state machine: `Closed → (≥ breakerThreshold() consecutive failures) → Open → (after breakerCooldownMs()) → HalfOpen → (breakerHalfOpenProbes() successes) → Closed | (any failure) → Open`. `run(fn)` short-circuits with `CircuitOpenError` while Open. A **module-level registry** `breakerFor(id)` returns the shared breaker for a dependency id (MCP-server name, tool name, runtime kind) so correlated failures across many agent invocations trip *one* breaker — that is what stops a dead MCP server from stalling a crew. Injectable clock for deterministic tests. No timers required (cooldown checked lazily on `run`).

### 4.2 Degradation ledger (`ledger.ts`)
Follows the existing `ResourceCapture` pattern (a mutable per-run object threaded through and read back). Shape:

```ts
export enum DegradeKind { ModelDegraded, AgentDropped, ToolSkipped, Retried, CircuitOpen }
export type DegradeEvent = { kind: DegradeKind; subject: string; reason: string; detail?: string };
export type DegradationLedger = { events: DegradeEvent[]; record(e: DegradeEvent): void };
```

- Created per run, added to `McpRunContext` (`with-mcp-run.ts`) and passed alongside `ResourceCapture` into the hook/engines.
- Persisted to `run.dir/degradation.jsonl` via `writeArtifact` (mirrors `spans.jsonl`) so `runs` CLI can show it.
- **Surfaced to the user**: the CLI prints a concise "⚠ degraded: dropped agent X (MCP server Y unreachable); model A→B" summary after a run with any events (single mechanism satisfies both "tell the user" and silent-quality-regression detection).

## 5. Integration points (wiring)

- **`core/agent.ts` (`runAgent`)** — wrap the single `generateText` in `withWallClock(runTimeoutMs())` (belt to AI SDK's `abortSignal` timeout). **No** second backoff retry (D5). Non-streaming, so no token-idle timeout here.
- **`core/delegate.ts` (`runGuardedAgent`)** — on a caught cause: `classify(err)`; **RouteWorthy** (incl. Transient-escaping-SDK, per D5) → `degradeChain` (try fallback model/runtime) then, if exhausted, drop-and-record; **Terminal** → drop-and-record. The LLM turn is **not** re-backoff-retried here (D5). Every drop/degrade calls `ledger.record(...)`. Still returns the structured `{ error }` (never throws up), but now *after* degrade and *with* a ledger note the user sees. Forward `abortSignal` through `asDelegateTool` (currently dropped).
- **`core/orchestrator.ts`** — surface a run-level degradation summary from the ledger into the user-facing output path (alongside `gap`/`resource`). A specialist dropped mid-run is now visible, not just a model-only tool-result string.
- **`workflow/engine.ts` + `run-step.ts`** — wrap `runStepByKind` per step with `withWallClock(runTimeoutMs())`. **Tool/MCP steps** (cross-boundary, ops we own) additionally get `withRetry` on Transient + run through the breaker; **Agent steps** are not re-backoff-retried (D5) — a route-worthy failure falls to the existing `onError` policy. `continue` (skip-and-continue) and `fallback` (degrade) already exist at `engine.ts:92-116`; timeout/retry slot in *before* the catch resolves to a `StepResult` error, then `onError` decides. New optional per-step fields `retry?` / `timeout?` on `StepBase` default to config.
- **`crew/engine.ts`** — sequential crews compile to workflows → inherit the above for free. Hierarchical crews inherit the orchestrator path. Thread the ledger through `CrewDeps`. Minimal crew-specific code.
- **`mcp/client.ts` (`mountMcpServer`)** — wrap each tool's `execute` from `client.tools()` in `breakerFor(serverName).run(...)`; on `CircuitOpenError`/mount-time down, the agent using it is dropped with a ledger note (extends existing per-entry mount degrade to *runtime* calls).
- **`resource/selector.ts` + `cli/select-hook.ts` + `runtime/*`** — `resolveModel`'s candidate-walk and the MLX→Ollama degrade become recorders into the ledger via `degrade.ts`; repeated runtime `isAvailable()` failures feed `breakerFor(runtimeKind)`. Probe `AbortSignal.timeout(1500)` literals → `probeTimeoutMs()`.
- **Consolidation migrations** — `provisioning/{supervisor,providers/ollama,providers/hf-fetch}` import `withRetry`/`abortableSleep`/`IdleWatchdog` + a shared `defaultDownloadRetry()` config (kills the two duplicated blocks + `STALL_MS`/`start(5_000)` dupes). `verified-build/dry-run.ts` re-exports `withWallClock` from `reliability/timeout.ts`. **Untouched**: `verification/expand.ts` unrolling; builders' regenerate-with-feedback semantics.

## 6. Error handling / degrade-never-crash

The whole layer degrades, never crashes. A breaker with no fallback → drop the agent + ledger note (not throw). A model chain exhausted → a clear user-facing terminal message via the existing `resource`/`gap` outcome surface (not a stack trace). `classify` never throws; unknown → Terminal. The ledger writer, like `JsonlFileExporter`, never throws into the run.

## 7. Telemetry (observable by default — standing note)

New `ATTR.RELIABILITY_*` keys (serialize automatically via the JSONL exporter — no exporter change):
`retry.attempts`, `retry.lane`, `breaker.state`, `breaker.trips`, `degrade.from`, `degrade.to`, `degrade.reason`, `partial_failure.dropped_agent`, `partial_failure.skipped_step`. Errors recorded via the **standard OTel `error.type` attribute + span status ERROR** (gen_ai conventions; pin the semconv version — attributes are still "Development"/churning). Add a `recordDegrade(event)` recorder (mutates active span, mirrors `recordGuardrailViolation`) and emit ledger events as span events. `runs`/`render-trace` gains reading for the new attrs so degradation is visible in the trace view.

## 8. Architecture-doc update note (standing)

`docs/architecture.md` gains a **Reliability** subsystem (`src/reliability/`) in the module map + a data-flow note showing classify→retry/degrade/breaker wrapping delegation/workflow/crew/MCP, and the ledger→user+telemetry edge. Update the mechanism section for the migrated provisioning/verified-build primitives. Regenerate the Artifact snapshot (new Reliability node + edges to delegate/workflow/crew/mcp/selector/telemetry, updated footer slice/test counts). README (status line + slice table + Next), ROADMAP (flip the "graceful degradation ❌" gap-table row + phase table + committed-sequence marker to ✅ Slice 21), and the SDD ledger all updated in the landing push.

## 9. Testing + live-verify

- **Unit:** `classify` lane mapping (each trigger); `withRetry` backoff/jitter/`Retry-After`/abort/attempt-cap + Transient-only; `withWallClock` + `withIdleTimeout` reset-on-progress; breaker Closed→Open→HalfOpen→Closed transitions, cooldown, registry sharing; `degradeChain` ordering + failure-domain avoidance; ledger recording + persistence.
- **Integration:** workflow node fails → skip-and-continue + ledger note; crew member down → degrade; MCP server down → tool breaker opens, agent dropped, ledger note surfaced; a Tool/MCP **Transient** failure (op we own) → `withRetry` succeeds on a later attempt; a delegation **RouteWorthy** failure → `degradeChain` to a fallback model/runtime (no LLM re-backoff, per D5).
- **Live-verify (mandatory before merge, per standing gate):** real Ollama — (a) point an MCP server at a dead command → run a crew that uses it → confirm the crew completes with the dependent agent dropped + user told, not crashed; (b) stop a model mid-run / request an unavailable runtime → confirm cross-runtime/next-candidate degrade + ledger note; (c) confirm `reliability.*` spans + `degradation.jsonl` land in `runs/<id>/`.

## 10. Out of scope (chartered elsewhere — NOT deferred debt)

- Checkpointing / resume-after-crash / durable execution → **Slice 24**.
- Token-budgeted retries → revisit at **Slice 22** (Codex cloud tier; local = free compute).
- Bulkhead / concurrency isolation (cockatiel) → not needed single-user-local.
- Reworking `verification/expand.ts` graph-unrolling → different paradigm, left intact.

## 11. Flagged consideration — decision recorded (2026-07-05)

Web-validated against OWASP's 2026 Agentic AI Top 10, which names **"ASI08:
Cascading Agent Failure"** as its own risk category, distinct from the
per-call retry/circuit-breaking this spec already covers: one agent's
degraded or wrong output silently corrupting *downstream* agents in a
crew/DAG. §5's ledger + orchestrator degradation-summary already makes a
**dropped** agent visible (item 101 above). The open question was: when a
specialist **degrades but still produces output** (e.g. falls back to a
smaller/different model per `degradeChain`, or a Tool/MCP step succeeds only
after `withRetry`), does that output carry any signal to downstream steps
that it came from a degraded path, or does it flow on identically to a
full-confidence result?

**Decision:** Slice 21 ships **observability-complete** — every degrade,
drop, and retry is recorded in the `DegradationLedger` and surfaced to the
**user** (printed run summary + `run.dir/degradation.jsonl`) and to
**telemetry** (`recordDegrade`/`ATTR.RELIABILITY_*`), including the
previously-unemitted `DegradeKind.Retried` (now emitted from
`workflow/run-step.ts`'s Tool-step `onRetry`, closing the one gap the ledger
had at spec time). What this slice does **not** build: a `degraded: true`
taint marker threaded through `StepResult`/delegation returns that a
**downstream step or agent within the same run** could branch on. That is
deferred to its **own future slice** — it needs a defined consumer reaction
(a grounding/verification-layer concern: what should a downstream step *do*
differently when it knows its input is degraded?), not a mechanical field
add. Tracked as candidate **Slice 37** in
[`docs/ROADMAP.md`](../../ROADMAP.md)'s backlog table, not silently
dropped.
