# Task 16 report: `RunsArea` — rich searchable/faceted/paginated list

Slice 30b Phase 3 (Runs), web layer. Status: **DONE, gate green, committed.**

(Note: this overwrites a stale `task-16-report.md` from an earlier
task-numbering pass in Phase 2 of this same slice — an unrelated
"composer drag-drop + paste-image upload" report — per the numbering-reuse
convention already applied to this file once before.)

## Commit

`5de53d9885c05210701d4da1740025496875e2f2` —
`feat(web): RunsArea — searchable/faceted/paginated runs history list`

## What was built

Replaced the Phase-1b stub (`web/src/features/runs/index.tsx`, previously
just a static "Streaming chat lands in Phase 2" placeholder) with a real,
working component:

- Search input (`data-testid="runs-search"`), an outcome facet `<select>`
  (`runs-outcome-filter`, options sourced from the actual outcome strings
  `src/run/run-dto.ts` emits — `answer`/`error`/`resource`/`gap`/`unknown`
  — plus an "All outcomes" escape hatch, since `outcome` is a free-form
  `z.string()` in `RunListItemDtoSchema`, not a closed enum), and a
  degraded facet `<select>` (`runs-degraded-filter`: All / Degraded only /
  Clean only).
- State (`search`, `outcome`, `degraded`) is assembled into a query string
  via `URLSearchParams` in a pure `toQueryString(query, cursor)` helper; a
  `useEffect` keyed on `[query, cursor]` calls
  `apiFetch('/runs?<qs>', { schema: RunListResponseSchema })`. Changing any
  facet/search resets the cursor stack (a fresh query goes back to page 1).
- Rows render as `<Link to="/runs/$runId" params={{ runId: item.id }}>`
  (route confirmed present in `web/src/app/router.tsx`), showing
  id / outcome / lifecycle / models (joined) / tokens
  (`(tokens?.input ?? 0) + (tokens?.output ?? 0)`, since `TokensSchema` in
  `src/contracts/dto.ts` makes the whole `tokens` object optional) / a
  "degraded" badge when `item.degraded`.
- Cursor pagination: a `cursors: string[]` stack. "Next" pushes
  `page.nextCursor` (rendered only when present); "First page" pops back to
  the empty stack (rendered only once you've paged forward). Matches what
  `RunListResponseSchema` actually exposes — a `nextCursor`, no
  `prevCursor` — so there's no arbitrary jump-to-page, only forward + reset.
- Empty page → "No runs yet"; fetch failure → a `role="alert"` in-region
  message. This error state is handled as component-local `useState`, not
  via `RegionErrorBoundary` — that boundary only catches render-time throws
  through `componentDidCatch`, not async/promise rejections from the
  `useEffect` fetch (verified by reading
  `web/src/shared/ui/error-boundary.tsx`). The whole component is still
  wrapped in `<RegionErrorBoundary region="Runs">` for genuine render
  errors, matching `ChatArea`'s pattern.
- Styled with `var(--color-*)` tokens matching `ChatArea`/`Button`
  (`--color-fg`, `--color-muted`, `--color-surface`, `--color-border`,
  `--color-accent`).

## Sibling pattern followed

`web/src/features/chat/index.tsx` (`ChatArea`) — the only other
feature-area doing real data work at the time — for the
`RegionErrorBoundary` wrap + `apiFetch` usage shape. `web/src/shared/ui/button.tsx`
for the Next/First-page buttons. `web/src/features/runs/run-detail.tsx`
confirmed the `/runs/$runId` route already exists in the router config, and
`web/src/shared/contract/client.ts` confirmed `apiFetch`'s exact signature
(`(path, { schema, method?, body?, signal? })`, prepends `/api`, throws
`ApiError` on `!res.ok`, otherwise `schema.parse(await res.json())`).

## Tests

Brief's one test plus 4 more (5 total, all in
`web/src/features/runs/index.test.tsx`):
1. Brief's test — lists `run-1` fetched from `/api/runs`.
2. Empty page (`{ items: [], total: 0 }`) → renders "No runs yet".
3. A 500 response → renders `role="alert"`.
4. Changing the search input triggers a re-fetch whose URL contains
   `search=hello`.
5. Clicking Next when `nextCursor` is present triggers a re-fetch whose URL
   contains `cursor=abc`.

All 5 use `renderAt('/runs')` (not a bare `render(<RunsArea />)`) — `<Link>`
needs router context, which turned out to be required for every test that
renders a populated row, not just the brief's original one.

**Test command + output:**
```
cd web && bun run test src/features/runs/index.test.tsx
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Gate results

- `cd web && bun run typecheck` → clean (`tsc --noEmit`, no output). One
  fix needed along the way: a mock `fetch` in the search test had no typed
  parameter, so `fetchMock.mock.calls.at(-1)?.[0]` inferred against an
  empty tuple (`TS2493`) — fixed by giving the mock an explicit
  `(_input: RequestInfo | URL) => ...` signature.
- `cd web && bun run test src/features/runs/index.test.tsx` → 5/5 pass.
- `bun run lint:file -- "web/src/features/runs/index.tsx"
  "web/src/features/runs/index.test.tsx"` → clean (root linter does cover
  `web/`; it invokes `biome check`). Two fixes needed:
  1. `useEffect` deps: biome's `useExhaustiveDependencies` wanted the whole
     `query` object as a dependency, not the three destructured fields —
     changed `[query.search, query.outcome, query.degraded, cursor]` to
     `[query, cursor]`.
  2. Ran `bunx biome check --write` once to auto-fix formatting (collapsed
     a multi-line `vi.stubGlobal` call and two single-child JSX blocks per
     biome's line-width rule); re-verified typecheck + tests still green
     after the auto-fix.
- `bun run docs:check` (pre-commit hook) → passed automatically on commit;
  no new `src/` subsystem was added (only `web/src/features/runs/index.tsx`
  changed, an already-documented area), so no `architecture.md` edit was
  required for this task-level UI change.

## Concerns / notes for follow-on work

- `outcome` is `z.string()` in the contract (not an enum), so the facet
  options list (`answer`/`error`/`resource`/`gap`/`unknown`) is a
  best-effort mirror of what `src/run/run-dto.ts` currently emits, not a
  contract-enforced set. If the server starts emitting a new outcome
  string, the dropdown won't offer it (it's a `<select>`, not free text).
  Worth revisiting if outcome is ever promoted to a proper enum, or if a
  later UI wants per-facet counts.
- No debounce on the search input — every keystroke re-fetches. The brief
  explicitly allowed "a plain controlled input re-fetching on change is
  fine," so this is a deliberate, brief-sanctioned simplification, not an
  oversight; a follow-on could debounce if it proves noisy against a real
  `runsRoot` with many files.
- Per the T13 review carry-forward noted in the dispatch brief: this list
  uses plain `apiFetch` (not the SSE stream `useRunTrace`/`waterfall.tsx`
  consume for the detail view), so the schema-decoupling concern from that
  earlier review doesn't apply here — `RunListResponseSchema` is passed
  straight into `apiFetch` as intended.
