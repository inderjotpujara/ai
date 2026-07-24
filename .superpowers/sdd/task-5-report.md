# Task 5 Report — `Eval` JobKind/RunKind/JobKindWire + parity + `deriveRunKind`

(Slice 32, self-improvement loop, Increment 2 Task 1. Note: this report file
previously held stale content from an unrelated Task 5 in Slice 31 — it has
been overwritten with this task's actual report.)

## Summary

Registered the new `Eval` job/run kind across the enum spine (`JobKind`,
`RunKind`, `JobKindWire`) and the run-classifier (`deriveRunKind`), extended
the parity/full-value-set tests, and — because it turned out to be load-bearing
for `bun run typecheck` — added a compile-safety-only stub case in
`src/server/jobs/dispatch.ts`'s `buildExecutor` exhaustiveness switch. No real
executor/dispatch logic was implemented (that's Task 8); this task is purely
enum-spine + classifier registration.

## Codegraph exploration (before editing)

Used `mcp__codegraph__codegraph_explore` (projectPath
`/Users/inderjotsingh/ai`) with query `"JobKind RunKind JobKindWire
deriveRunKind Build Pull"` and a follow-up for `src/queue/types.ts` — confirmed:
- `RunKind` (src/contracts/enums.ts:120), `JobKindWire` (enums.ts:237),
  `deriveRunKind` (src/run/run-dto.ts:46) — line numbers matched the brief.
- `JobKind` (src/queue/types.ts:23) — matched the brief.
- Blast radius: `JobKind` has 78 callers across the repo; `RunKind` 16;
  `JobKindWire` 10; `deriveRunKind` 4 (all internal to `run-dto.ts`). Confirmed
  no `Record<JobKind, …>` or `Record<RunKind, …>` exhaustive maps exist
  (which would need a new entry) — but this missed a `switch`-based
  exhaustiveness check (see Concerns/Deviation below), which codegraph's
  blast-radius summary doesn't specifically flag as "exhaustive switch."
- Also read `tests/contracts/job-kind-parity.test.ts`,
  `tests/contracts/run-kind-build-pull.test.ts`, and `tests/run/run-kind.test.ts`
  directly (codegraph's file-source dump didn't surface test file bodies in
  this query) to see the exact existing assertion shapes before extending them.
- Verified the root span name via `grep` on `src/self-improve/spans.ts:39`:
  `return inSpan('eval.reeval', async (span) => {` — confirms the brief's
  `eval.reeval` name (Task 3, already landed).

## TDD RED → GREEN

### RED (before implementation)

```
$ bun run test -- -t "gains Eval"
...
(fail) RunKind gains Eval (Slice 32) [0.17ms]
  Expected: "eval"  Received: undefined
(fail) JobKind gains Eval (Slice 32) [0.12ms]
  Expected: "eval"  Received: undefined
2 fail

$ bun run test -- -t "eval.reeval root"
(fail) deriveRunKind maps eval.reeval root to RunKind.Eval (Slice 32) [0.13ms]
  Expected: undefined  Received: "chat"
1 fail
```

### GREEN (after implementation)

```
$ bun run test:file -- "tests/contracts/job-kind-parity.test.ts" "tests/contracts/run-kind-build-pull.test.ts" "tests/run/run-kind.test.ts"
 12 pass
 0 fail
 25 expect() calls
```

Also ran broader regression nets:

```
$ bun run test:file -- "tests/contracts/job-kind-parity.test.ts" "tests/contracts/run-kind-build-pull.test.ts" "tests/run/run-kind.test.ts" "tests/server/jobs"
 51 pass / 0 fail / 121 expect() calls

$ bun run test:file -- "tests/contracts" "tests/a2a"
 245 pass / 0 fail / 100514 expect() calls
```

## Implementation

- `src/queue/types.ts` — `JobKind.Eval = 'eval'` added (with the same
  `// RunKind.X` trailing-comment style as the other members).
- `src/contracts/enums.ts`:
  - `RunKind.Eval = 'eval'` added; updated the doc comment above `RunKind`
    to mention Eval and its Slice 32 / `eval.reeval` origin.
  - `JobKindWire.Eval = 'eval'` added; updated its one-line doc comment.
- `src/run/run-dto.ts` — `deriveRunKind` gained
  `if (rootSpanNames.includes('eval.reeval')) return RunKind.Eval;`, placed
  after the `memory.ingest` check and before the `chat.run` check (mirrors the
  brief's placement — "before the chat.run fallback").
- `src/server/jobs/dispatch.ts` (**not in the brief's file list — see
  Deviation below**) — added a `case JobKind.Eval:` to `buildExecutor`'s
  switch that returns an executor throwing
  `'JobKind.Eval executor not yet implemented (Slice 32 Task 8)'`. No real
  logic; exists solely to satisfy the pre-existing
  `const _exhaustive: never = kind;` compile-time exhaustiveness guard in the
  `default:` branch.

## Tests changed

- `tests/contracts/job-kind-parity.test.ts` — added
  `test('JobKind gains Eval (Slice 32)', …)` asserting both
  `JobKind.Eval` and `JobKindWire.Eval` equal `'eval'`. (The pre-existing
  isomorphism test `'contract JobKind values stay isomorphic with queue'`
  already covers the general parity invariant and needed no edit — it just
  now also covers `'eval'` on both sides automatically.)
- `tests/contracts/run-kind-build-pull.test.ts`:
  - Added `test('RunKind gains Eval (Slice 32)', …)` with the individual
    `RunKind.Eval === 'eval'` assertion plus the full sorted-value-set
    assertion (now including `'eval'`).
  - **Removed** the full sorted-value-set assertion from the older
    `'RunKind gains Mcp/Memory members …'` test (it duplicated the same
    array, which would otherwise need editing in two places every time a
    member is added — left only the `Mcp`/`Memory` value checks there,
    single-sourcing the full-set check in the new Eval test). This is a small
    simplification beyond the brief's literal diff, done to avoid two tests
    asserting the same evolving array.
- `tests/run/run-kind.test.ts` (**used instead of a new
  `tests/run/derive-run-kind.test.ts`** — see Deviation below) — added
  `test('deriveRunKind maps eval.reeval root to RunKind.Eval (Slice 32)', …)`.

## Self-review

- `bun run typecheck` — clean (0 errors) after the dispatch.ts stub.
- `bun run lint:file` on all 7 touched files — clean after one auto-format
  fix (biome wanted the new `throw new Error(...)` call wrapped across
  multiple lines; applied).
- Verified `JobKind ⊆ RunKind` still holds: `'eval'` is now in both.
- Verified `JobKind == JobKindWire` value-set parity still holds via the
  existing isomorphism test (no manual list to keep in sync there — it
  diffs `Object.values` of both enums).
- Checked for other places that might need a same-shape update given the new
  enum member:
  - `src/a2a/allowlist.ts`'s `refExistsFor` switches on `JobKind` but has a
    plain `default: return false;` (no exhaustiveness guard) — compiles fine,
    unaffected.
  - `web/src/features/runs/index.tsx` and
    `web/src/features/notifications/notify-diff.ts` reference `RunKind` via
    plain arrays/Sets (UI filter facets / notifiable-kind allowlist), not
    exhaustive `Record`s — compile fine as-is, but `Eval` runs won't show as
    a distinct filter chip or trigger a notification yet. That's a UI/product
    surface, correctly out of this task's scope (belongs with whichever task
    wires the self-improvement Ops UI).
  - `src/telemetry/spans.ts` only comments on `RunKind.Chat`, no enum
    dependency to update.
- Confirmed the `eval.reeval` string matches Task 3's actual
  `src/self-improve/spans.ts:39` `inSpan('eval.reeval', …)` call (not just
  the brief's prose).

## Concerns / deviations from the brief

1. **Compile-time exhaustiveness break not in the brief's file list.**
   `src/server/jobs/dispatch.ts`'s `buildExecutor` has
   `const _exhaustive: never = kind;` in its `switch (kind)`'s `default:`
   branch — a real exhaustiveness guard. The instant `JobKind` gained `Eval`
   with no corresponding `case`, `bun run typecheck` failed:
   `error TS2322: Type 'JobKind.Eval' is not assignable to type 'never'.`
   This file wasn't in the brief's "Files: Modify" list (dispatch.ts is
   explicitly Task 8's territory per the task context). I judged this a
   genuine brief/live-code gap rather than a reason to abandon the
   "no executor logic" constraint, and closed it with the smallest possible
   fix: a `case JobKind.Eval:` that returns an executor which unconditionally
   throws `'JobKind.Eval executor not yet implemented (Slice 32 Task 8)'`.
   This adds zero real behavior (no Eval job can be enqueued yet — nothing
   in this increment enqueues one) and is explicitly commented as a stub for
   Task 8 to replace. I proceeded rather than stopping to ask because (a) the
   fix is mechanical and reversible, (b) leaving typecheck red would have
   failed the per-task gate outright, and (c) Auto Mode's guidance is to make
   the reasonable call and let the controller redirect if it disagrees — but
   flagging this prominently since it touches a file the brief didn't list.
   **Task 8 should replace this stub's throw with the real re-eval executor,
   not layer on top of it.**
2. **Used `tests/run/run-kind.test.ts` instead of a new
   `tests/run/derive-run-kind.test.ts`.** The brief offered
   `tests/run/run-dto.test.ts` "if present, else a new
   `tests/run/derive-run-kind.test.ts`" — but `tests/run/run-kind.test.ts`
   already exists and is the exact precedent file for `deriveRunKind`
   coverage (it already has dedicated tests for the Build/Pull/Mcp/Memory
   root-name additions). Adding the Eval case there follows that file's own
   established pattern more closely than either brief option, so I used it
   instead of creating a new file. `tests/run/run-dto.test.ts` exists but
   doesn't cover `deriveRunKind` at all — it's for
   `summarizeRunListItem`/`mapRunToDto` etc. — so it wasn't a fit either way.
3. **Consolidated the duplicated full-value-set assertion** in
   `run-kind-build-pull.test.ts` (see Tests changed above) rather than
   copy-pasting the array a third time. Purely a test-hygiene simplification;
   the assertion coverage is unchanged (still exactly one place asserts the
   complete `RunKind` value set, now including `'eval'`).
4. **Did not touch `RUN_ROOT_NAMES` / `TERMINAL_RUN_ROOTS`** in
   `src/run/run-trace.ts`, even though their doc comment says "every
   ephemeral-run root must be listed" or a run reads as perpetually Running.
   `deriveRunKind` (used by the web projection, `summarizeRunListItem`) does
   NOT consult `RUN_ROOT_NAMES` — it scans all span names in the tree
   directly — so `RunKind.Eval` classification works correctly today via this
   task's change alone. But the CLI's `--follow` stopper and `summarizeRun`
   (in `run-trace.ts`) DO gate on `TERMINAL_RUN_ROOTS`/`RUN_ROOT_NAMES`, and
   neither set includes `'eval.reeval'` yet — so once a real executor starts
   emitting real `eval.reeval` runs, the CLI runs list may show them stuck at
   `durationMs: 0` / `Running` until that set is updated too. This was
   explicitly out of the 4-file brief scope and is exactly the kind of
   "no executor/dispatch logic yet" boundary the task description drew, but
   **whoever lands the real eval.reeval span emission (Task 8 or later) must
   also add `'eval.reeval'` to `RUN_ROOT_NAMES` (and decide if it belongs in
   `TERMINAL_RUN_ROOTS`, i.e. whether it's a top-level run root or an
   ephemeral precursor like `mcp.mount`/`memory.recall`).**
5. **`web/src/features/runs/index.tsx`'s kind-filter facet array** and
   `web/src/features/notifications/notify-diff.ts`'s `NOTIFIABLE_KINDS` set
   don't include `RunKind.Eval` — Eval runs won't get a dedicated filter chip
   or a notification toast yet. Not a compile error (plain arrays, not
   exhaustive), and correctly out of this task's enum-spine scope, but noted
   for whichever later task builds the self-improvement Ops UI.

## Files changed

- `src/queue/types.ts`
- `src/contracts/enums.ts`
- `src/run/run-dto.ts`
- `src/server/jobs/dispatch.ts` (deviation — see Concerns #1)
- `tests/contracts/job-kind-parity.test.ts`
- `tests/contracts/run-kind-build-pull.test.ts`
- `tests/run/run-kind.test.ts` (deviation — see Concerns #2)

## Commit

`11a3a11` — `feat(queue,contracts): Eval JobKind + RunKind.Eval/JobKindWire.Eval + deriveRunKind(eval.reeval)`
