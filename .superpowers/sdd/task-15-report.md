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
