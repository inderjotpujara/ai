# Slice 25 — Scheduled + Triggered Agents (Phase E)

**Status:** design · 2026-07-20 · branch `slice-25-triggers` (off `main`)
**Predecessor:** Slice 24 shipped the always-on daemon + SQLite job queue (`src/queue/store.ts` `enqueue`/`claimNext`, one pool per DB, `createDaemon.start()` ordering in `src/daemon/core.ts`). Slice 25b shipped the Ops console and left the **Triggers tab a static stub** (`web/src/features/ops/triggers-tab.tsx` — a read-only `TRIGGER_KINDS` preview, no `apiFetch`). This slice builds the trigger *backend* and wires that tab live. It also lands the remaining non-`Manual` `RunOrigin` values reserved back in Slice 24 (`src/contracts/enums.ts:11` — `Schedule`/`Webhook`/`Api` already declared, unused).

---

## 1. Summary

Triggers turn the passive queue into an active scheduler: **cron**, **webhook**, **file-watch**, and **job-chain** triggers that enqueue a target `JobKind`+payload onto the existing Slice-24 queue. The engine is a durable **poll-tick scheduler** living in the daemon (`src/triggers/`), constructed beside the pool and lifecycle-bound to it. Triggers are authored from **two surfaces** — repo TS defs (the `crews/` pattern) and console/API CRUD — persisted in the existing queue DB. Webhooks arrive on a new `/hooks/:token` route outside the `/api` session guard, and every fired run threads `origin` provenance so the Slice-25b Jobs tab and runs `?origin=` facet light up for free. The stub's three preview columns (Type · Target job kind · Schedule) become the live list.

## 2. Goals / non-goals

**Goals:** durable time/event-driven job enqueue that survives daemon restart (fire-once catch-up on missed cron); a webhook receiver with production-grade auth (token + HMAC + replay window); file-drop and job-completion (chain) triggers; both authoring surfaces (repo defs read-only-editable from console, console rows full CRUD); provenance threading so trigger-fired runs are filterable; the live Triggers tab (list, create dialog, enable/disable, firing history, manual test-fire); a CLI mirroring the daemon CLI shape.

**Non-goals:** no distributed / multi-instance scheduling (single daemon owns the tick); no **trigger builder** (chat→trigger generation is a later slice — splice markers reserved only); no CloudEvents envelope (noted as a future interop option); no per-trigger custom code execution (targets are existing `JobKind`s only); no UI for editing repo-origin trigger *definitions* (console may only pause/resume them).

## 3. Decisions (D1..D4)

### D1 — Trigger model & storage (BOTH authoring surfaces)
A trigger = `{ id, name, type: cron|webhook|file|jobchain, enabled, target: { kind: JobKind, payload }, <per-type config>, origin: repo|console, nextRunAt?, lastFiredAt?, secretRef? }`.
- **(a) Repo defs.** A new root `triggers/` dir + `triggers/index.ts` registry, **exactly** the `crews/index.ts` pattern (TS source, `Object.hasOwn`-guarded `getTrigger`; agent-builder splice markers — `// TRIGGER-BUILDER:IMPORTS`/`:ENTRIES` — reserved for a later builder slice, unused now). Synced at daemon boot into SQLite as `origin=repo` rows (upsert by `name`, prune removed). The console may **only** pause/resume repo triggers — an `enabled` overlay column in SQLite that **survives re-sync** — never edit or delete them.
- **(b) Console/API-created.** `origin=console` rows, full CRUD.
- **Storage.** New `triggers` + `trigger_firings` tables in the **existing queue DB** (`jobs/jobs.db`) via the same `migrate(db, …)` pattern (`src/queue/store.ts:121`); migrations live in a new `src/triggers/migrations.ts` run against that DB. Webhook HMAC secrets are **NOT** in the DB: `~/.agent/trigger-secrets.json` at `0600` (the `device-registry.ts` / `root-token.ts` `~/.agent` idiom, `mode: 0o700` dir + `0o600` file); the table stores only a `secretRef`.

### D2 — Engine = durable poll-tick scheduler in the daemon (`src/triggers/`)
Web-validated: **Croner v10** as a *library only* (Bun-native, DST/IANA-tz-correct next-time computation); per-trigger `setTimeout` is the rejected anti-pattern; `Bun.cron` in-process is UTC-only and rejected. Modules:
- **`scheduler.ts`** — ticks every `AGENT_TRIGGERS_POLL_MS` (default ~1000ms). Each tick atomically claims due cron rows `WHERE enabled AND next_run_at <= now` via a `BEGIN IMMEDIATE` transaction (the `claimNext` idiom, `src/queue/store.ts:174` — write-lock at BEGIN, no read-then-upgrade window), fires them, and recomputes `next_run_at` via Croner. **Misfire policy = fire-once-on-boot:** exactly one catch-up per trigger if its due time passed while the daemon was down (per-trigger `catchUp:false` override). **Overlap protection:** skip if the previous fired job is still running (firing outcome `skipped-overlap`) unless `allowOverlap:true`.
- **`fire.ts`** — the single convergence point for **all four sources**: builds a job via `JobStore.enqueue` (`src/queue/store.ts:123`) with the target `kind`+`payload`, stamps provenance (D3), writes a `trigger_firings` row (`triggerId, firedAt, jobId, runId, outcome`), emits the `trigger.fire` span.
- **`watcher.ts`** — file triggers via **chokidar v4** (NOT v5: ESM-only/Node≥20) with `awaitWriteFinish` settle; watched paths validated + confined **at creation**; the matched path is injected via `{{file.path}}` substitution into the target payload.
- **`chain.ts`** — job-chain triggers: a completion observer the daemon registers on the pool's `markDone`/`markFailed` path (observer pattern — NOT hardcoded in `src/queue/pool.ts`, whose `runOne` calls `store.markDone`/`markFailed` at lines ~57/71), matching `{ onKind?, onName?, onStatus: done|failed }`. The fired payload carries the finished job/run id. **Cycle guard:** a `chainDepth` increments per hop with a hard cap `AGENT_TRIGGERS_MAX_CHAIN_DEPTH` (default 8).
- **`sync.ts`** — the D1(a) repo-def boot sync.
- **Daemon wiring.** Constructed in `buildRealDaemon` (`src/cli/daemon.ts:116`) beside the pool; **started AFTER** pool+server in `createDaemon.start()` (after step 5, `src/daemon/core.ts:118`); **stopped FIRST** in `stop()` (before `pool.stop`, `src/daemon/core.ts:86`) — stop producing before draining consumers.

### D3 — Webhooks + provenance threading
A new route class **`POST /hooks/:token`** wired in `src/server/app.ts` **outside** the `/api` session guard (which only wraps `url.pathname.startsWith('/api')`, `app.ts:228`) but **inside** the Host/Origin perimeter. Per trigger: a 128-bit random path token (minted at creation, shown once), constant-time lookup, optional per-trigger **HMAC-SHA256** over the RAW body + a timestamp header + a **±5-minute replay window** (GitHub/Stripe style), a hard body cap (reuse the existing `maxRequestBodySize` machinery), and the run-dir rate limiter applied (the same `createProcessRunLimiter` gating `/api/jobs` et al., `app.ts:147`). The body becomes `{{webhook.body}}` in the target payload. Response `202 {jobId, runId}`, fire-and-forget.
- **Provenance.** Add `origin?: RunOrigin` to `JobInput`/`JobRecord` (`src/queue/types.ts:31,50`) — one migration column. Generalize `dispatch.ts` `markDaemonOrigin` (`src/server/jobs/dispatch.ts:99`) to stamp the record's origin — `schedule` (cron), `webhook`, `api` (file/chain), defaulting to `daemon` as today. `RunOrigin` already reserves `Schedule`/`Webhook`/`Api` (`enums.ts:11`) — **no enum change**. The existing runs `?origin=` facet (Slice 25b) then works for trigger-fired runs for free.

### D4 — API / console / CLI
- **API.** `GET`/`POST /api/triggers`, `GET /api/triggers/:id`, `PATCH /api/triggers/:id` (enable/disable; console-origin edits), `DELETE /api/triggers/:id` (console-origin only), `GET /api/triggers/:id/firings` (keyset, the `listJobs` cursor idiom), `POST /api/triggers/:id/fire` (manual test-fire). **All mutating trigger routes** sit behind `requireTrustedLocal` (`src/server/security/trusted-local.ts` — principal `'local'` + allowed origin, as the device routes do) — trigger creation is *persistent code-execution-by-schedule*. Action-sub-path-before-bare-`:id` ordering as `app.ts` already does for `/api/devices/:id/revoke` (`app.ts:399`) and `/api/jobs/:id/cancel`.
- **Contracts.** `TriggerDtoSchema` / `TriggerFiringDtoSchema` + `TriggerTypeWire` / `TriggerOriginWire` enums, following the `dto.ts` `z.enum(<Wire>)` + `enums.ts` wire-mirror conventions (enum-over-union repo style; parity tests as for `JobKindWire`).
- **Console.** The Triggers tab replaces the static preview: a live list (the stub's Type / Target job kind / Schedule columns + Enabled + Last fired), a create dialog with per-type config forms, an enable/disable toggle, a firing-history drawer with job/run deep-links, and a manual-fire button; plain `apiFetch` hooks (**no** query lib), matching the other Ops tabs.
- **CLI.** New `src/cli/triggers.ts` mirroring `runDaemonCli`'s injected-deps shape (`src/cli/daemon.ts:67`): `agent triggers list|add|enable|disable|remove|history|fire`.

## 4. Backend-delta table

| Capability | Reachable today? | Route / module / store to ADD | Request → Response |
|---|---|---|---|
| Scheduler engine | ✗ | `src/triggers/{scheduler,fire,watcher,chain,sync}.ts` | (daemon-internal) |
| Trigger tables | ✗ | `triggers` + `trigger_firings` in `jobs.db` via `src/triggers/migrations.ts` | — |
| Repo trigger defs | ✗ | new root `triggers/` + `triggers/index.ts` (`crews/` pattern) | — |
| List / create triggers | ✗ | `GET`/`POST /api/triggers` | query / `TriggerCreateRequest` → `TriggerListResponse` / `TriggerDto` |
| Trigger detail | ✗ | `GET /api/triggers/:id` | — → `TriggerDto` |
| Enable/disable · edit | ✗ | `PATCH /api/triggers/:id` (trusted-local) | `TriggerPatchRequest` → `TriggerDto` |
| Delete (console-origin) | ✗ | `DELETE /api/triggers/:id` (trusted-local) | — → 200 |
| Firing history | ✗ | `GET /api/triggers/:id/firings` (keyset) | query → `TriggerFiringListResponse` |
| Manual test-fire | ✗ | `POST /api/triggers/:id/fire` (trusted-local) | — → `202 {jobId, runId}` |
| Webhook receiver | ✗ | `POST /hooks/:token` (outside `/api` guard) | raw body → `202 {jobId, runId}` |
| Job provenance origin | partial (run-dir marker only) | `origin` column on `jobs` (queue migration, `src/queue/migrations.ts`); generalized `markDaemonOrigin` | — |
| HMAC secrets | ✗ | `~/.agent/trigger-secrets.json` `0600`; `secretRef` in table | — |
| CLI | ✗ | `src/cli/triggers.ts` | — |

## 5. Increment breakdown (SUGGESTION — the plan skill finalizes)

1. **Contracts + storage** — `Trigger`/`TriggerFiring` types, wire enums + DTOs + parity tests; `src/triggers/migrations.ts` (the two trigger tables); the `jobs` `origin` column lands as a **queue** migration in `src/queue/migrations.ts` (it alters the jobs table, not a trigger table); `JobInput`/`JobRecord.origin`.
2. **Scheduler core** — `scheduler.ts` (tick + atomic claim + Croner recompute), `fire.ts` (convergence + firings write + span), misfire fire-once + overlap skip.
3. **Sources** — `watcher.ts` (chokidar4 + confinement), `chain.ts` (pool observer + depth cap), `sync.ts` (repo boot sync); daemon wiring in `buildRealDaemon` + `createDaemon` start/stop order.
4. **Webhooks + provenance** — `/hooks/:token` route (token/HMAC/replay/cap/rate-limit), generalized `markDaemonOrigin`.
5. **API + trusted-local gating** — the seven `/api/triggers*` routes into `app.ts`.
6. **Console** — live Triggers tab (list, create dialog, toggle, firing drawer, manual fire).
7. **CLI** — `src/cli/triggers.ts`.
8. **Docs (4 surfaces) + SDD ledger + live-verify + land** (§8/§10).

## 6. Web IA wiring (exact touch-points)

- `web/src/features/ops/triggers-tab.tsx` — replace the static `TRIGGER_KINDS` preview with a live `apiFetch`-driven list + `use-triggers.ts` hook; keep `data-testid="ops-triggers"`.
- `web/src/features/ops/` — new `trigger-create-dialog.tsx` (per-type config forms), `trigger-firings-drawer.tsx` (job/run deep-links into `/runs/$runId`), `use-triggers.ts` / `use-trigger-firings.ts`.
- All data via `apiFetch(path, { schema })` with the new contract schemas — Bearer is automatic; no query lib.

## 7. Hard parts (adversarial / ultracode / Fable verification)

- **7.1 Webhook receiver security.** Constant-time token compare (the `timingSafeEqual` idiom already in `security/`); HMAC verified over the RAW body (not a re-serialized parse); replay window enforced on the timestamp header; hard body cap; run-dir rate limit; the secret NEVER in logs, DTOs, or spans.
- **7.2 Scheduler atomicity.** No double-fire across tick races or an accidental second daemon instance — the `BEGIN IMMEDIATE` claim of due rows + the double-start pid guard (`daemon/core.ts:101`) are the two locks; a claimed row's `next_run_at` advances inside the same transaction.
- **7.3 Chain-cycle guard + payload template injection.** `chainDepth` hard cap prevents A→B→A storms; `{{file.path}}` / `{{webhook.body}}` substitution must be plain string interpolation into a JSON payload value — **never** an eval/`Function`/template-engine surface.
- **7.4 File-watcher path confinement.** No watching `/`, no symlink escape — paths validated + confined at trigger creation, re-checked before `chokidar.watch`.

## 8. Standing notes (per the CLAUDE.md hard line)

**Architecture-doc update (`docs/architecture.md`).** Add a new **`src/triggers/` subsystem** (scheduler tick → fire convergence → `JobStore.enqueue`, the four sources, boot sync) and its data-flow edges into the Queue/Daemon sections; document the new **`/hooks/:token` route class** sitting outside the `/api` guard; document the `origin` threading through `dispatch.ts` and the new `triggers`/`trigger_firings` tables in `jobs.db`. Update the **doc map / README pointer** if any living doc is added. Regenerate the interactive architecture-snapshot **Artifact** (new triggers node + edges to Queue/Daemon/`/hooks`; updated footer slice count "25" + test count). `bun run docs:check` + the pre-push slice-landing gate hard-fail until `README.md`, `docs/ROADMAP.md`, and `.superpowers/sdd/progress.md` are updated in the same push.

**Telemetry to emit.** New spans via the existing `inSpan`/`ATTR` conventions (`src/telemetry/spans.ts:16,229` — no parallel emission path, no-op without a tracer): `trigger.register`, `trigger.fire`, `trigger.skip`, carrying new `ATTR` keys `TRIGGER_ID`, `TRIGGER_TYPE`, `TRIGGER_ORIGIN`, `TRIGGER_OUTCOME`. Server-request-scoped spans (the `/api/triggers*` + `/hooks` routes) nest under `withServerRequestSpan` as the other routes do.

## 9. Testing strategy

- **Scheduler (fake clock).** Tick fires a due cron; misfire fires exactly once on boot; overlap → `skipped-overlap` unless `allowOverlap`; DST correctness via Croner next-time.
- **Webhooks.** HMAC accept/reject, replayed timestamp → 409, over-cap body → 413, constant-time token compare, secret-never-leaks assertions.
- **File watcher.** chokidar behind a mockable seam; path-confinement rejects `/` and symlink escape.
- **Chain.** A→B fires on completion; depth cap halts a cycle at `AGENT_TRIGGERS_MAX_CHAIN_DEPTH`.
- **Contracts.** DTO round-trips + wire-enum parity (the `JobKindWire` precedent).
- **Live-verify.** §10.

## 10. Live-verify gate (mandatory before merge)

On the target box against the real daemon (launchd) + real Ollama + native Chrome (logged-in session):

1. **Cron** — create a cron trigger in the console → observe a real fire → the job appears in the **Jobs** tab with `origin=schedule`.
2. **Webhook** — `curl` the `/hooks/:token` URL with (a) a good HMAC → job fires; (b) a bad HMAC → 401; (c) a replayed timestamp → 409.
3. **File** — drop a file into a watched dir → job fires with `{{file.path}}` substituted.
4. **Chain** — a two-step chain: job A done → job B fires; prove the depth cap halts a self-referential chain.
5. **Restart** — stop the daemon with a due cron pending, restart → **exactly ONE** catch-up fire.
   Throughout: the console firing history and the runs `?origin=` facet are verified against each fire.

## 11. New deps & env knobs

**Deps:** `croner` (runtime), `chokidar@4` (runtime).
**Env (all via `src/config/schema.ts`, defaults computed/conventional — never hardcoded, per repo rule):** `AGENT_TRIGGERS_POLL_MS` (idle tick cadence, ~1000ms), `AGENT_TRIGGERS_MAX_CHAIN_DEPTH` (default 8), `AGENT_TRIGGERS_PATH` (repo `triggers/` dir override, mirroring `AGENT_QUEUE_PATH`).
