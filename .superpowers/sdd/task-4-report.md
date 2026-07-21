# Task 4 Report — Queue provenance + chain-depth columns (Slice 25 Task 4)

## Status: DONE

Note: this report file previously held a stale Task 4 report from
Slice 25b Increment 1 (Device DTOs + pairing requests). That content was
already committed under its own SHA (`c8caf6a`, branch `slice-25b-ops-console`)
and is unaffected by this overwrite.

## Summary
Threaded trigger provenance through the job queue per the brief:

- `src/queue/migrations.ts` — appended `add-origin-and-chain-depth` as the
  **third** entry in `JOB_MIGRATIONS` (strict append, never inserted mid-list —
  preserves the positional `PRAGMA user_version` prefix invariant a later task
  relies on to concatenate trigger-table migrations after it). Adds
  `origin TEXT` (nullable) and `chain_depth INTEGER NOT NULL DEFAULT 0` via
  `ALTER TABLE`.
- `src/queue/types.ts` — imports `RunOrigin` from `../contracts/enums.ts`
  (one-directional: contracts imports nothing from queue). `JobInput` gains
  `origin?: RunOrigin` and `chainDepth?: number`; `JobRecord` gains
  `origin: RunOrigin | undefined` and `chainDepth: number`.
- `src/queue/store.ts` — `JobRowRaw` gains `origin: string | null` and
  `chain_depth: number`; `toJobRecord` sets `origin: (r.origin ?? undefined) as
  RunOrigin | undefined, chainDepth: r.chain_depth`; `enqueue`'s INSERT column
  list and value array both extended in lockstep with `origin` (`input.origin
  ?? null`) and `chain_depth` (`input.chainDepth ?? 0`) — double-checked the
  column/value lists stay positionally aligned.
- `tests/queue/store-origin.test.ts` (new) — the brief's exact TDD test:
  a job enqueued with `origin`/`chainDepth` reads them back; a default job
  reads `origin: undefined, chainDepth: 0`. Confirmed RED first (`origin`
  expected `"schedule"`, received `undefined`), then GREEN after the fix.

### Incidental fixes required for the gate to pass (outside the brief's file list)
Adding two new *required* fields to `JobRecord` broke hand-built object-literal
fixtures elsewhere:
- `tests/daemon/spans.test.ts` — `job()` fixture now sets `origin: undefined,
  chainDepth: 0`.
- `tests/server/jobs/dispatch.test.ts` — `fakeJob()` fixture now sets the same.
- `tests/queue/migrations.test.ts` — asserted `user_version === 2` and an
  exact `PRAGMA table_info(jobs)` column list; updated to `3` and appended
  `origin`, `chain_depth` to the expected column list (both the migration
  count and the column shape necessarily shift when a migration is appended).

Confirmed `JobDtoSchema` (`src/contracts/dto.ts`) and its mapper `toJobDto`
(`src/server/jobs/map.ts`) are unaffected: the mapper builds the DTO with an
explicit field list, so it naturally omits `origin`/`chainDepth` with no code
change needed — matches the reviewer note (`chainDepth` unread there;
`availableAt`/`retriedFrom` unaffected).

## Files changed
- `src/queue/migrations.ts`
- `src/queue/types.ts`
- `src/queue/store.ts`
- `tests/queue/store-origin.test.ts` (new)
- `tests/queue/migrations.test.ts`
- `tests/daemon/spans.test.ts`
- `tests/server/jobs/dispatch.test.ts`

## Gate results (all green)
- `bun run typecheck` → clean, no errors.
- `bun run lint:file -- src/queue/types.ts src/queue/migrations.ts src/queue/store.ts tests/queue/store-origin.test.ts tests/daemon/spans.test.ts tests/server/jobs/dispatch.test.ts tests/queue/migrations.test.ts` → clean after `biome check --write` applied import-order/formatting fixes (no logic changes; verified diff was formatting-only).
- `bun run test:file -- tests/queue/` → 51 pass, 0 fail (1520 expect() calls, 13 files).
- `bun run test -- -t "claimNext"` (brief's regression check) → 5 pass, 0 fail.

## Commit
`cca3380` — "feat(queue): job origin + chain_depth columns" on branch
`slice-25-triggers` (7 files changed, 61 insertions, 6 deletions). Only the
task-4 files were staged by explicit path (not `-A`); other working-tree
modifications present at commit time (`.remember/`, `.superpowers/sdd/task-{1,2,3}-*`,
`.superpowers/sdd/progress.md`) belong to sibling tasks and were deliberately
left untouched/unstaged. Pre-commit `docs-check` hook passed automatically
(no `docs/architecture.md` edit needed — `src/queue/` was already documented).

## Concerns
- INSERT column list and value array in `enqueue` were extended in parallel
  (`origin`, `chain_depth` appended at the same position in both lists) —
  worth a second look given positional bind params silently corrupt every
  row on a mis-order.
- Migration is a pure additive `ALTER TABLE ... ADD COLUMN`; no backfill
  needed since `origin` is nullable and `chain_depth` has `DEFAULT 0`, so
  pre-migration rows read back as `undefined`/`0` exactly per spec.
- Did not wait for a full `bun run test` run to finish (kicked off in the
  background for extra confidence but still executing at task close); the
  task's own specified gate — focused `tests/queue/` (51 tests) plus the
  `-t "claimNext"` regression check — is green. Recommend the slice
  controller run the full suite (`bun run check`) before landing.
