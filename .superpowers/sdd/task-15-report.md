# Task 15 report — Ops telemetry + ServerDeps security seam (Slice 25b Incr 3)

**Commit:** `ff0f90a` — feat(telemetry): DEVICE_ID + pair/revoke/rotate-root spans + session-root getter + security seam (Slice 25b Incr 3)
**Branch:** slice-25b-ops-console

> Note: this file previously held a stale Slice-30b "Task 15" report (Command
> dispatcher, D8) reusing the same filename — overwritten with the current
> Slice-25b Task 15 report.

## What landed

### AUDIT CRITICAL-1 — session-root getter (the core security fix)
`src/server/security/session-token.ts`: `createSessionTokenStore`'s `rootToken`
param is now `string | (() => string)`. A module-local `currentRoot()` resolves
it PER CALL (`typeof … === 'function' ? config.rootToken() : config.rootToken`)
and is called inside BOTH `sign()` sites — `mintSessionToken` (mint) and
`verifySessionToken` (verify). The captured `const { rootToken }` is gone; the
getter re-reads the live root on every sign/verify, so a `rotate()` on the
underlying `RootTokenStore` takes effect immediately on the same live store.
`sign(rootToken: string, …)` is unchanged (still takes a resolved string).
Backward compatible: existing callers pass a `string`, which the union accepts
and collapses to a constant — behaviour unchanged.

**Proof test** (added to `tests/server/security/session-token.test.ts`): builds
the store with `rootToken: () => rootStore.getOrCreateRoot()`, mints a token
(verifies OK), calls `rootStore.rotate()`, then asserts the PRE-rotate token now
verifies `null` (its sig was over the old root) AND a token minted POST-rotate
verifies OK (deviceId returned) — proving mint + verify both resolve per-call,
not once at build. All 12 pre-existing session-token tests (the string-passing
regression guard) stay green.

### Telemetry — ATTR.DEVICE_ID + ops spans
- `src/telemetry/spans.ts`: added `ATTR.DEVICE_ID = 'device.id'` next to
  `SERVER_PRINCIPAL`.
- `src/server/devices/spans.ts` (new): `recordDevicePair(deviceId, principal)` →
  `ops.devices.pair`, `recordDeviceRevoke(deviceId, principal)` →
  `ops.devices.revoke` (both set `SERVER_PRINCIPAL` + `DEVICE_ID`), and
  `recordRotateRoot(principal)` → `security.rotate-root` (sets `SERVER_PRINCIPAL`,
  adds an `all-sessions-invalidated` event, NO `DEVICE_ID` — rotate targets no
  single device). Each is a one-shot start/end span, no-op without a tracer,
  following the `daemon/spans.ts` convention.

**No-secret confirmation:** the pair test iterates every attribute key on the
finished span and asserts none contains `token`/`secret` — spans carry only
principal + opaque deviceId. The rotate test asserts `device.id` is `undefined`.

### ServerDeps security seam
`src/server/app.ts`: added three OPTIONAL fields — `deviceRegistry?:
DeviceRegistry`, `rootTokens?: RootTokenStore`, `publicBaseUrl?: string` — with
`DeviceRegistry`/`RootTokenStore` type imports. All optional (matching the
`runLimiter?`/`daemonPidPath?` precedent) so the ≥12 legacy fixtures compile
unchanged; the T16-19 routes will 503 via the shared `need()` until T20 wires
real values. No `main.ts` construction change (that is T20's job).

## TDD
- RED: devices spans test failed on missing module; getter test failed with a
  `createHmac` "key must be string … received function" TypeError (an unresolved
  function reached `sign`) — confirming the old store could not accept a getter.
- GREEN: 19/19 across the two files after implementation.

## Gate (all green)
- `bun run typecheck` — clean.
- `bun run lint:file` (all 6 changed files) — clean (fixed one biome
  format + import-sort after writing the test).
- `bun test tests/server/ tests/telemetry/` — 394 pass / 0 fail (92 files).
- pre-commit docs-check passed on commit.

## Files changed
- `src/server/security/session-token.ts` (getter)
- `src/telemetry/spans.ts` (ATTR.DEVICE_ID)
- `src/server/devices/spans.ts` (new)
- `src/server/app.ts` (3 optional ServerDeps fields + imports)
- `tests/server/devices/spans.test.ts` (new)
- `tests/server/security/session-token.test.ts` (getter proof test appended)

## Concerns
- None blocking. `deviceRegistry`/`rootTokens`/`publicBaseUrl` are unwired seams
  — the T16-20 routes/main.ts wiring must populate `rootTokens` as the SAME
  instance the session store's root getter reads (T20), or rotate-root's live
  invalidation won't be observable end-to-end. That is the documented T20 job.
- The rotate-root span deliberately carries no `deviceId`; a future per-session
  invalidated-count would be an added attribute on the same span, not a schema
  change.

---

# Task 15 — engine.ts (triggers subsystem composition root)

**Status:** COMPLETE. Commit `c874008` on branch `slice-25-triggers`.

## What shipped
- `src/triggers/engine.ts` — `createTriggersEngine(deps)` returning a
  `TriggersEngine { store, secretStore, fire, handleJobSettled, start(), stop() }`.
  Wires the single `createFireTrigger` into scheduler + watcher + chain observer
  (shared convergence), resolves `pollMs`/`watchRoot`/`maxChainDepth` from
  `loadConfig()` with the injected `config.*` override winning, and threads
  `now`/`setInterval`/`clearInterval`/`watch` seams into the sub-components.
- `start()` order: `syncRepoTriggers(store, repoDefs)` → `scheduler.start()`
  (its own reconcile runs first) → `watcher.start()`.
- `stop()` reverse teardown: `scheduler.stop()` → `await watcher.stop()` →
  `store.close()`.
- `handleJobSettled` = `chain.handleJobSettled` (observer is NOT started; it is
  the callback Task 16 passes to `createWorkerPool({ onSettled })`).
- Exported a minimal `TriggerSecretStore` type (`resolve(secretRef)`); engine
  only holds+exposes it, so this task does not depend on Task 18 landing.

## Deviations / decisions
- Added `now`/`setInterval`/`clearInterval`/`watch` seams to the deps beyond the
  brief's literal Produces block — required by the brief's Step-1 test (fake
  timers + fake chokidar) and the launching agent's "injectable seams thread
  through" note. Daemon passes none → real implementations.
- `maxChainDepth` reads a config loaded ONCE at construction (single `loadConfig`
  call) rather than re-calling `loadConfig()` per invocation as the brief's
  sample literally wrote — same live-config semantics, kept as a `() => number`
  getter for the fire.ts/chain seam.

## Tests (tests/triggers/engine.test.ts, 3 tests)
1. start/stop lifecycle runs clean + syncs repo defs (order proof: a repo cron's
   `nextRunAt` is seeded only because sync ran before scheduler.reconcile).
2. `handleJobSettled` forwards to the chain observer — a matched jobchain trigger
   records a firing through the engine's own store/fire.
3. `stop()` clears the exact interval id `start()` armed, closes every watcher,
   and closes the DB (post-stop `store.get()` throws).

Gate: `bun run typecheck` clean; `bun run lint:file` clean (exit 0, 0 warnings);
focused suite 3/3 pass; full `tests/triggers/` 93/93 pass.

## Concerns / carries
- **T13 N-carry (logger for chain observer's swallowed fire rejection) NOT
  applied here — defer to Task 16.** `createChainObserver` (chain.ts) does not
  accept a logger param; its `fire().catch(() => {})` still swallows silently.
  Adding a logger would require modifying chain.ts + its tests (out of scope for
  this integration task). T16 should either add a `log?` seam to
  `createChainObserver` or have the engine wrap `handleJobSettled` with logging.
- `TriggerSecretStore` is a minimal placeholder type. Task 18's real
  `createTriggerSecretStore` must align to / re-export this shape (or the engine
  import updates) when it lands.
- Engine opens a SECOND bun:sqlite connection onto the same jobs.db as the
  injected jobStore — this is the pre-existing M7 dual-connection design already
  documented in fire.ts (audit-only gap), not new.
