### Task 12: §7.1 adversarial correctness — dropped/invalidated, back-to-back isolation, final-wins-over-late-interim

**This is the phase's hardest reasoning surface** (spec §7.1, build-order note: "the interim-decode message-ordering/correlation piece is the reasoning-heavy part → ultracode Workflow adversarial-verify"). Task 11 wired interim streaming naively, with no guards on the `onInterim` callback itself — that gap is exactly what this task closes, one requirement at a time, each starting from a genuinely failing test.

**Files:**
- Modify: `web/src/features/voice/use-voice-input.ts` (the `onSegment` callback body Task 11 just wrote)
- Test: `web/src/features/voice/use-voice-input.test.ts` (append)

**Interfaces:**
- Consumes: `validSegmentersRef` (existing, `use-voice-input.ts:79`); `segmenterRef` (existing, `use-voice-input.ts:68`) — both read-only from this task's perspective, no shape change.
- Produces: no new public interface — the `onSegment` callback's `onInterim` closure gains three guards, in this order: `finalized` (local, per-segment) → `validSegmentersRef.current.has(segmenter)` → `segmenterRef.current === segmenter`.

**Requirements under test (spec §7.1, verbatim):**
(a) interim messages for a superseded/invalidated segmenter (per the existing `validSegmentersRef` gate) are dropped, never displayed.
(b) interim text is monotonically replaced, never appended-then-replaced-with-a-shorter-string — **already covered by Task 11's property test**, not repeated here.
(c) the final `transcribeResult` always wins over any late-arriving interim for the same request id.
(d) a back-to-back gesture (new segment starts before the previous segment's decode finishes) never shows the new segment's interim text as if it were the old segment's, or vice versa.

- [ ] **Step 1a: Write the failing test for (a) — invalidated segmenter's interim is dropped**

Append to `web/src/features/voice/use-voice-input.test.ts`. `cancel()` calls `segmenterRef.current?.reset()` and `endGesture('ready')`, which nulls `segmenterRef.current` — but the ALREADY-DISPATCHED `frames` from an earlier `stopHold()`'s flush already started `engine.transcribe(frames, ...)` before a subsequent `cancel()` runs, so starting a second gesture and cancelling it reproduces the real race: an in-flight transcribe whose segmenter has since been invalidated by the destructive `validSegmentersRef.current.clear()` (Fix 4):

```ts
  it('§7.1 (a): interim messages for a segmenter invalidated by a destructive teardown are dropped, never displayed', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {}); // never resolves
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold()); // flushes → transcribe() starts, interim '…'
    await waitFor(() => expect(result.current.interim).toBe('…'));

    // Start a NEW gesture and cancel it — this is the destructive path that
    // clears validSegmentersRef.current entirely (Fix 4), invalidating the
    // FIRST segment's still-in-flight transcribe too.
    act(() => result.current.startHold());
    act(() => result.current.cancel());

    const interimAtCancel = result.current.interim;
    act(() => capturedOnInterim?.('should-not-appear'));
    expect(result.current.interim).toBe(interimAtCancel);
    expect(result.current.interim).not.toBe('should-not-appear');
  });
```

- [ ] **Step 2a: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(a\)"`
Expected: FAIL — `result.current.interim` becomes `'should-not-appear'` because the `onInterim` closure has no `validSegmentersRef` guard yet.

- [ ] **Step 3a: Write the minimal guard for (a)**

In `use-voice-input.ts`'s `onSegment` callback, update the `onInterim` closure:

```ts
          .transcribe(frames, (text) => {
            if (!validSegmentersRef.current.has(segmenter)) return; // §7.1 (a)
            setInterim(text);
          })
```

- [ ] **Step 4a: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(a\)"`
Expected: PASS.

- [ ] **Step 1b: Write the failing test for (d) — back-to-back gesture isolation**

Append:

```ts
  it('§7.1 (d): a back-to-back gesture never shows the OLD segment\'s late interim as if it were the NEW segment\'s', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const captured: Array<(text: string) => void> = [];
    engine.transcribe = vi.fn((_frames, onInterim) => {
      if (onInterim) captured.push(onInterim);
      return new Promise<string>(() => {}); // neither segment's decode ever resolves
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Segment A: hold, release (graceful stop — stays VALID for its final).
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));
    const onInterimA = captured[0];
    act(() => onInterimA?.('A-partial'));
    await waitFor(() => expect(result.current.interim).toBe('A-partial'));

    // Segment B starts BEFORE A's decode resolves — a genuine back-to-back
    // gesture. B becomes segmenterRef.current; A is still in
    // validSegmentersRef (graceful stop), so A's FINAL would still be
    // allowed to land later — but A's INTERIM must not bleed into B's slot.
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));

    // A's decode is STILL in flight and fires another interim chunk late —
    // this must never overwrite B's display.
    act(() => onInterimA?.('A-partial-late'));
    expect(result.current.interim).toBe('…'); // still B's placeholder, not A's text

    const onInterimB = captured[1];
    act(() => onInterimB?.('B-partial'));
    await waitFor(() => expect(result.current.interim).toBe('B-partial'));
    act(() => onInterimA?.('A-partial-even-later'));
    expect(result.current.interim).toBe('B-partial'); // still B's, A never bleeds in
  });
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(d\)"`
Expected: FAIL — segment A is still in `validSegmentersRef` (a graceful stop), so (a)'s guard alone lets A's late interim through and stomps B's `'…'`/`'B-partial'` display.

- [ ] **Step 3b: Write the minimal guard for (d)**

```ts
          .transcribe(frames, (text) => {
            if (!validSegmentersRef.current.has(segmenter)) return; // §7.1 (a)
            if (segmenterRef.current !== segmenter) return; // §7.1 (d): never bleed into a newer gesture's display
            setInterim(text);
          })
```

- [ ] **Step 4b: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(d\)"`
Expected: PASS.

- [ ] **Step 1c: Write the failing test for (c) — final always wins over a late interim, same request id**

Append:

```ts
  it('§7.1 (c): the final transcribeResult always wins over a late-arriving interim for the same request id', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    const transcribeGate = deferred<string>();
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return transcribeGate.promise;
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));

    act(() => capturedOnInterim?.('partial'));
    await waitFor(() => expect(result.current.interim).toBe('partial'));

    // The final resolves — interim is cleared, onFinal fires.
    act(() => transcribeGate.resolve('final text'));
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('final text'));
    await waitFor(() => expect(result.current.interim).toBe(''));

    // A LATE interim for the SAME (already-settled) request id must not
    // stomp the cleared, finalized state.
    act(() => capturedOnInterim?.('late-after-final'));
    expect(result.current.interim).toBe('');
  });
```

- [ ] **Step 2c: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(c\)"`
Expected: FAIL — after `.then()` resolves and `setInterim('')` runs, the still-live `onInterim` closure (guarded only by (a)/(d), both still true for this single, uninterrupted gesture) calls `setInterim('late-after-final')`, resurrecting the cleared text.

- [ ] **Step 3c: Write the minimal guard for (c)**

Final full `onSegment` callback body (all three guards together):

```ts
      const offSegment = segmenter.onSegment((frames) => {
        setStatus('transcribing');
        setInterim('…');
        let finalized = false; // §7.1 (c): a final result always wins over a late interim
        engine
          .transcribe(frames, (text) => {
            if (finalized) return; // §7.1 (c)
            if (!validSegmentersRef.current.has(segmenter)) return; // §7.1 (a)
            if (segmenterRef.current !== segmenter) return; // §7.1 (d)
            setInterim(text);
          })
          .then((text) => {
            finalized = true;
            if (!validSegmentersRef.current.has(segmenter)) return;
            if (text) opts.onFinal(text);
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .catch(() => {
            finalized = true;
            if (!validSegmentersRef.current.has(segmenter)) return;
            setError('transcription failed');
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .finally(() => {
            validSegmentersRef.current.delete(segmenter);
          });
      });
```

- [ ] **Step 4c: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts`
Expected: PASS — all pre-existing tests + all Task 11/12 additions (happy-path ×2, monotonic-replace, (a), (d), (c)).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/use-voice-input.ts web/src/features/voice/use-voice-input.test.ts
git commit -m "fix(voice): §7.1 adversarial guards — drop invalidated interim, isolate back-to-back gestures, final wins over late interim (D6)"
```

**Note for the ultracode adversarial-verify Workflow (increment build-order):** this task's three failing→passing substeps ARE the reviewable unit — verify each guard is independently necessary (temporarily comment out one guard and confirm exactly its own test regresses, not the others) and that no guard's ordering can be swapped without breaking (c) (the `finalized` check must run first, since a late interim after final should short-circuit before even consulting `validSegmentersRef`/`segmenterRef`, both of which may have since been reused by a subsequent gesture).

---

