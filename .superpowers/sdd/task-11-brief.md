### Task 11: `vad.ts` — tap-to-toggle (gated) mode: multi-segment, jitter, short-utterance

**Files:**
- Modify: `web/src/features/voice/vad.ts` (already correct from Task 10 — the `gated: true` branch was implemented there; this task only ADDS tests, no code change, unless a test finds a real bug)
- Modify: `web/src/features/voice/vad.test.ts` (append)

**Interfaces:**
- Consumes/Produces: unchanged from Task 10 (`createSegmenter`/`Segmenter`/`SegmenterOpts`).

- [ ] **Step 1: Write the failing tests (tap-to-toggle / `gated: true`)**

Append to `web/src/features/voice/vad.test.ts`:

```ts
describe('createSegmenter — tap-to-toggle (gated: true)', () => {
  const CHUNK_MS_32 = new Float32Array(512); // 512 samples @ 16kHz = 32ms

  it('closes a segment after sustained silence >= silenceMs, trimming the trailing silence off the emitted audio', () => {
    const segmenter = createSegmenter({ silenceMs: 100, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0.5), true); // 32ms speech
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms
    segmenter.pushFrame(tone(512, 0), false); // 96ms
    expect(onSegment).not.toHaveBeenCalled(); // not yet sustained
    segmenter.pushFrame(tone(512, 0), false); // 128ms >= 100ms — closes
    expect(onSegment).toHaveBeenCalledTimes(1);
    const frames = onSegment.mock.calls[0][0];
    // only the one speech chunk survives trimming — no silent tail.
    expect(frames.samples.length).toBe(512);
  });

  it('does not double-transcribe on a jittery VAD flip that never sustains past silenceMs (§7.1 b)', () => {
    const segmenter = createSegmenter({ silenceMs: 100, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512), true);
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent — jitter
    segmenter.pushFrame(tone(512), true); // speech resumes — silence clock resets
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512), true);
    expect(onSegment).not.toHaveBeenCalled(); // never sustained 100ms of silence
  });

  it('a very short utterance (a single speech chunk) still emits once sustained silence follows (§7.1 b — no missed segment)', () => {
    const segmenter = createSegmenter({ silenceMs: 64, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512), true); // one 32ms speech chunk
    segmenter.pushFrame(tone(512, 0), false); // 32ms silent
    segmenter.pushFrame(tone(512, 0), false); // 64ms — closes
    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(onSegment.mock.calls[0][0].samples.length).toBe(512);
  });

  it('a tap-to-toggle session spans multiple speech/silence cycles, each closing its own segment independently', () => {
    const segmenter = createSegmenter({ silenceMs: 64, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    // cycle 1
    segmenter.pushFrame(tone(512, 0.1), true);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false); // closes cycle 1
    // cycle 2 (re-armed automatically — no explicit re-arm call needed)
    segmenter.pushFrame(tone(512, 0.2), true);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false); // closes cycle 2
    expect(onSegment).toHaveBeenCalledTimes(2);
    expect(onSegment.mock.calls[0][0].samples[0]).toBeCloseTo(0.1);
    expect(onSegment.mock.calls[1][0].samples[0]).toBeCloseTo(0.2);
  });

  it('leading silence before any speech is ignored (never buffered, never closes an empty segment)', () => {
    const segmenter = createSegmenter({ silenceMs: 64, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false);
    segmenter.pushFrame(tone(512, 0), false);
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('flush() during an open (not-yet-silence-closed) tap-toggle segment closes it immediately with whatever is buffered', () => {
    const segmenter = createSegmenter({ silenceMs: 1000, gated: true, frameMs: 32 });
    const onSegment = vi.fn();
    segmenter.onSegment(onSegment);
    segmenter.pushFrame(tone(512, 0.4), true);
    segmenter.flush(); // manual stop before silence would ever have closed it
    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(onSegment.mock.calls[0][0].samples[0]).toBeCloseTo(0.4);
  });
});
```

Remove the unused `CHUNK_MS_32` local (it documents intent inline but isn't referenced) — keep the file lint-clean by deleting that line before running tests.

- [ ] **Step 2: Run the tests to verify they fail (or pass vacuously) before trusting them**

Run: `cd web && bun run test -- vad.test.ts`
Expected: all 6 new tap-toggle tests already PASS against Task 10's implementation (the `gated: true` branch was written in Task 10) — this step is a verification, not a red step, since the code pre-exists. If any fails, the failure is a REAL bug in Task 10's gated branch — fix `vad.ts` before proceeding (do not weaken the test).

- [ ] **Step 3: (only if Step 2 found a failure) fix `vad.ts`, else skip**

No change expected. If `closeSustainedSilence`'s trim-walk under- or over-trims for a specific edge case surfaced by these tests, fix the loop in `web/src/features/voice/vad.ts` and re-run Step 2 until green — do not adjust the tests' assertions to match a wrong implementation.

- [ ] **Step 4: Run the full file to verify all 13 tests pass**

Run: `cd web && bun run test -- vad.test.ts`
Expected: PASS — 13/13 (7 from Task 10 + 6 from Task 11).

- [ ] **Step 5: Gate + commit**

Run: `cd web && bun run typecheck && cd web && bun run lint`

```bash
git add web/src/features/voice/vad.test.ts
git commit -m "test(voice): cover tap-to-toggle segmentation (multi-cycle, jitter, short-utterance)"
```

---

