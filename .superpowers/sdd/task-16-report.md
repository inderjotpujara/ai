# Task 16 report — `GET /api/devices` list (Slice 25b Ops Console, Increment 3)

(Note: this overwrites a stale `task-16-report.md` from an earlier
task-numbering pass — a Slice 30b Phase 8 D8 command-palette report — per
this repo's numbering-reuse convention, same as that file itself noted about
its own predecessor.)

## Status: Complete

## Route
`GET /api/devices`, wired in `src/server/app.ts` right after `/api/daemon/logs`
and before `POST /api/jobs`. Handler: `handleDeviceList` in the new
`src/server/devices/list.ts`, following the `handleJobList` pattern exactly
(same `json()` helper shape, same Zod-parse-then-200 style).

## Guard used
Session guard only (the shared `guard.verify(req)` check in `buildFetch` that
fronts every `/api` route) — matches the brief's explicit call-out: this is a
**read/list**, not a mutation, so `requireTrustedLocal` (T14) is **not**
applied here. It lands on the pair/revoke/rotate routes (T17-19) per the plan.
Confirmed via a 401-unauthenticated + 503-unwired integration test added to
`tests/server/app.test.ts` (see below) — the route degrades cleanly with no
extra gating beyond the standard bearer check.

`deviceRegistry` is optional on `ServerDeps` (T13/T15), so the handler is
reached via the shared `need(deps.deviceRegistry, 'deviceRegistry')` guard
(exported from `app.ts`, T8) — reused verbatim, not redefined. An unwired
registry throws `DepUnavailableError`, caught by `handleApi`'s existing
catch block and mapped to a 503 `{ error: 'server dependency not configured:
deviceRegistry' }`, same as the `queueConcurrency`/`daemonPidPath` precedents.

## Prune-on-read
`deps.deviceRegistry.list()` (device-registry.ts) filters `exp <= now` on
every call and persists the pruned set, so an expired device silently stops
appearing on the next `GET /api/devices` — no separate cron/sweep needed.
`handleDeviceList` does no additional filtering; it trusts `list()`'s
contract and maps the result straight into `DeviceListResponseSchema.parse`.

## No-token-in-response confirmation
`DeviceDtoSchema` (`src/contracts/dto.ts`) is `{deviceId, label, createdAt,
exp}` — structurally has no `token` field, and `DeviceRecord` (the registry's
own persisted type) never carries one either (the registry's `append()` even
strips any smuggled extra field defensively). The Zod `.parse()` step is a
second, runtime-enforced backstop: any accidental extra property on the
mapped object would need to pass the schema, and the schema has no such
field. The test asserts `'token' in item` is `false` explicitly.

## TDD
- **RED**: wrote `tests/server/devices/list.test.ts` per the brief's exact
  sample test (200-with-items, no-token assertion) plus one added sanity
  case (empty registry → `{items: []}`, 200). Ran — failed with
  `Cannot find module '.../src/server/devices/list.ts'` (module didn't exist
  yet), confirming RED.
- **GREEN**: implemented `src/server/devices/list.ts` verbatim per the
  brief's Step 3 code, wired the route per Step 4. Re-ran — 2/2 pass.
- Fixed two lint/typecheck nits along the way (not scope changes): the test's
  `res.json()` return needed an explicit cast (matches the existing
  `jobs/list.test.ts` idiom: `(await res.json()) as {...}`), and Biome's
  `noNonNullAssertion` on `body.items[0]!` was resolved by destructuring
  `const [item] = body.items` instead of a non-null-asserted index.
- Also added one integration test to `tests/server/app.test.ts` — the shared
  fixture's `deps` never sets the optional `deviceRegistry`, so this proves
  the full route ladder: 401 unauthenticated, 503 `deviceRegistry` unwired
  when authenticated — mirroring the existing `queue/stats` and
  `daemon/status` 503 precedents in that same file (same pattern, not
  something new invented).

## Gate results
- `bun run typecheck` — clean.
- `bun run lint:file -- src/server/devices/list.ts src/server/app.ts
  tests/server/devices/list.test.ts tests/server/app.test.ts` — clean (after
  the two nits above).
- `bun test tests/server/devices/list.test.ts tests/server/app.test.ts` —
  20 pass / 0 fail.
- `bun test tests/server/` (sanity, per dispatch instructions) — 347 pass /
  0 fail across 75 files.

## Files changed
- `src/server/devices/list.ts` (new) — `handleDeviceList`.
- `src/server/app.ts` (modified) — import + route wiring (GET
  `/api/devices`, plus a comment noting the action-sub-path-before-bare-`:id`
  ordering T17/T18 must respect when they add `POST /api/devices` and
  `/api/devices/:id/revoke`).
- `tests/server/devices/list.test.ts` (new) — unit tests for the handler.
- `tests/server/app.test.ts` (modified) — one new integration test for the
  wired route's 401/503 behavior.

## Commit
`e67f824` — `feat(devices): GET /api/devices list (Slice 25b Incr 3, D4)`
(branch `slice-25b-ops-console`)

## Span
No dedicated `ops.devices.list` span added — the brief's interface section
doesn't name one, and the pattern this task follows (`handleJobList`) also
has no handler-level span; the route is already covered by
`withServerRequestSpan` in `handleApi`. Per the dispatch instructions ("if
the brief names one; else no span") this is correct as-is.

## Concerns
None. The brief, the real `device-registry.ts`, `app.ts`'s `need()` export,
and the `DeviceDtoSchema`/`DeviceListResponseSchema` contracts all matched
exactly — no contradictions found, no NEEDS_CONTEXT stop required.

---

# Task 16 — Daemon lifecycle-binding (Slice 25 Increment 3, actual)

**Status:** COMPLETE. Commit `163deaa` on `slice-25-triggers`.

## What shipped
- **`src/daemon/core.ts`** — `CreateDaemonOptions.triggers?: TriggersEngine`.
  `start()` forwards the engine to the injected `startWebServer({ ..., triggers })`
  then calls `opts.triggers?.start()` as step 5b (AFTER pool.start + server — the
  producer comes up last). `stop()` calls `await opts.triggers?.stop()` as the
  FIRST awaited line (before `pool.stop()` — stop producing before draining
  consumers, per D2).
- **`src/cli/daemon.ts buildRealDaemon`** — builds `secretStore` + `triggers`
  engine beside the pool (same `AGENT_QUEUE_PATH` jobs.db, its own store
  connection/tables), adds `onSettled: triggers.handleJobSettled` to the pool,
  passes `triggers` to `createDaemon`. Runs triggers UNCONDITIONALLY (real
  deployment — no flag consulted).
- **`src/server/main.ts`** — `StartOptions.triggers?` + return-handle `triggers?`;
  `ServerDeps.triggers` set. Injected mode: uses `opts.triggers` (caller/daemon
  owns lifecycle — no start/stop here). Standalone: auto-constructs its OWN engine
  ONLY when `opts.triggers` absent AND `AGENT_TRIGGERS_ENABLED` truthy (I3),
  wiring `onSettled`, `start()` after `pool.start()`, and extending the standalone
  `onShutdown` to `await triggers.stop()` FIRST then `pool.stop()` then
  `jobStore.close()`. Flag off (default) ⇒ no engine, no scheduler/watcher handle.
- **`src/server/app.ts`** — `ServerDeps.triggers?: TriggersEngine` (Increment-5
  routes will `need(deps.triggers, 'triggers')`).
- **`src/triggers/secret-store.ts` (NEW)** — minimal `createTriggerSecretStore`.
  `createTriggerSecretStore` did NOT exist yet (the brief assumed it; it is slated
  for Task 18). Built a minimal fail-closed factory (`resolve` → undefined) that
  the two composition roots call now; Task 18 fills in real resolution in place.
- **`src/triggers/chain.ts`** — T13 carry CLOSED: the fire-and-forget `fire()`
  rejection is now logged (`log.error('chain fire failed', {triggerId, jobId,
  error})`) instead of silently swallowed. Chose the "logger in the observer"
  option (injectable `log?`, defaulting to `createLogger('triggers.chain')`,
  mirroring `watcher.ts`) — it is the ONLY layer that can see the internal
  rejection (`handleJobSettled` is sync and swallows internally, so wrapping it at
  the daemon layer could not observe it).

## Key decisions / deviations
- **`CreateDaemonOptions.triggers` typed as full `TriggersEngine`, not the brief's
  minimal `{ start; stop }`.** The daemon forwards the engine to `startWebServer`
  whose `StartOptions.triggers`/`ServerDeps.triggers` need the full engine (routes
  use store/fire/secretStore). Typing it minimally would force a cast in
  production forwarding code. The unit test injects a minimal fake cast
  `as unknown as TriggersEngine` (mirrors the existing `pool as never` pattern in
  the same corpus).
- **Return handle gains `triggers?`** — makes the I3 invariant directly testable
  (flag-off ⇒ undefined) and lets standalone callers tear the engine down;
  symmetric with the existing `jobStore`/`pool` on the handle.

## Tests (TDD)
`tests/daemon/core-triggers.test.ts` — 3/3 pass: (1) daemon start order
`[reconcile, pool.start, server.start, trg.start]` + stop order `[trg.stop,
pool.stop]` + engine forwarded to injected server; (2) I3 flag-OFF ⇒ no engine
(`h.triggers` undefined); (3) flag-ON ⇒ engine constructed + torn down cleanly.
Regression sweep: `tests/daemon` + `tests/server` + `tests/triggers` = 514 pass /
0 fail. Gate green: `bun run typecheck` clean, `bun run lint:file` clean (biome
auto-formatted import wraps), focused `-t "starts triggers AFTER"` 1 pass.

## Concerns
- `createTriggerSecretStore` is a stub (resolve→undefined) — Task 18 MUST replace
  its body with real env/secure-file resolution before webhook HMAC (Task 19) can
  verify anything. Fail-closed, so no security hole in the interim.
- onSettled wiring in `buildRealDaemon`/standalone is verified by construction +
  typecheck (signature match); end-to-end "chain fires on terminal settle" rests
  on the T13 chain.ts tests + future integration/live-verify (buildRealDaemon
  isn't unit-injectable, so a cheaper direct assertion wasn't feasible here).

## Fix pass

**MEDIUM (review):** a throwing `triggers.stop()` (producer) skipped the
`pool.stop()` drain (consumer) at BOTH teardown sites — wedging graceful
shutdown on a chokidar/sqlite close rejection.

**Fix, both sites:** wrapped the producer engine stop in try/catch, logged the
failure via a `createLogger` instance (mirroring the T13 `chain.ts` norm:
`log.error(msg, { error: err instanceof Error ? err.message : String(err) })`),
swallowed it, then unconditionally proceeded to the drain:
- `src/daemon/core.ts` `stop()` — `await opts.triggers?.stop()` now wrapped;
  always falls through to `await opts.pool.stop(opts.drainTimeoutMs)`. Added
  module-level `const log = createLogger('daemon.core')`.
- `src/server/main.ts` standalone `onShutdown` (`if (opts.triggers ===
  undefined)` branch) — `await triggers?.stop()` now wrapped; always falls
  through to `await pool.stop()` then `jobStore.close()`. Added
  `import { createLogger } from '../log/logger.ts'` + module-level `const log
  = createLogger('server.main')` (no logger previously existed in this file).

**Test:** extended `tests/daemon/core-triggers.test.ts` with `'a rejecting
triggers.stop() still lets the pool drain and does not reject daemon.stop()'`
— injects a `triggers.stop()` that throws, asserts the observed order is
`[reconcile, pool.start, server.start, trg.start, trg.stop, pool.stop]` (pool
still drains) and that `daemon.stop()` resolves (does not reject).

**Gate:** `bun run typecheck` clean; `bun run lint:file -- src/daemon/core.ts
src/server/main.ts tests/daemon/` clean; `bun run test:file -- tests/daemon/`
— 31 pass / 0 fail across 7 files (new test included; error log line observed
in stderr as expected, confirming the degrade-and-log path fired).

**Files touched:** `src/daemon/core.ts`, `src/server/main.ts`,
`tests/daemon/core-triggers.test.ts`.

**Commit:** `fix(daemon): producer engine.stop() failure must not skip pool
drain`.
