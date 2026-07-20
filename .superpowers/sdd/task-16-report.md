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
