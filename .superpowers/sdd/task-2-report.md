# Task 2 report — `RunListQuery.origin` facet

## Summary

Added an `origin` facet to `RunListQuerySchema` (`src/contracts/requests.ts`)
mirroring the existing `kind` facet exactly (`z.enum(RunOrigin).optional()`),
and threaded `query.origin` into `handleRunList`'s existing filter chain
(`src/server/runs/list.ts`) as a straight equality filter over
`RunListItemDTO.origin` — the same field `summarizeRunListItem`
(`src/run/run-dto.ts`) already populates from the run dir's `origin` marker
file via `readRunOrigin`.

## Implementation

- `src/contracts/requests.ts`:
  - Added `RunOrigin` to the `enums.ts` import list.
  - Added `origin: z.enum(RunOrigin).optional()` to `RunListQuerySchema`,
    placed after `kind` per the brief.
  - Updated the two doc comments that enumerate the query's facets/filters
    (`RunListQuerySchema`'s own comment and `handleRunList`'s doc comment)
    to include `origin` — kept accurate per the repo's doc-truth bar.
- `src/server/runs/list.ts`:
  - Read `params.get('origin')` into the `RunListQuerySchema.parse` call
    alongside the other raw query params.
  - Added `.filter((s) => (query.origin ? s.origin === query.origin : true))`
    to the existing filter chain, positioned right after the `kind` filter —
    no run-store list function exists to pass a param into; this is a
    purely in-mapper facet like `kind`, exactly as the brief anticipated.

No changes were needed to `RunListItemDTO`/`summarizeRunListItem` — the
`origin` field and its `RunOrigin.Manual` degrade-on-missing-marker behavior
already existed (Slice 24 Incr 3 / this file's `readRunOrigin`).

## TDD evidence

**RED** (`tests/contracts/run-list-query.test.ts`, written verbatim from the
brief):
```
error: expect(received).toBe(expected)
Expected: "daemon"
Received: undefined
  at .../tests/contracts/run-list-query.test.ts:6:65
error: expect(received).toThrow()
Received function did not throw
Received value: { limit: 25 }
 0 pass / 2 fail
```

**GREEN** after adding the schema field:
```
bun test tests/contracts/run-list-query.test.ts
 2 pass / 0 fail
```

**Server-side test** (`tests/server/runs/list-origin.test.ts`, new — seeds a
daemon-origin run via an `origin` marker file containing `daemon` and a
manual run with no marker, reusing the `writeRun`/`span` fixture idiom from
`tests/server/runs-list.test.ts`):
```
bun test tests/server/runs/list-origin.test.ts
 1 pass / 0 fail  (asserts only 'daemon-run' returns for ?origin=daemon)
```

**Full parity check** — `bun test tests/contracts` (all 30 contract test
files, including the existing `RunListQuery`/`requests.test.ts` parity
tests): 119 pass / 0 fail. `tests/server/runs-list.test.ts` (existing
outcome/degraded/kind/search/pagination tests) plus the two new test files
run together: 12 pass / 0 fail.

## Gate

```
bun run typecheck        → clean (tsc --noEmit, no errors)
bun run lint:file -- src/contracts/requests.ts src/server/runs/list.ts \
  tests/contracts/run-list-query.test.ts tests/server/runs/list-origin.test.ts
                          → clean after one `biome check --write` auto-format
                            pass on the test file (import order + line wrap;
                            the brief's literal snippet wasn't pre-formatted
                            to this repo's biome config)
```

Pre-commit hook (`bun run docs:check`) passed on commit — no
`docs/architecture.md` change was needed since this is a same-subsystem
contract-seam addition (extends an existing query schema + filter chain),
not a new subsystem.

## Files changed

- `/Users/inderjotsingh/ai/src/contracts/requests.ts`
- `/Users/inderjotsingh/ai/src/server/runs/list.ts`
- `/Users/inderjotsingh/ai/tests/contracts/run-list-query.test.ts` (new)
- `/Users/inderjotsingh/ai/tests/server/runs/list-origin.test.ts` (new)

## Commit

`6ffd9da` — `feat(contracts): RunListQuery.origin facet for daemon-run filtering (Slice 25b Incr 1)`

Only these four files were staged/committed (`git add` by explicit path,
never `-A`); the unrelated uncommitted ledger/memory files already in the
tree (`.remember/now.md`, `.remember/today-2026-07-19.md`,
`.superpowers/sdd/progress.md`, `task-1-brief.md`, `task-1-report.md`,
`task-2-brief.md`) were left untouched.

## Concerns

None. The brief matched real code exactly (`RunOrigin` enum,
`RunListItemDTO.origin`, `kind`-facet pattern) — no ambiguity or
contradiction encountered, no NEEDS_CONTEXT. Note: this report file
previously contained stale content from an unrelated Slice-24 spike task
(also numbered "Task 2" in that slice's ledger); it has been overwritten
with this task's actual report.
