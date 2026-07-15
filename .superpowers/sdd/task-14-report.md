### Task 14 (Slice 30b Phase 3 — Runs): `use-run-trace` — pure `foldSpan` + `useRunTrace` hook — Report

**Status:** DONE, GREEN.

**Note:** This file previously held a report for an unrelated Task 14 from
Slice 30b Phase 2 (the live agent/model status rail, `use-status-events.ts` /
`live-rail.tsx`). That content is superseded by this report — see git history
for the prior content if needed.

## What was built

- `web/src/features/runs/use-run-trace.ts` — `RunTraceState` type
  (`{ spans: SpanDTO[]; cursor: string | null }`), pure `foldSpan(state, span,
  eventId?)` reducer, and `useRunTrace(initial: SpanDTO[])` hook returning
  `{ spans, cursor, ingest }`. Implemented exactly per the brief's sample:
  `foldSpan` filters out any existing span with the same `spanId` (de-dupe /
  replace-in-place), pushes the new span onto that filtered (new) array,
  sorts by `offsetMs`, and sets `cursor = eventId ?? state.cursor`.
  `useRunTrace` seeds state by folding the `initial` snapshot array through
  `foldSpan`, then mirrors `use-status-events.ts`'s `useState` +
  stable `useCallback` shape for `ingest`.
- `web/src/features/runs/use-run-trace.test.ts` — the brief's exact test,
  verbatim: appends+sorts+cursor-tracks; de-dupes by `spanId` (replace, not
  duplicate).

Confirmed `SpanDTO` (from `src/contracts/dto.ts`'s `SpanDtoSchema`, re-exported
via the `@contracts` barrel) matches the test fixture's shape (`spanId`,
`parentSpanId`, `name`, `offsetMs`, `durationMs`, `depth`, `status`,
`degraded`, `attributes`, `events`) — no signature mismatch, no escalation
needed. The `web/tsconfig.json` / `vite.config.ts` `@contracts` path alias
resolves to `../src/contracts/index.ts`; the runs feature directory already
existed (`index.tsx`, `run-detail.tsx` from earlier phase tasks).

## Non-mutation confirmation (per the brief's explicit ask)

`state.spans.filter((s) => s.spanId !== span.spanId)` returns a **brand-new**
array (`next`); the subsequent `next.push(span)` and `next.sort(...)` mutate
only that new array, never `state.spans` itself. So `foldSpan` is pure and
safe for React state identity — the previous `state` object and its `.spans`
array are left untouched, and callers (`setState((prev) => foldSpan(prev, ...))`)
always get a genuinely new object/array pair back, which is what triggers a
correct re-render.

## TDD RED → GREEN

1. Wrote `use-run-trace.test.ts` first (brief's exact test).
2. `cd web && bun run test src/features/runs/use-run-trace.test.ts` →
   **FAIL** — `Failed to resolve import "./use-run-trace.ts"` (module
   missing), confirming the test exercises real code, not a stub.
3. Wrote `use-run-trace.ts` (brief's exact sample impl).
4. Re-ran the same test → **PASS**, `Test Files 1 passed (1)`, `Tests 2
   passed (2)`.

## Gate results

- `cd web && bun run test src/features/runs/use-run-trace.test.ts` → **PASS**,
  1 file / 2 tests (`appends new spans sorted by offsetMs and tracks the
  cursor`, `de-dupes by spanId (replace, not duplicate)`).
- `cd web && bun run typecheck` (`tsc --noEmit`) → clean, no errors.
- `bun run lint:file -- "web/src/features/runs/use-run-trace.ts"
  "web/src/features/runs/use-run-trace.test.ts"` → root Biome linter **does**
  cover `web/`. First pass flagged one formatting error in the test file (the
  brief's sample crammed two fields onto compressed lines inside the `span()`
  fixture's return object — not multi-line per Biome's formatter rules).
  Fixed via `bunx biome check --write` on both files (reformatted the
  `span()` return object onto one field per line; no logic change). Re-ran
  `lint:file` → clean, no fixes applied, 0 errors. Re-ran the vitest test and
  `tsc --noEmit` after the reformat to confirm nothing regressed — both still
  green/clean.

## Commit

`ee0c7d4 feat(web): use-run-trace — pure foldSpan reducer + useRunTrace hook
(snapshot+stream merge)` — staged only the 2 task files explicitly (`git add
web/src/features/runs/use-run-trace.ts web/src/features/runs/use-run-trace.test.ts`,
not `-A`). `git status --short` before committing showed numerous unrelated
in-flight files modified by other concurrent tasks (`.remember/*`, other
`.superpowers/sdd/task-*-brief.md`/`report.md`, `docs/superpowers/plans/*`) —
none of those were staged or committed here. `git show --stat HEAD`: 2 files
changed, 71 insertions(+) — exactly the files this task owns. Pre-commit
`docs-check` hook ran and passed (`✔ docs-check: living docs present +
linked; every src subsystem documented`) — this is a `web/` UI addition
inside the already-documented Slice 30b Phase 3 runs subsystem; no new
`src/` subsystem was introduced, so no `architecture.md` edit was required at
this task-level granularity (phase-level doc updates are the
controller's/final-review's job per the slice plan).

## Concerns

- None blocking. `useRunTrace` itself has no dedicated hook-level test (only
  `foldSpan` is unit-tested, per the brief's exact scope) — the hook is a
  thin `useState`/`useCallback` wrapper around the already-tested pure
  reducer, consistent with how `use-status-events.ts`'s `useStatusEvents`
  is tested only indirectly (via `renderHook` in a sibling task) rather than
  directly. If a later task wires `useRunTrace` into a live SSE-consuming run
  view, that integration point would be the place to add a `renderHook`-based
  test exercising `ingest` end-to-end.
- `foldSpan`'s de-dupe is O(n) per call (full array filter + re-sort); fine
  for typical single-run trace sizes, but if a run ever streams a very large
  number of spans this could be revisited (out of scope for this task).
