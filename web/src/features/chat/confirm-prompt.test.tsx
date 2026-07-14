import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { DataUIPart, UIDataTypes } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import { useStatusEvents } from '../agents/use-status-events.ts';
import { ConfirmPrompt } from './confirm-prompt.tsx';

describe('ConfirmPrompt', () => {
  const ask = { promptId: 'p1', kind: 'mcp-mount', question: 'Allow mount?' };

  it('renders the question and kind; Approve answers true', () => {
    const onAnswer = vi.fn();
    render(<ConfirmPrompt ask={ask} onAnswer={onAnswer} />);

    expect(screen.getByText('Allow mount?')).toBeInTheDocument();
    expect(screen.getByText('mcp-mount')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('Decline answers false', () => {
    const onAnswer = vi.fn();
    render(<ConfirmPrompt ask={ask} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('dismiss (✕) fails safe to false', () => {
    const onAnswer = vi.fn();
    render(<ConfirmPrompt ask={ask} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('Escape fails safe to false', () => {
    const onAnswer = vi.fn();
    render(<ConfirmPrompt ask={ask} onAnswer={onAnswer} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onAnswer).toHaveBeenCalledWith(false);
  });
});

describe('useStatusEvents — runId + pendingConfirm fold', () => {
  function fire(
    result: { current: ReturnType<typeof useStatusEvents> },
    data: DataUIPart<UIDataTypes>['data'],
  ) {
    act(() => {
      result.current.handleData({
        type: (data as { type: string }).type,
        data,
      } as DataUIPart<UIDataTypes>);
    });
  }

  it('sets runId from RunStart, pendingConfirm from Confirm, clearConfirm resets it', () => {
    const { result } = renderHook(() => useStatusEvents());

    fire(result, { type: 'data-run-start', runId: 'r1' });
    expect(result.current.runId).toBe('r1');
    expect(result.current.pendingConfirm).toBeUndefined();

    fire(result, {
      type: 'data-confirm',
      promptId: 'p1',
      kind: 'mcp-mount',
      question: 'Allow?',
    });
    expect(result.current.pendingConfirm).toEqual({
      promptId: 'p1',
      kind: 'mcp-mount',
      question: 'Allow?',
    });

    act(() => result.current.clearConfirm());
    expect(result.current.pendingConfirm).toBeUndefined();
  });

  it('RunEnd clears any pending confirm', () => {
    const { result } = renderHook(() => useStatusEvents());

    fire(result, {
      type: 'data-confirm',
      promptId: 'p1',
      kind: 'k',
      question: 'q?',
    });
    expect(result.current.pendingConfirm).toBeDefined();

    fire(result, { type: 'data-run-end', runId: 'r1', outcome: 'answer' });
    expect(result.current.pendingConfirm).toBeUndefined();
  });

  it('keeps the existing rail view fold intact alongside the new fields', () => {
    const { result } = renderHook(() => useStatusEvents());
    fire(result, {
      type: 'data-model-select',
      agent: 'file_qa',
      model: 'qwen3:4b',
    });
    expect(result.current.view.model).toBe('qwen3:4b');
  });
});

const sendMessage = vi.fn();
const stop = vi.fn();
const regenerate = vi.fn();
const setMessages = vi.fn();
const respond = vi.fn().mockResolvedValue(undefined);
let capturedOnData: ((part: DataUIPart<UIDataTypes>) => void) | undefined;

vi.mock('@ai-sdk/react', () => ({
  useChat: (options: { onData?: (part: DataUIPart<UIDataTypes>) => void }) => {
    capturedOnData = options.onData;
    return {
      messages: [],
      sendMessage,
      status: 'ready',
      stop,
      regenerate,
      setMessages,
    };
  },
}));

vi.mock('../../shared/transport/sse-adapter.ts', () => ({
  createSseTransport: () => ({ respond, stream: vi.fn() }),
}));

describe('ChatArea data-confirm wiring', () => {
  beforeEach(() => {
    respond.mockClear();
    capturedOnData = undefined;
  });

  it('renders the pending confirm on a data-confirm part and answering calls transport.respond(runId, {promptId, value})', async () => {
    renderAt('/');
    await screen.findByTestId('area-chat');

    act(() => {
      capturedOnData?.({
        type: 'data-run-start',
        data: { type: 'data-run-start', runId: 'run-123' },
      } as DataUIPart<UIDataTypes>);
    });
    act(() => {
      capturedOnData?.({
        type: 'data-confirm',
        data: {
          type: 'data-confirm',
          promptId: 'p1',
          kind: 'mcp-mount',
          question: 'Allow mount?',
        },
      } as DataUIPart<UIDataTypes>);
    });

    expect(await screen.findByText('Allow mount?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith('run-123', {
        promptId: 'p1',
        value: true,
      }),
    );
  });

  it('does NOT call transport.respond when a Confirm arrives without a prior RunStart (no runId)', async () => {
    renderAt('/');
    await screen.findByTestId('area-chat');

    // No data-run-start — runId stays undefined.
    act(() => {
      capturedOnData?.({
        type: 'data-confirm',
        data: {
          type: 'data-confirm',
          promptId: 'p1',
          kind: 'mcp-mount',
          question: 'Allow mount?',
        },
      } as DataUIPart<UIDataTypes>);
    });

    expect(await screen.findByText('Allow mount?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    // The prompt is dismissed (fail-safe) but no POST to /api/runs//respond.
    await waitFor(() =>
      expect(screen.queryByText('Allow mount?')).not.toBeInTheDocument(),
    );
    expect(respond).not.toHaveBeenCalled();
  });
});
