# Slice 24 — Always-on Daemon + Task Queue + Resumable Jobs + Secure Remote Access

**Status:** design · 2026-07-19 · branch `slice-24-daemon-queue-remote` (off `main`)
**Predecessor:** Slice 23 landed the AI SDK v7 GA base (memory `deferred-dependency-major-upgrades`); v7's `WorkflowAgent` (`@ai-sdk/workflow`) is now available as the candidate durable-execution substrate this slice spikes (Slice 23 D4). Reliability primitives (`src/reliability/` — breaker + backoff + timeout) shipped in Slice 21 for the retry/backoff policy here to reuse.
**Unblocks:** Slice 25 triggers (cron/webhook/event enqueue onto this queue); the remote-reachable-from-anywhere requirement (memory `remote-access-requirement`).

---

## 1. Thesis

Today the BFF is a **foreground** `Bun.serve` (`src/server/main.ts:243`) whose runs are **request-scoped**: `POST /api/chat` awaits `RunChatTurn` → `runChatSession` → orchestrator → `runAgent` inline (`src/server/chat/run-turn.ts:87`, `src/core/agent.ts:68`), and if the HTTP connection drops the turn aborts (`signal: req.signal`, `handler.ts:185`). **The run cannot outlive its request — that is the core obstacle.** The "fire-and-watch" detached paths (`handleCrewRun` `src/server/crews/run.ts:41`, workflow/model-pull/builder) mint a `runId` and `void deps.run*Turn(...).catch(...)` with **no in-memory registry, no concurrency limit, and no persistence beyond the run dir** — so process death loses every in-flight promise. There is no PID/detach/restart anywhere (`src/cli/start.ts` is a stub; `scripts/serve.sh` starts Ollama, not the web server). The per-process token (`src/server/security/token.ts:5` `mintSessionToken`) dies on restart — a blocker for always-on. And `Bun.serve` passes no hostname → binds `0.0.0.0`; only the Host-header perimeter (`src/server/security/origin.ts:26`) keeps it localhost-scoped — the "localhost ≠ trust boundary" correction (ROADMAP:307,315).

Slice 24 turns the foreground BFF into a **long-lived daemon with a persistent job queue at its heart**. An HTTP call (or a future Slice-25 trigger) **enqueues** a job and returns a `jobId`; a bounded worker pool inside the daemon executes it independently of any connection; clients poll or SSE-stream status. Jobs and their status persist in SQLite and survive restart; long multi-hour workflow/crew runs resume at DAG-node granularity. The daemon is reachable from anywhere via a **pluggable tunnel** (Tailscale default), authenticated by a durable root token that mints short-lived per-device session tokens.

Four capabilities ship together as **one slice** (locked with the user — "all four, one slice"), built in 7 increments (§build-order), spike-first.

## 2. Scope

**In:** daemon lifecycle (portable core + launchd recipe + `agent daemon` CLI); SQLite `jobs` queue (scheduler + bounded worker pool + priority + retry); job API (`POST`/`GET`/`GET :id`/`cancel`) with chat/crew/workflow runs detached onto it; resumable jobs (three layers — job-level durability, DAG-node step-resume, `WorkflowAgent` substrate spike-gated); durable auth (root token → per-device session tokens + rotate/revoke); pluggable secure remote access (bind-address + token, Tailscale default recipe, Cloudflare/reverse-proxy documented). Hardening: `maxRequestBodySize` cap, `/api/telemetry` pre-auth body-size limit, config-driven Origin allowlist for the tunnel origin, `@ai-sdk/mcp` `redirect:'error'` SSRF revisit. The 18 chartered deferred items (§deferred). Docs (4 surfaces) + SDD ledger.

**Out (chartered elsewhere — NOT deferred debt):** Slice 25 triggers; `runs/` retention GC (stays Tier-2, explicitly not pulled in); multi-machine delegation + A2A (Slice 31); optional `Bun.serve` native TLS (§9); resuming *inside* a single agent's token generation (not a meaningful granularity — DAG-node is).

## 3. Decisions (D-series — locked from the brainstorm)

- **D1 — All four capabilities, ONE slice.** Daemon lifecycle + task queue + resumable jobs + secure remote access ship together. Consistent with the `no-deferrals-full-throttle` standing rule; they are one coherent "always-on" story and splitting them would ship a daemon with no durable auth, or a queue with no lifecycle to host it.
- **D2 — Remote transport = PLUGGABLE, the daemon is tunnel-AGNOSTIC.** The daemon owns a configurable **bind-address** + **token auth** and nothing more about transport. **Tailscale is the DEFAULT documented recipe** (bind the `100.x` tailnet interface + `localhost`); **Cloudflare Tunnel** and a **reverse-proxy** (Caddy/nginx) are documented alternatives. Provider-agnostic per the repo's standing rule (memory `provider-agnostic-all-features`) — no transport is special-cased in code.
- **D3 — Daemon lifecycle = portable long-lived CORE + a launchd recipe.** The core is OS-portable: PID file `~/.agent/daemon.pid`; graceful `SIGTERM`/`SIGINT` drain (stop accepting new work, finish or checkpoint in-flight). It reuses the existing `src/process/lifecycle.ts` + `src/process/child-registry.ts` groundwork. macOS default install is a **launchd plist** (`KeepAlive=true`, `RunAtLoad=true`, stdout/err → logs) wrapped by an `agent daemon install/start/stop/status/logs` CLI over `launchctl`. A **systemd unit** is documented for Linux (later). Only build-on point in today's code is `startWebServer`'s clean `{server,token,port}` handle (`main.ts:127`); daemonization is otherwise greenfield.
- **D4 — Durable auth = persisted ROOT token that MINTS short-lived SESSION tokens.** A root token persists at `~/.agent/daemon-token` (`chmod 0600`, minted once, **survives restart**) and mints short-lived, scoped, **per-device** session tokens (TTL). Browser/remote clients hold only the ephemeral session token, **never the root**. `agent daemon token rotate` rolls the root; a device is revoked without rotating root. Reuses the existing constant-time compare (`token.ts` `timingSafeEqual`, `createTokenGuard` `token.ts:15`). This **replaces** today's per-process ephemeral token (`token.ts:5`, dies on restart) — the always-on blocker.
- **D5 — Resumable jobs = THREE layers.** (a) **Job-level durability** — queue + status persist in SQLite, survive daemon restart; queued jobs run post-reboot; a job caught mid-run at boot is marked `Interrupted` and re-runnable from the top. (b) **Workflow-DAG step-resume** — `--resume <run-id>` / re-enqueue skips completed workflow/crew DAG nodes and continues at the first incomplete node (the real multi-hour-job story). (c) **Adopt `WorkflowAgent`** (`@ai-sdk/workflow`) as the durable substrate providing (b) natively + durable approval — but **SPIKE-GATED (increment 1)**: if the spike shows it doesn't fit the local-first single-box model cleanly, **fall back** to a custom per-node checkpoint store in `src/workflow/`. The deliverable (resume at DAG-node granularity) is identical either way. Web-validated facts about `WorkflowAgent`: persists agent state to a configurable store **before every step**, resumes from the last completed step on crash/restart with zero data loss, per-step auto-retry (default 3), durable `needsApproval` human-in-the-loop that survives restarts, supports a **filesystem store** (runs locally, no Vercel infra). Resuming *inside* a single `generateText` token-stream is **not** meaningful — DAG-node is the correct resume granularity.
- **D6 — Task queue = FULL control plane + bounded concurrency + PRIORITY + RETRY.** SQLite `jobs` table **mirrors the `src/session/store.ts` pattern** (`bun:sqlite`, WAL + `busy_timeout=5000` + `foreign_keys=ON`, `user_version` migrations via `src/db/migrate.ts`, `INSERT OR IGNORE` idempotency, `db.transaction()` atomicity, base64url keyset-cursor pagination, snake_case↔camelCase mappers). Columns: `id, kind, payload (JSON), priority, status, attempts, created_at/updated_at/started_at/finished_at, run_id, result, error`. API: `POST /api/jobs` (enqueue → `202 {jobId, runId}`), `GET /api/jobs` (list + status filter + keyset page), `GET /api/jobs/:id` (status + result), `POST /api/jobs/:id/cancel` (fires the existing end-to-end `AbortSignal`). A **bounded worker pool** runs N concurrent jobs (N **computed from hardware, env-override** — never hardcoded, per the repo rule); the rest queue FIFO within priority. **Priority lanes** (`High`/`Normal`). **Retry/backoff** reuses `src/reliability/` breaker + backoff primitives. The worker pool **IS** the "concurrent-launch cap" prior slices deferred.
- **D7 — TLS = DELEGATE to the transport.** The app stays plain HTTP behind the Host/Origin perimeter (`src/server/security/origin.ts` `enforcePerimeter` — already config-driven via `AGENT_WEB_ORIGIN_ALLOWLIST` for a tunnel origin). Encryption is the tunnel's job: Tailscale WireGuard (automatic) / Cloudflare edge TLS / reverse-proxy cert (Caddy/nginx). **Document the TLS recipe per transport; do not own cert lifecycle.** Optional `Bun.serve` native TLS is explicitly **out** (a possible future, §9).

## 4. Architecture / affected modules

- **New `src/queue/`** — the heart. `store.ts` (SQLite `jobs`, factory-returns-closure like `createSessionStore`): `enqueue`, `claimNext` (priority-then-FIFO, atomic `Queued→Running` transition in `db.transaction()`), `markDone`/`markFailed`/`markInterrupted`/`markCanceled`, `getJob`, `listJobs` (keyset page + status filter), `reconcileOrphans` (boot-recovery). `migrations.ts` (one migration, `'init-jobs'`). `scheduler.ts` + `pool.ts` (bounded worker pool, N from hardware/env; pulls `claimNext`, dispatches by `kind`, wires the existing `AbortSignal` per job for cancel). `types.ts`: `enum JobStatus { Queued, Running, Done, Failed, Interrupted, Canceled }`, `enum JobPriority { High, Normal }`, `enum JobKind` (chat/crew/workflow/model-pull/builder — the existing run kinds).
- **New `src/daemon/`** — lifecycle core: PID file (`~/.agent/daemon.pid`), `SIGTERM`/`SIGINT` drain (stop accepting → finish/checkpoint in-flight, via `src/process/lifecycle.ts` + `child-registry.ts`), boot-recovery pass (calls `queue.reconcileOrphans`). launchd plist template + `agent daemon` CLI (install/start/stop/status/logs over `launchctl`).
- **New `src/server/security/root-token.ts`** — root-token store (`~/.agent/daemon-token`, `0600`, mint-once, rotate) + per-device session-token mint (TTL, scope, revoke). Replaces the process-ephemeral `token.ts:5` mint; the `createTokenGuard` constant-time check is reused for session tokens.
- **`src/server/security/origin.ts`** — the perimeter gains the tunnel origin via the already-anticipated `AGENT_WEB_ORIGIN_ALLOWLIST` (`schema.ts:488`; comments at `origin.ts:16,22` already flag the Slice-24 tunnel origin). Bind-address becomes configurable (Tailscale iface + localhost) instead of the implicit `0.0.0.0`.
- **`src/server/app.ts` + `main.ts`** — new `/api/jobs*` routes in the if-ladder handler; the chat/crew/workflow handlers change from inline-await / `void`-detach to **enqueue → return `202 {jobId,runId}`**; the daemon owns `startWebServer`'s handle. `maxRequestBodySize` cap added to `Bun.serve`; `/api/telemetry` (`src/server/telemetry/handler.ts:37`, `req.json()` before token check `handler.ts:46`) gets a size limit **before** parse.
- **`src/server/runs/stream.ts`** — the SSE live-stream is reconciled with detached execution (§7.1): the stream now tails a run the worker pool owns, via the existing Last-Event-ID replay.
- **Resume substrate** — either `@ai-sdk/workflow` (`WorkflowAgent` + filesystem store, D5c adopted) or a custom per-node checkpoint store in `src/workflow/` (fallback). The consent registry (`src/server/consent/registry.ts:30`, in-memory, lost on restart `registry.ts:28`) is subsumed by `WorkflowAgent`'s durable `needsApproval` (or the custom checkpoint's durable-approval equivalent).
- **DTO provenance** — populate the reserved `RunDTO.origin` (was const `'manual'`) and `server.principal` (was const `'local'`) for daemon/remote runs (ROADMAP:319).

## 5. Build order (7 increments — spike-first)

1. **SPIKE `WorkflowAgent` + filesystem store locally** — de-risk the substrate. Decision output: adopt `@ai-sdk/workflow` (does it run local-first, filesystem store, no Vercel infra? does it *wrap* our custom DAG engine or *replace* it?) vs. custom per-node checkpoint store. Resolves D5c / §7.2. **No production wiring yet.**
2. **Queue core** — `src/queue/` SQLite `jobs` store + scheduler + bounded worker pool + priority + retry (reusing `src/reliability/`). No HTTP yet; unit-tested against a temp SQLite db (mirrors the `SqliteStore`/`SessionStore` test precedent).
3. **Job API + detach runs** — `POST /api/jobs` (202), `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel`; migrate chat/crew/workflow handlers from inline-await / `void`-detach onto the queue. Reconcile the SSE live-stream (§7.1).
4. **Daemon lifecycle** — portable core (PID, `SIGTERM` drain, boot-recovery pass marking orphaned `Running` jobs) + launchd plist + `agent daemon` CLI over `launchctl`.
5. **Durable auth + hardening** — root-token store + per-device session tokens + `rotate`/revoke; `maxRequestBodySize` cap; `/api/telemetry` pre-parse body-size limit; perimeter/allowlist for the tunnel origin; `@ai-sdk/mcp` `redirect:'error'` SSRF revisit.
6. **Resume wiring** — `--resume` / re-enqueue → DAG-node skip (WorkflowAgent resume or custom checkpoint) + durable consent/approval.
7. **Docs (all 4 surfaces) + live-verify + land** — `architecture.md`, README, ROADMAP, SDD ledger; regenerate the Artifact; whole-branch fan-out review → live-verify (§success-criteria) → merge `--no-ff` + push (README+ROADMAP+ledger in the same push for the slice-landing gate).

## 6. Deferred items chartered to Slice 24 (18 — none dropped)

| # | Item | Folds into increment |
|---|---|---|
| 1 | consent-resolver-map eviction (progress.md:1066) | 6 (durable approval subsumes it) |
| 2 | run-dir rate-limit (progress.md:1066) | 5 |
| 3 | `maxRequestBodySize` cap (progress.md:1066,1327) | 5 |
| 4 | `/api/telemetry` pre-auth body parse hardening — size-limit before `req.json()` (progress.md:1327; architecture.md:4944-4960) | 5 |
| 5 | localhost ≠ trust-boundary → authenticated network entry point (ROADMAP:307,315) | 4+5 |
| 6 | concurrent-stream cap (SSE) (progress.md:918,939) | 3 |
| 7 | concurrent-launch cap = the worker pool (Phase-4 spec) | 2 |
| 8 | in-UI/API run cancellation beyond local = `POST /api/jobs/:id/cancel` (Phase-4 spec) | 3 |
| 9 | resumable long jobs / `--resume <run-id>` (ROADMAP:210,307) | 6 |
| 10 | durable/resumable execution + checkpointing + resume-after-crash = `WorkflowAgent` (Slice 23 D4) | 1+6 |
| 11 | persistence/resume chartered out of Slice 21 (progress.md:518,546) | 2+6 |
| 12 | secure remote access surface: auth/token, tunnel, TLS, threat-model (ROADMAP:307) | 4+5 |
| 13 | config-driven Origin/CORS allowlist for tunnel origin (partly present) | 5 |
| 14 | `@ai-sdk/mcp` `redirect:'error'` / remote-MCP SSRF revisit (architecture.md:1938; progress.md:1349,1356) | 5 |
| 15 | "resource minors" from Phase 5 (progress.md:1073,1077) | 2–5 (as touched) |
| 16 | server-push / global SSE event bus — folds into remote/tunnel work (Phase-6 spec:160) | 3 |
| 17 | reserved DTO provenance `RunDTO.origin` (`'manual'`) + `server.principal` (`'local'`) — populate for daemon/remote runs (ROADMAP:319) | 3+4 |
| 18 | triggers/daemon telemetry root spans tagged with `origin` (ROADMAP:135; Slice-8 spec:194) | 4 (queue/daemon spans, §8) |

**Explicitly NOT pulled in:** `runs/` retention GC stays **Tier-2** (an already-tracked ROADMAP row) — this slice adds durable *jobs*, not a retention policy for the filesystem `runs/` dir.

## 7. Hard parts

### 7.1 Detaching execution from the request lifetime WITHOUT losing the SSE live-stream

Today the stream **is** the request (`handler.ts` streams inline; abort on `req.signal`). Once the run outlives its request on the worker pool, the SSE surface must tail a run it no longer owns. The reconcile point is the existing Last-Event-ID replay in `src/server/runs/stream.ts`: a client connects (or reconnects) to `GET /api/runs/:id/stream`, and replay serves from the run's span/event journal regardless of which worker is executing it — so a client can submit, disconnect, and reconnect later to collect output. **Risk:** a race where the run finishes (or emits its first event) between enqueue and the client's stream subscribe drops events. **Gate:** an integration test — enqueue a job, subscribe *after* it has started, assert the full event sequence replays with no gap; and the disconnect-reconnect-collect path (§success-criteria) is live-verified.

### 7.2 The `WorkflowAgent` spike — highest-uncertainty item

Does `@ai-sdk/workflow` run **local-first** with a filesystem store and **no Vercel infra**? Does it **wrap** our custom DAG engine (`src/workflow/`) or **replace** it? The web-validated facts (D5c) say it persists before every step, resumes from the last completed step, and supports a filesystem store — but "runs on our single-box local model with our runtime port" is unproven until the spike. **Increment 1 exists solely to resolve this**, and D5 pre-commits the fallback (custom per-node checkpoint store) so the deliverable is fixed regardless. **Gate:** the spike test — a multi-node workflow, killed mid-DAG, resumes from the last completed node against a filesystem store with no re-execution of completed nodes.

### 7.3 Boot-recovery correctness — no double-execution

After a crash, orphaned `Running` jobs must be **deterministically** reconciled: durable ones (DAG-node checkpointed) resume from their last checkpoint; non-durable ones are marked `Interrupted` and re-run from the top only on explicit re-enqueue. **Risk:** a job mid-flight when the daemon died is double-executed if boot-recovery both resumes it AND the client retries. **Mechanism:** `reconcileOrphans` runs once at boot inside a `db.transaction()` before the pool accepts work — every `Running` row is atomically transitioned (`→ Interrupted`, or `→ Queued` for a checkpoint-resumable durable job) so no row is ever picked up in an ambiguous state. **Gate:** a restart-durability test — inject orphaned `Running` rows, boot, assert each lands in exactly one terminal-or-resumable state and executes at most once.

### 7.4 Durable-token security + threat model

Root-token file perms (`0600`); session-token TTL / scope / revocation; and **never** leaking the root to browser `localStorage` (the browser holds only an ephemeral session token). **Threat model:** an attacker who passes the tunnel (on the tailnet) but **not** the token gets `401` at the perimeter guard — the network is no longer the trust boundary (item 5). An attacker with **neither** never reaches the bound interface. A leaked *session* token is TTL-bounded and independently revocable without rotating root; a leaked *root* is the disaster case, which is why it never leaves `~/.agent/daemon-token` and `rotate` exists. **Gate:** token mint/expiry/rotate/revoke unit tests + a perimeter test proving tunnel-without-token → `401`.

## 8. Standing notes (per the CLAUDE.md hard line)

**Architecture-doc update:** `docs/architecture.md` gains **two new subsystems** — a **Daemon** section (`src/daemon/` — lifecycle, PID, drain, launchd, `agent daemon` CLI, boot-recovery) and a **Queue** section (`src/queue/` — `jobs` table, scheduler, bounded pool, priority, retry, the `/api/jobs*` control plane) in the module map + data-flow. Existing sections change: **server perimeter/auth** (bind-address now configurable + tunnel origin; the durable root→session token model replacing the process-ephemeral token), the **run store** (runs now enqueued as jobs, execution detached from the request, SSE tails a pool-owned run), and **observability** (new job/daemon spans). Note the pluggable-transport recipes (Tailscale default / Cloudflare / reverse-proxy) and that TLS is delegated (D7). `bun run docs:check` + the pre-push slice-landing gate hard-fail until README, ROADMAP, and the SDD ledger are updated in the same push; regenerate the Artifact (new Daemon + Queue nodes + edges, updated footer slice/test counts).

**Telemetry to emit:** new spans following `gen_ai.*` OTel conventions — `job.enqueue`, `job.run`, `job.retry`, `job.cancel`, and daemon `daemon.start` / `daemon.stop`. Each run span carries the now-populated **provenance attributes** `RunDTO.origin` (manual/daemon/remote/trigger) and `server.principal` (which device's session token authorized it), so a daemon/remote/trigger-originated run is distinguishable in the trace (item 17/18). No change to the existing per-run span routing (`src/telemetry/run-router.ts`) beyond the daemon owning the tracer lifecycle; the queue spans nest under each job's run root.

## 9. Forward-items (deferred, tracked — NOT in scope)

- **Slice 25 triggers** — cron / webhook / event sources that **enqueue onto this queue**; the queue's `POST /api/jobs` enqueue path is built here precisely so triggers have a target.
- **`runs/` retention GC** — stays Tier-2 (already-tracked ROADMAP row); this slice adds durable jobs, not filesystem retention.
- **Multi-machine delegation + A2A** — Slice 31; this slice makes *one* box remotely reachable, not a fleet.
- **Optional `Bun.serve` native TLS** — explicitly out (D7); TLS is the tunnel's job. A possible future if a no-tunnel direct-HTTPS mode is ever wanted.
- **Full custom-DAG-engine migration** — if the spike (increment 1) adopts `WorkflowAgent`, fully migrating `src/workflow/` off the custom engine onto it is a follow-on; Slice 24 only wires DAG-node resume, whichever substrate wins.

## 10. Success criteria / live-verify gate (mandatory before merge)

On the target box (Mac Mini M4 Pro, memory `target-hardware-m4-pro`), against real models:

1. **Daemon under launchd** — `agent daemon install` + `start`; confirm it survives a logout/relaunch (`KeepAlive`/`RunAtLoad`) and `agent daemon status`/`logs` work.
2. **Remote reachability** — from a **second device over Tailscale**, authenticate with a per-device session token and hit `GET /api/jobs`; confirm tunnel-without-token → `401`.
3. **Detached long job** — submit a long job → **disconnect** the client → **reconnect** later → collect the result via SSE replay (§7.1).
4. **Restart-resume** — `kill -TERM` the daemon mid-job → restart → confirm a durable (DAG) job resumes from its last completed node (no re-execution) and a non-durable job is marked `Interrupted` (§7.3), with **no double-execution**.

## 11. Testing

- **Queue unit tests** — `enqueue`/`claimNext` priority-then-FIFO ordering; atomic `Queued→Running` claim under concurrent pool workers (no two workers claim one row); `markDone`/`Failed`/`Interrupted`/`Canceled` transitions; keyset pagination + status filter; retry/backoff via `src/reliability/`; bounded-pool concurrency cap (N from hardware, env-override honored).
- **Restart-durability tests** — orphaned `Running` rows reconciled deterministically at boot; durable job resumes from checkpoint, non-durable → `Interrupted`; at-most-once execution (§7.3).
- **Token tests** — root mint-once + `0600` perms; session-token mint / TTL-expiry / scope / rotate (root roll) / per-device revoke without root rotation; constant-time compare reused.
- **Perimeter / body-cap tests** — tunnel-origin allowlist accept/reject; tunnel-without-token → `401`; `maxRequestBodySize` cap enforced; `/api/telemetry` body size limited **before** `req.json()`.
- **`WorkflowAgent` spike test** — multi-node workflow, filesystem store, killed mid-DAG, resumes from last completed node with no re-execution (the increment-1 decision gate, §7.2).
- **SSE reconcile test** — subscribe after a job starts → full event sequence replays with no gap (§7.1).
