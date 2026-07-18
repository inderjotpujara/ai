# Task 5 report: `createDownsampler` — pure carry-state 48k→16k resampler (Phase 7, §7.1)

## Summary

Created `web/src/features/voice/audio-capture.ts` (exports only `DownsampleState`
type + `createDownsampler`) and `web/src/features/voice/audio-capture.test.ts`,
following the brief's derived algorithm and exact test cases verbatim.

Before implementing, I hand-verified the brief's algorithm against all four
correctness test cases (ramp exact-integer, 12-sample two-chunk carry, the
1.5:1 `prevLast`-boundary straddle, and the inductive invariant that
`idxLow >= -1` always holds) by tracing the loop step-by-step for each. No bug
found — the derivation is correct as given, so I implemented it as specified
rather than "fixing" anything.

## TDD evidence

**RED** — file didn't exist yet:

```
$ cd web && bun run test -- features/voice/audio-capture.test.ts
FAIL  src/features/voice/audio-capture.test.ts
Error: Failed to resolve import "./audio-capture.ts" from
"src/features/voice/audio-capture.test.ts". Does the file exist?
Test Files  1 failed (1)
```

**GREEN** — after implementing per the brief:

```
$ cd web && bun run test -- features/voice/audio-capture.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)
```

All 6 tests pass, including:
- exact-equality ramp test (3:1 ratio, zero floating error)
- 12-sample carry-across-boundary test (`[0,9,18,27]` chunked == one-shot)
- the 1.5:1 fractional-ratio `prevLast`-boundary-straddle test (chunked
  `[2,1,3]` == one-shot `[0,1.5,3,4.5]`)
- the 48000-sample, 128-frame-quanta vs. odd-non-aligned-chunk-sizes
  (`[37,91,5,200,1,333,128,4001]` + remainder) invariance test — asserts
  full array equality (16000 samples) between the two chunkings, plus the
  exact expected output length
- `flush()` returns empty + resets state for safe reuse
- zero-length quantum never throws, doesn't perturb subsequent output

## Gate results

- `cd web && bun run typecheck` → clean (no errors)
- `cd web && bun run test` (full suite) → **49 files / 214 tests passed**
  (a pre-existing stderr stack trace from an unrelated ECONNREFUSED test is
  just noise, not a failure — the run reports 100% pass)
- `bun run lint:file -- web/src/features/voice/audio-capture.ts
  web/src/features/voice/audio-capture.test.ts` (from repo root, biome) →
  clean after one `bunx biome check --write` formatting pass (wrapped two
  long array-literal/ternary lines only; no logic changes)

## Self-review: does the invariance test actually prove chunk-boundary correctness?

Yes, with the following reasoning:

1. **It exercises the mechanism, not just an outcome.** The 48000-sample test
   partitions the *same* signal two different ways — canonical 128-frame
   AudioWorklet quanta (375 calls) vs. 8 deliberately odd, non-128-aligned,
   non-uniform sizes (`37, 91, 5, 200, 1, 333, 128, 4001` + a final remainder
   chunk) — and asserts the two output arrays are element-wise `toEqual`
   across all 16000 samples. Because `nextP`, `globalOffsetSoFar`, and
   `prevLast` are the only state threaded between calls, and the algorithm's
   invariant guarantees `idxLow` is always resolvable from either the
   current quantum or `prevLast`, identical total input must produce a
   bit-identical output sequence regardless of chunk boundaries — this test
   would catch an off-by-one in the invariant (e.g., if the loop bound were
   `<=` instead of `<`, or if `prevLast` were captured before vs. after the
   loop) because such a bug would only manifest at specific chunk boundaries
   that differ between the two partitionings.
2. **The 1.5:1 test specifically forces the rare `idxLow === -1` path** (a
   1-sample chunk isolating the exact case where `prevLast` is required),
   which the 128-aligned-only test would never hit at a 3:1 ratio (every
   ratio-3 boundary lands with `frac === 0` well inside the next quantum).
   Combining both tests means every branch of the `idxLow === -1` conditional
   is covered by an actual chunk boundary, not just executed with
   `frac === 0` trivially.
3. **Weakness acknowledged:** the 48000-sample test uses a fixed ratio (3:1,
   `48000/16000`) and a fixed odd-chunk-size list — it doesn't fuzz random
   ratios or random chunk partitions. It's a strong deterministic invariance
   check but not an exhaustive property-based proof. Given the brief's
   explicit exact test cases (not asking for property-based fuzzing) and the
   hand-verified inductive proof of `idxLow >= -1`, I judge this sufficient
   for the task's scope; a follow-on could add fast-check-style randomized
   chunking if the adversarial-verify Workflow wants more coverage.

## Concerns

None blocking. One minor scope note for the reviewer: `DownsampleState` is
exported per the brief's interface spec but is not directly constructed or
used anywhere yet (it documents the closure's internal shape) — this is
intentional per `phase7-interfaces.md`, not dead code, and will presumably be
referenced by `downsample-worklet.ts` in Task 6.

## Commit

`0a93ada` — `feat(voice): pure carry-state 48k downsampler with chunk-invariance tests (D3, spec §7.1)`

## Review-fix pass (2 adversarial Opus verifiers: impl sound, tests inadequate)

Confirmed instruction: do NOT touch the resample math in `createDownsampler`.
Fixed only the test-adequacy gaps + one dead type.

1. **Fractional-interpolation test off the {0, 0.5} grid.** Added the
   VERBATIM test from the review brief (`createDownsampler(20000)`, ratio
   1.25, input `[0,4,8,12,16]`, expects `[0,5,10,15]`). Before trusting it, I
   hand-traced the real implementation step-by-step (`nextP` sequence
   0 → 1.25 → 2.5 → 3.75, fracs 0/.25/.5/.75 against `idxLow` 0/1/2/3) and it
   produces exactly `[0, 5, 10, 15]` — matches the brief's hand-computed
   values with no discrepancy, so no adjustment was needed. This closes the
   gap where prior tests only ever hit frac ∈ {0, 0.5}.
2. **Sine/odd-chunking test strengthened from consistency-only to
   correctness.** Added a `naiveResample(signal, ratio, k)` helper — computes
   `p = k*ratio`, floors, linear-interps directly against the full signal
   array with no carried state — and asserted `quantaOutput[k]` against it
   for `k ∈ {0,1,2,500,4999,8192,15999}` (start, early, mid, tail), in
   addition to keeping the existing `oddOutput === quantaOutput` +
   `length===16000` invariance assertions. Ratio is 3 (integer) here so
   `frac` is always exactly 0 and `s0+(s1-s0)*0 === s0` with no rounding, so
   exact `toBe` equality is meaningful (same reasoning as the file's first
   test) — this test now catches a nonlinear/nearest-neighbor resampler that
   happened to be self-consistent but wrong, which pure invariance couldn't.
3. **Dead `DownsampleState` type.** Grepped `web/src` — zero consumers
   anywhere (Task 6 has not landed). Removed the type entirely (unused
   export, doc comment attached to it removed too) rather than correcting its
   shape, since nothing references it and the real closure state
   (`nextP`/`globalOffsetSoFar`/`prevLast`) is already documented in
   `createDownsampler`'s own doc comment just below.

### Gate results (review-fix pass)

```
$ cd web && bun run typecheck
$ tsc --noEmit
(clean, no output)

$ cd web && bun run test -- src/features/voice/audio-capture.test.ts
 RUN  v4.1.10 /Users/inderjotsingh/ai/web
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  323ms

$ cd web && bun run test   (full suite, unrelated to this change)
 Test Files  49 passed (49)
      Tests  215 passed (215)

$ bun run lint:file -- "web/src/features/voice/audio-capture.ts" "web/src/features/voice/audio-capture.test.ts"
$ biome check web/src/features/voice/audio-capture.ts web/src/features/voice/audio-capture.test.ts
Checked 2 files in 4ms. No fixes applied.
```

(One `bunx biome check --write` pass was needed first, to collapse an
over-aligned comment's extra spaces in the verbatim test snippet — whitespace
only, no semantic change.)

### Review-fix commit

`test(voice): close downsampler test-adequacy gap (frac-off-grid + independent reference) [review fix]`
