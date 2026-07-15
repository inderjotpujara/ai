# Task 9 Report: `handleRunList` — `GET /api/runs` filtered/sorted/paginated list (Slice 30b Phase 3)

Note: this filename was previously reused for an earlier, unrelated Task 9
(Slice 30b Phase 2 consent registry / `POST /api/runs/:id/respond`). That
content is superseded here — this is the Slice 30b **Phase 3** runs-list
Task 9.

## Status: DONE

## Commit
`46350f9` — feat(server): handleRunList — filtered/sorted/paginated GET /api/runs

## Files
- Created: `src/server/runs/list.ts`
- Created: `tests/server/runs-list.test.ts`

## TDD flow
1. **RED**: Wrote `tests/server/runs-list.test.ts` exactly per the brief's
   Step 1 sample (4 tests: sort-desc-by-startMs+total, case-insensitive
   search over id/models/outcome, outcome+degraded facet filters,
   limit+opaque-cursor pagination). Ran to fail:
   ```
   $ bun test --path-ignore-patterns 'web/**' tests/server/runs-list.test.ts
   error: Cannot find module '../../src/server/runs/list.ts' from
     '/Users/inderjotsingh/ai/tests/server/runs-list.test.ts'
   0 pass, 1 fail, 1 error
   ```
2. **GREEN**: Implemented `src/server/runs/list.ts` per the brief's Step 3
   sample verbatim — `encodeCursor`/`decodeCursorId`/`matchesSearch`/
   `handleRunList`, importing `RunsDeps` from `./detail.ts` (Task 8,
   committed) and `summarizeRunListItem` from `../../run/run-dto.ts`
   (Task 6, committed, mtime-cache-fronted).
3. Ran to pass (final run after formatting fix, see Gate below):
   ```
   $ bun test --path-ignore-patterns 'web/**' tests/server/runs-list.test.ts
   bun test v1.3.11 (af24e281)
    4 pass
    0 fail
    17 expect() calls
   Ran 4 tests across 1 file. [117.00ms]
   ```

## Interfaces confirmed against already-landed code
- `RunsDeps = { runsRoot: string }` — confirmed exported from
  `src/server/runs/detail.ts` (Task 8).
- `summarizeRunListItem(runsRoot, id): Promise<RunListItemDTO | undefined>` —
  confirmed exported + mtime-cache-fronted in `src/run/run-dto.ts` (Task 6).
- `RunListQuerySchema` (`src/contracts/requests.ts`) — confirmed: `search`/
  `outcome` are plain optional strings; `degraded` is
  `z.enum(['true','false']).optional().transform(...)` → boolean or
  `undefined`; `limit` is `z.coerce.number().int().positive().max(200).default(25)`.
- `RunListResponseSchema` — confirmed: `{ items: RunListItemDtoSchema[],
  nextCursor?: string, total: number }`.
- `RunListItemDtoSchema` (`src/contracts/dto.ts`) — confirmed field set
  (`id`, `startMs`, `durationMs`, `outcome: string`, `lifecycle`, `origin`,
  `models: string[]`, `degraded: boolean`, `spanCount`, `tokens`) matches
  what `list.ts`'s filter/sort/search logic assumes.

## Implementation notes
- `handleRunList(params, deps)` builds the raw query object from
  `URLSearchParams`, `RunListQuerySchema.parse`s it, `readdir`s
  `deps.runsRoot` for directory entries (a `readdir` failure — root doesn't
  exist yet — degrades to an empty `{items:[], total:0}` 200 rather than
  throwing/500ing), projects each id through `summarizeRunListItem`
  (`undefined` entries, e.g. dirs with no `spans.jsonl`, are dropped),
  filters by `search`/`outcome`/`degraded`, sorts descending by `startMs`,
  then paginates: an opaque cursor is `base64url(startMs:id)`, decoded back
  to just the `id` half, used to find that item's index in the filtered+
  sorted array and slice from the next index; `nextCursor` is only set when
  `start + limit < filtered.length`.
- `search` matching is over
  `` `${id} ${models.join(' ')} ${outcome}`.toLowerCase() `` — a substring
  match against the lowercased search term, exactly per the brief.

## Gate results (all three, before commit)
1. **typecheck** — `bun run typecheck` → `$ tsc --noEmit` clean, no errors.
2. **lint** — `bun run lint:file -- "src/server/runs/list.ts"
   "tests/server/runs-list.test.ts"` — first pass reported 2 formatting
   errors (Biome's line-width/wrapping rules differ from the brief's inline
   sample formatting, e.g. multi-arg `writeRun({...})` object literals and
   the `matchesSearch` template-literal length in `list.ts`). Ran `bunx
   biome check --write` on both files to auto-fix formatting only (no logic
   changes — confirmed by re-reading the diff, purely re-wrapped
   lines/object literals). Re-ran lint → `Checked 2 files in 5ms. No fixes
   applied.` (clean). Re-ran the focused test suite and typecheck after the
   autofix to confirm nothing broke — both still green/clean (results shown
   above are the post-autofix final runs).
3. **focused tests** — 4 pass / 0 fail, 17 `expect()` calls (see above).
4. `bun run scripts/docs-check.ts` (pre-commit hook) → passed: "living docs
   present + linked; every src subsystem documented" — `src/server/runs/`
   already exists as a documented subsystem surface from Task 8; adding
   `list.ts` alongside `detail.ts` didn't introduce a new subsystem.

## Commit
`git add src/server/runs/list.ts tests/server/runs-list.test.ts` (no `git
add -A` — the working tree has unrelated dirty ledger/scratch files from
other in-flight tasks, left untouched). `git status --short` before commit
confirmed only these two files were staged (`A  src/server/runs/list.ts`,
`A  tests/server/runs-list.test.ts`); everything else stayed as pre-existing
modified/untracked.

Commit: `46350f9` — "feat(server): handleRunList — filtered/sorted/paginated
GET /api/runs"
```
2 files changed, 218 insertions(+)
 create mode 100644 src/server/runs/list.ts
 create mode 100644 tests/server/runs-list.test.ts
```

## Deviations from brief
None in logic — the implementation matches the brief's Step 3 sample
verbatim. The only change from the brief's literal text was Biome's
auto-formatting (line wrapping / multi-line object literals) applied to
both the test file and `list.ts` to satisfy the project's lint gate; no
behavioral change.

## Concerns
None blocking. Same interim-cache caveat already noted in Task 6's report
applies transitively here (the in-process `summaryCache` in `run-dto.ts` is
a stateless-friendly interim, not a persisted index — Phase 6 territory,
not this task's scope).

---

## Follow-up: review-requested test-coverage gaps (post-review)

Review came back Spec ✅ / Quality Approved with two Important
test-coverage gaps (code already correct by inspection — these lock in the
behavior). Added exactly two tests to `tests/server/runs-list.test.ts`:

1. **missing/unreadable runsRoot → 200 with empty list** — asserts the
   "degrade, never crash" contract: `handleRunList(new URLSearchParams(''),
   { runsRoot: join(root, 'does-not-exist') })` returns 200 with body
   `{ items: [], total: 0 }` and `nextCursor` undefined.
2. **stale cursor id → resets to page 1 (never throws)** — two runs, request
   with a cursor for an absent id (`Buffer.from('999:ghost').toString(
   'base64url')`, same encoding the impl uses); asserts 200 and all items
   returned (`items.length === 2`, start resets to 0).

Gate (changed test file only):
- `bun run typecheck` → `$ tsc --noEmit` clean.
- `bun run lint:file -- "tests/server/runs-list.test.ts"` → clean after one
  `biome check --write` autofix (pure line-wrap formatting, no logic change).
- Test run:
  ```
  $ bun test --path-ignore-patterns 'web/**' tests/server/runs-list.test.ts
  bun test v1.3.11 (af24e281)
   6 pass
   0 fail
   23 expect() calls
  Ran 6 tests across 1 file. [111.00ms]
  ```

Follow-up commit (NOT amended into T9): `d2dc6f6` — "test(server): cover
runList empty-root degrade + stale-cursor fallback". `git add
tests/server/runs-list.test.ts` only (no `git add -A`); 1 file changed,
19 insertions. Pre-commit docs-check passed.
