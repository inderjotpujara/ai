# Task 11 Report — vad.ts tap-to-toggle (gated) mode (Slice 30b Phase 7, voice)

## Status: DONE

## Summary
Task 10 had already implemented the `gated: true` branch of `createSegmenter`
structurally but left it untested. This task added the 6 tap-to-toggle tests
from the brief (verbatim, minus the unused `CHUNK_MS_32` local per the
brief's Step-1 note) to `web/src/features/voice/vad.test.ts`.

Per the brief's Step 2, this was a **verification, not a red step**: all 6
new tests passed on the first run against the existing implementation — no
bug found in `closeSustainedSilence`'s trim-walk or the `pushFrame` gating
logic. Traced through each test by hand to confirm:

- **Sustained-silence close + trim**: `closeSustainedSilence` walks backward
  from the end of the buffer, summing each chunk's duration, cutting at the
  index where accumulated trim first reaches `silentMsAccumulated` — this
  correctly isolates exactly the speech-bearing prefix in all four
  silence-close tests (single speech chunk + N silence chunks → emitted
  segment is exactly the speech chunk(s), tail dropped).
- **Jitter tolerance (§7.1 b)**: a resumed speech frame resets
  `silentMsAccumulated = 0` before the silence clock can reach `silenceMs`,
  so a single-frame silence blip inside speech never closes prematurely —
  confirmed via the jitter test (3 speech/silence alternations, never
  called).
- **Short-utterance (§7.1 b)**: a single speech chunk followed by sustained
  silence still closes and emits (`inSegment` is true after the one speech
  push, so the following silence pushes are buffered and counted) — not
  dropped.
- **Multi-segment**: after `emit()` resets `inSegment = false` and
  `silentMsAccumulated = 0`, the next speech push re-arms the cycle
  automatically with no explicit re-arm call — verified 2 independent
  cycles → 2 segments, correct content per cycle (`0.1` then `0.2`).
- **Leading silence**: `pushFrame`'s silence branch returns early when
  `!inSegment`, so pre-speech silence is never buffered and never closes an
  empty segment.
- **flush() mid-segment**: `flush()` calls `emit()` directly regardless of
  gated mode, closing whatever is buffered immediately — verified with
  `silenceMs: 1000` (silence-close would never fire) and a single speech
  push before `flush()`.

## Code change (cleanup, not behavior)
Removed a dead `inSegment = true` write in the **non-gated** branch of
`pushFrame` (`web/src/features/voice/vad.ts`): `inSegment` is only ever
*read* in the gated branch's `if (!inSegment) return` silence-gate check,
which is unreachable when `gated` is false (that branch returns early
before reaching it). Since a segmenter's `gated` mode is fixed at
construction, the write was never observably read for any non-gated
instance. Replaced with a comment explaining why hold-to-talk mode doesn't
need it. No test depended on this write; all 7 non-gated (Task 10) tests
still pass unchanged.

## Test fixes needed to satisfy the gate (not logic changes)
The brief's literal test snippets used `onSegment.mock.calls[0][0]`
(un-narrowed array index), which fails `tsc --noEmit` under this repo's
strict indexed-access checking (`TS2532: Object is possibly 'undefined'`).
Adjusted to the same pattern Task 10 already used elsewhere in the file:
`onSegment.mock.calls[0]?.[0] as VoiceFrames`, then indexed into
`.samples as Float32Array` where a specific sample value was asserted. This
is purely a TS-narrowing fix — assertion strictness/content is unchanged.
Ran `bunx biome check --write` to reformat the newly added `describe` block
to the repo's line-wrap conventions (biome flagged wrapping only, no logic
diff).

## Gate results
- `cd web && bun run typecheck` — clean.
- `cd web && bun run test -- vad.test.ts` — **13/13 pass** (7 non-gated from
  Task 10, unchanged and still green; 6 new gated tests from this task).
- `bun run lint:file -- "web/src/features/voice/vad.ts" "web/src/features/voice/vad.test.ts"`
  (root-level biome; `web/` has no local `lint` script) — clean after the
  biome `--write` reformat.

## Commits
- `1bdb50a` — `test(voice): cover tap-to-toggle segmentation (multi-cycle, jitter, short-utterance)`

## Concerns for Task 13 (adversarial re-attack target, §7.1)
- The trim-walk in `closeSustainedSilence` assumes every chunk counted
  toward `silentMsAccumulated` is still present, unmodified, at the tail of
  `buffer` — true today since nothing else mutates `buffer` between the
  silence-accumulate push and the close, but worth Task 13 poking at
  chunk-size irregularity (variable-length real AudioWorklet chunks, not
  the fixed 512-sample frames used here) to confirm the ms-based trim
  boundary still lands exactly at a chunk boundary rather than needing
  sub-chunk trimming.
- All tests use uniform 512-sample (32ms) chunks; real Silero-worker output
  cadence (Task 12) may not be perfectly uniform — the duration-based (not
  count-based) accumulation should tolerate that, but it is untested here
  with irregular chunk sizes.

## Review fix — test-adequacy hardening (§7.1, `vad.ts` unchanged)

A review flagged that two of the original 6 gated tests **passed but did not
discriminate** a subtly-wrong segmenter — they'd pass identically against a
buggy implementation. `vad.ts` itself was confirmed correct throughout; only
`vad.test.ts` was touched.

**Fix 1 — jitter test didn't lock the accumulator reset.** The original
jitter test accumulated at most 32ms of silence per run against
`silenceMs: 100`, so a segmenter that forgot to reset
`silentMsAccumulated` on speech resumption would still stay under 100ms and
pass identically. Rewrote it (`vad.test.ts`, "does not double-transcribe...")
with 3 silence runs of 2 chunks (64ms) each, separated by a speech frame that
must reset the clock — no single run reaches `silenceMs` (100ms), but the sum
across all three (192ms) does. A no-reset bug would carry 64ms over the
speech frame and cross 100ms mid-way through the *second* run (64+64=128ms),
closing early. Also pinned the other direction in the same test: a genuine
sustained run from that point still closes correctly.

**Fix 2 — trim tests asserted length, not content.** Both silence-close
tests (`:125` sustained-silence-close, `:161` short-utterance) only checked
`frames.samples.length === 512`. Since a speech (fill 0.5) and silence (fill
0) chunk are the same length, an off-by-one in `closeSustainedSilence`'s trim
`cut` index that retained a *silent* chunk instead of the *speech* chunk
would still emit 512 samples and pass. Converted both to content assertions
(`Array.from(frames.samples as Float32Array)).toEqual(Array.from(new
Float32Array(512).fill(0.5)))`), following Task 10's Float32-round-trip
convention to avoid float32-precision false failures.

**Minor (done) — multi-chunk-speech coverage.** Added one new gated test
with 2 leading speech chunks (fill 0.6, 0.7) before the closing silence,
asserting the emitted content is the exact concatenation of both chunks in
order, trimmed of only the silent tail. This was previously untested (every
existing gated test had exactly one speech chunk). No impl bug surfaced —
`concat()`'s straightforward append-in-order already handles it correctly.

### Gate results (this fix)
- `cd web && bun run typecheck` — clean.
- `cd web && bun run test -- vad.test.ts` — **14/14 pass** (13 previous + 1
  new minor test).
- `cd web && bun run test` (full web suite) — **249/249 pass, 52/52 files**
  (unrelated `ECONNREFUSED` stderr noise from other tests exercising
  network-failure paths, pre-existing, not from this change).
- `bun run lint:file -- "web/src/features/voice/vad.test.ts"` (root-level
  biome) — clean, no fixes needed.

### Mutation checks (performed, then reverted — `vad.ts` restored to
identical content, confirmed via empty `git diff`)
1. Commented out `silentMsAccumulated = 0;` in the `isSpeech` branch of
   `pushFrame` → re-ran `vad.test.ts` → the hardened jitter test went **red**
   (`expected onSegment to not be called, but actually been called 1 times`)
   while all 13 other tests stayed green. Restored the reset line.
2. Changed `buffer.slice(0, cut)` to `buffer.slice(0, cut + 1)` in
   `closeSustainedSilence` (off-by-one, retains one extra trailing silent
   chunk) → re-ran `vad.test.ts` → all **3** content-assertion tests went
   **red** (both original trim tests + the new multi-chunk-speech test),
   11/14 passed. Restored the correct `cut` slice.

Both mutations confirm the hardened tests actually lock the behavior they
claim to; no real `vad.ts` bug was found — the implementation was correct
both before and after this fix, only the tests were strengthened.

### Commit
- `560f076` — `test(voice): harden gated-segmenter tests (jitter-reset discrimination + trim content assertions) [review fix]`
