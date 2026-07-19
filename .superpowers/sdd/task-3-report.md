# Task 3 report — Decision record: resume substrate (adopt vs. custom)

(Note: this file previously held a report for an unrelated Slice 30b a11y
task that reused the same filename. It has been overwritten with the
Slice 24 Increment 1 report below.)

## Status: DONE

## What was done

Followed the Task 3 brief's 3 steps on branch `slice-24-daemon-queue-remote`,
then ran the Task 3b boundary gate and fixed what it surfaced.

1. **Step 1 — decision record.** Created
   `docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md`
   containing, in order: (1) the D5c/§7.2 question verbatim from the spec,
   (2) the Task 2 spike transcript (exports probe, worker self-diagnostics,
   the failing `bun test` run, the `nodes.log` showing `a` twice) verbatim
   from `.superpowers/sdd/task-2-report.md`, (3) the Task 1 peer-range result
   (`@ai-sdk/workflow@1.0.31` resolved cleanly against `ai@7.0.31`, no peer
   conflict — clears the gate but doesn't decide adopt/custom on its own),
   (4) answers to the three spike questions (local-first/filesystem-store/
   no-Vercel? no re-execution on resume? wraps-or-replaces `src/workflow/`?
   — all answered "no"/"neither" against the installed API, each cross-checked
   against the independent Opus verification of `dist/index.d.ts`'s full
   export set), (5) the verdict line, (6) a one-paragraph rationale covering
   the Increment-6 consequence (Task 40b/41b execute, Task 40a is skipped as
   moot) and the Increment-7 cleanup flag (the `@ai-sdk/workflow` dep is
   unused by `src/`, only `spikes/` references it — mark for removal).

2. **Step 2 — stamped the Increment 6 header.** In
   `docs/superpowers/plans/2026-07-19-slice-24-daemon-queue-remote.md`, the
   "SELECTED PATH" line (plan line ~3332) now reads:
   `**SELECTED PATH: \`custom\`** (decided by Task 3, ...); Execute Task 40b/41b
   only; Task 40a is skipped as moot.` — naming the record's path + file so
   the Increment-6 executor cannot miss it.

3. **Step 3 — commit.** Staged exactly the two brief-named files and
   committed with the brief's exact message under `DOCS_OK=1` (non-src
   decision record + plan edit, not a slice landing). Commit `5d8abd4`.

4. **Task 3b — boundary gate.** `bun run typecheck` failed first
   (2 pre-existing errors in `spikes/workflow-agent/worker.ts` left over from
   Task 2: an unsafe direct cast of `WorkflowAgent?.prototype` to
   `Record<string, unknown>`, and an untyped `import('workflow')` probe with
   no `@types`). `bun run lint` then failed on biome-format drift in the two
   spike files (pre-existing from Task 2, plus one line my typecheck fix
   pushed over the formatter's width). `bun run test` then failed on the
   spike test itself: `bun run test` scopes to `tests/`+`src/` via
   `--path-ignore-patterns 'web/**'`, but it does **not** exclude `spikes/**`,
   so it picked up `resume.spike.test.ts` — whose failure is the spike's
   intended evidence (`a` appears twice), not a regression to fix.
   Per the brief's own contingency note ("if it is picked up, exclude
   `spikes/**` the same way `web/**` is excluded in the test script"), and
   since none of this touches `src/`, I:
   - Fixed the two typecheck errors in `worker.ts` (cast through `unknown`
     first; `@ts-expect-error` on the DevKit probe import with a comment
     explaining absence is the expected/proven case).
   - Ran `bun x biome check --write` on the two spike files to clear the
     pre-existing format drift.
   - Added `--path-ignore-patterns 'spikes/**'` alongside the existing
     `'web/**'` to both the `test` and `test:file` scripts in `package.json`.
   Committed these three files (not amended — a new commit) as `0082414`,
   `DOCS_OK=1` (non-src, no slice-landing implication).

   Re-ran the full gate clean afterward: `tsc --noEmit` 0 errors; `biome
   check .` 0 errors / 21 pre-existing warnings (unchanged from before this
   task — 4 `noNonNullAssertion` in the spike worker + others in unrelated
   `src/memory/chunk.ts` and `tests/**` files, none introduced here); `bun
   run test` — 1591 pass, 36 skip, 0 fail across 1627 tests / 381 files.

## Verdict recorded

```
SUBSTRATE = custom  (Increment 6 uses src/workflow/checkpoint.ts — Task 40b/41b)
```

## Files changed

- `docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md` — new,
  the decision record.
- `docs/superpowers/plans/2026-07-19-slice-24-daemon-queue-remote.md` —
  Increment 6 "SELECTED PATH" header stamped `custom`.
- `spikes/workflow-agent/worker.ts` — typecheck fix (safe unknown-cast,
  `@ts-expect-error` on the DevKit probe) + biome format.
- `spikes/workflow-agent/resume.spike.test.ts` — biome format only (no
  logic change; still the honest failing spike test, now excluded from
  `bun run test`'s scope).
- `package.json` — `test`/`test:file` scripts gained a second
  `--path-ignore-patterns 'spikes/**'` alongside the existing `'web/**'`.

Nothing under `src/` was created or modified.

## Gate results

| Gate | Result |
|---|---|
| `bun run typecheck` | PASS (0 errors, after fixing 2 pre-existing spike-file errors) |
| `bun run lint` | PASS (0 errors, 21 pre-existing warnings, none new) |
| `bun run test` | PASS — 1591 pass, 36 skip, 0 fail, 1627 tests / 381 files |
| pre-commit `docs:check` (both commits) | PASS |

## Commits

- `5d8abd4` — `docs(queue): Slice 24 resume-substrate decision record (Incr 1 gate)`
  (the decision record + plan header stamp).
- `0082414` — `chore(queue): Slice 24 Incr 1 gate fixes — spike typecheck/format
  + exclude spikes/** from bun test` (Task 3b gate-fix, no `src/` change).

## Concerns / handoff notes

- The `@ai-sdk/workflow` dependency (added Task 1, `package.json` +
  `bun.lock`) is now confirmed unused by `src/` — only `spikes/` references
  it. The decision record flags it for **removal in Increment 7 cleanup**;
  it was intentionally left in place here since Task 3's scope is the
  decision record, not dependency cleanup.
- Task 40a (`[ADOPT PATH]`) in the plan is now moot per the stamped header;
  Increment 6 should execute Task 40b/41b only and mark 40a
  `SKIPPED — path not selected` in the ledger, per the plan's own convention.
