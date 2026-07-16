import { StatusEventType } from '@contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  foldMcpTestMountFrame,
  useMcpTestMount,
} from './use-mcp-test-mount.ts';

const INITIAL = { narration: [] as string[], done: false };

describe('foldMcpTestMountFrame', () => {
  it('captures the runId from data-run-start', () => {
    const next = foldMcpTestMountFrame(INITIAL, {
      type: StatusEventType.RunStart,
      runId: 'run-abc',
    });
    expect(next.runId).toBe('run-abc');
  });

  it('folds a data-mcp-mount progress frame into narration', () => {
    const next = foldMcpTestMountFrame(INITIAL, {
      type: StatusEventType.McpMount,
      server: 'gh',
      outcome: 'mounting',
    });
    expect(next.narration).toEqual(['gh: mounting']);
  });

  it('folds a data-confirm frame into pendingConfirm', () => {
    const next = foldMcpTestMountFrame(INITIAL, {
      type: StatusEventType.Confirm,
      promptId: 'p1',
      kind: 'mcp-mount',
      question: 'Mount "gh"?',
    });
    expect(next.pendingConfirm).toEqual({
      promptId: 'p1',
      kind: 'mcp-mount',
      question: 'Mount "gh"?',
    });
  });

  // Deviation from the task-25 brief's original Step-1 snippet (which called
  // `foldMcpTestMountFrame(state, type, data)`, a 3-arg shape): the brief's
  // own controller reconciliation note (top of task-25-brief.md) supersedes
  // that snippet and requires the SAME `(state, frame)` 2-arg signature as
  // `foldBuildFrame` (Task 13, `use-build-events.ts`) — one fold shape shared
  // by both interactive flows. This test matches that verified contract.
  it('folds the terminal data-mcp-server frame into result and clears pendingConfirm', () => {
    const withConfirm = {
      ...INITIAL,
      pendingConfirm: { promptId: 'p1', kind: 'mcp-mount', question: 'x' },
    };
    const dto = {
      name: 'gh',
      kind: 'stdio',
      authKind: 'static',
      status: 'mounted',
    };
    const next = foldMcpTestMountFrame(withConfirm, {
      type: 'data-mcp-server',
      data: dto,
    });
    expect(next.result).toEqual(dto);
    expect(next.pendingConfirm).toBeUndefined();
  });

  it('marks done on data-run-end', () => {
    const next = foldMcpTestMountFrame(INITIAL, {
      type: StatusEventType.RunEnd,
      runId: 'run-abc',
      outcome: 'done',
    });
    expect(next.done).toBe(true);
  });
});

describe('useMcpTestMount (integration: real enveloped wire bytes)', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Drives `start()` against the ACTUAL wire shape `src/server/mcp/test-mount.ts`
  // emits (envelope-wrapped StatusEvents via its `events` sink — data-run-start /
  // data-mcp-mount / data-run-end — plus a one-shot `data-mcp-server` data part,
  // terminated by `data: [DONE]`) — end-to-end proof that `postSseStream` + the
  // envelope unwrap + `foldMcpTestMountFrame` compose correctly, exactly like
  // `use-build-events.test.ts`'s sibling integration test.
  it('folds a full mounted run into final state', async () => {
    const encoder = new TextEncoder();
    const lines = [
      'data: {"type":"data-run-start","data":{"type":"data-run-start","runId":"run-abc"},"transient":true}\n\n',
      'data: {"type":"data-mcp-mount","data":{"type":"data-mcp-mount","server":"gh","outcome":"mounting"},"transient":true}\n\n',
      'data: {"type":"data-mcp-server","data":{"name":"gh","kind":"stdio","authKind":"static","status":"mounted"},"transient":true}\n\n',
      'data: {"type":"data-run-end","data":{"type":"data-run-end","runId":"run-abc","outcome":"done"},"transient":true}\n\n',
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

    const { result } = renderHook(() => useMcpTestMount());

    await act(async () => {
      await result.current.start('gh');
    });

    await waitFor(() => expect(result.current.state.done).toBe(true));
    expect(result.current.state.runId).toBe('run-abc');
    expect(result.current.state.narration).toEqual(['gh: mounting']);
    expect(result.current.state.result).toEqual({
      name: 'gh',
      kind: 'stdio',
      authKind: 'static',
      status: 'mounted',
    });
    expect(result.current.state.pendingConfirm).toBeUndefined();
  });

  // The `[DONE]` sentinel is not JSON (`JSON.parse('[DONE]')` throws) —
  // `postSseStream` must skip it rather than feed it to `schema.parse`. This
  // test fails loudly (an unhandled rejection surfacing as a thrown error out
  // of `start()`) if that skip regresses.
  it('does not crash on the trailing [DONE] sentinel', async () => {
    const encoder = new TextEncoder();
    const lines = [
      'data: {"type":"data-run-start","data":{"type":"data-run-start","runId":"run-x"},"transient":true}\n\n',
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

    const { result } = renderHook(() => useMcpTestMount());

    await expect(
      act(async () => {
        await result.current.start('gh');
      }),
    ).resolves.not.toThrow();
    expect(result.current.state.runId).toBe('run-x');
  });
});
