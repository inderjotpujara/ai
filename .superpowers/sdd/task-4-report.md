# Task 4 report: Region error boundary + Base-UI primitives (Slice 30b Phase-1b)

## Status: DONE

## Commit
`ed68cc5 feat(web): RegionErrorBoundary + Base-UI Button/Dialog primitives`

## Files created
- `web/src/shared/ui/error-boundary.tsx` — `RegionErrorBoundary` class component
- `web/src/shared/ui/button.tsx` — `Button` (native button + `variant?: 'default' | 'accent'`)
- `web/src/shared/ui/dialog.tsx` — `Dialog` wrapping Base UI's `Dialog` primitive
- `web/src/shared/ui/error-boundary.test.tsx` — 2 tests
- `web/src/shared/ui/dialog.test.tsx` — 2 tests

## Base UI API verification (installed `@base-ui-components/react@1.0.0-rc.0`)

Inspected `web/node_modules/@base-ui-components/react/package.json` `exports` map and
the `.d.ts` files under `web/node_modules/@base-ui-components/react/dialog/`.

- **Import path confirmed:** `@base-ui-components/react/dialog` is a valid subpath
  export (`exports['./dialog']` → `./dialog/index.d.ts` / `./dialog/index.js`,
  with an ESM variant under `./esm/dialog/`). `dialog/index.d.ts` does
  `export * as Dialog from './index.parts.js'`, so
  `import { Dialog as BaseDialog } from '@base-ui-components/react/dialog'` is
  exactly right — no root-import fallback needed.
- **Part names confirmed** via `dialog/index.parts.d.ts`: `Root`, `Portal`,
  `Backdrop`, `Popup`, `Title` (plus `Close`, `Description`, `Viewport`, `Trigger`,
  `Handle`) all exist under those exact names — no `Content`/`Overlay` rename in
  this RC, no restructuring versus the brief's sample.
- **Root props** (`dialog/root/DialogRoot.d.ts`): `open?: boolean`,
  `onOpenChange?: (open: boolean, eventDetails: DialogRoot.ChangeEventDetails) => void`.
  Our wrapper's narrower `onOpenChange: (open: boolean) => void` is directly
  assignable (a callback with fewer parameters satisfies a wider one) — confirmed
  by `tsc --noEmit` passing clean with no cast. `modal` defaults to `true` (focus
  trap + scroll lock + outside-pointer disabled), satisfying the focus-trap
  requirement with no extra props.
- **Unmount-on-close confirmed** (`dialog/root/DialogRoot.d.ts`, `actionsRef` doc):
  the popup only stays mounted after close if an `actionsRef` with an `unmount`
  action is supplied; by default Base UI unmounts the closed dialog's content.
  This is what makes "renders nothing when closed" pass with zero extra props.
- **No adaptation needed.** The brief's `dialog.tsx` sample matched the installed
  API verbatim — used byte-for-byte as written.

## TDD

**RED** — wrote both test files first (`error-boundary.test.tsx`,
`dialog.test.tsx`), then ran:
```
$ cd web && bun run test src/shared/ui/
FAIL src/shared/ui/dialog.test.tsx — Failed to resolve import "./dialog.tsx"
FAIL src/shared/ui/error-boundary.test.tsx — Failed to resolve import "./error-boundary.tsx"
Test Files  2 failed (2)
     Tests  no tests
```
Confirmed genuine RED (missing modules), not a false pass.

**GREEN** — wrote `error-boundary.tsx`, `button.tsx`, `dialog.tsx` verbatim from
the brief (`Button` isn't in this task's test list but is required by the
`Dialog`/palette interface description, so it was created alongside per the
brief's file list). Re-ran the same command: 4/4 tests passed on the first try.
No happy-dom portal workaround was needed — React portals into `document.body`
render synchronously and RTL's `screen` queries the whole document by default,
so plain `getByText`/`queryByText` worked without `findBy*`/`waitFor`.

## Gate 1 — tests

```
$ cd web && bun run test src/shared/ui/
 RUN  v4.1.10 /Users/inderjotsingh/ai/web
 Test Files  2 passed (2)
      Tests  4 passed (4)
   Duration  564ms
```

Console output stayed pristine: the error-boundary "catches a throwing child" test
spies on `console.error` (`vi.spyOn(console, 'error').mockImplementation(() => {})`)
before triggering `Boom`, suppressing both React's dev-mode error logging and the
boundary's own `componentDidCatch` log during the assertion.

## Gate 2 — typecheck

```
$ cd web && bun run typecheck
$ tsc --noEmit
(clean, no output, exit 0)
```

## Gate 3 — lint

Initial `bun run lint` (from repo root) flagged 4 errors, all in the new files
(a `Button` formatting diff, an `error-boundary.tsx` JSX-wrapping diff, and
import-order in both new test files), plus pre-existing unrelated
`noExplicitAny` warnings in `tests/provisioning/provisioner.test.ts` and
`tests/resource/ollama-control.test.ts` (untouched by this task). Ran the scoped
autofix:
```
$ bun run lint:file -- "web/src/shared/ui/button.tsx" "web/src/shared/ui/dialog.tsx" \
    "web/src/shared/ui/dialog.test.tsx" "web/src/shared/ui/error-boundary.tsx" \
    "web/src/shared/ui/error-boundary.test.tsx" --write
Checked 5 files in 6ms. Fixed 4 files.
```
Re-ran `bun run lint` from root: **0 errors**, 14 pre-existing warnings (all in
files outside this task's scope). No repo-wide config changes; only the biome
auto-formatter touched the new files (import sort + JSX/argument wrapping) — no
scoped `biome-ignore` was needed, no genuine rule conflict encountered.

Re-ran tests + typecheck after the autofix to confirm nothing regressed: 4/4
tests still passed, `tsc --noEmit` still clean.

## Self-review

- **`RegionErrorBoundary`**: class component; `getDerivedStateFromError` sets
  state; `componentDidCatch` logs `[region:<name>]` + error + component stack to
  `console.error` (telemetry sink explicitly deferred to a later phase per the
  brief's own comment). Fallback renders `role="alert"` with the region name
  bolded, matching the test's `toHaveTextContent(/Chat/)`.
- **`Button`**: extends native `ButtonHTMLAttributes`, `variant` defaults to
  `'default'`, explicit `type="button"` avoids accidental form-submit semantics,
  `className` passthrough appends after the variant classes so callers can
  override. Not directly unit-tested in this task (brief's test list covers only
  error-boundary + dialog) — it's a trivial presentational wrapper; Task 7's
  palette will exercise it through its own tests.
- **`Dialog`**: thin wrapper; `open`/`onOpenChange`/`title`/`children` map 1:1 onto
  Base UI's `Root`/`Title`/children slot. Focus-trap and Esc-close are Base UI's
  default `Root` behavior (`modal` defaults `true`; `disablePointerDismissal`
  defaults `false`, so outside-click and Escape both dismiss) — verified via the
  type declarations rather than reimplemented.
- Styling in `button.tsx`/`dialog.tsx` consumes the same `--color-*` CSS custom
  properties Task 2's `tokens.css` established (`--color-border`,
  `--color-surface`, `--color-fg`, `--color-accent`, `--color-bg`,
  `--color-muted`), consistent with Task 3's `theme.tsx` usage.

## Concerns

- `Button` has no dedicated unit test in this task (out of the brief's scope);
  flagging in case a reviewer wants one added preemptively, though Task 7's ⌘K
  palette will cover it via its own render.
- Living docs (`docs/architecture.md`, README, ROADMAP, SDD ledger) were **not**
  touched by this task — per the repo's hard line those are gated at
  slice-landing (pre-push), not per-task, and `.superpowers/sdd/progress.md`
  already shows other in-flight edits from the broader Phase-1b effort that are
  outside this task's scope.
