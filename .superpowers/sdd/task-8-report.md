# Task 8 report: `handleRunDetail` — `GET /api/runs/:id` → RunDTO / 404 (Slice 30b Phase 3)

(Note: this file name was previously used by an earlier Slice-30b-Phase-2
Task 8 — the `POST /api/chat` SSE handler + task builder. That work is
preserved in git history on `slice-30b-phase2-chat`. This report replaces
it for the current, Phase-3 Task 8: the `GET /api/runs/:id` run-detail
handler.)

## Status: COMPLETE

## Commit

`dabb9ee` — `feat(server): handleRunDetail — GET /api/runs/:id → RunDTO / 404 (confineToDir guarded)`

## Files created

- `src/server/runs/detail.ts` — `RunsDeps = { runsRoot: string }`,
  `handleRunDetail(id, deps): Promise<Response>`.
- `tests/server/runs-detail.test.ts` — 3 tests.

## TDD RED/GREEN

- RED: wrote `tests/server/runs-detail.test.ts` first, ran
  `bun test --path-ignore-patterns 'web/**' tests/server/runs-detail.test.ts`
  → `Cannot find module '../../src/server/runs/detail.ts'` (module didn't
  exist yet).
- Implemented `src/server/runs/detail.ts` exactly per the brief's sample
  (it matches the established handler shape already used by
  `src/server/chat/handler.ts`: a local `json()` helper re-declared rather
  than imported from `app.ts`, to avoid a circular import — `app.ts` will
  import this handler to wire the route in Task 11).
- GREEN: `3 pass / 0 fail / 7 expect() calls`.

## Behavior implemented

1. `confineToDir(id, deps.runsRoot)` runs FIRST, before any run lookup —
   realpath-confines the `:id` path segment under `runsRoot`, rejecting
   `../`/symlink/absolute escapes.
2. A `MediaPathError` thrown by `confineToDir` maps to the exact same
   404 `{error:'not found'}` used for a genuinely missing run — the
   response gives a caller no way to distinguish "id escapes the runs
   root" from "no such run id" (no traversal-vs-missing leak), matching
   how `serveStatic` already treats `MediaPathError` elsewhere in
   `src/server`.
3. `mapRunToDto(deps.runsRoot, id)` returning `undefined` (no
   `spans.jsonl` for that run) also 404s with the identical body.
4. Otherwise: 200 with the `RunDTO` JSON body under `ISOLATION_HEADERS`
   (COOP/COEP) plus `content-type: application/json; charset=utf-8`.

`mapRunToDto` (in `src/run/run-dto.ts`) already runs
`RunDtoSchema.parse(dto)` internally before returning, so every 200 body
this handler serves is guaranteed schema-valid by construction — no
additional validation needed in the handler itself.

## Test cases

- **200** — real temp run dir with a `spans.jsonl` containing one
  `agent.run` span (`agent.outcome: 'answer'`): asserts status 200,
  `body.id === 'run-1'`, `body.outcome === 'answer'`, and the
  `cross-origin-opener-policy: same-origin` header is present.
- **404 missing** — an id with no corresponding run dir: asserts status
  404 and body exactly `{ error: 'not found' }`.
- **404 traversal** — id `'../../../../etc'`: asserts status 404 (the
  `confineToDir` → `MediaPathError` → 404 path), same status/shape as
  the missing-run case, confirming no leak.

## Scope note (per brief)

Route wiring into `handleApi`/`app.ts` is explicitly Task 11 per the
brief — not touched here. This task is the standalone handler function
plus its unit tests, fabricating a temp `runsRoot` + request id directly
rather than going through the full server/`app.ts` request path.

## Gate results

- `bun run typecheck` — clean (`tsc --noEmit`, no output;
  `noUncheckedIndexedAccess` respected).
- `bun run lint:file -- "src/server/runs/detail.ts" "tests/server/runs-detail.test.ts"`
  — clean. One biome auto-format was applied to the test file (multi-line
  wrapping of the `span()` helper and one long `writeFile` call broken
  across lines) — no logic change, purely formatting; re-verified clean
  afterward (`Checked 2 files. No fixes applied.`).
- `bun test --path-ignore-patterns 'web/**' tests/server/runs-detail.test.ts`
  — `3 pass, 0 fail, 7 expect() calls`.

## Self-review

- **Traversal → 404 no-leak (the security-critical path):** verified by
  reading `confineToDir`'s implementation
  (`src/server/security/media-path.ts`) — it realpath-resolves both the
  root and the candidate, and throws `MediaPathError` uniformly whether
  the candidate doesn't exist (`realpathSync` throws internally, caught
  and rethrown as `MediaPathError`) or exists but resolves outside the
  root's prefix. `handleRunDetail` catches only `MediaPathError` and maps
  it to the identical `{error:'not found'}`/404 used for a plain missing
  run; any *other* thrown error (a genuine bug, e.g. `root` itself not
  existing) is rethrown rather than swallowed, matching the brief's
  sample and the same pattern `chat/handler.ts` uses for its own
  `confineToDir` call.
- **200 bodies validate `RunDtoSchema`:** confirmed by reading
  `mapRunToDto` in `src/run/run-dto.ts` — it constructs the `RunDTO` object
  and returns `RunDtoSchema.parse(dto)`, so a malformed projection would
  throw inside `mapRunToDto` itself (500, loud) rather than ever reach this
  handler's 200 branch with an invalid shape.
- No new subsystem introduced (`src/server/runs/` sits inside the already-
  documented `src/server` tree) — `bun run docs:check` (run as part of the
  pre-commit hook) passed with no living-doc gap.
- Only this task's 2 new files were staged/committed; pre-existing
  unrelated modified files in the working tree (SDD ledger bookkeeping,
  `.remember/` buffers, other task briefs/reports from parallel
  Phase-3 tasks) were left untouched, verified via `git status --short`
  before `git add`.

## Concerns

None. Implementation follows the brief's sample code verbatim; it matched
the established handler shape in `chat/handler.ts` with no deviations
needed.
