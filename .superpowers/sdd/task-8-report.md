# Task 8 Report: Retrieval pipeline

## Implemented

`src/memory/retrieve.ts` — `retrieve(query, opts, deps)`:
1. Embeds the query via `deps.embedQuery`.
2. Guards `vector.length === deps.space.embedDim`, throwing `MemoryError` on mismatch.
3. Calls `deps.lance.hybridSearch(space.name, { queryVector, queryText, namespace, kind, limit: topK * 4 })` for candidates.
4. Optionally reranks via `deps.reranker.rerank(query, candidates)` when `opts.rerank && deps.reranker`.
5. Budget-fits: packs candidates in incoming order until `retrievalBudgetChars(numCtx)` chars are spent, capped at `topK`; the first candidate is always included even if it alone exceeds budget.

Wrapped in `withMemoryRecallSpan({ space, namespace, reranked }, ...)`. `topK` defaults via `opts.topK ?? AGENT_MEMORY_TOP_K env (default 6)`; `numCtx` defaults via `opts.numCtx ?? currentDelegationContext().numCtx`.

Exports `type Reranker = { rerank(query, results): Promise<RetrievalResult[]> }` and `type RetrieveDeps = { lance: Pick<LanceStore,'hybridSearch'>; embedQuery; space: SpaceMeta; reranker?: Reranker }`.

Deviated from the brief's literal reference snippet in one respect: did not set `candidates`/`returned` span attributes (only `reranked`), matching the brief's own reference implementation body (which also omits them) even though `MemoryRecallInfo` supports them — kept minimal per brief.

## TDD RED/GREEN

**RED** — test file used `bun:test` imports (brief's snippet used `vitest`, which is not a project dependency and would break typecheck per task instructions; I adapted imports, kept all 3 test bodies verbatim in behavior):
```
bun test tests/memory/retrieve.test.ts
error: Cannot find module '../../src/memory/retrieve.ts'
0 pass, 1 fail, 1 error
```

**GREEN** — after implementing `src/memory/retrieve.ts`:
```
bun test tests/memory/retrieve.test.ts
3 pass, 0 fail, 4 expect() calls
Ran 3 tests across 1 file. [94.00ms]
```

One typecheck fix needed post-GREEN: `noUncheckedIndexedAccess` (tsconfig) flagged `out[0].id` as possibly undefined in 2 test assertions — changed to `out[0]?.id` (consistent with strict-mode indexing elsewhere in the codebase).

`bun run typecheck` → clean (exit 0, no output).
`bun run lint:file -- src/memory/retrieve.ts tests/memory/retrieve.test.ts` → "Checked 2 files. No fixes applied." (0 errors).

## Full suite

```
bun test
238 pass, 16 skip, 0 fail, 481 expect() calls
Ran 254 tests across 85 files. [51.05s]
```

No regressions.

`bun run docs:check` → passes ("living docs present + linked; every src subsystem documented") — `src/memory/` subsystem already covered in `docs/architecture.md` from earlier Slice-12 tasks; this task adds a file to an already-documented subsystem, not a new one, so no architecture.md edit was required by the doc-check tooling. Flagging for the slice-level docs audit: architecture.md's `src/memory` description should be checked at slice-close to ensure it explicitly names the retrieval pipeline module, since the hard-line rule requires truthful, current claims, not just presence.

## Files

- Created: `/Users/inderjotsingh/ai/src/memory/retrieve.ts`
- Created: `/Users/inderjotsingh/ai/tests/memory/retrieve.test.ts`
- Commit: `8f80d83` — `feat(memory): retrieval pipeline (RRF candidates → budget-fit → top-k, rerank seam)` on branch `slice-12-memory-rag`

## Self-review

- Candidate order preservation: confirmed the loop iterates `candidates` in place without any sort — LanceDB's best-first order (or the reranker's output order) is respected verbatim, per the correctness note in the task.
- Budget-fit "always include first candidate" guard (`out.length > 0`) verified by the tight-budget test: with budget=256 chars and two 400-char candidates, only candidate `'a'` is returned (`out.length === 1 < topK === 5`).
- Dimension-mismatch path verified independent of `hybridSearch` (mock returns `[]`) — the guard fires before any search call, so no wasted work on a doomed query.
- Reranker seam verified: when `opts.rerank` is true and a reranker is supplied, its output order fully determines the final order (test reverses candidates and asserts the reversed order surfaces).
- `defaultTopK()` mirrors the brief's env-parsing pattern (`Number.isInteger(raw) && raw > 0`), consistent with `retrievalCtxFraction()` in `budget.ts` and `maxDelegationDepth()` in `guardrails.ts`.

## Concerns

1. **Test framework substitution**: the brief's test snippet imports from `vitest`; I used `bun:test` per explicit task instructions and this repo's established convention (all existing `tests/memory/*.test.ts` use `bun:test`). Confirmed no `vitest` dependency exists in `package.json`. This is a documentation bug in task-8-brief.md itself, not a design ambiguity — flagging in case other pending task briefs in this SDD batch carry the same copy-paste artifact.
2. **`noUncheckedIndexedAccess` fix**: the brief's test snippet as literally given would fail `tsc --noEmit` in this repo's strict config; fixed with `?.` chaining. Worth noting for future briefs targeting this repo to pre-empt the same tsconfig strictness.
3. Did not add `candidates`/`returned` telemetry attributes even though the span type supports them and it would arguably be more observable (aligns with the project's "telemetry to emit" standing note) — held back to match the brief's reference implementation exactly; a follow-up task/slice could wire those in if richer memory-recall telemetry is desired.
4. **Report filename collision**: `.superpowers/sdd/task-8-report.md` already existed on disk from an unrelated Slice-11 task ("Crews & roles documentation"). Overwrote it with this Slice-12 Task-8 report as instructed by this task's brief path — flagging in case the stale Slice-11 content was still needed elsewhere (it was plain leftover scratch, not referenced by this task).
