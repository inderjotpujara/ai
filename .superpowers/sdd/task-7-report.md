# Task 7 Report: `verify()` primitive

(Note: this filename previously held a stale report from an unrelated
Slice-12 task — "LanceDB native-load smoke test" — that happened to reuse
this path. This report replaces it and documents Slice 13 Task 7 only.)

## Implemented

`src/verification/verify.ts` exports:

```ts
export async function verify(
  answer: string,
  opts: { query: string; space: string; threshold?: number },
  deps: VerifyDeps,
): Promise<Verdict>
```

Pipeline:
1. `decomposeClaims(answer, deps)` (Task 4) → `Claim[]`.
2. `[...new Set(claims.flatMap((c) => c.citedIds))]` → dedup all cited ids across claims.
3. `allIds.length ? deps.getByIds(opts.space, allIds) : []` → `RetrievalResult[]`, then `new Map(evidence.map((e) => [e.id, e.text]))` → `evidenceById`.
4. `deps.ensureJudge(verifyModel())` → `{model, fallback}` (see wiring note below).
5. `withVerificationSpan({}, () => verifyFaithfulness(claims, evidenceById, judge.model, judge.fallback, threshold, deps))` (Task 5) → `Verdict`, returned as-is.
6. `threshold = opts.threshold ?? verifyThreshold()` (Task 1 config), computed up front.

## How I wired `ensureJudge` / `verifyModel` (ambiguity resolution)

The brief's Step-3 sketch called `deps.ensureJudge(deps.generalModel)`, which the task instructions flagged as wrong: the judge model must be the **configured verify model**, not the general/router model. I implemented it as instructed:

```ts
import { verifyModel, verifyThreshold } from './config.ts';
...
const judge = await deps.ensureJudge(verifyModel());
```

`deps.generalModel` remains untouched by `verify.ts` — it's consumed internally by `decomposeClaims` (Task 4, claim decomposition prompt) and by `verifyFaithfulness`'s fallback path (Task 5, when `fallback: true` grading can route through the general model). `verify.ts` itself never reads `deps.generalModel` directly; it only passes `deps` through to those two functions and calls `ensureJudge` with the config-resolved verify model id (`verifyModel()` → `AGENT_VERIFY_MODEL` env or `'bespoke-minicheck'` default).

I added a third test (beyond the brief's two) that pins this down: `ensureJudge` is asserted to be called with `'bespoke-minicheck'` (not `'g'`, the fixture's `generalModel`), and the `checkClaim` call inside `verifyFaithfulness` is asserted to receive the model id `ensureJudge` resolved to (`'resolved-judge-model'`), not the raw input. This exercises the exact ambiguity called out in the task instructions and would fail if `verify.ts` reverted to `deps.ensureJudge(deps.generalModel)`.

## TDD

- **RED:** Wrote `tests/verification/verify.test.ts` with the brief's two tests plus the judge-wiring test; ran `bun test tests/verification/verify.test.ts` → failed with `Cannot find module '../../src/verification/verify.ts'` (module didn't exist yet).
- **GREEN:** Implemented `src/verification/verify.ts` per the plan above; reran → `3 pass, 0 fail, 7 expect() calls`.

## Files

- `src/verification/verify.ts` (new, 33 lines) — the `verify()` primitive.
- `tests/verification/verify.test.ts` (new, 3 tests) — brief's 2 tests + 1 added test for the ensureJudge/verifyModel wiring.

## Verification run

- `bun test tests/verification/verify.test.ts` → 3 pass, 0 fail, 7 expect() calls.
- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- src/verification/verify.ts tests/verification/verify.test.ts` → initially flagged `noExplicitAny` (the brief's literal test snippet typed the fixture as `Partial<any>`/`any`) plus import-order/formatting; fixed by typing the test fixture as `Partial<VerifyDeps> → VerifyDeps` (matching the existing convention in `tests/verification/judge.test.ts`) and running `bunx biome check --write` once to auto-fix import ordering/formatting. Final run: clean, no errors/warnings.
- `bun run test` (full suite) → **272 pass, 18 skip, 0 fail, 553 expect() calls, 290 tests across 98 files**. No regressions.
- Commit: `c7e25d5` — `feat(verification): verify() primitive (decompose→evidence→judge)` on branch `slice-13-grounded-verification`. Pre-commit hook (`docs-check`) passed (`verification/` was already a documented subsystem from an earlier task in this slice, so no `architecture.md` update was needed for this task).

## Self-review

- Function is a thin, pure orchestration layer — no I/O beyond what `deps` provides, matching the "primitive stays agnostic" note in the brief.
- Dedup via `Set` on `citedIds` avoids redundant `getByIds` lookups when multiple claims cite the same id.
- Short-circuits `getByIds` entirely when there are no cited ids at all (`allIds.length ? ... : []`), avoiding an unnecessary call with an empty array — matches the brief's sketch.
- `withVerificationSpan({}, ...)` is called with an empty info object, consistent with the brief; `spans.ts` already exposes a `recordVerdict(unsupportedClaims)` helper for annotating the active span post-hoc, which `verify.ts` does not currently call. That's a possible follow-up (e.g. for Task 10's CLI wiring) but wasn't specified as in-scope here and the brief's own sketch left the span info empty too.
- Deviated from the brief's literal test-fixture typing (`Partial<any>`/`any`) to satisfy the repo's `noExplicitAny` lint rule and match the sibling test file's convention (`Partial<VerifyDeps>` / `VerifyDeps`). Test behavior is unchanged; only the type annotations differ from the brief's inline snippet.

## Concerns

- None blocking. One minor observability gap noted above (span isn't annotated with the computed verdict via `recordVerdict`) — left as-is since it matches the brief's own sketch and wasn't specified as in-scope for Task 7; worth a follow-up if Task 10 (CLI wiring) or a later slice wants richer per-check span attributes.
