# Slice 25b — Jobs & Triggers Ops Console (web-UI companion to Slice 24)

**Status:** design · 2026-07-19 · branch `slice-25b-ops-console` (off `main`)
**Predecessor:** Slice 24 shipped the always-on daemon + SQLite task queue + resumable jobs + durable root→session auth **backend-only** — there is no browser surface for any of it. The queue control plane (`POST/GET /api/jobs`, `POST /api/jobs/:id/cancel`), the daemon lifecycle (`src/daemon/`), and the durable auth (`root-token.ts` / `session-token.ts`) all exist and are tested, but the only client is the CLI.
**Numbering:** a **new ROADMAP row "Slice 25b"**, non-destructive to existing numbering — a UI companion, not a re-plan of Slice 25 (whose *trigger backend* is still unstarted; this slice ships the Triggers screen as a STUB). It also delivers the **UI half of what Slice 26 "remote-auth completion" anticipated** — device pairing/revoke + root rotate over the web — so §8 notes the overlap and Slice 26 narrows to any residual backend-only hardening.

---

## 1. Summary

Slice 24 made the box always-on and remotely reachable but left every operator action at the CLI. Slice 25b adds a **management console** to the existing local web UI (`web/`, React 19 + Vite + Tailwind v4 + TanStack Router + `@ai-sdk/react`): one new top-level nav entry **Ops** at `/ops` with a roving-tabindex sub-nav of four tabs — **Overview** (daemon/queue health) · **Jobs** (the queue table + drawer + cancel/resume/retry) · **Triggers** (designed, STUBBED until Slice 25) · **Devices & Access** (bind status, device pairing/revoke, root rotate). It builds the Slice-24 parts for real and stubs only the trigger screens. It follows the existing feature-module conventions exactly (`web/src/features/ops/`, `data-testid="area-ops"`, `RegionErrorBoundary`, `apiFetch` + a zod contract schema, automatic Bearer auth via `sessionToken()`).

## 2. Goals / non-goals

**Goals:** a real operator surface for the daemon + queue; visibility (daemon liveness/uptime, per-status queue counts, recent failures); job lifecycle actions from the browser (cancel, resume-from-checkpoint, retry); the full remote-access story (bind posture, per-device pairing with a phone-openable URL+QR, revoke, break-glass root rotate); a read-only daemon logs tail. Ship the trigger IA read-only so the shape is designed before Slice 25 wires it.

**Non-goals:** no triggers backend (cron/webhook/event enqueue is Slice 25); no remote daemon start/stop (bootstrap paradox — the daemon *hosts* this web server; D6); no visx charts this slice (Overview is card-lite; charts are an explicit deferred enhancement); no multi-user / RBAC (single local principal + per-device session tokens only).

## 3. Decisions (D1..D6)

### D1 — Overview tab = health dashboard (card-lite)
Three cards. **Daemon:** running/stopped, `pid`, uptime. **Queue:** counts by `JobStatus`, active workers vs concurrency. **Recent failures:** last N `Failed`/`Interrupted` jobs, each with a one-click **Resume** (for `Interrupted`) / **Retry** (for `Failed`). No charts (deferred). Poll-refresh on the same `notifyConfig().pollMs` cadence the notifications feature already uses.
- **New endpoints.** `GET /api/daemon/status` — extend the payload beyond today's `{running, pid?}` (`daemon/core.ts status()`) with `startedAt`/`uptimeMs` and a `bind` sub-object (feeds D4). `GET /api/queue/stats` — per-status counts + `activeCount` + `concurrency`, from a NEW single-query `JobStore.stats()` (§7.2) + `pool.activeCount()` + `computeConcurrency()`.
- **New DTOs (`src/contracts/dto.ts`).** `DaemonStatusDtoSchema { running: boolean, pid?: number, startedAt?: number, uptimeMs?: number, bind: DaemonBindDtoSchema }`; `QueueStatsDtoSchema { counts: Record<JobStatusWire, number>, total: number, activeCount: number, concurrency: number }`.
- **Web.** `web/src/features/ops/overview-tab.tsx` + `use-daemon-status.ts` + `use-queue-stats.ts`.

### D2 — Jobs tab = queue table + detail drawer + actions
Queue table with facet filters (status / kind / priority) + keyset "load more", **mirroring `web/src/features/runs/index.tsx`** (its `cursors[]`/`page`/`nextCursor` pattern against `GET /api/jobs`). Row → detail drawer/panel showing: `payload`, `attempts`/`maxAttempts`, all timestamps, retry-scheduled-at (`availableAt`), `error`, origin, and the linked `runId` **deep-linked into the existing Runs viewer** (`/runs/$runId`) + its SSE stream. Actions: **cancel** (`Queued`/`Running` → `POST /api/jobs/:id/cancel`, already live), **resume** (`Interrupted`-with-checkpoint → `POST /api/jobs {resume: runId}`, already live via `JobEnqueueRequestSchema.resume`), **retry** (`Failed`/`Canceled`/`Interrupted` → `POST /api/jobs/:id/retry`, a lineage-preserving re-enqueue stamping `retriedFrom` — see §11). Poll-refresh + optimistic UI (an action flips the row's local status immediately, reconciled on the next poll).
- **Backend deltas.** Project `JobRecord.availableAt` onto `JobDtoSchema` (add `availableAt: z.number()`; `src/server/jobs/map.ts toJobDto` populates it). Add an `origin` facet to `RunListQuerySchema` (`src/contracts/requests.ts`, `z.enum(RunOrigin).optional()`) so a `runId` deep-link and the runs list can server-filter daemon-originated runs (`RunOrigin.Daemon`).
- **Web.** `web/src/features/ops/jobs-tab.tsx` + `job-detail-drawer.tsx` + `use-jobs.ts`.

### D3 — Triggers tab = DESIGNED BUT STUBBED
Render the intended IA **read-only**: a trigger list (cron / webhook / event → target `JobKind`) with an empty-state card "Triggers arrive in Slice 25." **No backend wiring, no endpoints, no contract additions this slice.** Explicitly marked stub scope — the component exists so the four-tab shell is complete and the shape is reviewed early; Slice 25 replaces the empty-state with live data.
- **Web.** `web/src/features/ops/triggers-tab.tsx` (static empty-state only).

### D4 — Devices & Access tab = the remote-access story
Three sections. **(a) Bind status** — display `AGENT_WEB_BIND` (loopback vs LAN/tunnel), `AGENT_WEB_ALLOWED_HOSTS`, port, session TTL (`AGENT_WEB_SESSION_TTL_MS`), served in the `bind` sub-object of `GET /api/daemon/status`; plus static copy-paste **Tailscale + Cloudflare** recipe cards. **(b) Device sessions** — list active device sessions, **PAIR** a new device (mint a per-device session token, surfaced as a URL + QR the user opens on a phone), **REVOKE** a device. **(c) Root token rotate** — break-glass mass-invalidate, behind a strong confirm.
- **Biggest new backend surface.** Today session tokens are **stateless HMAC with NO server-side positive list** (`session-token.ts` keeps only a `revoked-devices.json` negative set), `mintSessionToken` is only ever called for a hardcoded `deviceId:'local'`, and `revokeDevice`/root `rotate()` have **no callers**. So ADD a **persisted device registry** `~/.agent/devices.json` (`{deviceId, label, createdAt, exp}[]`, `0600`/`0700` like the sibling secrets) — a new `src/server/security/device-registry.ts` that `mint` writes to and `revoke`/`rotate` prune.
- **New endpoints** (`src/server/devices/{list,pair,revoke}.ts`, `src/server/security/rotate.ts`; wired into `src/server/app.ts`'s if-ladder, action-sub-path-before-bare-`:id` ordering like `/api/jobs/:id/cancel`):
  - `GET /api/devices` → `{items: DeviceDto[]}` from the registry (prune expired on read).
  - `POST /api/devices {label}` → mint a token for a fresh `deviceId` (`crypto.randomUUID()`) + `label`; append to registry; respond `{deviceId, token, pairingUrl}` — the token appears in the response body **once** (never re-listed) and the client renders it as a copy field + QR of `pairingUrl`.
  - `POST /api/devices/:id/revoke` → `sessionTokens.revokeDevice(id)` + prune registry.
  - `POST /api/security/rotate-root` → `rootTokens.rotate()` (invalidates every outstanding session), then re-mint the local browser's own session so the current tab survives.
- **New DTOs/requests.** `DaemonBindDtoSchema { bind: string, allowedHosts: string[], port: number, sessionTtlMs: number }`; `DeviceDtoSchema { deviceId, label, createdAt, exp }` + `DeviceListResponseSchema`; `DevicePairRequestSchema { label: z.string().min(1).max(120) }` + `DevicePairResponseSchema { deviceId, token, pairingUrl }`; `RotateRootRequestSchema { rootSecret: z.string() }` (D5 re-confirm).
- **Web.** `web/src/features/ops/devices-tab.tsx` + `pair-device-dialog.tsx` (QR via a self-contained inline generator — no external CDN, per artifact/CSP discipline) + `use-devices.ts`.

### D5 — Security posture (CRITICAL) — the primary Fable review target
Pairing / revoke / rotate-root are **privileged writes over the web**. Gate each to BOTH: (1) an authenticated session (the existing `SessionGuard.verify`, already applied to every `/api` route), AND (2) the request coming from the **trusted local principal** — `guard.principal(req) === 'local'` and/or a loopback / `AGENT_WEB_ALLOWED_HOSTS` origin (reuse `hostAllowed`/`originAllowed` from `security/origin.ts`): you pair NEW devices *from the trusted local browser*, so a remote paired device cannot itself mint/revoke/rotate. `rotate-root` **additionally** requires re-confirming possession of the root secret (`RotateRootRequestSchema.rootSecret`, constant-time-compared against `rootTokens.getOrCreateRoot()` via the existing `timingSafeEqual` idiom). A new `requireTrustedLocal(req, guard, policy): Response | null` helper (`src/server/security/trusted-local.ts`) returns `403` when the principal/origin check fails, applied to all three device-management routes on top of the standard session guard. The pairing token in `POST /api/devices`'s response is the ONLY time a device token is transmitted (never persisted in the registry, never re-listed).

### D6 — Daemon control = READ-ONLY status + logs tail (NO remote start/stop)
No remote start/stop button anywhere — the daemon hosts this very web server, so stopping it over its own HTTP surface is a bootstrap paradox; the tab shows **copy-the-CLI-command** guidance (`agent daemon stop`, etc.) instead. Add `GET /api/daemon/logs?tail=&stream=out|err` → a redacted tail of `~/.agent/logs/agent.{out,err}.log`. The endpoint **must redact** any root-token-shaped (`[0-9a-f]{64}`) or `Bearer <token>` substring before returning bytes (§7.3) so logs never leak the durable root or a session token.
- **New DTO/request.** `DaemonLogsQuerySchema { tail: z.coerce.number().int().positive().max(2000).default(200), stream: z.enum(['out','err']).default('out') }`; `DaemonLogsResponseSchema { lines: string[] }`.
- **Web.** folded into `overview-tab.tsx` (or a small `daemon-logs.tsx`) — a monospace tail viewer.

## 4. Backend-gap table (HTTP-reachable today → endpoint to ADD)

| Capability | Reachable today? | Endpoint to ADD / extend | Request → Response |
|---|---|---|---|
| Daemon liveness+uptime | `daemon/core.ts status()` (CLI only, no HTTP) | **extend** `GET /api/daemon/status` | — → `DaemonStatusDto` (adds `startedAt`/`uptimeMs`/`bind`) |
| Queue health counts | ✗ (only `GET /api/jobs` list) | `GET /api/queue/stats` | — → `QueueStatsDto` |
| Job list / detail | ✅ `GET /api/jobs`, `GET /api/jobs/:id` | reuse; add `availableAt` to `JobDto` | query → `JobListResponse` |
| Cancel job | ✅ `POST /api/jobs/:id/cancel` | reuse | — → 200 |
| Resume interrupted | ✅ `POST /api/jobs {resume: runId}` | reuse | `JobEnqueueRequest` → `JobLaunchResponse` |
| Retry failed (w/ lineage) | ✗ | `POST /api/jobs/:id/retry` (stamps `retriedFrom`, §11) | — → `JobLaunchResponse` |
| Filter runs by origin | ✗ | `RunListQuerySchema` gains `origin` facet | query → `RunListResponse` |
| List devices | ✗ (no positive registry exists) | `GET /api/devices` | — → `DeviceListResponse` |
| Pair device | ✗ (`mintSessionToken` hardcodes `'local'`) | `POST /api/devices` | `DevicePairRequest` → `DevicePairResponse` |
| Revoke device | ✗ (`revokeDevice` has no caller) | `POST /api/devices/:id/revoke` | — → 200 |
| Rotate root | ✗ (`rotate()` has no caller) | `POST /api/security/rotate-root` | `RotateRootRequest` → 200 (re-mints local session) |
| Daemon logs tail | ✗ (files exist, no HTTP) | `GET /api/daemon/logs` | `DaemonLogsQuery` → `DaemonLogsResponse` |
| Bind posture | ✗ | in `GET /api/daemon/status`.`bind` | — → `DaemonBindDto` |

## 5. Increment breakdown (SUGGESTION — the plan skill finalizes)

1. **Contracts + DTO deltas** — `JobDto.availableAt`; `RunListQuery.origin`; new `DaemonStatusDto`/`DaemonBindDto`/`QueueStatsDto`/`DeviceDto`+list/`DevicePairRequest`+response/`RotateRootRequest`/`DaemonLogsQuery`+response; parity tests kept green.
2. **Read endpoints** — `JobStore.stats()` (single query, §7.2), `GET /api/queue/stats`, extend `GET /api/daemon/status` (uptime via pid-file mtime + `bind`), `GET /api/daemon/logs` (redacted tail, §7.3).
3. **Device registry + pairing endpoints (SECURITY, §7.1/D5)** — `device-registry.ts`, `trusted-local.ts`, `GET/POST /api/devices`, `POST /api/devices/:id/revoke`, `POST /api/security/rotate-root`.
4. **Web Ops shell** — nav entry, `/ops` route, ⌘K command(s), roving-tabindex sub-nav via `web/src/shared/ui/tab-list.ts`, `RegionErrorBoundary`, `data-testid="area-ops"`.
5. **Jobs tab** (table + drawer + cancel/resume/retry + deep-link).
6. **Overview tab** (three cards + logs tail).
7. **Devices & Access tab** (bind + pair/QR + revoke + rotate confirm).
8. **Triggers stub** (static empty-state).
9. **Docs (4 surfaces) + SDD ledger + live-verify + land** (§8/§10).

## 6. Web IA wiring (exact touch-points)

- `web/src/app/app-shell.tsx` — add `{ to: '/ops', label: 'Ops' }` to `NAV`.
- `web/src/app/router.tsx` — `route('/ops', OpsArea)`; the active tab is a search param (`?tab=overview|jobs|triggers|devices`, `validateSearch` like `RunDetailSearch`) so a tab is deep-linkable and ⌘K can target it.
- `web/src/app/commands.ts` — a `go-ops` `Nav` command (+ optionally one per tab).
- `web/src/features/ops/index.tsx` — `OpsArea`: `<section data-testid="area-ops">`, the roving-tabindex tab-list (`tab-list.ts`), and the four tab panels; each panel is its own `RegionErrorBoundary` region so one failing card never blanks the console.
- All data via `apiFetch(path, { schema })` with the new contract schemas — Bearer is automatic.

## 7. Hard parts (adversarial / ultracode / Fable verification)

### 7.1 Device-pairing security (mint / registry / revoke / rotate, trusted-principal gating, no token leak) — Fable target
**Naive failure modes:** (a) accepting a client-supplied `deviceId` (IDOR — a remote device pairs *itself* a fresh identity, or overwrites `'local'`) — the server MUST mint the id (`crypto.randomUUID()`), never trust the body. (b) Gating pairing only on the session guard, so any *paired remote* device can pair/revoke/rotate — D5's `requireTrustedLocal` (principal `'local'` + loopback/allowed origin) is what closes this; the whole point is you pair FROM the trusted local browser. (c) Re-listing or persisting the minted token (registry stores only `{deviceId,label,createdAt,exp}` — never the token). (d) `rotate-root` reachable without re-confirming the root secret (mass-invalidation as an unauthenticated CSRF-ish write) — `RotateRootRequestSchema.rootSecret` constant-time-compared. (e) rotate-root logging out the operator's OWN tab (self-DoS) — rotate re-mints the local session in the same response.
**Acceptance:** unit tests — pair mints server-side id, appends to registry, returns token once; a request from a non-`'local'` principal / non-loopback origin gets `403` on all three routes; revoke prunes registry AND adds to the negative set so the token stops verifying; rotate invalidates all *other* sessions while the local caller's re-minted token still verifies; rotate with a wrong `rootSecret` → `401`, registry untouched; the minted token never appears in `GET /api/devices`.

### 7.2 Queue-stats accuracy under live concurrency (counts must not race the pool)
**Naive failure mode:** computing per-status counts as six separate `COUNT(*) WHERE status=?` reads while the worker pool concurrently transitions rows (`Queued→Running→Done`) — the six snapshots are taken at different instants, so `sum(counts) ≠ total` and a job can be double-counted or missed, and `activeCount` read at yet another instant disagrees with the DB `Running` count.
**Mechanism:** a single `JobStore.stats()` doing one `SELECT status, COUNT(*) ... GROUP BY status` inside the store's normal read (one consistent SQLite snapshot); `activeCount` is `pool.activeCount()` (in-flight controllers) reported as a **distinct** field from the DB `Running` count (they may transiently differ — the panel labels them separately: "running rows" vs "active workers"), never reconciled by arithmetic.
**Acceptance:** a test enqueues + drives N jobs through a live pool and asserts, on repeated `stats()` calls, `sum(counts.values) === total` every time and no count is negative; and that `activeCount ≤ concurrency`.

### 7.3 Daemon status uptime + logs-tail without secret leakage
**Naive failure modes:** (a) deriving uptime from `process.uptime()` of whatever process answers — correct only because the server runs *in-daemon*, but brittle and wrong the moment status is ever proxied; use `startedAt = statSync(pidPath).mtimeMs` (the daemon's own pid write, `daemon/pid.ts`) with `uptimeMs = Date.now() - startedAt`, robust to who answers. (b) `GET /api/daemon/logs` `cat`-ing the raw log file — the root token or a `Bearer` session token can appear in a logged request/error line, so the tail would exfiltrate the disaster secret over HTTP. The endpoint MUST run a redaction pass replacing `[0-9a-f]{64}` and `Bearer\s+\S+` with `‹redacted›` before returning, and cap `tail` (≤2000 lines) so it can't stream an unbounded file.
**Acceptance:** a test writes a log line containing a 64-hex token and a `Bearer eyJ...` and asserts the endpoint's `lines[]` contain `‹redacted›` and NOT the secret; `uptimeMs` derived from an injected pid-file mtime matches expectation.

## 8. Standing notes (per the CLAUDE.md hard line)

**Architecture-doc update (`docs/architecture.md`).** The **Queue** subsystem gains a `stats()` read + the `/api/queue/stats` route; the **Daemon** subsystem gains the HTTP `/api/daemon/status` (uptime/bind) + `/api/daemon/logs` (redacted tail) surfaces on top of the CLI-only lifecycle. The **server perimeter/auth** section gains the **device registry** (`~/.agent/devices.json`, the first *positive* device list beside the existing negative `revoked-devices.json`), the `trusted-local` privileged-write gate, and the pairing/revoke/rotate-root routes wired into `app.ts`. A **new `web/` Ops console** node is added to the frontend module map (`web/src/features/ops/`, four tabs, the new contract DTOs it consumes). Note the **Slice-26 overlap**: this slice delivers remote-auth's UI half, so Slice 26's row narrows. Regenerate the interactive architecture-snapshot **Artifact** (new Ops-console web node + the daemon/queue HTTP edges + `devices.json` node; updated footer slice count "25b" and test count). `bun run docs:check` + the pre-push slice-landing gate hard-fail until `README.md`, `docs/ROADMAP.md`, and `.superpowers/sdd/progress.md` are updated in the same push.

**Telemetry to emit.** New spans following the `daemon/spans.ts` + `telemetry/spans.ts` `inSpan`/`ATTR` conventions (no parallel emission path, no-op without a tracer): `ops.devices.pair`, `ops.devices.revoke`, `security.rotate-root` (privileged writes — each carrying `ATTR.SERVER_PRINCIPAL` = the authorizing device and a **new** `ATTR.DEVICE_ID` for the target device), `daemon.status.read`, `queue.stats.read`, and `daemon.logs.read`. The rotate-root span additionally records an event marking the mass-invalidation. No new run-root routing — these are server-request-scoped spans nesting under `withServerRequestSpan`.

## 9. Testing strategy

- **Unit (server).** `JobStore.stats()` snapshot consistency under concurrent pool churn (§7.2); `device-registry` append/prune/expire; `trusted-local` accept-local / reject-remote; rotate-root secret compare (right/wrong) + all-other-sessions invalidated + local re-mint verifies; logs redaction (§7.3); `availableAt` projection; `RunListQuery.origin` facet parse.
- **Contract.** parity tests stay green; new DTO round-trips; `DaemonLogsQuery` coercion/caps.
- **Web (vitest + happy-dom).** Ops shell renders four tabs with roving-tabindex keyboard nav (extend the `tab-widget-keyboard.test.tsx` pattern); Jobs tab pagination + facet filters + optimistic cancel/resume/retry; drawer deep-link to `/runs/$runId`; Overview cards from mocked `apiFetch`; Devices pair-dialog renders token+QR once and revoke removes the row; Triggers empty-state; `data-testid="area-ops"` present; a11y-baseline passes.
- **Security tests.** the §7.1 acceptance set is the Fable-reviewed core — IDOR, trusted-local gating, no-token-leak, rotate self-survival.
- **Live-verify.** §10.

## 10. Live-verify gate (mandatory before merge)

On the target box (Mac Mini M4 Pro), against the real daemon under launchd + real Ollama + real Chrome (native `/chrome`, logged-in session):

1. **Jobs lifecycle** — enqueue a crew job (via chat/crew launch) → watch it appear + advance in the **Jobs** tab → **cancel** a running one and see it flip to `Canceled` → **resume** an `Interrupted`-with-checkpoint job and confirm it continues from its last DAG node (no re-execution).
2. **Overview** — daemon card shows running + pid + a plausible uptime; queue card counts match the Jobs tab; a `Failed` job shows in Recent failures with a working Retry.
3. **Device pairing** — from the trusted local browser, **pair** a fake 2nd device → see it listed in Devices & Access with its label → open the pairing URL/QR authenticates a second client hitting `GET /api/jobs` → **revoke** it and confirm that client now gets `401`.
4. **Daemon status + logs** — the logs tail renders recent lines with NO token substrings; the "stop" guidance is copy-only (no remote-stop button exists).
5. **Rotate root (break-glass)** — rotate → confirm every *other* device session is invalidated (the revoked/other clients `401`) while the current operator tab keeps working (re-minted session).

## 11. Resolved decision — lineage-preserving retry

**Retry keeps lineage (user directive: no-deferrals / full completeness).** Rather than a client-side re-`POST` that loses the trail, add a server-side **`POST /api/jobs/:id/retry`**: it loads the failed job, re-enqueues a fresh job with the same `kind`+`payload`, and stamps `retriedFrom: <originalJobId>` onto the new `JobRecord` (a new nullable column + `JobDto.retriedFrom` projection). The Jobs drawer then shows "retry of job X" and can back-link. Gated identically to the other job mutations (session guard). This is a small backend delta folded into increments 1 (contract + column) and 3/5 (route). 404 on unknown/terminal-mismatch; only `Failed`/`Canceled`/`Interrupted` jobs are retryable (a `Done` job is not).
- **Delta.** migration adds `retried_from TEXT NULL` to the jobs table; `JobDtoSchema` gains `retriedFrom: z.string().nullable()`; `JobStore.enqueue` accepts an optional `retriedFrom`; new `src/server/jobs/retry.ts` route wired before the bare `:id` handler.
