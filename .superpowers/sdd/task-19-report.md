# Task 19 report — Isomorphic evals contracts (Evals/Health DTOs)

> NOTE: this file previously held a stale Task-19 entry from an EARLIER
> slice's task-numbering (`POST /api/security/rotate-root`, itself noted as
> overwritten from a yet-earlier Slice 30b `telemetry.ts` entry). Fully
> overwritten for Slice 32 Task 19 (Increment 7, D7 surfaces); nothing from
> the old content was merged.

## Summary

Added a new isomorphic contracts module `src/contracts/evals.ts` with the
Zod schemas + inferred types for the Slice 32 "Evals/Health" Ops tab, per
the task-19 brief exactly. Re-exported from `src/contracts/index.ts`.

## DTO shapes (as implemented)

```ts
EvalCaseResultDtoSchema = z.object({ id, passed, detail })
  // wire mirror of EvalCaseResult (src/verified-build/types.ts)

EvalHistoryDtoSchema = z.object({
  id, artifactId, model, baselineModel?, ts,
  passed, passedCount, total, regressed,
  perCase: EvalCaseResultDtoSchema[],
  judgeModel, belowBar, reason?,
})
  // field-for-field mirror of EvalHistoryRow (src/self-improve/history.ts)

EvalHealthDtoSchema = z.object({
  artifact, verifiedLevel: z.enum(VerifiedLevel),
  baselineModel?, currentModel?, latest?: EvalHistoryDtoSchema,
  regressed, thumbsDown,
})
  // per-artifact rollup: baseline verifiedWith vs latest eval verdict + 👎 count

EvalHealthListResponseSchema  = z.object({ items: EvalHealthDtoSchema[] })
EvalHistoryListResponseSchema = z.object({ items: EvalHistoryDtoSchema[] })

EvalReevalRequestSchema = z.object({
  mode: z.enum(['artifact', 'all']),
  ref: z.string().min(1).optional(),
}).refine(p => p.mode !== 'artifact' || !!p.ref)

EvalReevalResponseSchema = z.object({ enqueued, jobIds: string[] })
```

All shapes match the brief verbatim — no deviation, no conflict with the
live `EvalHistoryRow` (`src/self-improve/history.ts:17`) or `VerifiedWith`/
`VerifiedLevel` (`src/verified-build/types.ts:3,78`) shapes, so no
pre-start question was needed.

## Where placed + why

- **New file `src/contracts/evals.ts`** (not folded into `dto.ts`). Followed
  the existing precedent of small, topic-scoped standalone files in
  `src/contracts/` (`a2a.ts`, `voice.ts`, `telemetry.ts`, `events.ts` — each
  a self-contained feature surface re-exported by `index.ts`'s `export *`
  barrel) rather than growing the already-550-line `dto.ts` monolith further.
  Confirmed via `codegraph_explore` that `dto.ts` holds the generic
  run/session/job/device DTOs while feature-specific ones (A2A, voice) get
  their own file — Evals/Health is exactly that kind of new, self-contained
  feature surface.
- **`VerifiedLevel` reused from `./enums.ts`** (the wire-mirror enum at
  `src/contracts/enums.ts:137`, itself parity-tested against the engine enum
  in `tests/contracts/verified-level-parity.test.ts`) — did **not** duplicate
  it as a literal union, and did not import the engine's own
  `src/verified-build/types.ts` enum (would violate the isomorphic rule).
- **`index.ts` entry** inserted alphabetically between `enums.ts` and
  `events.ts` (`evals` < `events` lexically) to match the file's existing
  strict alphabetical ordering.
- **No mapper function added.** The brief's "Interfaces" section lists only
  the seven schemas/types above; a mapper (`evalHistoryRowToDTO` /
  `toEvalHealthDTO`) is explicitly conditional in the task-19 dispatch note
  ("if you add a mapper") and isn't part of this task's deliverable file
  list — that projection belongs to Task 20's server routes, which own the
  `eval_history` store + manifest reads this DTO is projected from. Kept
  scope to schemas only, per the brief.
- **`EvalReevalRequestSchema`'s inline `z.enum(['artifact', 'all'])`** (not a
  named repo enum) mirrors the existing precedent in
  `src/contracts/requests.ts` (`DaemonLogsQuerySchema`'s
  `z.enum(['out', 'err'])`, `FileConfigSchema`'s
  `z.enum(['add', 'change'])`) — small closed request-only literal sets stay
  inline rather than promoted to `enums.ts`, matching the repo's own style
  split (long-lived domain enums go in `enums.ts`; one-off request literals
  stay inline).

## TDD RED → GREEN

**RED** — wrote `tests/contracts/evals-contracts.test.ts` importing from the
not-yet-existing `src/contracts/evals.ts`:

```
$ bun run test:file -- "tests/contracts/evals-contracts.test.ts"
error: Cannot find module '../../src/contracts/evals.ts' from
'/Users/inderjotsingh/ai/tests/contracts/evals-contracts.test.ts'
0 pass / 1 fail / 1 error
```

**GREEN** — after adding `src/contracts/evals.ts` + the `index.ts` export:

```
$ bun run test:file -- "tests/contracts/evals-contracts.test.ts"
10 pass
0 fail
17 expect() calls
Ran 10 tests across 1 file. [49.00ms]
```

10 tests cover: `EvalCaseResultDtoSchema` valid parse; `EvalHistoryDtoSchema`
valid parse + `perCase` round-trip; row with optional `baselineModel`/`reason`
omitted; rejects malformed `perCase` entry (missing `detail`);
`EvalHealthDtoSchema` parses a rollup with a `latest` history row (brief's
required test); parses a rollup with no `latest` yet; rejects a bad
`verifiedLevel`; both list-response wrappers parse item arrays;
`EvalReevalRequestSchema` requires `ref` when `mode=artifact` (brief's
required test, exact assertions) and accepts a valid artifact-mode request;
`EvalReevalResponseSchema` valid parse.

## Gate (all three, on task-19 files)

```
$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file -- src/contracts/evals.ts src/contracts/index.ts tests/contracts/evals-contracts.test.ts
$ biome check ...
Checked 3 files in 4ms. No fixes applied.

$ bun run test:file -- "tests/contracts/evals-contracts.test.ts"
10 pass / 0 fail
```

One lint round-trip needed: initial test file had an import-order violation
(fixed by reordering the `VerifiedLevel` import before the `evals.ts`
import) and two formatter line-length violations (long single-line object
literals) — fixed via `bunx biome check --write` on the test file only
(mechanical formatting, no logic change).

## Extra verification (beyond the per-task gate)

- Full contracts regression suite: `bun test ./tests/contracts/` →
  **147 pass / 0 fail** across 37 files, including
  `tests/contracts/isomorphic.test.ts` (the recursive
  "`src/contracts` imports only `zod` or sibling `./` files" guard) —
  confirms `evals.ts`'s `import { z } from 'zod'` +
  `import { VerifiedLevel } from './enums.ts'` don't violate the isomorphic
  rule.
- `cd web && bun run typecheck` → clean, confirming the `@contracts` alias
  still resolves with the new module in the barrel (web doesn't yet import
  from `evals.ts` — that's Task 21 — but the alias surface itself is intact).

## Files changed

- `src/contracts/evals.ts` (new, 87 lines)
- `src/contracts/index.ts` (+1 line: `export * from './evals.ts';`,
  alphabetically placed)
- `tests/contracts/evals-contracts.test.ts` (new, 141 lines, 10 tests)

## Self-review

- Every field name/type matches the brief character-for-character; no
  speculative additions (no extra optional fields, no mapper, no route
  wiring — those are Tasks 20/21).
- No PII/secrets in the DTO: only artifact id, model ids, counts, booleans,
  a judge verdict, and short per-case `detail` strings (already stripped of
  golden-case text/raw output at the `EvalCaseResult` source — this DTO adds
  no new exposure).
- `string enum` convention honored: reused `VerifiedLevel` rather than a
  duplicate literal union, per repo style and the isomorphic-parity-test
  precedent already established for that exact enum.
- `type` over `interface` throughout (all `z.infer<...>` type aliases).
- No `console.log` anywhere in the new files.
- Commit message is a single, scoped conventional commit
  (`feat(contracts): ...`) ending with the required co-author trailer.

## Concerns

- None blocking. One judgment call flagged for the controller/Task 20 author
  to confirm: `EvalHealthDtoSchema.currentModel` has no engine-side
  computation wired yet (it's a DTO field only) — Task 20's route will need
  to decide what populates it (likely the artifact's *live-resolved* model
  at request time, distinct from `baselineModel` = `verifiedWith.model`).
  That's squarely Task 20 scope, not a defect in this task's DTO shape.
- The brief's optional mapper (`evalHistoryRowToDTO`/`toEvalHealthDTO`) was
  deliberately NOT added here (out of this task's file list); Task 20's
  server routes will need to write that projection themselves when they
  read `EvalHistoryStore`/`ManifestEntry`.
