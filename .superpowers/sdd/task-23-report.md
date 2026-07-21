# Task 23 Report — Ops console shell + `/ops` route + tab search param (Slice 25b Incr 4)

> NOTE: This file previously held a stale Phase-8 (Slice 30b) Task-23 report; overwritten with the current Slice 25b task.

## Status: DONE

Commit: `05d1435` — `feat(web): Ops console shell + /ops route + tab search param (Slice 25b Incr 4)`

## What shipped

- **Nav** — `web/src/app/app-shell.tsx`: added `{ to: '/ops', label: 'Ops' }` to the `NAV` array, placed right after `/runs` (matching the brief's ordering).
- **Route** — `web/src/app/router.tsx`: added `OpsSearch` type (`{ tab?: 'overview'|'jobs'|'triggers'|'devices' }`) and an `opsRoute` built with `createRoute` + `validateSearch`, mirroring the existing `runDetailRoute`/`RunDetailSearch` pattern exactly (invalid/missing `tab` values fall back to `'overview'`). Registered `opsRoute` in `rootRoute.addChildren([...])` right after `/library`.
- **⌘K command** — `web/src/app/commands.ts`: added a `go-ops` `Nav`-kind command (`n({ to: '/ops' })`), inserted before `go-library`. Did not add per-tab palette entries — the brief said "optionally," and a single `go-ops` entry is consistent with how other multi-tab areas (Library, Builders) are represented in the palette (one entry, not one per tab).
- **`OpsArea` shell** — new `web/src/features/ops/index.tsx`: exports `OpsTab` enum (`Overview/Jobs/Triggers/Devices`) and `OpsArea`. `<section data-testid="area-ops">` renders a roving-tabindex `role="tablist"` (reusing `nextTabIndex` from `shared/ui/tab-list.ts` verbatim — no reimplementation) and four tab panels, each its own `<RegionErrorBoundary region={"Ops: " + label}>` so one failing tab can never blank the whole console. Panels are stubs (`data-testid="ops-panel-<tab>"`, placeholder text) — real content lands in later increments (5–8) per the brief.
- **Search-param wiring**: one deliberate deviation from the brief's sample code — used `useSearch({ from: '/ops' })` (imported from `@tanstack/react-router`) instead of `getRouteApi('/ops')`. Verified `getRouteApi` is not used anywhere else in this codebase (`grep -rn getRouteApi web/src` → no hits), while `useSearch({ from: ... })` is the established convention (`run-detail.tsx` uses it for `RunDetailSearch`). This follows the brief's own instruction to "mirror the real runDetailRoute... patterns rather than guessing" — same behavior, better convention match. Tab switches call `navigate({ to: '/ops', search: { tab: next } })`, so `?tab=` is deep-linkable and browser back/forward works.

## TDD trace
1. Wrote `web/src/features/ops/index.test.tsx` first (per the brief's exact spec: renders 4 tabs defaulting to Overview; deep-links via `?tab=jobs`).
2. Ran it → FAIL ("Not Found" — no `/ops` route existed yet). Confirmed RED.
3. Implemented route + nav + `OpsArea` → re-ran → PASS (2/2).

## Gate results (web)
- `cd web && bun run typecheck` → clean, no errors.
- `cd web && bun run test` → **64 test files / 350 tests passed** (full suite, not just the new file).
- `bun run lint:file -- web/src/features/ops/index.tsx web/src/features/ops/index.test.tsx web/src/app/router.tsx web/src/app/app-shell.tsx web/src/app/commands.ts` (biome, root-level — `web/` has no separate lint script) → initially 3 formatting-only findings (line-wrap style), fixed via `bunx biome check --write` on the same file set, re-ran clean.
- Pre-commit hook (`docs-check`) passed — web-only change, no `src/architecture.md` doc-gate trip.

## Files changed
- `web/src/app/app-shell.tsx` (nav entry)
- `web/src/app/router.tsx` (`OpsSearch` type + `opsRoute` + import + `addChildren`)
- `web/src/app/commands.ts` (`go-ops` command)
- `web/src/features/ops/index.tsx` (new — `OpsArea` shell)
- `web/src/features/ops/index.test.tsx` (new — component test)

Only these 5 files were staged and committed (`git add <specific files>`, not `-A`) — the repo's pre-existing unrelated modified `.remember/`/`.superpowers/sdd/task-*` files were left untouched/unstaged, as instructed.

## Concerns / notes for later increments
- Panels are pure stubs by design (Increments 5–8 fill Overview/Jobs/Triggers/Devices with real content) — nothing to flag there.
- `go-ops` is a single palette entry (not one per tab); if a future task wants direct ⌘K deep-links to individual Ops tabs (e.g. "Go to Ops → Jobs"), that's an easy additive change to `commands.ts` (`n({ to: '/ops', search: { tab: OpsTab.Jobs } })`) — flagging so it isn't assumed already covered.
- No architecture.md / README / ROADMAP changes made — this is an interior increment of an already-tracked Slice 25b; the living-docs update is expected to land with the slice's overall doc pass, not a single sub-task, consistent with how prior Slice-25b increments have been landing.


---

# Task 23 Report — Trigger mutating handlers (create/patch/delete) (Slice 25)

## Status: DONE

Commit: `54e9fed` — `feat(triggers): mutating routes (create/patch/delete) behind requireTrustedLocal + repo-origin rules`

## What shipped

- **`src/server/triggers/config-parse.ts`** (new) — `parseTriggerConfig(type: TriggerTypeWire, raw: unknown): TriggerConfig`. Dispatches EXPLICITLY on the caller-supplied `type` (never inferred from `raw`'s shape, since `TriggerConfig` is a non-discriminated union) to `CronConfigSchema`/`WebhookConfigSchema`/`FileConfigSchema`/`JobChainConfigSchema`. Cron additionally runs `validateCron(schedule, timezone)`, throwing a plain `Error` on a bad pattern. File additionally runs `confineWatchPath(cfg.path, expandHome(loadConfig().values.AGENT_TRIGGERS_WATCH_ROOT))` — the SAME expanded root `triggers/watcher.ts` re-confines against at watch-start, so a path accepted at create time can never be watch-time-rejected (§7.4). The confined result is discarded; the stored config keeps the caller's literal path. File/jobchain configs are cast `as unknown as TriggerConfig` (wire↔domain enum members aren't structurally assignable, same idiom as `enqueue.ts`'s `JobKind` cast); cron/webhook need no cast (plain fields, no enums).
- **`src/server/triggers/create.ts`** (new) — `handleTriggerCreate(req, deps, guard)`. `requireTrustedLocal` FIRST (zero side effect on reject) → parse `TriggerCreateRequestSchema` (400) → `parseTriggerConfig` (400 on any throw, incl. bad cron / escaping file path) → M2 duplicate-name pre-check `store.getByName(name, Console)` → 409 *before* any mint/insert → webhook-only: mint a 128-bit path token (`randomBytes(16)`), hash it (`hashToken`, only the hash persisted), mint an HMAC secret via `secretStore.mint()` when `config.hmac` → cron-only: seed `nextRunAt` via `computeNextRun({config} as Trigger, Date.now())` (the function only reads `.config`, so a minimal object is sufficient pre-insert) → `store.create` + `recordTriggerRegister` (id/type/origin only, never the token/secret) → `201` with `TriggerCreateResponseSchema` (`webhookToken`/`webhookUrl` present only for a webhook create — the DTO itself never carries them).
- **`src/server/triggers/patch.ts`** (new) — `handleTriggerPatch(id, req, deps, guard)`. `requireTrustedLocal` FIRST → 404 if absent → parse `TriggerPatchRequestSchema` (400) → **repo-origin rows**: any `target`/`config` field in the same request → 403 ("pause/resume-only"), even alongside a legitimate `enabled` flip (no partial-apply). Console rows: `config` (when present) is re-validated via `parseTriggerConfig` against the trigger's own immutable-via-patch `type` (400 on bad cron/path, same as create). For a cron trigger, `nextRunAt` is recomputed when the config changed (old value was computed against the old schedule) or when `enabled` flips to `true` while `nextRunAt` is currently unset (a parked row, e.g. from a previously-uncomputable pattern, must be re-seeded). Returns the updated `TriggerDTO` via `toTriggerDto`.
- **`src/server/triggers/delete.ts`** (new) — `handleTriggerDelete(id, req, deps, guard)`. `requireTrustedLocal` FIRST → 404 if absent → repo-origin → 403 ("edit `triggers/`") → console: `secretStore.remove(secretRef)` (no-op if absent) THEN `store.remove(id)` (so a crash mid-delete can only leak an orphaned secret, never a dangling trigger row) → `200 {deleted:true}`.
- **`tests/server/triggers-mutate.test.ts`** (new, 14 tests) covering: trusted-local 403 (non-local principal AND non-loopback Host) with zero side effect on create/patch/delete; webhook create returns the token exactly once + correct `/hooks/:token` URL, never leaks into `GET /api/triggers` or the stored row; bad-cron 400; escaping-file-path 400; duplicate console name 409 with no second row/secret; repo-trigger patch (enabled OK, config 403, definition untouched by the rejected edit); console-trigger config patch applies + recomputes `nextRunAt`; bad-cron patch 400; patch/delete 404 on unknown id; repo-trigger delete 403; console-trigger delete 200 + secret actually removed from the secret store.

## TDD trace
1. Read the full substrate first (store.ts, confine.ts, next-run.ts, secret-store.ts, webhook-verify.ts, engine.ts, contracts requests/dto/enums, trusted-local.ts + the `handleDevicePair`/`handleDeviceRevoke`/`handleRotateRoot` precedents) to nail the exact interfaces before writing code.
2. Wrote all 14 tests in `triggers-mutate.test.ts` against the not-yet-existing handlers → confirmed RED (module-not-found).
3. Implemented `config-parse.ts` → `create.ts` → `patch.ts` → `delete.ts` in that dependency order.
4. Ran the suite → GREEN on the first pass after two small type-cast fixes (file/jobchain config casts; `merged: Trigger` construction in patch's recompute branch).

## Gate results
- `bun run typecheck` → clean, no errors (whole repo).
- `bun run lint:file -- src/server/triggers/create.ts src/server/triggers/patch.ts src/server/triggers/delete.ts src/server/triggers/config-parse.ts tests/server/triggers-mutate.test.ts` → 2 rounds of `biome check --write` auto-fixes (import ordering, one formatter wrap), then clean.
- `bun test tests/server/triggers-mutate.test.ts` → **14 pass, 0 fail, 41 expect() calls**.
- `bun test tests/server/triggers-read.test.ts tests/server/triggers-mutate.test.ts tests/contracts/` → **151 pass, 0 fail** (no regression to the Task 22 read handlers or contract/enum-parity tests).
- `bun run docs:check` → passes (no `src/architecture.md` update expected mid-slice, consistent with every prior Slice 25 task commit on this branch — confirmed by `git log` showing no doc-touching commits until slice landing).
- Pre-commit hook ran `docs:check` on the actual commit — passed.

## Files changed / committed
- `src/server/triggers/config-parse.ts` (new)
- `src/server/triggers/create.ts` (new)
- `src/server/triggers/patch.ts` (new)
- `src/server/triggers/delete.ts` (new)
- `tests/server/triggers-mutate.test.ts` (new)

Only these 5 files were staged and committed (`git add <specific files>`, not `-A`); the branch's pre-existing unrelated modified `.remember/`/`.superpowers/sdd/task-*` files were left untouched/unstaged.

## Concerns / notes for later tasks
- **Routing not wired**: per the brief's exact file list (and matching the Task 22 precedent, whose read handlers are also not yet wired into `app.ts`), these three handlers are NOT yet mounted onto `POST /api/triggers`, `PATCH /api/triggers/:id`, `DELETE /api/triggers/:id` in `src/server/app.ts`. `app.ts` currently has no `/api/triggers*` routing at all (only the `/hooks/:token` webhook receiver from Task 19). Whichever task wires the full `/api/triggers*` route table should wire GET (Task 22) and POST/PATCH/DELETE (this task) together.
- **Task 24 (manual fire)** is confirmed out of scope here, per the brief — not built.
- `handleTriggerDelete`'s signature in the brief text omitted `req` (`handleTriggerDelete(id, deps, guard): Response`), but `requireTrustedLocal` requires a `Request` to check Host/Origin — implemented as `handleTriggerDelete(id, req, deps, guard)`, matching `handleDeviceRevoke`'s signature exactly (the stated precedent). Flagging this discrepancy between the brief's prose and the necessary interface.
- `patch.ts`'s `nextRunAt` recompute-on-enable heuristic (recompute when re-enabling a cron whose `nextRunAt` is currently `null`) is my own inference from the brief's underspecified "if a cron config/enabled change requires it, recompute nextRunAt" — reasoning documented in the file's docstring. No test exercises the "re-enable a parked cron" path specifically (only the config-change recompute path is tested); a follow-up review may want to add that case explicitly.

## Fix pass

Dual review (spec Approved, adversarial SOUND-WITH-NITS, no security break) found two must-close items before this task can be considered fully closed. Both fixed in one commit: `8393cf1` — `fix(triggers): clean up minted secret on create failure + cover re-enable-parked-cron reschedule`.

### FIX 1 — orphaned-secret window on create (`src/server/triggers/create.ts`)
`secretStore.mint()` ran BEFORE `store.create(...)`, and `store.create` was unwrapped — if it ever threw (the M2 pre-check is a check-then-act race, or any other INSERT error), the freshly-minted webhook secret would be orphaned on disk with no cleanup, and the caller got an unhandled 500 instead of a clean 409. Unreachable today via the M2 pre-check under normal single-writer operation, but latent, and the mirror-image of the deliberate secret-then-row ordering `delete.ts` already documents.

Fix: wrapped the `store.create` call in try/catch. On failure:
- If a secret was minted for this create (`input.secretRef` set), `secretStore.remove(input.secretRef)` runs before returning — no orphan survives a failed insert.
- A `UNIQUE(name, origin)` constraint failure (detected via bun:sqlite's `SQLITE_CONSTRAINT_UNIQUE` code, with a message-substring fallback in `isUniqueConstraintError`) maps to the same 409 shape the M2 pre-check already returns.
- Any other error rethrows to the app-level 500 handler (`app.ts`'s outer try/catch) — never swallowed into a false 409.

The M2 pre-check is unchanged (still the fast, common-case clean 409 before any mint/insert); this try/catch is the backstop for the race the pre-check cannot close.

Tests added (`tests/server/triggers-mutate.test.ts`):
- `create failure after secret mint (UNIQUE race): 409, no orphaned secret` — stubs `store.create` to throw a `SQLITE_CONSTRAINT_UNIQUE` error after a real `secretStore.mint()` has already run (spied to capture the ref); asserts 409, zero rows persisted, and `secretStore.get(mintedRef)` is `undefined` (the secret was actually removed, not just orphaned quietly).
- `create failure with a non-UNIQUE store error rethrows (not swallowed into a 409)` — stubs `store.create` to throw a plain `Error('disk full')`; asserts the handler rethrows (caller sees a rejected promise / would surface as the app-level 500) rather than mapping it to any clean-looking status.

### FIX 2 — coverage hole: re-enable-parked-cron `nextRunAt` (`src/server/triggers/patch.ts`)
The `willBeEnabled && existing.nextRunAt == null` branch (re-seeding `nextRunAt` when a parked/disabled cron with no scheduled next-run is re-enabled) was already implemented but had zero test coverage — flagged as a known gap in the original task-23 report's "Concerns" section.

No code change was needed in `patch.ts` (logic was already correct); added the missing test:
- `patch re-enabling a parked cron (nextRunAt null) recomputes nextRunAt` — creates a disabled console cron trigger via `store.create` directly (so `nextRunAt` is never seeded, matching a genuinely parked row), asserts it starts with `enabled: false` / `nextRunAt: undefined`, PATCHes `{enabled: true}`, and asserts the response is 200 and the persisted row now has `enabled: true` and a `nextRunAt` strictly greater than `Date.now()` captured just before the patch — proving the value was freshly recomputed via the cron pattern, not left null.

### Gate results
- `bun run typecheck` → clean (whole repo).
- `bun run lint:file -- src/server/triggers/create.ts src/server/triggers/patch.ts tests/server/triggers-mutate.test.ts` → clean, no fixes needed.
- `bun run test:file -- tests/server/triggers-mutate.test.ts` → **17 pass, 0 fail, 52 expect() calls** (13 pre-existing + 4 new: 2 for FIX 1, 1 for FIX 2, 1 rethrow-guard test written alongside FIX 1).
- Pre-commit hook (`docs:check`) passed on the fix commit.

### Files changed / committed (fix pass)
- `src/server/triggers/create.ts` (modified — wrapped `store.create`, added `isUniqueConstraintError`, updated docstring)
- `tests/server/triggers-mutate.test.ts` (modified — 4 new tests)

`src/server/triggers/patch.ts` needed no code change (FIX 2 was test-only); it was not staged in the fix commit. Only the two touched files were staged (`git add <specific files>`), matching the branch's existing convention of leaving the pre-existing unrelated modified `.remember/`/`.superpowers/sdd/task-*` files untouched.

Not touched (per instruction, and confirmed still sound): the trusted-local gate, repo-origin rules, and the §7.4 watch-root confine. Routes remain unwired (T25, unchanged).
