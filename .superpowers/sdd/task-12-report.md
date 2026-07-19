# Task 12 report — §7.1 adversarial correctness (D6 progressive-decode-reveal)

## Summary
Closed the deliberately-deferred correctness hole in Task 11's naive `onInterim`
wiring. The `onSegment` interim closure in
`web/src/features/voice/use-voice-input.ts` now carries three guards, in order:
`finalized` (§7.1 c) → `validSegmentersRef.current.has(segmenter)` (§7.1 a) →
`latestSegmentRef.current !== segmenter` (§7.1 d). Three failing-first adversarial
tests added to `web/src/features/voice/use-voice-input.test.ts`.

Final: **web full suite 326/326 pass (61 files)**, voice file **23/23**, typecheck
clean, biome clean.

## IMPORTANT DEVIATION FROM THE BRIEF (needs review sign-off)
The brief's prescribed guard for (d) was `segmenterRef.current !== segmenter`.
**That guard is flawed and I did not use it** — it is empirically wrong, not a
judgement call:

- On a graceful stop (`stopHold`/`toggleTap`), `endGesture` nulls
  `segmenterRef.current`. `flush()` starts `engine.transcribe(...)`
  synchronously *inside* `stopHold`, but the `onInterim` callback fires LATER —
  by which point `segmenterRef.current` is already `null`. So
  `segmenterRef.current !== segmenter` is `true` for the **legitimate current
  transcription's own interim**, dropping it.
- Applying the brief's guard verbatim turned the whole file RED: it broke THREE
  already-passing tests — both D6 interim-streaming tests (hold-to-talk + VAD
  tap) and the §7.1 (b) monotonic-replace test — and blocked the first
  legitimate interim in the new (c)/(d) tests. That directly violates the "do
  not weaken existing tests" constraint. (Evidence below: 5 failed.)

The brief's *intent* for (d) is correct — **segmenter-identity / no cross-bleed**.
Only the *ref it consulted* was wrong. The fix introduces `latestSegmentRef`, set
to `segmenter` at the moment its `'…'` placeholder is painted in `onSegment`
(i.e. "the latest segment to BEGIN transcribing"), and gates interim display on
that. This is still a strict segmenter-identity check — it keeps the current
transcription's interim (survives the graceful-stop null) while dropping an OLD,
superseded segment's late interim during a back-to-back gesture. This is a
traced correction, not a guess (full case analysis below); I proceeded rather
than hard-blocking because the correction is minimal, provably correct against
all four requirements, and preserves every existing test — but I am flagging it
prominently so the ultracode verify stage can veto.

## RED → GREEN evidence

### (a) invalidated segmenter's interim dropped
- RED (before any guard): `expected 'should-not-appear' to be '…'` — Received
  `"should-not-appear"` (unconditional `setInterim` painted the stale text).
- GREEN (after `validSegmentersRef` guard): 1 passed.

### (d) back-to-back gesture isolation
- RED (before guards): `expected 'A-partial-late' to be '…'` — old segment A's
  late interim stomped B's placeholder.
- RED (with brief's `segmenterRef` guard): regressed EARLIER —
  `expected 'A-partial' to be '…'` (first legit interim blocked). This is the
  flaw above.
- GREEN (after `latestSegmentRef` guard): 1 passed.

### (c) final wins over late interim (same request id)
- RED (before guards): `expected 'late-after-final' to be ''` — late interim
  resurrected the cleared, finalized composer.
- RED (with brief's `segmenterRef` guard): regressed earlier —
  `expected 'partial' to be ''` (first legit interim blocked).
- GREEN (after `finalized` guard): 1 passed.

### Full-file RED under the brief's verbatim guard (proof of the flaw)
```
Tests  5 failed | 18 passed (23)
 × streams real interim text from engine.transcribe (hold-to-talk) (D6)
 × streams real interim text via VAD tap-to-toggle too (D6)
 × interim text is always a monotonic replace (§7.1 b)
 × §7.1 (d) ...
 × §7.1 (c) ...
```

### Final GREEN
```
web voice file: Tests 23 passed (23)
web full suite:  Test Files 61 passed (61) | Tests 326 passed (326)
typecheck: tsc --noEmit (clean)
biome check --write (2 files): No fixes applied
```

## Guard-independence audit (reviewer note)
Empirically probed by disabling each guard in isolation and running (a)/(d)/(c):

| Guard | Disabled → regresses | Independently necessary? |
|-------|----------------------|--------------------------|
| `validSegmentersRef` (a) | only (a) fails | YES |
| `latestSegmentRef` (d)   | only (d) fails | YES |
| `finalized` (c)          | nothing regresses | NO — defense-in-depth |

**Concern:** the `finalized` guard is NOT strictly independent under the current
code. The `.finally` block deletes the segmenter from `validSegmentersRef` on
every settle, so a late-after-final interim is already caught by the (a) guard —
(c)'s test still passes with `finalized` removed. I kept `finalized` deliberately:
(1) it matches the brief's explicit Step-3c prescription; (2) it expresses the
"final wins for THIS request id" intent locally and is robust to any future
change in the bounded-growth `.finally`-delete strategy; (3) it is harmless and
correctly ordered first (a settled request short-circuits before consulting refs
a later gesture may reuse). If the verify stage prefers strict minimality, it can
be dropped with no test impact — flagging for the decision.

## Case analysis for `latestSegmentRef` (why it is correct, not a guess)
- Single hold-to-talk (existing D6 + §7.1 b): `latest = S` at onSegment; interim
  `latest === S` → displayed. ✓
- (a): S1 transcribes (`latest = S1`); a 2nd gesture starts but never flushes, so
  `latest` stays S1; `cancel()` clears `validSegmentersRef` → S1's late interim
  dropped by the (a) guard (latest alone wouldn't catch it — confirms (a) does
  the work here). ✓
- (d): A transcribes (`latest = A`) → A-partial shown; B flushes
  (`latest = B`, `'…'`); A's late interim: `latest (B) !== A` → dropped; B's
  interim shown; A even-later → dropped. Both A and B remain in
  `validSegmentersRef` (graceful stops), so ONLY `latestSegmentRef` distinguishes
  them — confirms (d) is independently necessary. ✓
- (c): single segment; `finalized`/`.finally`-delete handle the late interim. ✓

## Files changed
- `web/src/features/voice/use-voice-input.ts` — added `latestSegmentRef`; three
  guards + `finalized` flag in the `onSegment`/`onInterim` closure; `finalized`
  also set in `.then`/`.catch`.
- `web/src/features/voice/use-voice-input.test.ts` — appended §7.1 (a), (d), (c)
  adversarial tests.

## Commit
Subject:
`fix(voice): §7.1 adversarial guards — drop invalidated interim, isolate back-to-back gestures, final wins over late interim (D6)`

---

# Follow-up fix — §7.1 guards were per-SEGMENTER; VAD tap-toggle needs per-SEGMENT (commit 5e44f88)

## The defect (adversarial review, verified against ef4675c)
The three §7.1 guards correlated on the **segmenter object**
(`validSegmentersRef` + `latestSegmentRef` both held the segmenter). Correct for
hold-to-talk (one segmenter → one segment → one transcribe), but BROKEN for the
VAD **tap-toggle** gesture, whose single `gated:true` segmenter emits **many
segments** (one per speech→silence cycle), each with its own `engine.transcribe`.

- **Critical #1 (multi-segment tap):** segment 1's transcribe `.finally` ran
  `validSegmentersRef.delete(segmenter)`, deleting the ONE shared segmenter from
  the validity set. Segment 2 of the SAME still-active tap gesture then failed
  `has(segmenter)` → its interim dropped AND its `.then` early-returned →
  **`onFinal` never fired**. Hands-free, only the FIRST utterance was ever
  delivered; every later utterance silently lost.
- **Critical #2 (same-segmenter overlap):** `latestSegmentRef !== segmenter`
  could not tell two segments of the SAME segmenter apart (both `=== segmenter`),
  so an older segment's late interim painted over a newer segment's display
  (cross-bleed + non-monotonic).

## The fix (correlate per-SEGMENT)
Mint a fresh per-segment token (`const segToken: object = {}`) INSIDE the
`onSegment` callback. `validSegmentersRef` → `validSegmentTokensRef:
Set<object>` (add the token when the segment begins transcribing, delete the
TOKEN in `.finally`, so siblings of one gesture stay valid). `latestSegmentRef`
→ `latestSegmentTokenRef: object|null` (holds the latest TOKEN). All three
guards (finalized / validity-has / latest-is-me) key on the per-segment token.
`onFinal` is always delivered (append semantics); the shared interim/status
display is only touched when `latestSegmentTokenRef === segToken`, so a
superseded older segment's resolve never wipes a newer segment's live interim
(also closes the latent non-monotonic-`.then` case).

**stt-engine.ts:** left unchanged. Its `transcribe` uses an internal numeric
`id` for interim correlation but does NOT expose it; the engine already isolates
interim by id worker-side. The hook-level per-segmenter correlation was the sole
defect, so a hook-minted per-segment token is the right, minimal fix — no engine
API change needed.

## Preserved (existing passing behaviors, all still green)
(i) destructive teardown (`cancel`/disable/unmount) `clear()`s ALL tokens;
(ii) a graceful stop keeps the gesture's in-flight segment tokens valid so their
finals land; (iii) back-to-back separate gestures stay isolated;
(iv) the per-request `finalized` flag kept.

## TDD RED→GREEN evidence
- **Test 1 (Critical #1, multi-segment tap):** RED on ef4675c —
  `expected '…' to be 'seg2-partial'` (segment 2 interim dropped); segment 2
  `onFinal('two')` also never fired. GREEN after.
- **Test 2 (Critical #2, same-segmenter overlap):** RED on ef4675c —
  `expected 'A-partial-late' to be '…'` (older segment's late interim bled over
  the newer's). GREEN after.
- **Test 3 (tap variants of (a) invalidated-drop + (d) back-to-back):** added
  (Verifier-2 flagged the adversarial tests were hold-only). GREEN.
- Existing suite: `use-voice-input.test.ts` **27/27 green** (D6 streaming,
  hold-to-talk §7.1 a/b/c/d, Fix 1–4, back-to-back). Full web suite **330/330**
  across 61 files. `tsc --noEmit` clean; `biome check` clean.

## Files changed
- `web/src/features/voice/use-voice-input.ts` — segmenter-keyed refs → per-segment
  token (`validSegmentTokensRef`, `latestSegmentTokenRef`); token minted in
  `onSegment`; interim/status side effects gated on latest-token.
- `web/src/features/voice/use-voice-input.test.ts` — 4 new §7.1 tap-toggle tests
  (Critical #1, Critical #2, (a) tap variant, (d) tap variant).

## Commit
`5e44f88` — `fix(voice): correlate §7.1 progressive-decode guards per-SEGMENT, not per-segmenter`
