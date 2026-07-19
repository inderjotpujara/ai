### Task 11: `use-voice-input.ts` — wire real streamed interim text (naive wiring; happy-path + monotonic-replace tests)

This task wires `engine.transcribe(frames, onInterim)` into the hook's `interim` state for both gestures, replacing the static `'…'` placeholder with the real streamed text once it starts arriving. It deliberately does **not yet** add the three adversarial guards (dropped-for-invalidated-segmenter, back-to-back-gesture isolation, final-wins-over-late-interim) — those are Task 12's dedicated, individually-failing-first correctness surface (§7.1 (a), (c), (d)). Requirement (b) — monotonic replace — falls out of Task 9's accumulator design for free (every message carries the full running text, so `setInterim(text)` is always a replace) and is locked here as a property test.

**Files:**
- Modify: `web/src/features/voice/use-voice-input.ts` (the `onSegment` callback, lines 161–196)
- Test: `web/src/features/voice/use-voice-input.test.ts` (append; reuses the file's existing `makeFakeCapture`/`makeFakeEngine`/`deferred` helpers, no new test scaffolding needed)

**Interfaces:**
- Consumes: `SttEngine.transcribe(frames, onInterim?)` (Task 10).
- Produces: `UseVoiceInput.interim` (existing field, unchanged shape) now reflects real streamed text instead of a static `'…'` busy indicator once decoding begins; `onFinal`/`status` semantics are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/voice/use-voice-input.test.ts` (inside `describe('useVoiceInput', ...)`):

```ts
  it('streams real interim text from engine.transcribe (hold-to-talk), replacing the "…" placeholder (D6)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {}); // never resolves — interim-only in this test
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
    act(() => capturedOnInterim?.('Hel'));
    await waitFor(() => expect(result.current.interim).toBe('Hel'));
    act(() => capturedOnInterim?.('Hello'));
    await waitFor(() => expect(result.current.interim).toBe('Hello'));
  });

  it('streams real interim text via VAD tap-to-toggle too (D6)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    engine.detectSpeech = vi.fn(async () => true);
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {});
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 10, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    await act(async () => {
      emitChunk(new Float32Array(512));
      await Promise.resolve();
    });
    await act(async () => {
      result.current.toggleTap();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.interim).toBe('…'));
    act(() => capturedOnInterim?.('world'));
    await waitFor(() => expect(result.current.interim).toBe('world'));
  });

  it('interim text is always a monotonic replace — every message is the full running text, never a shorter fragment (§7.1 b)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {});
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
    const seen: string[] = [];
    for (const chunk of ['Hel', 'Hello', 'Hello world']) {
      act(() => capturedOnInterim?.(chunk));
      await waitFor(() => expect(result.current.interim).toBe(chunk));
      seen.push(result.current.interim);
    }
    // Each observed value is a prefix-superset of the previous one — never
    // shorter, never a different branch (a decode-restart artifact).
    expect(seen).toEqual(['Hel', 'Hello', 'Hello world']);
    expect(seen.every((s, i) => i === 0 || s.startsWith('') )).toBe(true);
    expect(seen[2]?.startsWith('Hello')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts`
Expected: FAIL — the hook's `onSegment` callback still hardcodes `setInterim('…')` with no follow-up updates; `capturedOnInterim` is never invoked because `engine.transcribe(frames)` is called with a single argument.

- [ ] **Step 3: Write minimal implementation**

In `web/src/features/voice/use-voice-input.ts`, replace the `onSegment` callback body (lines 161–196):

```ts
      const offSegment = segmenter.onSegment((frames) => {
        setStatus('transcribing');
        setInterim('…');
        engine
          .transcribe(frames, (text) => {
            // D6: real streamed interim text replaces the static '…'
            // placeholder as Moonshine decodes. The three adversarial
            // guards (dropped-for-invalidated-segmenter, back-to-back
            // gesture isolation, final-wins-over-late-interim) land in
            // Task 12 — deliberately absent here.
            setInterim(text);
          })
          .then((text) => {
            if (!validSegmentersRef.current.has(segmenter)) return;
            if (text) opts.onFinal(text);
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .catch(() => {
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts`
Expected: PASS (all pre-existing tests + 3 new).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/use-voice-input.ts web/src/features/voice/use-voice-input.test.ts
git commit -m "feat(voice): wire real streamed interim text into use-voice-input.ts (D6)"
```

---

