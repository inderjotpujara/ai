# Task 6 report: `summarizeRunListItem` + mtime-keyed summary cache

_(Slice-30b Phase-3 runs plan. Note: a prior, unrelated "Task 6" report — the Phase-2
`runChatSession` CLI/server-parity extraction — previously occupied this file; that work
already landed on main. This file now documents the Phase-3 list-projection task per the
current brief/controller spec.)_

**Status:** Done. Typecheck clean, lint clean, focused tests green.

**Commit:** `0e18909` — `feat(run): summarizeRunListItem + mtime-keyed summary cache`

## What was built

`src/run/run-dto.ts` gained:

1. **Shared `runRootSummary(tree: TraceNode[])` helper** (private, not exported) — derives
   `{ startMs, durationMs, outcome, lifecycle, contentPolicy }` from the top-level trace roots,
   name-agnostic across `agent.run` / `crew.run` / `workflow.run` (earliest recognized root in
   the existing `RUN_ROOT_NAMES` set, which `mapRunToDto` already used). **Both `mapRunToDto`
   and `summarizeRunListItem` now call this one function** — `mapRunToDto` was refactored to
   replace its inline root-derivation logic (previously ~25 lines computing `rootSpan`,
   `runRootPresent`, `outcomeSource`, `outcome`, `lifecycle` directly in the function body) with
   a single `const { startMs, durationMs, outcome, lifecycle, contentPolicy } = runRootSummary(tree)`
   call. This is the "genuinely shared, not replicated" path the task demanded: there is exactly
   one place that decides lifecycle/duration/outcome/startMs from a trace tree, so the list and
   detail projections cannot drift, and neither can inherit the bug in `run-trace.ts`'s
   `summarizeRun` (which does `spans.find(s => s.name === 'agent.run')` and reports completed
   crew.run/workflow.run runs as durationMs 0 / lifecycle Running). `run-trace.ts` was **not**
   touched — confirmed via `git show --stat 0e18909`, only `src/run/run-dto.ts` and the new test
   file changed.

2. **`summarizeRunListItem(runsRoot, id): Promise<RunListItemDTO | undefined>`** — reads
   `spans.jsonl` only (no artifacts readdir, no degradation.jsonl read), builds the tree via the
   existing `buildTree`, calls `runRootSummary`, then does a single pass over the raw
   `SpanRecord[]` to collect `models` (from `ATTR.MODEL_ID`), summed `tokens` (from
   `ATTR.USAGE_INPUT_TOKENS`/`USAGE_OUTPUT_TOKENS`), and `degraded` (`true` if any span carries a
   `reliability.degrade` event — already present in spans.jsonl, so no separate degradation.jsonl
   read is needed, which is the whole point of this projection being cheap). Output is validated
   through `RunListItemDtoSchema.parse` before returning, matching `mapRunToDto`'s
   fail-loudly-here convention.

3. **Module-level `summaryCache: Map<string, { mtimeMs: number; item: RunListItemDTO }>`** keyed
   on **`runDir` → `{mtimeMs of spans.jsonl, item}`** — the approved deviation from the brief's
   literal directory-mtime wording. A `// why:` comment on the declaration explains: a directory's
   mtime does not change on file append (only on entry add/remove/rename), so keying on the run
   directory would leave an in-flight run's list summary stale as spans stream in; keying on
   `spans.jsonl`'s own `mtimeMs` (read via `stat`) is what actually invalidates on append. A cache
   miss (file absent) returns `undefined` immediately without ever calling `readSpans`.
   `__summaryCacheSize()` is exported test-only so cache-hit-vs-miss can be asserted by entry count
   rather than a spy/mock.

## Tests — `tests/run/run-summary.test.ts` (new, 7 tests)

- `summarizes an agent.run without spans/artifacts arrays` — brief's base case, plus explicit
  `'spans' in item` / `'artifacts' in item` assertions (both `false`) to prove the projection is
  genuinely list-cheap in shape, not just by omission of fields in the type.
- **Guardrail (required by the task, not present in the brief's literal sample code):**
  `completed crew.run (no agent.run) gets Done lifecycle + non-zero duration, NOT the agent.run-only
  bug` — asserts `lifecycle: Done`, `durationMs: 42`, `outcome: 'answer'`, `startMs: 2000` for a
  `crew.run` root with a `workflow.step` child and no `agent.run` span anywhere. This is exactly the
  fixture shape that would report `durationMs: 0` / `lifecycle: Running` under the old
  `spans.find(s => s.name === 'agent.run')` logic pattern.
- Guardrail: `completed workflow.run (no agent.run) gets Done lifecycle + non-zero duration` —
  `durationMs: 33`, `lifecycle: Done`.
- Guardrail: `crew.run root with resource outcome → Failed lifecycle`.
- `degraded=true derived from span reliability.degrade events (no degrades-file read)` — proves
  `degraded` detection works without a `degradation.jsonl` on disk at all.
- **Cache invalidation-on-append (the mechanism under test in the brief):** writes run `r2` with 1
  span, calls `summarizeRunListItem` once, snapshots `__summaryCacheSize()`, calls it again and
  asserts the cache size is unchanged (a hit — no new entry) while also asserting the returned
  item's `spanCount` is still 1 (proves the hit returns a *correct* memoized value, not just "some"
  value). Then sleeps 10ms and **overwrites** `spans.jsonl` with 2 spans (content shape identical to
  what a real append produces), which bumps the file's real `mtimeMs`, and asserts the next call
  returns `spanCount: 2` — proving the recompute path fires on a genuine mtime change.
- `undefined for a run with no spans`.

## Gate output

```
bun test --path-ignore-patterns 'web/**' tests/run/run-summary.test.ts tests/run/run-dto.test.ts
  21 pass / 0 fail / 77 expect() calls
bun test --path-ignore-patterns 'web/**' tests/run/
  34 pass / 0 fail / 110 expect() calls   (full run/ directory — nothing else regressed)
bun run typecheck
  tsc --noEmit — clean (noUncheckedIndexedAccess)
bun run lint:file -- "src/run/run-dto.ts" "tests/run/run-summary.test.ts"
  Checked 2 files. No fixes applied.  (one bunx biome check --write formatting pass needed first —
  two multi-line-wrap reflows, no logic change)
```

TDD sequence followed: wrote `tests/run/run-summary.test.ts` first, ran it, confirmed it failed
with `Export named 'summarizeRunListItem' not found in module '.../src/run/run-dto.ts'` (0 pass / 1
fail / 1 error), then implemented, then reran to green.

## Self-review / concerns

1. **How the run-root logic is shared:** literally one function (`runRootSummary`), called from
   both `mapRunToDto` and `summarizeRunListItem` — not two hand-copied implementations. This was
   verified by re-reading the diff after the edit: `mapRunToDto`'s body no longer contains any
   `RUN_ROOT_NAMES.has(...)` check or `outcomeSource`/`runRootPresent` local logic — that entire
   block was deleted and replaced with the destructured call. There is now no code path in this
   file that computes lifecycle/duration/outcome from a trace tree except through
   `runRootSummary`, so a future edit to one caller's expectations can't silently diverge from the
   other's.
2. **How cache invalidation-on-append was tested:** no mock of `fs.stat` or the clock — a real
   10ms sleep followed by a real file rewrite, then asserting the *content* of the recomputed
   summary (`spanCount: 2`) changed, not just that recompute was *attempted*. This proves both that
   the mtime comparison correctly detects the change and that the recompute path produces a
   correct result, not merely that some new object was returned.
3. Did not add a live end-to-end smoke test against a real orchestrator run — out of scope for
   this task (pure projection over on-disk spans.jsonl fixtures, same style as the existing
   `run-dto.test.ts` and `run-trace.test.ts`).
4. `run-trace.ts`'s `summarizeRun` (the CLI path with the known agent.run-only bug) was
   deliberately left untouched per the task's explicit instruction — it is out of scope here and
   is not depended on by the new code.
