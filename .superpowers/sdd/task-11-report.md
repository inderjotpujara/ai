# Task 11 report — Wire the three GET run routes into `handleApi`

**Status:** DONE. Committed on `slice-30b-phase3-runs`.

**Commit SHA:** `7b80c95300200e88efb2efc317e8135d3d4e4400`

## What was done

Wired the three Runs GET endpoints into `src/server/app.ts` `handleApi`, behind
the already-shipped perimeter (Host/Origin allowlist) + bearer-token guard that
`buildFetch` enforces before `handleApi` runs.

- Added imports: `handleRunDetail` (`./runs/detail.ts`), `handleRunList`
  (`./runs/list.ts`), `handleRunStream` (`./runs/stream.ts`).
- Added three GET matches after the `/api/feedback` block and before the 404,
  in order **list → stream → detail**:
  - `GET /api/runs` → `handleRunList(new URLSearchParams(url.search), deps)`
  - `GET /api/runs/:id/stream` → `handleRunStream(id, deps, { lastEventId, signal })`
  - `GET /api/runs/:id` → `handleRunDetail(id, deps)`
- Test: `tests/server/runs-routes.test.ts` (5 tests; boots `buildFetch` via
  `Bun.serve` with a tmp `runsRoot` holding one run; imports from `bun:test`).

## Correctness confirmations

- **Route ordering correct:** the `:id/stream` regex match precedes the bare
  `:id` detail match, so `/api/runs/run-1/stream` returns `text/event-stream`
  (verified by test assertion on `content-type`), not the detail JSON. The list
  match (`=== '/api/runs'`) comes first. The existing POST
  `/api/runs/:id/respond` match was left untouched (POST + `/respond` suffix, so
  no collision with the new GET matches).
- **Signal wiring correct:** `handleRunStream` is passed
  `{ lastEventId: req.headers.get('Last-Event-ID') ?? undefined, signal: req.signal }`
  exactly as required — a client disconnect is honored.
- **`rec.status` from actual response for detail:** detail sets
  `rec.status(res.status)` from the handler's real response (may be 404), not a
  hardcoded 200, per the brief note.

## Deviations from the brief's sample code (both required to pass the gate)

1. **`new URLSearchParams(url.search)` instead of `url.searchParams`.** The brief
   passed `url.searchParams` directly; that failed typecheck — `url` is
   `new URL(req.url)`, whose `.searchParams` is typed as `node:url`.URLSearchParams,
   NOT assignable to `handleRunList`'s `URLSearchParams` parameter (the global/bun
   type — missing `toJSON`). Reconstructing via the global `URLSearchParams`
   constructor produces the matching type and mirrors the existing
   `tests/server/runs-list.test.ts` pattern (`handleRunList(new URLSearchParams(qs), ...)`).
   Behavior is identical.
2. **Import ordering + test formatting** were adjusted by Biome's writer
   (`biome check --write`) to satisfy `organizeImports` and the formatter. No
   logic change.

## Gate results (all green)

- `bun run typecheck` (`tsc --noEmit`): clean, no errors.
- `bun run lint:file -- "src/server/app.ts" "tests/server/runs-routes.test.ts"`:
  `Checked 2 files. No fixes applied.` — 0 errors.
- Focused tests:
  `bun test --path-ignore-patterns 'web/**' tests/server/runs-routes.test.ts tests/server/app.test.ts`

  ```
  bun test v1.3.11 (af24e281)
   12 pass
   0 fail
   32 expect() calls
  Ran 12 tests across 2 files. [171.00ms]
  ```

  New `runs-routes.test.ts` (5 tests: 401-without-token, list, detail RunDTO,
  stream event-stream, missing→404) all pass; existing `app.test.ts`
  perimeter/token/404 tests remain green.

## Concerns

- **List route hardcodes `rec.status(200)` before calling `handleRunList`** (as
  the brief specifies). A malformed query param makes `RunListQuerySchema.parse`
  throw → caught by `handleApi`'s try/catch → 500 with `rec.status(500)` reset in
  the catch. So both the response status (500) and the span status are correct;
  the pre-emptive `rec.status(200)` is harmless because the catch overwrites it.
  Followed the brief; noting for the record. Detail avoids this by design
  (`handleRunDetail` returns 404 rather than throwing for missing/escaping ids),
  so `rec.status(res.status)` after the call is accurate.
- Only `src/server/app.ts` and `tests/server/runs-routes.test.ts` were staged and
  committed; the pre-existing dirty ledger/scratch files in the tree were left
  untouched (no `git add -A`).
