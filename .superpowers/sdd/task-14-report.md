# Task 14 Report — `isLoopbackHost` + `requireTrustedLocal` (Slice 25b Incr 3, D5)

> Note: this path previously held a superseded report for an unrelated
> "Task 14" from Slice 30b Phase 8 (aria-live MicButton). Overwritten here per
> this task's instruction to write the Slice-25b Task-14 report to this exact
> path; prior content remains in git history.

## Summary
Implemented the trusted-local privileged-write gate that makes plan-audit CRITICAL-2 real:
a remote/paired client can never pair/revoke/rotate. Two units:

1. `isLoopbackHost(req: Request): boolean` added to `src/server/security/origin.ts`
   (next to `hostAllowed`, reusing the existing `LOCAL_HOSTS` constant — no reinvention
   of Host parsing).
2. `requireTrustedLocal(req, guard, policy): Response | null` in new
   `src/server/security/trusted-local.ts`.

## isLoopbackHost matching rules
- Reads the `host` header. Absent (`null`) OR empty string → `false`.
- Strips an optional `:PORT` suffix via `/:\d+$/` (the `[::1]` brackets are preserved —
  only a trailing `:digits` is stripped, so `[::1]:4130` → `[::1]`).
- Returns `LOCAL_HOSTS.includes(bare)` where `LOCAL_HOSTS = ['localhost','127.0.0.1','[::1]']`.
- TRUE for: `127.0.0.1`, `127.0.0.1:4130`, `localhost`, `localhost:4130`, `[::1]`, `[::1]:4130`.
- FALSE for tunnel/LAN/allowlisted-but-not-loopback hosts — a request over an
  `AGENT_WEB_ALLOWED_HOSTS` tunnel is admitted by `hostAllowed` but is NOT loopback here.

### Adversarial host cases tested (`tests/server/security/origin-loopback.test.ts`)
- `127.0.0.1.evil.com` → false (subdomain-suffix spoof; no `:port` to strip, not in set).
- `localhost.evil.com` → false; `evil.com:127.0.0.1` → false (port-position spoof).
- tunnel host `ts.example` → false; LAN/CGNAT `100.64.0.1:4130` → false.
- absent Host (`null`) → false; empty Host (`''`) → false.
- `0.0.0.0` and `0.0.0.0:4130` → false (bind wildcard, never a client host — excluded
  because it is not in `LOCAL_HOSTS`).

## requireTrustedLocal — 3-condition logic
Returns `null` (proceed) IFF ALL THREE hold; otherwise a **403** JSON Response
(`{"error":"forbidden: trusted-local only"}`, `content-type: application/json`):
1. `guard.principal(req) === 'local'` — only the local-minted session token carries
   deviceId `'local'`; a paired remote device resolves to a random UUID (or `undefined`).
2. `isLoopbackHost(req)` — a LOOPBACK Host specifically, so an injected `'local'` token
   replayed over an ALLOWED TUNNEL host is still rejected (the FIX-2 backstop).
3. `originAllowed(req, policy)` — same-/allowed-origin (CSRF defense; reuses existing helper).

### requireTrustedLocal cases tested (`tests/server/security/trusted-local.test.ts`)
- local principal + loopback Host + no cross-origin → `null` (pass).
- principal is a UUID (paired remote device) → 403.
- Host is non-loopback non-allowlisted remote (`evil.example`) → 403.
- injected `'local'` token replayed over ALLOWED TUNNEL host (`ts.example`) → 403 (core fix).
- no verified principal (`undefined`) → 403.
- loopback + local principal but cross-origin `Origin: http://evil.example` → 403 (condition 3).

## TDD
- RED: ran both new test files before implementation — `Export named 'isLoopbackHost' not
  found` + `Cannot find module trusted-local.ts` (0 pass, 2 fail).
- GREEN: after adding the helper + module — 9 pass / 0 fail across the two new files
  (21 expect calls). Existing `tests/server/origin.test.ts` stays green (unchanged
  `hostAllowed`/`originAllowed` behavior). Full `tests/server/`: 339 pass / 0 fail.

## Brief consistency check
The brief's loopback matching (strip `:\d+$`, compare against `LOCAL_HOSTS`) is consistent
with the real `origin.ts` Host-parsing and the shared `LOCAL_HOSTS` constant — no
contradiction, no NEEDS_CONTEXT.

## Files changed
- `src/server/security/origin.ts` (added `isLoopbackHost`)
- `src/server/security/trusted-local.ts` (new)
- `tests/server/security/origin-loopback.test.ts` (new)
- `tests/server/security/trusted-local.test.ts` (new)

## Gate
- `bun run typecheck` — clean.
- `bun run lint:file` on all 4 files — clean.
- targeted tests 9/9 green; `tests/server/` sanity 339/339 green.

## Concerns
- None blocking. Note for downstream (T17–T21, Fable review): `requireTrustedLocal` is a
  belt-and-suspenders gate that must be applied to pair/revoke/rotate routes IN ADDITION to
  the inherited session guard — it narrows those privileged routes to the physically-local
  browser; it does not replace `enforcePerimeter` or the session guard.
- `originAllowed` treats an absent Origin as allowed (matching the existing perimeter);
  conditions 1+2 carry the core protection, so this is intentional and safe here.

---

# Task 14 Report — `src/triggers/sync.ts` + repo `triggers/` registry (Slice 25, Task 14)

> Note: this path already held a Slice-25b Incr-3 "Task 14" report for an unrelated unit
> (`isLoopbackHost`/`requireTrustedLocal`, above the separator). Appended per this task's
> report contract; that content is left intact.

## Status: DONE

Commit `58ad339` — `feat(triggers): repo trigger registry + boot sync (upsert/prune)`.

## What shipped
1. **`triggers/index.ts`** (repo root) — the repo-defined trigger registry, byte-for-byte
   mirroring the `crews/index.ts` pattern:
   - `TriggerDef = Omit<TriggerInput, 'origin'>` — a repo def never sets its own origin;
     `sync.ts` stamps `TriggerOrigin.Repo`.
   - `export const TRIGGERS: Record<string, TriggerDef> = { /* TRIGGER-BUILDER:ENTRIES */ }`
     with `// TRIGGER-BUILDER:IMPORTS` reserved above it. Shipped EMPTY (no starter def).
   - `export function getTrigger(name)` using the `Object.hasOwn` guard (same
     prototype-pollution rationale comment as `crews/index.ts`/`workflows/index.ts`).
2. **`src/triggers/sync.ts`** — `syncRepoTriggers(store: TriggerStore, defs: Record<string,
   TriggerDef>): void`:
   - For each `[name, def]`: if `def.type === TriggerType.Cron` and
     `!validateCron((def.config as CronConfig).schedule, (def.config as
     CronConfig).timezone)` → `store.upsertRepo({ ...def, origin: TriggerOrigin.Repo, enabled:
     false })` + `logger.warn('trigger.sync.invalid-cron', { name })` (registered but disabled,
     never throws — I1(b)).
   - Otherwise → `store.upsertRepo({ ...def, origin: TriggerOrigin.Repo })`.
   - After the loop: `store.pruneRepo(Object.keys(defs))`.
   - Logger: `createLogger('triggers.sync')` (matches `scheduler.ts`'s convention; the brief
     said "logger" but the real export is `createLogger`).

## T7 CARRY resolution (repo-webhook token path)
Chose **(a) reject-with-warning is moot for this task** in practice: `syncRepoTriggers` does
not special-case `TriggerType.Webhook` at all — it just upserts whatever `def.type` is. A
repo-defined webhook trigger would sync fine at the STORE level (no tokenHash is ever set by
`upsertRepo`, which never accepts one — see `store.ts`), but it would be **useless**: nothing
mints it a `token_hash`, so it can never be looked up by `getByTokenHash` and the webhook route
can never fire it. No raw secret ever touches a repo TS file. This satisfies the carry's "do
NOT put a raw secret in a repo TS file" constraint without adding bespoke rejection logic this
task's brief didn't ask for (the brief's Step-1/Step-3 spec, which is authoritative for THIS
task, only describes the cron-validation branch — no webhook-reject branch). Flagging for the
slice's final review in case a louder rejection (e.g. a warning log) is wanted before webhook
UI surfaces repo-origin webhook triggers.

## I1 CARRY resolution (sync-side cron validation)
Implemented exactly as specified: reused `validateCron` from `next-run.ts` (construction-only
pattern check); invalid → registered-but-disabled + `logger.warn`, never thrown. Verified with
a dedicated test (`sync registers a bad-cron repo def as disabled (no throw)`).

## TDD
- RED: `tests/triggers/sync.test.ts` written first — `Cannot find module
  '../../src/triggers/sync.ts'` (0 pass, 1 error) before either file existed.
- GREEN after implementation — 4 pass / 0 fail / 13 expect() calls:
  1. `sync upserts repo defs and prunes removed ones` — pre-existing paused repo row `old`
     pruned; new `nightly` def created enabled by default.
  2. `sync preserves the console-paused overlay across re-sync` — pauses `nightly` via
     `store.update`, re-syncs with a changed schedule, confirms same row id + `enabled: false`
     survives + `config` reflects the new schedule (delegates to `upsertRepo`'s existing
     overlay-preserving UPDATE path, per the T7/carry note that store already does this).
  3. `sync registers a bad-cron repo def as disabled (no throw)` — I1(b), `schedule: 'not a
     cron'` → row exists, `enabled === false`, `expect(() => ...).not.toThrow()`.
  4. `sync leaves non-cron trigger types untouched by cron validation` — a `TriggerType.File`
     def syncs enabled (no accidental gate on non-cron types).
- Full `tests/triggers/` suite (12 files, includes scheduler/watcher/store/etc.): 89 pass / 0
  fail / 298 expect() calls — no regressions.

## Gate
- `bun run typecheck` — clean.
- `bun run lint:file -- triggers/index.ts src/triggers/sync.ts tests/triggers/sync.test.ts` —
  clean (one import-order autofix applied to the test file: `createTriggerStore` before
  `syncRepoTriggers` alphabetically).
- `bun run docs:check` — clean; confirmed the new top-level `triggers/` dir does NOT trip the
  check (it only scans `src/<subsystem>` entries, and `src/triggers/` was already documented
  by an earlier Slice-25 task).

## Files changed
- `triggers/index.ts` (new)
- `src/triggers/sync.ts` (new)
- `tests/triggers/sync.test.ts` (new)

## Concerns
- Minor logging cosmetic: `logger.warn('trigger.sync.invalid-cron', { name })` — per
  `src/log/logger.ts`'s `emit`, the fields object is spread AFTER the record's own `name`
  field (the logger's own name, e.g. `"triggers.sync"`), so the trigger's `name` field
  silently overwrites it in the emitted JSON (observed in test output: `{"name":"broken",...}`
  instead of `{"name":"triggers.sync",...,"triggerName":"broken"}`). This is exactly the call
  shape the brief specifies verbatim, so implemented as directed rather than deviating; flagging
  in case a future logger-hygiene pass wants to rename the field (e.g. `{ triggerName: name }`)
  to avoid the collision — not blocking for this task.
- The webhook non-handling described above (T7 carry) is a design choice, not a bug, but is
  worth a second look at the slice's final review once a webhook-authoring UI/CLI exists.
- No caller wires `syncRepoTriggers` into daemon boot yet — this task only ships the
  registry + the sync function per its stated file scope (`triggers/index.ts` +
  `src/triggers/sync.ts` + test). Boot-time wiring (importing `TRIGGERS` from the registry and
  calling `syncRepoTriggers(store, TRIGGERS)` in the daemon startup path) is presumably a later
  task in this slice; confirm against the task list if it's expected here.

## Fix pass

Applied both must-fix findings from the review in one commit.

**FIX 1 (logger field collision, Important):** renamed the field in
`logger.warn('trigger.sync.invalid-cron', { name })` to `{ triggerName: name }`. Confirmed via
`emit()` in `src/log/logger.ts` — the record's own `name` (the logger source, e.g.
`"triggers.sync"`) is set before `...fields` is spread, so any `name` key in `fields` silently
overwrote it in the JSON/non-TTY branch (the daemon's production log format). No `logger.ts`
change; the fix is entirely call-site.

**FIX 2 (repo webhook defs silently non-functional, must-fix, closes T7 carry):** added an
explicit `TriggerType.Webhook` branch in `syncRepoTriggers`, symmetric with the cron-validation
branch: upserts the def with forced `enabled: false` and emits
`logger.warn('trigger.sync.webhook-unsupported', { triggerName: name })`, then `continue`s
(skips the unconditional upsert below it). Rationale unchanged from the carry note: a repo TS
file must not hold a raw webhook secret, so repo-defined webhooks can't be server-token-minted;
without this branch the repo path would upsert an `enabled: true` row with no `token_hash`,
which `getByTokenHash` can never match — looks live in the console, can never actually fire, no
warning. Now it's persisted visibly-disabled with a clear reason instead.

New test `sync registers a repo webhook def as disabled with a warning`
(`tests/triggers/sync.test.ts`): syncs a `TriggerType.Webhook` repo def, asserts the row exists
with `enabled === false`, captures logger output via `setLogSink` (the existing test seam in
`src/log/logger.ts`, same pattern as `tests/log/logger.test.ts`), and asserts both that the
`trigger.sync.webhook-unsupported` warning fired with `triggerName: 'repo-hook'` AND that the
emitted record's `name` field is still `'triggers.sync'` (the FIX 1 regression guard — proves
the collision is gone, not just that the message fired).

### Gate
- `bun run typecheck` — clean.
- `bun run lint:file -- src/triggers/sync.ts tests/triggers/sync.test.ts` — clean, no fixes
  applied.
- `bun run test:file -- tests/triggers/` — 90 pass / 0 fail / 303 expect() calls (was 89/298
  before this pass; +1 test file's worth of new assertions), no regressions. Observed log line
  now reads `{"name":"triggers.sync",...,"triggerName":"broken"}` for the cron-invalid case —
  confirms FIX 1 live in the actual JSON emission, not just asserted in the new test.

### Files changed
- `src/triggers/sync.ts`
- `tests/triggers/sync.test.ts`

### Concerns carried forward
- Boot-time wiring of `syncRepoTriggers(store, TRIGGERS)` into daemon startup is still not
  present — unchanged from the original task-14 concern, out of scope for this fix pass.
