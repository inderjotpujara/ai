import { StatusEventType } from '@contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { foldBuildFrame, useBuildEvents } from './use-build-events.ts';

const INITIAL = { narration: [] as string[], done: false };

describe('foldBuildFrame', () => {
  it('captures the runId from data-run-start', () => {
    const next = foldBuildFrame(INITIAL, {
      type: StatusEventType.RunStart,
      runId: 'run-abc',
    });
    expect(next.runId).toBe('run-abc');
  });

  it('sets pendingConfirm from data-confirm', () => {
    const next = foldBuildFrame(INITIAL, {
      type: StatusEventType.Confirm,
      promptId: 'p1',
      kind: 'build',
      question: 'Create this agent?',
    });
    expect(next.pendingConfirm).toEqual({
      promptId: 'p1',
      kind: 'build',
      question: 'Create this agent?',
    });
  });

  it('appends a non-terminal text-delta to narration', () => {
    const next = foldBuildFrame(INITIAL, {
      type: 'text-delta',
      id: 'narration-0',
      delta: 'Generated proposal stock_quotes',
    });
    expect(next.narration).toEqual(['Generated proposal stock_quotes']);
    expect(next.result).toBeUndefined();
  });

  // Deviation from the task-13 brief's original snippet (which modeled the
  // terminal as a `text-delta` with id `'build-result'` carrying a
  // JSON-stringified DTO): Task 11's adversarial verification established
  // the real wire shape is a one-shot `data-build-result` DATA PART —
  // `{ type: 'data-build-result', data: <BuildResultDTO> }` — written by
  // `src/server/builders/build.ts`, NOT a text-delta. This test matches
  // that verified contract instead.
  it('reads the build-result data part into `result` (not narration)', () => {
    const next = foldBuildFrame(INITIAL, {
      type: 'data-build-result',
      data: { kind: 'written', name: 'stock_quotes', files: ['a.ts'] },
    });
    expect(next.result).toEqual({
      kind: 'written',
      name: 'stock_quotes',
      files: ['a.ts'],
    });
    expect(next.narration).toEqual([]);
  });

  it('marks done on data-run-end', () => {
    const next = foldBuildFrame(INITIAL, {
      type: StatusEventType.RunEnd,
      runId: 'run-abc',
      outcome: 'written',
    });
    expect(next.done).toBe(true);
  });

  // Minor #4: a stale confirm button must not render alongside the
  // terminal result.
  it('clears a pending confirm on data-run-end', () => {
    const withConfirm = {
      ...INITIAL,
      pendingConfirm: { promptId: 'p1', kind: 'build', question: 'x' },
    };
    const next = foldBuildFrame(withConfirm, {
      type: StatusEventType.RunEnd,
      runId: 'run-abc',
      outcome: 'written',
    });
    expect(next.pendingConfirm).toBeUndefined();
  });

  // Finding #2 (IMPORTANT): the shared POST-SSE contract has no error lane —
  // an AI-SDK `{ type: 'error', errorText }` frame (`onError` in
  // `src/server/builders/build.ts`) must fold into a surfaced error state,
  // not crash `postSseStream`'s `schema.parse` and die silently.
  it('folds an error frame into a terminal error state', () => {
    const withConfirm = {
      ...INITIAL,
      pendingConfirm: { promptId: 'p1', kind: 'build', question: 'x' },
    };
    const next = foldBuildFrame(withConfirm, {
      type: 'error',
      errorText: 'stream error: server restarted mid-build',
    });
    expect(next.error).toBe('stream error: server restarted mid-build');
    expect(next.done).toBe(true);
    expect(next.pendingConfirm).toBeUndefined();
  });
});

describe('useBuildEvents (integration: real enveloped wire bytes)', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Drives `start()` against the ACTUAL wire shape `src/server/builders/build.ts`
  // emits (envelope-wrapped StatusEvents via its `events` sink, a one-shot
  // `data-build-result` data part, flat narration text parts, terminated by
  // `data: [DONE]`) — end-to-end proof that `postSseStream` + the envelope
  // unwrap + `foldBuildFrame` compose correctly, not just each piece in
  // isolation.
  it('folds a full build-then-write run into final state', async () => {
    const encoder = new TextEncoder();
    const lines = [
      'data: {"type":"data-run-start","data":{"type":"data-run-start","runId":"run-abc","task":"stock quotes"},"transient":true}\n\n',
      'id: n0\ndata: {"type":"text-start","id":"narration-0"}\n\n',
      'id: n1\ndata: {"type":"text-delta","id":"narration-0","delta":"Generated proposal stock_quotes"}\n\n',
      'id: n2\ndata: {"type":"text-end","id":"narration-0"}\n\n',
      'data: {"type":"data-build-result","data":{"kind":"written","name":"stock_quotes","files":["a.ts"]}}\n\n',
      'data: {"type":"data-run-end","data":{"type":"data-run-end","runId":"run-abc","outcome":"written"},"transient":true}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const line of lines) controller.enqueue(encoder.encode(line));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useBuildEvents());

    await act(async () => {
      await result.current.start({ kind: 'agent', need: 'stock quotes' });
    });

    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.runId).toBe('run-abc');
    expect(result.current.narration).toEqual([
      'Generated proposal stock_quotes',
    ]);
    expect(result.current.result).toEqual({
      kind: 'written',
      name: 'stock_quotes',
      files: ['a.ts'],
    });
    expect(result.current.pendingConfirm).toBeUndefined();
  });

  // Finding #2: an error frame mid-stream (server restart, `createRun`
  // failure, etc.) must surface as `result.current.error`, not throw out of
  // `start()` and leave the caller with an unhandled rejection.
  it('surfaces a mid-stream error frame instead of dying in the fold loop', async () => {
    const encoder = new TextEncoder();
    const lines = [
      'data: {"type":"data-run-start","data":{"type":"data-run-start","runId":"run-err","task":"x"},"transient":true}\n\n',
      'data: {"type":"error","errorText":"stream error: boom"}\n\n',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const line of lines) controller.enqueue(encoder.encode(line));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useBuildEvents());

    await expect(
      act(async () => {
        await result.current.start({ kind: 'agent', need: 'x' });
      }),
    ).resolves.not.toThrow();

    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.error).toBe('stream error: boom');
  });

  // A thrown/rejected stream (network drop before any frame, a non-2xx
  // response) must ALSO surface via `error` — `start()` itself must never
  // reject, or every call site would need its own try/catch to avoid an
  // unhandled rejection freezing the tab.
  it('surfaces a rejected stream (non-2xx response) as an error, not a hang', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );

    const { result } = renderHook(() => useBuildEvents());

    await expect(
      act(async () => {
        await result.current.start({ kind: 'agent', need: 'x' });
      }),
    ).resolves.not.toThrow();

    expect(result.current.done).toBe(true);
    expect(result.current.error).toBeTruthy();
  });
});
