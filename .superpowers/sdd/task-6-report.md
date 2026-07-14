# Task 6 report — TanStack Router app shell + feature-area stubs + root render

_(Slice-30b Phase-1b frontend-scaffold plan. Note: a prior, unrelated "Task 6" report — the
per-session bearer-token security work from Phase 1 — previously occupied this file; that work
already landed on main and is documented in `docs/architecture.md`. This file now documents the
Phase-1b frontend task per the current brief.)_

## Files created

- `web/src/app/router.tsx` — route tree (`rootRoute.addChildren([...])`), `router` instance, `Register` module augmentation.
- `web/src/app/app-shell.tsx` — `AppShell` layout: top nav (7 areas) + `SessionsSidebar` + `Outlet` wrapped in `RegionErrorBoundary` + theme toggle `Button`.
- `web/src/app/app-shell.test.tsx` — RED→GREEN test (4 assertions per brief, unmodified assertions).
- `web/src/main.tsx` — `StrictMode > ThemeProvider > RouterProvider` root render; imports Geist fonts + `tokens.css`.
- `web/src/features/chat/index.tsx` → `ChatArea` (`area-chat`)
- `web/src/features/crews/index.tsx` → `CrewsArea` (`area-crews`)
- `web/src/features/workflows/index.tsx` → `WorkflowsArea` (`area-workflows`)
- `web/src/features/builders/index.tsx` → `BuildersArea` (`area-builders`)
- `web/src/features/runs/index.tsx` → `RunsArea` (`area-runs`)
- `web/src/features/runs/run-detail.tsx` → `RunDetail` (`run-detail`, reads `useParams({ from: '/runs/$runId' })`)
- `web/src/features/library/index.tsx` → `LibraryArea` (`area-library`)
- `web/src/features/settings/index.tsx` → `SettingsArea` (`area-settings`)
- `web/src/features/sessions/index.tsx` → `SessionsSidebar` (`sessions-sidebar`)

All exactly match the brief's stub pattern (near-identical by design — one component per feature area, intended feature-slicing, not duplication to abstract away).

## Verified TanStack Router v1 API (installed: `@tanstack/react-router@1.170.18`, `@tanstack/router-core@1.171.15` via bun's hoisted store)

Checked the installed `.d.ts` files directly (`node_modules/@tanstack/react-router/dist/esm/index.d.ts`, `route.d.ts`, `router.d.ts`, `RouterProvider.d.ts`) before writing any code:

- `createRootRoute`, `createRoute`, `createRouter`, `RootRoute`, `Route` — all re-exported from `./route.js` / `./router.js`, matching the brief exactly.
- `createMemoryHistory` — re-exported from `@tanstack/history`, matches.
- `Link` (with `activeOptions`), `Outlet`, `useParams` — all present and match the brief's usage.
- `Register` interface lives in `@tanstack/router-core` (`router.d.ts:23`); the brief's `declare module '@tanstack/react-router' { interface Register { router } }` pattern is the documented augmentation point and works (module augmentation is visible in `@tanstack/react-router` because it re-exports the core types).
- `RouterProvider` props: `{ router: TRouter } & RouterOptions...` — matches brief's `<RouterProvider router={router} />` usage exactly, no adaptation needed.

**Two adaptations vs. the brief's literal code** (both anticipated by the brief's own caveat about the `route` helper's `JSX.Element` typing):

1. **`route()` helper's component parameter type.** The brief's `component: () => JSX.Element` doesn't satisfy `createRoute`'s `component?: RouteComponent` option (`RouteComponent = AsyncRouteComponent<{}>`, a more specific function-component-like type, not any 0-arg function returning `JSX.Element`). Fixed by importing `type { RouteComponent }` from `@tanstack/react-router` and typing the helper's second parameter as `RouteComponent` directly instead of `ComponentType` or `() => JSX.Element`.
2. **`route()` helper's path parameter needed to stay a literal type.** With `path: string` (widened), `createRoute`'s path-literal-driven `RouteIds` inference collapsed to just `"__root__"`, and `useParams({ from: '/runs/$runId' })` in `run-detail.tsx` failed to typecheck (`Type '"/runs/$runId"' is not assignable to type '"__root__"'`) because the registered router's route-id union no longer included `/runs/$runId`. Fixed by making the helper generic: `const route = <TPath extends string>(path: TPath, component: RouteComponent) => ...` — this preserves the path as a literal type through `createRoute`, restoring correct `RouteIds` inference for the whole tree (including the dynamic `/runs/$runId` route) and clearing the `useParams` error with no `any`.

No other API reshaping was needed — `createRouter({ routeTree })`, `RouterProvider`, `Link`/`Outlet`, and `useParams({ from })` all match the brief's code verbatim.

## TDD

- **RED:** Wrote `web/src/app/app-shell.test.tsx` verbatim from the brief first. Ran `cd web && bun run test src/app/app-shell.test.tsx` → failed as expected: `Failed to resolve import "./router.tsx"` (file did not exist yet).
- **GREEN:** Implemented the 8 feature stubs, `run-detail.tsx`, `app-shell.tsx`, `router.tsx`, `main.tsx` per the brief (with the two adaptations above). Re-ran the same test command → 4/4 passed on the first attempt after the router-typing fixes (no assertions weakened; all `findByRole`/`findByTestId` queries kept as-is, matching the real 7 areas + theme toggle + run-detail's `$runId` interpolation).

## Gate outputs (verbatim)

**1. `cd web && bun run test src/app/app-shell.test.tsx`**
```
$ vitest run src/app/app-shell.test.tsx
 RUN  v4.1.10 /Users/inderjotsingh/ai/web
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

**2. `cd web && bun run test`** (full web suite)
```
$ vitest run
 RUN  v4.1.10 /Users/inderjotsingh/ai/web
 Test Files  8 passed (8)
      Tests  22 passed (22)
```
(8 suites = the 4 pre-existing Task 1-5 suites + this task's `app-shell.test.tsx`, all green — nothing broken by adding `main.tsx`/router.)

**3. `cd web && bun run typecheck`**
```
$ tsc --noEmit
```
Clean — no output, exit 0.

**4. `bun run lint`** (from repo root)
```
Checked 574 files in 121ms. No fixes applied.
Found 14 warnings.
```
0 errors. The 14 warnings are all pre-existing `noExplicitAny` warnings in unrelated files (`tests/provisioning/provisioner.test.ts`, `tests/resource/ollama-control.test.ts`, etc.) — none in any file touched by this task. Ran `bunx biome check --write` scoped to the 13 new/changed web files first, which auto-fixed import-order and one JSX-formatting issue (5 files reformatted: `router.tsx`, `app-shell.tsx`, `app-shell.test.tsx`, `main.tsx`, `sessions/index.tsx` — alphabetized imports, wrapped the sessions-sidebar `<p>` text) — no `// biome-ignore` needed anywhere, no repo-wide config changes.

## Self-review

- All 7 nav areas + run-detail render behind real routes; `AppShell` composes `SessionsSidebar`, `RegionErrorBoundary`-wrapped `Outlet`, and the theme-toggle `Button` exactly as specified.
- `main.tsx` matches `index.html`'s existing `<script type="module" src="/src/main.tsx">` mount point — no changes needed there.
- Feature stub near-duplication (8 near-identical components) is intentional feature-slicing per the task's explicit instruction, not abstracted away.
- No `any` introduced; the two router-typing adaptations (`RouteComponent` type import, generic `route<TPath>` helper) are minimal, correctly typed fixes with no test-assertion weakening.
- Confirmed via `.d.ts` inspection (not guesswork) that every TanStack Router API surface used matches the installed 1.170.18/1.171.15 versions before finalizing.

## Concerns

- None blocking. One note for future tasks: the `route()` helper in `router.tsx` is a small local abstraction — if a later phase needs route-specific options (loaders, search-param validators, etc.), it will likely need to move to calling `createRoute` directly per route rather than through this generic wrapper, since the wrapper only threads `path`/`component`.

## Unplanned fix: `.gitignore` `runs/` collision with the new feature area

`git add web/src/features/runs/` silently failed — both the tracked `.gitignore` (line 5: `runs/`) and the local, untracked `.git/info/exclude` (line 8: `runs/`) had an **unanchored** rule meant for the repo-root run-artifacts directory (`./runs/agent-builder-*`), which also matched any nested `runs/` folder, including this task's new `web/src/features/runs/`. Fixed both by anchoring to `/runs/` (matching the existing, correctly-anchored `/memory/` convention two lines below in `.gitignore`) — confirmed via `git check-ignore -v` before and after that this only unignores `web/src/features/runs/*` and does NOT unignore the real `./runs/` artifacts directory. This one-line `.gitignore` fix is included in this task's commit; the `.git/info/exclude` fix is local-only (untracked, not part of any commit) and only affects this machine's checkout.
