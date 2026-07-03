# Task 16 report: provisioning fit-math tuning (WS4)

## Summary

Implemented the two logged Slice-14 tuning follow-ons plus the gguf-parser
keep-decision note. Scope ended up spanning three files instead of just
`fit.ts`, because the actual constants/heuristics the brief describes live
one layer down from `fit.ts` — `fit.ts` only *consumes* them:

1. **`bytesPerWeight` 0.56 → 0.6.** The real constant is the `Q4_0`/`Q4_K_M`
   entries in `src/discovery/quant.ts`'s `BPW` map (not a literal in
   `fit.ts` — `fit.ts` reads `candidate.footprint.bytesPerWeight`, which is
   populated upstream from this map for GGUF candidates). Bumped both from
   0.56 → 0.6 per the logged finding ("Q4_K_M ≈ 0.6 B/param, repo's 0.56 is
   optimistic"), with a doc comment explaining why. Updated the one test
   that pinned the old value (`tests/discovery/quant.test.ts`). Other tests
   that hardcode a literal `0.56` (footprint.test.ts, verification/deps.ts,
   several discovery/resource fixtures) pass a literal number directly and
   never call `bytesPerWeightForQuant`, so they were unaffected and left
   alone — touching them would have been unrelated scope creep.

2. **Injectable Metal working-set reader.** The "static tier-fraction
   heuristic" the brief refers to is `GPU_BUDGET_FRACTION` in
   `src/resource/hardware.ts` (`gpuBudgetBytes`/`machineBudgetBytes`/
   `liveBudgetBytes` — this is what ultimately becomes the `budgetBytes`
   argument `fitAndRank` receives from callers). Added a `HardwareDeps` type
   with `readMetalWorkingSetBytes?: () => number | undefined`, threaded as
   an optional param (default `{}`) through all three functions — fully
   backward-compatible, no caller changes required. Default reader consults
   only `process.env.AGENT_METAL_WORKING_SET_BYTES`; returns `undefined`
   otherwise (no native probe, no shell-out, never crashes) so callers fall
   back to the existing `GPU_BUDGET_FRACTION` heuristic unchanged.

3. **gguf-parser-go keep-decision.** Added a code comment at the top of
   `src/provisioning/fit.ts` documenting the conscious decision to keep
   HF-tree/Ollama-manifest sizing (`fileSizeBytes`) instead of adding
   `gguf-parser-go` (a Go binary dependency), so it isn't re-litigated.

## Files changed

- `src/discovery/quant.ts` — `Q4_0`/`Q4_K_M` bytes-per-weight 0.56 → 0.6 + comment.
- `src/resource/hardware.ts` — `HardwareDeps` type + injectable
  `readMetalWorkingSetBytes` seam on `gpuBudgetBytes`/`machineBudgetBytes`/
  `liveBudgetBytes`, env-only fallback-safe default reader.
- `src/provisioning/fit.ts` — gguf-parser keep-decision comment (no logic change).
- `tests/discovery/quant.test.ts` — updated pinned value 0.56 → 0.6.
- `tests/provisioning/fit.test.ts` — two new test groups:
  - flows the tuned `bytesPerWeightForQuant('Q4_K_M')` (0.6) through
    `fitAndRank`'s size estimate and checks the exact expected byte math.
  - `gpuBudgetBytes` uses the injected reader when it returns a value, and
    falls back to the static 0.75 heuristic (no throw) when it returns
    `undefined`.

## Verification (inline, focused — no full suite run)

- `bun run typecheck` → 0 errors.
- `bun run lint:file -- src/discovery/quant.ts src/resource/hardware.ts src/provisioning/fit.ts tests/provisioning/fit.test.ts tests/discovery/quant.test.ts` → clean (one `--write` auto-format pass for line wrapping, then clean).
- `bun run test:file -- "tests/provisioning/fit.test.ts"` → 8 pass / 0 fail (was RED on the 2 new tests before the constant bump + reader existed).
- Also ran the two other directly-touched-module test files as a targeted
  sanity check (not the full suite): `tests/discovery/quant.test.ts` +
  `tests/resource/hardware.test.ts` → 7 pass / 0 fail combined.

## Notes / concerns

- The brief's "Files: Modify: `src/provisioning/fit.ts`" undersold the
  actual blast radius — the two tunable values live in `quant.ts` and
  `hardware.ts`, one layer beneath `fit.ts`. Kept `fit.ts` itself
  logic-unchanged (comment only) since that's architecturally correct:
  it consumes both values, it doesn't own either.
- Backward compatibility: `gpuBudgetBytes`/`machineBudgetBytes`/
  `liveBudgetBytes` all gained an optional trailing `deps` param defaulting
  to `{}` — no existing call site required changes (verified via
  `bun run typecheck`).
