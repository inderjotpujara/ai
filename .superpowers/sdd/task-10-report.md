# Task 10 Report: Recall tool + auto-inject helper

## Implemented

`src/memory/recall-tool.ts`:
- `formatResults(results: RetrievalResult[]): string` — citation-tagged
  (`[mem:<id>] (<source>) <text>`, chunks joined by `\n\n`); returns the exact
  explicit abstention string `'No supporting memory found.'` when `results` is empty.
- `makeRecallTool(store: MemoryStore, ctx: { space?: string; namespace?: string })`
  — an AI SDK `tool()` (description + zod input schema + `execute`) matching
  the codebase's existing tool declarations. Zod input `{ query: string; topK?: number }`.
  `execute` calls `store.recall(query, { space, namespace, topK })` and returns
  `formatResults(...)`.
- `injectRecall(store, ctx, task): Promise<string>` — reads the caller's live
  context budget via `currentDelegationContext().numCtx` (from
  `src/core/guardrails.ts`), calls `store.recall(task, { space, namespace, numCtx })`,
  and if there are hits, formats them and truncates to
  `retrievalBudgetChars(numCtx)` (from `src/memory/budget.ts`) before prepending
  as `Relevant memory:\n<recalled>\n\n---\nTask:\n<task>`. Returns `task`
  unchanged when nothing is found.

## tool() schema key — CONFIRMED

Grepped `src/tools/read-file.ts` and `src/core/delegate.ts` (both use `tool(...)`
from `ai` v6.0.217). Both use **`inputSchema`**, not `parameters`:

```ts
export const readFileTool = tool({
  description: '...',
  inputSchema: z.object({ path: z.string().describe('...') }),
  execute: async ({ path }) => { ... },
});
```

The brief's Step-3 code sample used `parameters:` — that was the ambiguous/older
shape flagged by the task's own caveat ("v6 uses `inputSchema` in some versions,
`parameters` in others"). I mirrored the codebase's real, confirmed shape
(`inputSchema`) instead of the brief's literal sample. `execute` destructures
the parsed input object directly (no wrapper), and both existing tools return
either a plain value/string or a small structured object — `recall`'s `execute`
returns a plain string (`formatResults(...)`), consistent with that pattern.

## Design choices beyond the brief's literal sample

1. **`inputSchema` not `parameters`** (see above — verified against 2 existing
   tool declarations, not guessed).
2. **`injectRecall` is budget-fit, not just presence-gated.** The task
   description explicitly says "prepends budget-fit recalled context" — the
   brief's Step-3 code sample recalls with no `numCtx` and no truncation, which
   would silently violate the "budget-fit" requirement built in Task 8
   (`retrievalBudgetChars`). I wired `currentDelegationContext().numCtx`
   (already used by `delegate.ts` for the same purpose) into `store.recall(...)`
   and truncated the formatted string to `retrievalBudgetChars(numCtx)` before
   splicing it into the task. This reuses `budget.ts` (Task 8) and
   `guardrails.ts` (Slice 9) rather than reinventing a budget check, and keeps
   the same behavior as the brief when `numCtx` is unset (falls back to 4096
   via `retrievalBudgetChars`).
3. Used `bun:test` (not the brief's `vitest`), per explicit task instructions
   and matching every other `tests/memory/*.test.ts` file in the slice.

## TDD RED/GREEN

- **RED**: wrote `tests/memory/recall-tool.test.ts` (2 tests: citation tag
  present; empty → abstention regex `/no supporting memory/i`). Ran
  `bun test tests/memory/recall-tool.test.ts` → failed with
  `Cannot find module '../../src/memory/recall-tool.ts'` (module not found, as
  expected — no implementation yet).
- **GREEN**: wrote `src/memory/recall-tool.ts`. Re-ran the same test file →
  `2 pass / 0 fail / 3 expect() calls`.

## Verification

- `bun test tests/memory/recall-tool.test.ts` → 2 pass, 0 fail.
- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- src/memory/recall-tool.ts` → `Checked 1 file... No fixes applied.`
- Full suite: `bun test` → **245 pass / 16 skip / 0 fail** (491 expect() calls,
  261 tests across 87 files).

## Files

- `/Users/inderjotsingh/ai/src/memory/recall-tool.ts` (new)
- `/Users/inderjotsingh/ai/tests/memory/recall-tool.test.ts` (new)

## Commit

`80bab2d feat(memory): recall tool (citation-tagged) + auto-inject helper`
(pre-commit `docs-check` passed — `src/memory/` is already a documented
subsystem in `docs/architecture.md`; the detailed memory-subsystem prose is
explicitly stubbed there as "filled in as the slice lands (Task 14)", which is
this slice's own convention for the final docs-sync task, not a violation of
the per-slice doc rule.)

## Self-review

- `formatResults` matches the brief exactly: citation format
  `[mem:<id>] (<source>) <text>`, chunks joined with a blank line, and the
  literal abstention string.
- `makeRecallTool`'s zod schema matches the brief: `query: z.string()`,
  `topK: z.number().int().positive().optional()`.
- `injectRecall`'s "return task unchanged if nothing found" path is preserved
  (`results.length === 0 → return task`), satisfying the interface contract
  even though the happy path adds truncation logic beyond the brief's sample.
- No `console.log`, no `any`, no non-null assertions.
- Reused existing exports (`retrievalBudgetChars`, `currentDelegationContext`)
  rather than duplicating budget/context logic — keeps this task's surface
  small and consistent with Tasks 8/9's design.

## Concerns

- **None blocking.** One judgment call worth flagging for the slice's final
  review (Task 14): `injectRecall`'s truncation is a plain `.slice(0, budget)`
  on the joined citation string, which can cut a citation tag or chunk
  mid-text if the budget lands inside one. The brief didn't specify truncation
  granularity; this is the simplest safe behavior (never exceeds budget) but a
  future refinement could truncate at chunk boundaries (drop whole
  `[mem:...]` entries that don't fit rather than slicing mid-chunk) for
  cleaner output. Flagging rather than gold-plating since the brief's own
  sample had no truncation at all.
- The task named the export `makeRecallTool` per both the brief and task
  description; the tool's registered *name* (`recall`) is not set inside the
  `tool()` call itself (this codebase's `tool()` declarations, per
  `read-file.ts` and `delegate.ts`, don't take a `name` field — the name is
  assigned by whatever record/map the tool is registered into, e.g.
  `{ recall: makeRecallTool(...) }`). This matches the existing pattern
  exactly (`readFileTool`, `asDelegateTool` also have no in-call name) and
  will be wired at the call site in a later task if not already covered by
  Task 9/store integration.
