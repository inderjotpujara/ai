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
