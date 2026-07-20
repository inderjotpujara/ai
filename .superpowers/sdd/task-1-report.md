# Task 1 Report: JobDto.availableAt + retriedFrom lineage

(Note: this file previously held a report for an unrelated Slice 24 Increment 1
task that reused the same filename. It has been overwritten with the Slice 25b
Task 1 report below.)

## Status: DONE

## What was implemented
Per `.superpowers/sdd/task-1-brief.md`, verbatim except for two mechanical
ambiguity resolutions noted below.

1. **`src/queue/migrations.ts`** — appended `'add-retried-from'` migration
   (`ALTER TABLE jobs ADD COLUMN retried_from TEXT`), advancing `user_version`
   to 2.
2. **`src/queue/types.ts`** — added `retriedFrom: string | null` to
   `JobRecord` (after `error`) and `retriedFrom?: string` to `JobInput`
   (after `runId`).
3. **`src/queue/store.ts`** — added `retried_from: string | null` to
   `JobRowRaw`; `toJobRecord` now sets `retriedFrom: r.retried_from` (no
   `?? undefined` — the DTO field is nullable, not optional); `enqueue`'s
   INSERT now includes `retried_from`, bound from `input.retriedFrom ?? null`.
4. **`src/contracts/dto.ts`** — `JobDtoSchema` gained `availableAt: z.number()`
   and `retriedFrom: z.string().nullable()` (after `error`). `toJobDto`
   (`src/server/jobs/map.ts`) is an unchanged passthrough, as the brief said.

## TDD evidence
- **RED**: wrote `tests/queue/store-lineage.test.ts` verbatim from the brief,
  ran `bun test tests/queue/store-lineage.test.ts` before any impl change →
  2 failures (`retriedFrom` was `undefined`, not `null`/the retried job's id).
- **GREEN**: after Steps 3–6, `bun test tests/queue/store-lineage.test.ts
  tests/queue/migrations.test.ts tests/contracts/job-dto.test.ts` → 11 pass,
  0 fail.

## Two ambiguities resolved (not blocking, both mechanical)

1. **`tests/contracts/job-dto.test.ts` already existed** (the brief said
   "create if absent," but it was present with an existing `'JobDtoSchema
   round-trips a full record'` test). That test's fixture object omitted
   `availableAt`/`retriedFrom`, which would now fail to parse since both are
   required (non-optional) fields on `JobDtoSchema`. Fixed by adding
   `availableAt: 0, retriedFrom: null` to that existing fixture (same spirit
   as the brief's own Step 5, which updates the pre-existing migrations-test
   column-list assertion) — then appended the brief's new round-trip test
   below it, unmodified.
2. **`bun run typecheck` caught two more `JobRecord` literal fixtures** the
   brief's file list didn't mention: `tests/daemon/spans.test.ts`'s `job()`
   helper and `tests/server/jobs/dispatch.test.ts`'s `fakeJob()`, both
   constructing a full `JobRecord` object without the now-required
   `retriedFrom` field. Added `retriedFrom: null` to each (mechanical fixture
   update, no behavior change) — required for `bun run typecheck` to pass per
   the gate.

Both are additive, non-controversial completions of the same seam-threading
task (a required field was added to a type; every literal of that type needed
updating) — not scope or design decisions, so I did not stop for
NEEDS_CONTEXT.

## Files changed
- `src/contracts/dto.ts`
- `src/queue/migrations.ts`
- `src/queue/types.ts`
- `src/queue/store.ts`
- `tests/queue/store-lineage.test.ts` (new)
- `tests/queue/migrations.test.ts`
- `tests/contracts/job-dto.test.ts`
- `tests/daemon/spans.test.ts` (fixture fix only)
- `tests/server/jobs/dispatch.test.ts` (fixture fix only)

## Gate results
- `bun run typecheck` → clean.
- `bun run lint:file -- <9 files above>` → clean (after `biome check --write`
  auto-fixed two formatting nits — an import-sort and a long-line wrap — in
  the two new/extended test files; no logic changes).
- `bun test tests/queue tests/contracts tests/daemon/spans.test.ts
  tests/server/jobs` → 200 pass, 0 fail, 381 expect() calls. Full contract
  parity suite (`tests/contracts/*`) and full queue suite (`tests/queue/*`)
  both green.

## Concerns
None outstanding. The two fixture fixes are pure mechanical completions of
the required-field threading; no design ambiguity remains for later tasks
consuming `JobRecord.retriedFrom` / `JobDTO.retriedFrom`.

## Commit
`676fbdb` — `feat(queue): JobDto availableAt + retriedFrom lineage column (Slice 25b Incr 1)`
(9 files changed, 81 insertions(+), 4 deletions(-))
