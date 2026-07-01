# Task 12 report (Slice 13 — Grounded Verification): live MiniCheck test

NOTE: this file previously held a stale report from an unrelated Slice 12 task
("wire memory into crews + workflows") that reused this filename/number in a
different slice's numbering. Replaced below with the correct Task 12 report
for Slice 13.

## Summary

Added `tests/integration/verification.live.test.ts` — a live test that
exercises the real MiniCheck judge model (`bespoke-minicheck`, via
`verifyModel()`) end-to-end through the real `verify()` primitive, and skips
cleanly when Ollama or the judge model is unavailable.

## Skip guard

Mirrors `tests/integration/memory.live.test.ts`'s `ollamaReady()` +
`describe.skipIf` pattern, extended with a pull-or-skip step for the judge
model:

- `judgeReady()` first calls the existing `ollamaReady(EMBED_MODEL)` helper
  (checks `/api/version` reachable + `qwen3-embedding:0.6b` installed —
  needed because the test also ingests memory for citations).
- If that's up, it checks `isModelInstalled('bespoke-minicheck')` (from
  `src/resource/ollama-control.ts`); if missing, it attempts
  `control.pull('bespoke-minicheck')` once and re-checks installation.
- The whole thing is wrapped in try/catch — any failure (Ollama down, pull
  fails, network error) resolves `false`, so `describe.skipIf(!ready)` skips
  the suite. No hang, no throw.
- `ready` is computed once at module load (top-level `await`), same as the
  memory live test.

## Real-deps wiring

Built the same way the CLI does (`src/cli/verify-runtime.ts` /
`src/cli/memory.ts`), inlined into the test (not via `makeRealVerifyDeps`
directly) to keep the test self-contained/explicit, matching the style of
`memory.live.test.ts`:

- `createModelManager()` for the real Model Manager.
- `runtimeFor(ProviderKind.Ollama).control` for the real Ollama control
  (`isInstalled`/`pull`/embed, etc.).
- `makeEmbedder(...)` + `createMemoryStore(...)` — identical construction to
  `memory.live.test.ts`, writing to a scratch dir `/tmp/verify-live` (cleaned
  up before and after).
- `makeVerifyDeps({ manager, control, generalModel: qwenRouter.model, store,
  space: 'default' })` from `src/verification/deps.ts` (Task 10) — the exact
  factory the CLI uses, with `qwenRouter.model` (`qwen3.5:4b`) as the real
  general/decompose/grade model, matching `makeRealVerifyDeps` in
  `verify-runtime.ts`.

Ingested two evidence chunks via `store.remember(text, { space, source, at })`
with explicit `source` ids (`raft-fact`, `sky-fact`) so citation ids are
deterministic (`${source}#0`) rather than depending on recall ranking. Added a
sanity check that `store.getByIds` resolves the raft chunk's text before using
it in a citation, so a failing assertion downstream points at the judge model
rather than an id-wiring bug.

## Assertions

1. **Grounded**: answer `"Raft elects a leader using randomized election
   timeouts. [mem:raft-fact#0]"` against the Raft evidence chunk ("The Raft
   consensus algorithm elects a leader via randomized election timeouts.") →
   `verify(...)` expected `supported: true`.
2. **Planted hallucination**: answer `"The sky appears blue because it is
   reflecting the ocean. [mem:sky-fact#0]"` cites a chunk whose real text says
   "The sky appears blue due to Rayleigh scattering." — contradicts it →
   expected `supported: false`, and `unsupportedClaims` joined+lowercased
   expected to match `/ocean|reflecting/` (the hallucinated claim text
   itself).

Both calls go through the real `verify()` (`src/verification/verify.ts`),
exercising `decomposeClaims` → `getByIds` → `ensureJudge(verifyModel())` →
`verifyFaithfulness`/`checkClaim` against the real MiniCheck model end-to-end.
180s timeout on the `it(...)`, matching the memory live test.

## Run results in this environment

- Ollama is **not reachable** here (`curl localhost:11434/api/version`
  returned nothing — connection refused). `judgeReady()` correctly resolved
  `false`.
- `bun test tests/integration/verification.live.test.ts` → `0 pass, 1 skip,
  0 fail`, completed in 163ms — clean skip, no hang, no error.
- `bun run typecheck` → clean.
- `bun run lint:file -- "tests/integration/verification.live.test.ts"` →
  clean (biome, no fixes needed).
- Full `bun run check` (docs:check + typecheck + lint + full test suite) →
  **green**: 293 pass, 19 skip, 0 fail, 631 expect() calls across 312 tests /
  103 files. The new live test is one of the 19 skips.

The test did **not** run against the real model in this environment (no
Ollama available) — only the skip path was exercised. It has never been run
"hot" against a live `bespoke-minicheck`, so that should be validated on a
machine with Ollama + the model available before fully trusting the
assertions' wording/thresholds match real MiniCheck output. The logic mirrors
the offline gate (Task 11) and unit tests (`tests/verification/verify.test.ts`),
which do pass, so confidence is reasonably high, but the live numeric
threshold behavior (`verifyThreshold()` default 0.9) with real model variance
is unverified.

## Files touched

- `/Users/inderjotsingh/ai/tests/integration/verification.live.test.ts` (new)

## Concerns

- Cannot confirm the "RAN" path (real MiniCheck call) in this sandbox — no
  Ollama daemon reachable. Recommend a follow-up manual run on a dev machine
  with Ollama + `bespoke-minicheck` pulled to confirm the assertions hold
  against real model output (especially the hallucination case, since
  MiniCheck's yes/no framing could be sensitive to phrasing).
- The pre-commit `docs:check` hook ran and passed automatically as part of the
  commit (no `docs/architecture.md` change needed for a test-only addition).
- Left other pre-existing modified files (`.remember/`, `.superpowers/sdd/*.md`
  from sibling task agents) untouched/unstaged — commit only includes the new
  test file, scoped to Task 12.

Commit: `f0cc57b` — "test(verification): live MiniCheck faithfulness
roundtrip (skips w/o model)"
