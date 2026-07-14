# Task 3 report: ThemeProvider + light/dark toggle (Slice-30b Phase-1b frontend scaffold)

## Files
- Created: `web/src/shared/design/theme.tsx`
- Created: `web/src/shared/design/theme.test.tsx`
- Modified: `web/src/test/setup.ts` (see "Concerns" — a scoped environment shim was required)

Commit: `c10f7e2` — `feat(web): ThemeProvider with persisted light/dark toggle`

## TDD

**RED** — wrote `theme.test.tsx` verbatim from the brief, ran
`cd web && bun run test src/shared/design/theme.test.tsx`:
```
FAIL  src/shared/design/theme.test.tsx [ src/shared/design/theme.test.tsx ]
Error: Failed to resolve import "./theme.tsx" from "src/shared/design/theme.test.tsx". Does the file exist?
```
Confirmed expected failure (cannot resolve `./theme.tsx`).

**GREEN (attempt 1, blocked)** — wrote `theme.tsx` verbatim from the brief, reran the same
command. All 3 tests failed with `TypeError: localStorage.clear is not a function` inside
the test file's own `beforeEach`. This is a root-cause environment issue, not a defect in
`theme.tsx` — investigated and fixed (see below).

**GREEN (final)** —
```
$ cd web && bun run test src/shared/design/theme.test.tsx
 RUN  v4.1.10 /Users/inderjotsingh/ai/web
 Test Files  1 passed (1)
      Tests  3 passed (3)
```
Also ran the full web suite to confirm no regression from the `setup.ts` change:
`bun run test` → `Test Files 3 passed (3)`, `Tests 9 passed (9)`.

## Root cause of the localStorage failure (and the fix)

Node v25.2.1 (the interpreter Bun's `vitest` process runs under here) ships a native,
**default-on** `--experimental-webstorage` global (`node --help` shows
`--webstorage, --no-experimental-webstorage`). This defines its own `localStorage` as an
**own property directly on `globalThis`**, which shadows happy-dom's working `Storage`
instance (an own property beats an inherited prototype getter). Without a
`--localstorage-file` backing, Node's native stub exists (`typeof localStorage === 'object'`)
but its `getItem`/`setItem`/`clear` are missing — hence the `TypeError`.

Verified this is a genuine runtime/environment issue, not a happy-dom or vitest quirk, by
reproducing it with plain `node -e "localStorage.setItem('a','b')"` — no vitest, no
happy-dom involved at all — and by showing `NODE_OPTIONS="--no-experimental-webstorage"`
makes the exact same test command pass.

Since the brief's own `web/src/test/setup.ts` (already landed as prep for this task) carries
a directly analogous, already-accepted precedent — a `matchMedia` stub commented
`"happy-dom does not implement matchMedia; ThemeProvider (Task 3) depends on it"` — I added
one matching, minimally-scoped `beforeEach` stub for `localStorage` in the same file (a small
in-memory Map-backed implementation via `vi.stubGlobal`), rather than touching any shared
config (vitest.config, bunfig, package.json scripts) or reaching for a global `NODE_OPTIONS`
workaround that every future test invocation would need to remember to pass. This is the one
judgment call I made without stopping to ask first — flagging it here per the "report it"
instruction rather than silently absorbing it. I judged it in-scope because: (a) it's
required for the brief's own test to be executable at all under this repo's actual Node/Bun
version, (b) it's the same file, same `beforeEach` pattern, same task-scoped comment style
already pre-established for this exact task, and (c) it changes no repo-wide tooling
behavior — it only affects what `localStorage` resolves to inside `web`'s test process.

## Gate outputs

**1. Test (brief's exact command):**
```
$ cd web && bun run test src/shared/design/theme.test.tsx
 RUN  v4.1.10 /Users/inderjotsingh/ai/web
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  464ms
```

**2. Typecheck:**
```
$ cd web && bun run typecheck
$ tsc --noEmit
(clean — no output, exit 0)
```

**3. Lint:**
First pass on the two new files + `setup.ts` via
`bun run lint:file -- "web/src/shared/design/theme.tsx" "web/src/shared/design/theme.test.tsx" "web/src/test/setup.ts"`
flagged import-order/formatting (biome's `organizeImports` + a couple of wrap-width
formatting diffs) plus one genuine dead import (`act` from `@testing-library/react`,
imported by the brief's verbatim test code but never called). Ran
`bunx biome check --write` on the three files per the brief's own instruction ("run
`biome check --write` ... if it flags formatting/import-order, then re-run"), then removed
the unused `act` import by hand (a biome "unsafe fix" it declined to auto-apply). Re-ran:
```
$ bun run lint:file -- "web/src/shared/design/theme.tsx" "web/src/shared/design/theme.test.tsx" "web/src/test/setup.ts"
$ biome check web/src/shared/design/theme.tsx web/src/shared/design/theme.test.tsx web/src/test/setup.ts
Checked 3 files in 4ms. No fixes applied.
```
0 errors, 0 warnings on the three touched files.

Then ran the full-repo gate as specified:
```
$ bun run lint
Checked 554 files in 120ms. No fixes applied.
Found 14 warnings.
```
Exit code 0. Grepped the output for `theme`/`setup.ts` — no hits; all 14 warnings are
pre-existing `lint/suspicious/noExplicitAny` in unrelated files
(`tests/provisioning/provisioner.test.ts`, `tests/resource/ollama-control.test.ts`),
untouched by this task.

## Self-review
- `theme.tsx` and `theme.test.tsx` match the brief verbatim except the one dead import
  (`act`) removed for lint, and biome's own formatting pass (multi-line JSX wraps,
  import-name sort order) — no logic changed.
- `apply(theme)` toggles both `.dark` and `.light` classes exactly per the corrected
  Task-2-review contract; verified by the test asserting both directions (default dark →
  `.dark` present/`.light` absent; after toggle → `.light` present/`.dark` absent).
- `initialTheme()` reads `localStorage` first, falls back to
  `matchMedia('(prefers-color-scheme: light)')`, defaulting to `Theme.Dark` — matches the
  interface spec (`prefers-color-scheme: light → light, else dark`).
- `useTheme()` throws outside `<ThemeProvider>` — standard context-guard pattern, no
  existing usage elsewhere in the repo to conflict with.
- Ran the full web test suite (not just this file) post-change: 3 files / 9 tests pass, so
  the `setup.ts` addition didn't regress Task 1/2's existing tests.

## Concerns
- The `web/src/test/setup.ts` edit is the one piece of work outside the brief's literal
  file list. It's small (one more `beforeEach` block, same shape as the existing one) and
  necessary for the brief's own verbatim test to run at all on this repo's actual Node/Bun
  version — but flagging it explicitly since I was told to report rather than guess on
  anything ambiguous. If a reviewer would rather this live differently (e.g. a narrower
  polyfill, or documented as a known Node-version caveat instead of code), that's a design
  call worth a second look, though I'm confident the fix is correct given the pre-existing
  matchMedia precedent in the same file.
- Did not touch the other files `git status` showed as modified before I started
  (`.remember/now.md`, `.superpowers/sdd/progress.md`, `task-1-brief.md`,
  `task-1-report.md`, `task-2-brief.md`, `task-3-brief.md`,
  `docs/superpowers/plans/2026-07-14-slice-30b-phase1b-frontend-scaffold.md`) — those were
  already dirty in the working tree before this task began and were left untouched/unstaged
  in my commit, since they weren't part of Task 3's scope.
