# Task 4 Report — Device DTOs + pairing requests + rotate-root request (Slice 25b Incr 1)

## Status: DONE

Note: this report file previously held a stale Phase-8 Task 4 report
(`useReducedMotion` hook, unrelated slice/phase). That content was already
committed under its own SHA in that phase and is unaffected by this overwrite.

## Summary
Added the device-management + security request/response DTOs for the Devices &
Access tab, per the brief and the "Shared contracts" snippet in
`docs/superpowers/plans/2026-07-19-slice-25b-ops-console.md:77-104`. Pure
schema declarations + inferred types + round-trip tests only — no endpoint
wiring (that's future Task 13/14/T21 work per the plan).

## Implementation
- **`src/contracts/dto.ts`** — appended after `QueueStatsDtoSchema` (Task 3's
  addition, 2e1daee):
  - `DeviceDtoSchema { deviceId: string, label: string, createdAt: number, exp: number }`
    + `DeviceDTO` inferred type. `exp` is the device's session-token expiry
    (epoch-ms) — the registry never stores the token itself.
  - `DeviceListResponseSchema { items: DeviceDtoSchema[] }` + `DeviceListResponse`.
- **`src/contracts/requests.ts`** — appended after `JobListResponseSchema`
  (Task 3's addition):
  - `DevicePairRequestSchema { label: z.string().min(1).max(120) }` +
    `DevicePairRequest`.
  - `DevicePairResponseSchema { deviceId: string, token: string, pairingUrl: string }`
    + `DevicePairResponse`.
  - `RotateRootRequestSchema { rootSecret: z.string() }` + `RotateRootRequest`.
- No change needed to `src/contracts/index.ts` — it re-exports via
  `export * from './dto.ts'` / `'./requests.ts'`, so the new schemas are
  already reachable from `@contracts`.
- Doc comments added above each schema explaining the wire contract (token
  transmitted exactly once, `exp` vs token, root-secret re-confirm) matching
  the file's existing comment density/style (e.g. `DaemonBindDtoSchema`,
  `JobEnqueueRequestSchema`).

## TDD
- **RED**: wrote `tests/contracts/device-dto.test.ts` verbatim from the brief
  first; ran `bun test tests/contracts/device-dto.test.ts` → failed with
  `SyntaxError: Export named 'DeviceListResponseSchema' not found in module
  '.../src/contracts/dto.ts'` (confirms missing export, not a typo/import path
  bug).
- **GREEN**: added the schemas; re-ran → `2 pass, 0 fail, 4 expect() calls`.
- One deviation from the brief's literal test text: the line
  `expect(() => DevicePairRequestSchema.parse({ label: 'x'.repeat(121) })).toThrow();`
  exceeds Biome's line-length wrap rule under `lint:file`. Reformatted to
  Biome's required multi-line form (identical assertion/behavior) — required
  to pass the gate; no other deviation.

## Files changed
- `src/contracts/dto.ts` (modified)
- `src/contracts/requests.ts` (modified)
- `tests/contracts/device-dto.test.ts` (new)

## Gate results (all inline, all green)
- `bun run typecheck` → clean (`tsc --noEmit`, no errors).
- `bun run lint:file -- src/contracts/dto.ts src/contracts/requests.ts tests/contracts/device-dto.test.ts`
  → clean after the formatting fix above (`Checked 3 files in 6ms. No fixes applied.`).
- `bun test tests/contracts/device-dto.test.ts` → `2 pass, 0 fail`.
- `bun test tests/contracts/` (full contract-parity suite, all 32 files) →
  `123 pass, 0 fail, 192 expect() calls` — no regressions from Tasks 1-3's
  additions (job/run/daemon/queue contracts).

## Commit
`c8caf6a` — `feat(contracts): Device DTOs + pair/rotate-root requests (Slice 25b Incr 1)`
on branch `slice-25b-ops-console` (3 files changed, 57 insertions). Only the
three intended files were staged (`git add` by explicit path, not `-A`); other
working-tree modifications present at commit time (`.remember/`,
`.superpowers/sdd/task-{1,2,3}-*`, plan doc) belong to sibling tasks/history
and were deliberately left untouched/unstaged. Pre-commit `docs-check` hook
passed automatically (`✔ docs-check: living docs present + linked; every src
subsystem documented.`) — no `docs/architecture.md` edit was needed since
`src/contracts/` was already a documented subsystem before this task.

## Self-review
- Schema field names/types match the plan's "Shared contracts" snippet
  (`docs/superpowers/plans/2026-07-19-slice-25b-ops-console.md:80-103`) and
  the design spec
  (`docs/superpowers/specs/2026-07-19-slice-25b-ops-console-design.md:44`)
  verbatim — no deviation, no judgment calls needed on shape.
- `enum` over unions / `type` over `interface` — n/a here (no new enums or
  object-shape types beyond the inferred DTO types, consistent with every
  sibling schema in the file).
- No `z.record` over an enum used in this task (the Task-3
  `z.partialRecord`-vs-exhaustive-`z.record` pitfall doesn't apply — no
  enum-keyed record was needed for device/security DTOs).
- No `console.log`, no `any`, no deviation from repo code style.

## Concerns
None. Endpoint wiring (`POST /api/devices`, `/api/devices/:id/revoke`,
`POST /api/security/rotate-root`, `requireTrustedLocal`, `DeviceRegistry`) is
explicitly out of scope per the brief and belongs to later tasks (T13/T14/T21
per the plan) that will consume these schemas.
