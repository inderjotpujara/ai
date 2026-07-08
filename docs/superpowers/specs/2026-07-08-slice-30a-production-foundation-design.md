# Slice 30a — Production foundation (make the engine safe for a long-lived, concurrent host) — design

**Date:** 2026-07-08
**Branch:** `slice-30a-production-foundation` (off `main`)
**Status:** design (brainstorm), spec under review before planning
**Lands before:** Slice 30b (local web UI), which builds on this.

## Context & framing

A 6-agent production-readiness audit (2026-07-08) found that the entire engine rests on one
latent assumption: **"one run, one process, which exits when the run ends."** Every CLI
invocation is short-lived and single-run, so this has never bitten. The Slice 30b web UI
inverts it — **many runs, one long-lived process, never exits** — and that exposes a cluster
of CRITICAL flaws. Fixing them is independently valuable (the CLI gains cancellation and
clean shutdown), and entangling them with UI work would make both unreviewable. So they land
first, as their own slice, on which the web UI is then safe to build.

This slice touches the engine's *lifecycle and concurrency*, not its reasoning. No web
server, no React — that is Slice 30b. Perimeter security (auth/CORS/host-checks) also belongs
to 30b because it only exists once there is a server.

## Goal (one sentence)

Make the engine correct and safe when driven as a long-lived process running multiple
concurrent, cancellable runs — collision-free runs, per-run telemetry, cooperative
cancellation, signal-clean shutdown, concurrency-safe stores, schema migrations — plus the
minimal ops surface (structured logs, config schema, `status`, `start`) a served product needs.

## Decisions (locked with user, 2026-07-08)

- **F1 — Collision-free run IDs.** Replace `run-${process.pid}` (`src/cli/chat.ts:237`) with a
  collision-free id (`run-<sortableTs>-<rand>` or `crypto.randomUUID()`). Sortable-prefix
  preferred so `runs/` lists chronologically. All entry points (chat/flow/crew/build) adopt it.
- **F2 — Per-run telemetry provider (kill the process-global).** `initRunTelemetry`
  (`src/telemetry/provider.ts:52`) currently calls `trace.setGlobalTracerProvider` per run —
  run B clobbers run A's provider. Move to a **context-scoped** provider/tracer keyed to the
  run (carried via the existing AsyncLocalStorage), so concurrent runs write to their own
  `spans.jsonl` and shut down independently. This is the foundational change the whole
  concurrency story depends on.
- **F3 — Cooperative cancellation.** Introduce an `AbortController` threaded from the run
  entry (`runChat`/`runOrchestrator`) → delegate → `generateText`/`streamText` → spawned
  children. `withWallClock` (`src/reliability/timeout.ts`) is rewired to **abort the work**,
  not merely stop awaiting it (today it leaks the underlying compute). Gives the CLI a real
  Ctrl-C and 30b a working Stop button.
- **F4 — Signal handlers + central child-process registry.** Install top-level
  SIGINT/SIGTERM handlers that run teardown (`unloadAll`, `tel.shutdown`, `reg.close`) and
  kill a **tracked set of child processes**. Today there is no registry, so Ctrl-C orphans
  llama.cpp/MLX/LM Studio servers, ffmpeg, and STT/gen subprocesses. Add a `ChildRegistry`
  that every `spawn` site registers with; teardown drains it.
- **F5 — Concurrency-safe stores.** Open `bun:sqlite` with `PRAGMA journal_mode=WAL` +
  `busy_timeout` and a shared connection for the long-lived process
  (`src/memory/sqlite-store.ts:23`); add an async lock around the model-manager
  `ensureReady` eviction/budget accounting (`src/resource/model-manager.ts:171`) so
  concurrent delegations don't over-commit VRAM or double-evict.
- **F6 — Schema versioning + migration runner + embedder guard.** Add a `user_version`-based
  migration runner; retrofit `memory.db`; add an **embedder-mismatch guard** to `ensureSpace`
  (`src/memory/store.ts:34`) that refuses or auto-reindexes instead of silently corrupting a
  space when the configured embedder differs from the stored one. (SessionStore in 30b uses
  this runner.)
- **F7 — Structured leveled logger.** A small logger (`src/log/`) emitting JSONL to
  `runs/<id>/app.log` (+ pretty console for a TTY), stamped with run-id/trace-id, replacing
  the ~105 ad-hoc `console.*` calls. This is the log signal 30b's UI will tail. Level via
  `AGENT_LOG_LEVEL`.
- **F8 — Config schema module.** `src/config/` — one Zod schema enumerating every `AGENT_*`
  knob (≈63 today) with default + doc string, validated once at startup, optionally seeded
  from `~/.config/ai/config.json` (env still overrides — "compute-live, env-fallback-only"
  preserved). Emits `bun run config` (effective config + source). This is the schema 30b's
  settings UI reads/writes against.
- **F9 — `bun run status` + a single `bun run start` scaffold + app version.** `status`:
  Ollama reachable? models resident? disk headroom? effective config summary (feeds 30b's
  live panel). `start`: the single boot command placeholder (30b wires the web server into
  it). Bump `package.json` off the static `0.1.0`; add `--version`; start a generated
  `CHANGELOG.md` from the SDD ledger.
- **F10 — Top-level error boundary.** Replace `main().catch(console.error)` with a boundary
  that maps `FrameworkError` subtypes to actionable messages and persists `error.json` per
  run (the record 30b's UI surfaces).
- **F11 — Usage/cost rollup.** Extend `src/verified-build/usage.ts` (or a new
  `src/usage/`) to aggregate tokens/latency by model+agent+day from existing spans; `bun run
  usage`. No new instrumentation — reuses span data. (Also closes telemetry gap #1: emit an
  explicit run/agent token roll-up so per-run totals aren't dependent on AI-SDK gen spans.)

## Architecture / touch map

Mostly *modifications* to existing subsystems plus three small new ones (`src/log/`,
`src/config/`, `src/usage/`) and a `ChildRegistry` (likely `src/runtime/` or `src/process/`).
No new external deps. Key edit sites: `src/cli/chat.ts:237` (F1), `src/telemetry/provider.ts`
(F2), `src/reliability/timeout.ts` + `src/cli/run-chat.ts` + `src/core/*` (F3), all `spawn`
sites in `src/media/`, `src/voice/`, `src/runtime/` (F4), `src/memory/sqlite-store.ts` +
`src/resource/model-manager.ts` (F5), `src/memory/store.ts` (F6).

## Error handling / graceful degrade

Every fix hardens an existing degrade path rather than adding new failure modes: cancellation
and signal teardown must themselves never throw past the boundary; a failed migration aborts
startup with an actionable message (never a silent half-migrated store); the embedder guard
degrades to a clear "reindex required" error, not corruption.

## Testing

- **F1/F2:** a test running two overlapping runs in one process asserts separate run dirs +
  no span cross-contamination (the current design would fail this — that's the point).
- **F3:** abort mid-run → `generateText`/child receives the signal, no leaked process
  (extends the existing `agent-abort.test.ts`); `withWallClock` timeout aborts the work.
- **F4:** a SIGINT-simulation test asserts the child registry is drained (mock children).
- **F5:** concurrent sqlite read/write under WAL doesn't `SQLITE_BUSY`; a concurrent
  `ensureReady` test asserts no double-evict/over-commit.
- **F6:** migration up/down; embedder-mismatch is caught.
- **F7–F11:** logger level filtering + run-id stamping; config schema rejects a bad value;
  `status`/`usage` output shape; error boundary maps a typed error.
- This slice is where the **CI pipeline** is stood up (`bun run check` on PR/push) so 30b
  lands into an enforced gate — see 30b spec §Testing for the frontend harness.
- **Live-verify:** real Ctrl-C during a real model run leaves no orphaned Ollama/MLX/ffmpeg
  process (the headline manual check).

## Standing spec notes (per repo CLAUDE.md)

- **Architecture-doc update note:** adds subsystems `src/log/`, `src/config/`, `src/usage/`
  (+ `ChildRegistry`); `docs/architecture.md` gets sections for each + updates to the
  telemetry (§per-run provider), reliability (§cancellation/abort propagation), and
  model-manager (§eviction lock) sections; subsystem-registry table; Mermaid diagrams;
  README (status line + ✅ Slice 30a row); ROADMAP (new Slice 30a row); SDD ledger; docs
  snapshot Artifact.
- **Telemetry to emit:** the per-run provider (F2) is itself a telemetry-correctness fix;
  add an explicit run/agent **token roll-up** span/attribute (F11, telemetry gap #1); the new
  logger correlates logs to trace-id.

## Out of scope (→ Slice 30b or later)

The web server, React, SSE, perimeter security (auth/CORS/host-checks), SessionStore/chat
persistence, and all product UI. `runs/` retention GC, model-weight disk GC, and LanceDB
compaction are **Tier-2 new ROADMAP slices** (registered, not built here). Encryption-at-rest
and tool-exec sandboxing remain Slice 35.

## Top risks & mitigations

1. **F2 (per-run telemetry) is invasive** — the global provider is load-bearing across the
   codebase. Mitigate: land it behind the existing AsyncLocalStorage run context with a
   thorough concurrent-run test before anything else in the slice.
2. **F3/F4 (cancellation + child registry) touch many spawn sites** — do it as a mechanical
   sweep with the registry as the single choke point; a test per subsystem.
3. **F6 migrations on existing user data** — ship the migration runner with a backup/copy of
   `memory.db` before first migration and a dry-run mode.
