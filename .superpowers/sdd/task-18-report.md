# Task 18 report: web Models tab — inventory table + per-row Pull + live progress bar (Slice 30b Phase 5)

> Note: this report path previously held Slice 30b **Phase 4**'s Task-18
> report ("run-detail live DAG overlay + Runs kind facet", commit `383ceca`),
> which itself had overwritten earlier Phase-3/Slice-21 Task-18 reports. That
> work is still landed on `main`; only this file is overwritten to match the
> current task numbering (Slice 30b **Phase 5**, Task 18: web Models tab),
> per the same convention the prior notes used for their own collisions.

## Status: DONE

Commit `9d05173` — "feat(web): Models tab — inventory table + live pull progress (Phase 5)"

## What shipped

- **`web/src/features/library/models-tab.tsx` (new)** — `ModelsTab()`:
  - Fetches `GET /api/models` (`ModelListResponseSchema`) on mount into an
    inventory `<table>` (Model / Runtime / Size / Status columns).
  - Each row (`ModelRow`) renders `Installed` for installed models, or a
    `Pull` `Button` (`data-testid="models-pull-<model>"`,
    `disabled={!item.fits}`) for pullable ones.
  - `handlePull` POSTs `/api/models/pull` (`{ runtime, modelRef }`, matching
    `ModelPullRequestSchema`'s shape; response parsed with
    `RunLaunchResponseSchema`) and stores the returned `runId`.
  - `usePullWatch(runId)` opens the **existing** `/api/runs/:runId/stream`
    via `createSseTransport().stream(runId, null, SpanDtoSchema, signal)` —
    no new transport code (D2) — and watches for `model.pull.progress`
    spans, reading the literal wire key `'model.pull.progress.percent'` off
    `span.attributes` (comment points back at `ATTR.MODEL_PULL_PERCENT` in
    `src/telemetry/spans.ts:173`, confirmed exact string match by
    inspection, and `src/provisioning/pull-bridge.ts` confirms this is the
    T15 tick-span emission path).
  - Progress span (`data-testid="models-progress-<model>"`) shows
    `${percent}%` whenever a percent has ever been observed, falling back
    to `'Done'` only if the stream closed with no percent ever received,
    and `'0%'` while waiting for the first tick (see "fixes beyond the
    brief" below).
  - `/api/models`'s fetch effect has a `.catch()` + inline `role="alert"`
    error region + `RegionErrorBoundary` wrapper, matching the sibling
    `CrewsArea`/`WorkflowsArea` idiom.
- **`web/src/features/library/index.tsx`** — replaced the Models stub `<p>`
  with `<div data-testid="library-panel-models"><ModelsTab /></div>`
  (wrapping div keeps Task 7's shell test green unchanged, per the brief's
  preferred route) and updated the shell's doc comment to reflect Models no
  longer being a stub.
- **`web/src/features/library/models-tab.test.tsx` (new)** — the brief's
  test verbatim: stubs `fetch` for `/api/models`, `/api/models/pull`
  (POST), and `/api/runs/run-pull-x/stream` (one SSE frame carrying a
  `model.pull.progress` span with
  `attributes: { 'model.pull.progress.percent': 55 }`); asserts the row
  renders, clicking Pull triggers the POST + stream watch, and the progress
  testid ends up showing `55%`.

## Fixes applied beyond the brief's literal code (both caught by the gate, not left as debt)

- **Progress-render priority bug**: the brief's sample rendered
  `pull.done ? 'Done' : \`${pull.percent ?? 0}%\``. Under React's automatic
  batching, the mock's single-frame stream resolves the SSE frame, sets
  `percent`, then immediately (same microtask chain, no macrotask boundary)
  closes and sets `done: true`; React coalesces both `setState` calls into
  one commit, so the DOM only ever showed `'Done'`, never `'55%'` —
  confirmed by running the test against the brief's code unmodified (RED
  for the right reason: assertion failure, not a missing module). Fixed by
  reordering render priority to show the last known percent whenever one
  exists, falling back to `'Done'` only when the stream ended having never
  observed a percent — strictly more correct (a real completed pull would
  already have shown a percent; this just stops discarding the last known
  number).
- **Unhandled-rejection bug**: the brief's literal `/api/models` fetch
  effect had no `.catch()`. `library/index.test.tsx` (Task 7's shell test)
  renders `<ModelsTab />` via the `models` tab without stubbing `fetch`,
  so the real `fetch('/api/models')` rejects (network error in
  happy-dom/vitest) — with no `.catch()` this became a genuine unhandled
  promise rejection that failed the `bun run test` gate (exit code 1) even
  though every individual assertion passed. Fixed by adding `.catch()` +
  `error` state + `role="alert"` region + `RegionErrorBoundary`, matching
  the exact idiom already used in `CrewsArea`/`WorkflowsArea`.

## TDD evidence

- RED (missing module): `cd web && bun run test -- models-tab.test.tsx` →
  `Failed to resolve import "./models-tab.tsx"`.
- RED (assertion failure after creating the component with the brief's
  literal ternary): test ran but failed on `toHaveTextContent('55%')` (DOM
  showed `'Done'`) — confirming the coalescing bug above.
- GREEN (targeted): `cd web && bun run test -- models-tab.test.tsx` →
  `1 passed (1)`.
- GREEN (shell regression): `cd web && bun run test -- library` →
  `2 passed (2)`, exit 0 (no unhandled-rejection failure, confirmed after
  the `.catch()` fix — first run without it showed `Errors 1 error` /
  `exited with code 1` despite `2 passed (2)`).
- GREEN (full web suite): `cd web && bun run typecheck` clean;
  `cd web && bun run test` → **36 files / 134 tests passed**, exit 0.
- Root gate: `bun run typecheck` clean; `bun run docs:check` passes (no
  `src/**` changes, no doc gate triggered — web-only task).
- Lint: `bun run lint:file -- web/src/features/library/models-tab.tsx
  web/src/features/library/models-tab.test.tsx web/src/features/library/index.tsx`
  — initial run found 3 formatting diffs (long-line wraps for the type
  literal, `waitFor` call, and JSX children), fixed via `--write`
  (formatting-only, no logic changes), re-run clean (`No fixes applied`).

## Files changed

- `web/src/features/library/models-tab.tsx` (new)
- `web/src/features/library/models-tab.test.tsx` (new)
- `web/src/features/library/index.tsx` (modified — wired `<ModelsTab />`
  into the `models` tab panel)

## Self-review

- Confirmed `ModelInventoryDtoSchema`/`ModelListResponseSchema`/
  `ModelPullRequestSchema`/`RunLaunchResponseSchema`/`SpanDtoSchema` field
  shapes in `src/contracts/{dto,requests}.ts` match what the component
  consumes (no drift): `runtime`/`model`/`installed`/`fits`/`sizeBytes` on
  the inventory row; `{ runtime, modelRef }` on the pull request;
  `{ runId }` on the launch response; `attributes: Record<string, unknown>`
  on the span.
- Confirmed the progress attribute key literal
  (`'model.pull.progress.percent'`) against `ATTR.MODEL_PULL_PERCENT` in
  `src/telemetry/spans.ts:173` — exact match.
- Confirmed `fits` is honored (`disabled={!item.fits}`) without building any
  "won't fit" row rendering, per the T16 finding that non-fitting models
  never appear in the inventory (`fitAndRank` pre-filters `fits===true`).
- Verified `useRunTrace` was not force-fit in — the brief's own "Produces"
  note explicitly scopes the progress derivation to an in-component
  function with no reuse target; `createSseTransport().stream()` (the same
  underlying primitive `useRunTrace`'s callers use) is reused directly,
  satisfying "reuse the existing run-trace/stream consumption hook" at the
  transport level.
- No new pure/exported helpers beyond `ModelsTab` itself, per the interface
  note — the progress derivation stays inline in `usePullWatch`.

## Concerns

- The two deviations from the brief's literal sample code (progress-render
  priority; `.catch()` + error UI) are both defect fixes surfaced by
  running the brief's own test against its own sample, not scope creep —
  flagging them explicitly since the brief said "implement exactly as
  written." Worth folding this fix pattern (percent-priority render,
  `.catch()` on mount-effect fetches) back into future briefs that hand out
  literal sample code with an unguarded `useEffect` fetch.
- No other concerns. Increment 3 (Models/pull) is now fully wired
  end-to-end: T16 inventory → T17 pull → T15 span bridge → this UI.
- Not live-verified in a real browser against a running server + real
  model pull (out of scope for this task's gate, which is unit/vitest
  only) — recommend a live-verify pass (per the standing "live-verify
  before merge" gate) once Increment 3 as a whole is ready to land,
  confirming the progress bar advances smoothly against a real
  `model.pull.progress` tick cadence rather than the test's single frame.
