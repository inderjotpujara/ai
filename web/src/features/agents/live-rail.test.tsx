import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveRail } from './live-rail.tsx';
import { RailPhase, useStatusEvents } from './use-status-events.ts';

describe('useStatusEvents', () => {
  it('folds model-select then delegation into agent/model/running', () => {
    const { result } = renderHook(() => useStatusEvents());

    act(() => {
      result.current.handleData({
        type: 'data-model-select',
        data: {
          type: 'data-model-select',
          agent: 'file_qa',
          model: 'qwen3:4b',
        },
      });
    });
    act(() => {
      result.current.handleData({
        type: 'data-delegation',
        data: {
          type: 'data-delegation',
          agent: 'file_qa',
          depth: 1,
          ancestors: ['orchestrator'],
        },
      });
    });

    expect(result.current.view.model).toBe('qwen3:4b');
    expect(result.current.view.agent).toBe('file_qa');
    expect(result.current.view.phase).toBe(RailPhase.Running);
    expect(result.current.view.degraded).toBe(false);
  });

  it('folds a degrade event into view.degraded', () => {
    const { result } = renderHook(() => useStatusEvents());

    act(() => {
      result.current.handleData({
        type: 'data-degrade',
        data: {
          type: 'data-degrade',
          kind: 'model_degraded',
          subject: 'qwen3:4b',
          reason: 'oom',
        },
      });
    });

    expect(result.current.view.degraded).toBe(true);
  });

  it('folds ModelSelect.degraded (runtime-fallback) into view.degraded', () => {
    const { result } = renderHook(() => useStatusEvents());

    act(() => {
      result.current.handleData({
        type: 'data-model-select',
        data: {
          type: 'data-model-select',
          agent: 'x',
          model: 'm',
          degraded: true,
        },
      });
    });

    expect(result.current.view.degraded).toBe(true);
  });

  it('resets degraded/agent/model on RunStart (regression: a prior-turn degrade must not linger onto the next turn)', () => {
    const { result } = renderHook(() => useStatusEvents());

    act(() => {
      result.current.handleData({
        type: 'data-model-select',
        data: {
          type: 'data-model-select',
          agent: 'file_qa',
          model: 'qwen3:4b',
          degraded: true,
        },
      });
    });
    expect(result.current.view.degraded).toBe(true);
    expect(result.current.view.agent).toBeUndefined();
    expect(result.current.view.model).toBe('qwen3:4b');

    act(() => {
      result.current.handleData({
        type: 'data-run-start',
        data: { type: 'data-run-start', runId: 'run-2' },
      });
    });

    expect(result.current.view).toEqual({
      phase: RailPhase.Starting,
      degraded: false,
    });
  });

  it('ignores parts whose data.type is not a StatusEventType', () => {
    const { result } = renderHook(() => useStatusEvents());

    act(() => {
      result.current.handleData({
        type: 'data-unrelated',
        data: { type: 'data-unrelated', foo: 'bar' },
      });
    });

    expect(result.current.view).toEqual({
      phase: RailPhase.Idle,
      degraded: false,
    });
  });
});

describe('LiveRail', () => {
  it('renders the model id, agent, and a running indication', () => {
    render(
      <LiveRail
        view={{
          agent: 'file_qa',
          model: 'qwen3:4b',
          phase: RailPhase.Running,
          degraded: false,
        }}
      />,
    );

    const rail = screen.getByTestId('live-rail');
    expect(rail).toHaveTextContent('file_qa');
    expect(rail).toHaveTextContent('qwen3:4b');
    expect(rail).toHaveTextContent(/running/i);
    expect(screen.queryByTestId('live-rail-degraded')).not.toBeInTheDocument();
  });

  it('renders a degraded marker when view.degraded is true', () => {
    render(
      <LiveRail
        view={{
          agent: 'file_qa',
          model: 'qwen3:4b',
          phase: RailPhase.Running,
          degraded: true,
        }}
      />,
    );

    expect(screen.getByTestId('live-rail-degraded')).toBeInTheDocument();
  });

  it('renders minimally when idle', () => {
    render(<LiveRail view={{ phase: RailPhase.Idle, degraded: false }} />);
    expect(screen.getByTestId('live-rail')).toBeInTheDocument();
  });

  it('shows the degraded marker even while phase is Idle', () => {
    render(<LiveRail view={{ phase: RailPhase.Idle, degraded: true }} />);
    expect(screen.getByTestId('live-rail-degraded')).toBeInTheDocument();
  });
});
