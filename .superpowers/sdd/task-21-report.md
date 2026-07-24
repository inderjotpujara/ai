# Task 21 report — Ops "Evals/Health" web tab + evalHistory boot-wiring carry-forward

**Status: DONE.** (This report path previously held a stale Slice-31 task-21
report for `src/a2a/mount.ts` — overwritten per this task's instructions; that
content is preserved in the SDD ledger history / prior commits.)

## Summary

Two independent pieces, both complete:

- **Part A**: new `EvalsTab` (`web/src/features/ops/evals-tab.tsx`) + `use-evals.ts`
  hook (`useEvals`/`useEvalHistory`/`useReeval`), registered as the sixth Ops tab
  (`OpsTab.Evals = 'evals'`) beside Federation in `index.tsx` and `router.tsx`.
- **Part B**: `createEvalHistoryStore(...)` wired into `src/server/main.ts`'s
  `ServerDeps` construction, sharing the same `jobs.db` (`AGENT_QUEUE_PATH`) the
  queue/trigger stores use. `GET /api/evals` now returns 200 real data instead of
  503 in both standalone AND daemon-injected boot (the field is built
  unconditionally, before the standalone/injected branch splits).

## Part A — the web tab

### Files created

- `web/src/features/ops/use-evals.ts` — three hooks:
  - `useEvals()` — `apiFetch('/evals', { schema: EvalHealthListResponseSchema })`,
    fetch-on-mount + `reloadTick`-bump `refresh()`, mirrors `use-jobs.ts:22`
    exactly (no query lib).
  - `useEvalHistory(artifact)` — `apiFetch('/evals/:artifact', { schema:
    EvalHistoryListResponseSchema })`, fetch-on-mount keyed by `artifact` (no
    refresh — intended to be mounted only while a trend is expanded, so
    switching/collapsing rows cancels the fetch via the effect's cleanup).
  - `useReeval(refresh)` — `reevalArtifact(ref)` POSTs `{mode:'artifact', ref}`,
    `reevalAll()` POSTs `{mode:'all'}`, both to `/evals/reeval` with
    `EvalReevalResponseSchema`, both call `refresh()` after — mirrors
    `use-job-actions.ts`'s POST + `refresh()` reconcile shape exactly.

- `web/src/features/ops/evals-tab.tsx` — `EvalsTab` (`data-testid="ops-evals"`):
  - Header with a global "Re-eval all" button (`ops-eval-reeval-all`).
  - One `EvalRow` per `EvalHealthDTO` (`ops-eval-row-<artifact>`): baseline
    `verifiedWith` model vs current model vs 👎 count in the row subtitle; a
    "Trend"/"Hide trend" toggle (`ops-eval-trend-toggle-<artifact>`); a
    "Re-eval now" button (`ops-eval-reeval-<artifact>`) that flips a local
    `pending` Set (this tab's optimistic UI — disables the button + shows
    "Re-evaluating…" immediately, before the request settles) then calls
    `reevalArtifact`.
  - A per-case grid (`ops-eval-cases-<artifact>`) from `item.latest.perCase`:
    each case is a pill (`ops-eval-case-<artifact>-<caseId>`) carrying
    `data-regressed="true"` when that case failed (`!c.passed`) — this is the
    per-case "regressed cell" highlight the brief calls for. The row itself
    also carries `data-regressed` mirroring `item.regressed` (the overall
    health-rollup verdict).
  - `EvalTrend` (mounted only while `expanded`, same conditional-mount idiom
    `JobsTab`'s `JobDetailDrawer` uses) renders a compact newest-first verdict
    strip (`ops-eval-trend-<artifact>`, points `ops-eval-trend-point-<id>`,
    filled/hollow glyph + `data-regressed` — never color-only signaling).
  - The 👎 count always renders (`👎 {item.thumbsDown}`) — 0 today, per the
    brief ("that's fine": Task 20's read has no writer for `chat.feedback`
    counts yet).

### Files modified

- `web/src/features/ops/index.tsx`:
  - `OpsTab` enum gains `Evals = 'evals'` (now six tabs, docstring updated
    "five" → "six").
  - `TABS` gains `{ id: OpsTab.Evals, label: 'Evals' }` after Federation.
  - The panel conditional gains `{t.id === OpsTab.Evals && <EvalsTab />}`.
  - Import added: `import { EvalsTab } from './evals-tab.tsx';`.
- `web/src/app/router.tsx`:
  - `OpsSearch.tab` union gains `'evals'`.
  - `validateSearch` gains `search.tab === 'evals'` in the allow-list check
    (falls back to `'overview'` otherwise, unchanged).
- `web/src/features/ops/index.test.tsx` (pre-existing, NOT in the brief's file
  list but had to be updated — see TDD section below): the five-tab
  keyboard-nav (ArrowRight/ArrowLeft wrap, Home/End) and click-switch
  assertions hard-coded Federation as the last tab; adding a sixth tab broke
  two of those tests purely by shifting "the last tab" from Federation to
  Evals. Updated to include the Evals tab id/label and moved the
  wrap-around assertions onto it, following the exact same pattern the file
  already used for Federation.

## Part B — the server boot-wiring carry-forward

### Root cause

`src/server/app.ts`'s `handleEvalHealth`/`handleEvalReeval`/`handleEvalHistory`
routes (shipped in Task 20) all resolve `deps.evalHistory` via
`need(deps.evalHistory, 'evalHistory')`, which 503s when the field is
`undefined`. `src/server/main.ts`'s `ServerDeps` construction (the same block
that builds `deviceRegistry`/`jobStore`/`triggers`/etc.) never set
`evalHistory` — so every `/api/evals*` request 503'd regardless of the routes
themselves being correct (per `tests/server/evals-routes.test.ts`, which tests
the handlers directly against hand-built stores and never exercised the boot
path — the actual gap this task closes).

### Fix — `src/server/main.ts`

1. Import added:
   ```ts
   import { createEvalHistoryStore } from '../self-improve/history.ts';
   ```
2. Construction added right after `jobStore` (same `AGENT_QUEUE_PATH`
   derivation, unconditionally — mirrors `deviceRegistry`'s unconditional
   construction earlier in the file, not gated on standalone-vs-injected
   since it is a cheap open+migrate with no start/stop lifecycle):
   ```ts
   const evalHistory = createEvalHistoryStore({
     path: String(cfg.AGENT_QUEUE_PATH),
   });
   ```
3. Threaded onto `ServerDeps`:
   ```ts
   deviceRegistry,
   rootTokens: rootStore,
   publicBaseUrl,
   // `/api/evals*` routes (Task 21 Part B) resolve this; construction above
   // is unconditional, so this is never undefined in a real boot.
   evalHistory,
   ```

This covers **both** the standalone path (`startWebServer()` called directly)
and the daemon-injected path (`src/daemon/core.ts` → `opts.startWebServer({
queue: {...} })`, per `src/cli/daemon.ts`) — both go through this same
`ServerDeps` construction block in `main.ts`; the daemon never builds its own
`ServerDeps` separately. No daemon-side change was needed.

`createRealRunEvalTurn` (`src/server/launch-turns.ts`, Task 16/Slice 32) opens
its OWN `EvalHistoryStore` instance per-run (inside the returned closure,
lazily) against the same `AGENT_QUEUE_PATH` — that write-side instance is
untouched by this change; this task only adds the READ-side instance
`ServerDeps.evalHistory` needs for the `GET` routes. Both connections open the
same `jobs.db` under WAL, which is the established, already-relied-upon
multi-connection pattern in this codebase (queue store + trigger store do the
same).

Not closed in `onShutdown`: mirrors `memoryStore`/`sessionStore`/
`deviceRegistry`, none of which are explicitly closed either (only
`jobStore`/`pool`/`triggers`, which own live workers/watchers beyond a bare DB
handle, get explicit teardown) — process exit reclaims the SQLite handle.

## TDD — RED then GREEN

### Web (Part A)

The new files (`use-evals.ts`/`evals-tab.tsx`) and their tests
(`use-evals.test.tsx`/`evals-tab.test.tsx`) were written together against the
target API shape (test-first against a not-yet-existing module is RED by
construction — `Cannot find module`). The genuine RED discovered by running
the gate was in the pre-existing `index.test.tsx`, once the sixth tab landed:

```
$ cd web && bun run test -- src/features/ops/evals-tab.test.tsx src/features/ops/use-evals.test.tsx src/features/ops/index.test.tsx
 FAIL  src/features/ops/index.test.tsx > OpsArea > moves focus with ArrowRight/ArrowLeft (roving tabindex), wrapping at both ends
   Expected element with focus: <button data-testid="ops-tab-overview">
   Received element with focus: <button data-testid="ops-tab-evals">
 FAIL  src/features/ops/index.test.tsx > OpsArea > Home jumps to the first tab, End to the last
   Expected element with focus: <button data-testid="ops-tab-federation">
   Received element with focus: <button data-testid="ops-tab-evals">
 Test Files  1 failed | 2 passed (3)
      Tests  2 failed | 12 passed (14)
```

(The two new test files' 6 `it`s passed immediately in that same run — they
were written in the same pass as the implementation, target-first.)

GREEN (after fixing `index.test.tsx`'s wrap-around assertions to land on
Evals instead of Federation):

```
$ cd web && bun run test -- src/features/ops/evals-tab.test.tsx src/features/ops/use-evals.test.tsx src/features/ops/index.test.tsx
 Test Files  3 passed (3)
      Tests  14 passed (14)
```

Full web gate:

```
$ cd web && bun run typecheck
$ tsc --noEmit
(clean, no output)

$ cd web && bun run test
 Test Files  87 passed (87)
      Tests  439 passed (439)
```

### Server (Part B)

RED — the new boot-wiring test, run BEFORE the `main.ts` wiring:

```
$ bun test tests/server/main-evals-boot.test.ts
error: expect(received).toBe(expected)
Expected: 200
Received: 503
(fail) a standalone startWebServer boot populates evalHistory so /api/evals returns 200 real data (not 503)
 0 pass
 1 fail
```

GREEN — after wiring `createEvalHistoryStore` into `main.ts`:

```
$ bun test tests/server/main-evals-boot.test.ts
 1 pass
 0 fail
 2 expect() calls
```

Focused + regression suite around the change:

```
$ bun test tests/server/evals-routes.test.ts tests/server/main-ops-deps.test.ts \
    tests/server/main-queue-boot.test.ts tests/server/a2a-boot-wiring.test.ts \
    tests/server/main.test.ts tests/self-improve/history.test.ts \
    tests/daemon/core.test.ts tests/daemon/core-triggers.test.ts
 47 pass
 0 fail
 136 expect() calls
```

## Gates run

- `bun run typecheck` (root) — clean.
- `bun run lint:file -- src/server/main.ts tests/server/main-evals-boot.test.ts` —
  clean.
- `bun run lint:file -- web/src/features/ops/evals-tab.tsx web/src/features/ops/use-evals.ts web/src/features/ops/index.tsx web/src/app/router.tsx web/src/features/ops/evals-tab.test.tsx web/src/features/ops/use-evals.test.tsx web/src/features/ops/index.test.tsx` —
  clean (biome auto-fixed 4 formatting-only diffs via `biome check --write`,
  applied and re-verified clean).
- `cd web && bun run typecheck && bun run test` — clean / 439 passed.
- Full root `bun run test` (extra safety net, not strictly required by the
  per-task gate but run given the boot-path change touches shared `main.ts`) —
  **2390 pass, 36 skip, 0 fail** across 519 files, 235.9s.

## Files changed

Created:
- `web/src/features/ops/use-evals.ts`
- `web/src/features/ops/evals-tab.tsx`
- `web/src/features/ops/use-evals.test.tsx`
- `web/src/features/ops/evals-tab.test.tsx`
- `tests/server/main-evals-boot.test.ts`

Modified:
- `web/src/features/ops/index.tsx`
- `web/src/app/router.tsx`
- `web/src/features/ops/index.test.tsx` (six-tab keyboard-nav fix-up, see above)
- `src/server/main.ts`

## Self-review

- Mirrored `use-jobs.ts`/`use-a2a-config.ts`/`use-job-actions.ts` structurally
  and stylistically (no query lib, `useEffect` + cancelled-flag + tick-bump
  refresh, POST-then-`refresh()` action shape) — no new patterns introduced.
- Mirrored `FederationTab`'s tab-registration wiring in `index.tsx`/
  `router.tsx` exactly (enum entry, `TABS` entry, panel conditional,
  `OpsSearch` union + `validateSearch` allow-list entry).
- `EvalsTab`'s per-case `data-regressed` highlight is scoped to the FAILING
  case (`!c.passed`), not blanket-copied from the row's overall `regressed`
  flag — this is the actually load-bearing signal a human would look for in
  a per-case grid (which case broke), and is independently testable
  (`ops-eval-case-weather-agent-c2` has it, `-c1` does not, in the same
  regressed row).
- No `console.log` introduced; no `any`; string enum (`OpsTab`) extended per
  repo convention rather than a union.
- Confirmed the 👎 count renders even at 0 (brief's explicit "that's fine")
  via an assertion on the never-evaled fixture row.
- Confirmed Part B covers the daemon-injected path by tracing
  `src/daemon/core.ts` → `src/cli/daemon.ts`'s `startWebServer` call — both
  go through the same `main.ts` `ServerDeps` block this task edited; no
  separate daemon-side `ServerDeps` construction exists to also patch.
- Did NOT add `evalHistory` to `startWebServer`'s returned `handle` object
  (only `server`/`token`/`port`/`jobStore`/`pool`/`triggers` are returned
  today) — out of scope for this task (nothing in the brief or existing
  callers needs it externally) and would have been a wider, unasked-for
  surface change.

## Concerns

- `EvalTrend`'s per-artifact fetch is intentionally gated behind row
  expansion (not fetched for every row on tab mount) to avoid N parallel
  `GET /api/evals/:artifact` requests when many artifacts exist — this is a
  deliberate scope choice consistent with `JobDetailDrawer`'s existing
  conditional-mount idiom, but means the "trend" is opt-in-per-row rather
  than always-visible; flagging in case the intended UX was an always-on
  sparkline per row (the brief's wording — "a small trend from eval_history"
  — reads compatibly with either).
- `evalHistory` is not explicitly closed in `main.ts`'s `onShutdown` — this
  matches the existing convention for `memoryStore`/`sessionStore`/
  `deviceRegistry` (all left to process-exit reclaim) rather than the
  `jobStore`/`pool`/`triggers` pattern (explicit teardown), but is worth a
  second look if a future audit tightens that convention across the board.
- `docs/architecture.md`/`README.md`/`ROADMAP.md`/the docs-snapshot Artifact
  were NOT touched by this task — per repo convention those are a
  slice-level (not per-task) hard line, expected to be handled by the
  slice's final review/landing pass, not each individual task.
