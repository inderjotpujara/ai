import type { SpanDTO } from '@contracts';
import { SpanStatus } from '@contracts';
import { describe, expect, it } from 'vitest';
import { DagStatus } from '../../shared/dag/types.ts';
import { findRunGraphSource, stepStatusOverlay } from './run-dag.ts';

function span(p: Partial<SpanDTO> & { spanId: string; name: string }): SpanDTO {
  return {
    parentSpanId: null,
    offsetMs: 0,
    durationMs: 1,
    depth: 0,
    status: SpanStatus.Ok,
    degraded: false,
    attributes: {},
    events: [],
    ...p,
  };
}

describe('findRunGraphSource', () => {
  it('returns undefined when no recognized root span has closed yet', () => {
    expect(
      findRunGraphSource([span({ spanId: 'a', name: 'workflow.step' })]),
    ).toBeUndefined();
  });

  it('reads workflow.id off a closed workflow.run root', () => {
    const spans = [
      span({
        spanId: 'root',
        name: 'workflow.run',
        attributes: { 'workflow.id': 'fetch-then-summarize' },
      }),
    ];
    expect(findRunGraphSource(spans)).toEqual({
      kind: 'workflow',
      id: 'fetch-then-summarize',
    });
  });

  it('reads crew.id off a closed crew.run root', () => {
    const spans = [
      span({
        spanId: 'root',
        name: 'crew.run',
        attributes: { 'crew.id': 'research-crew' },
      }),
    ];
    expect(findRunGraphSource(spans)).toEqual({
      kind: 'crew',
      id: 'research-crew',
    });
  });
});

describe('stepStatusOverlay', () => {
  it('maps closed step spans to Done/Error by workflow.step.id; unstarted steps are omitted', () => {
    const spans = [
      span({
        spanId: 's1',
        name: 'workflow.step',
        status: SpanStatus.Ok,
        attributes: { 'workflow.step.id': 'fetch' },
      }),
      span({
        spanId: 's2',
        name: 'workflow.step',
        status: SpanStatus.Error,
        attributes: { 'workflow.step.id': 'summarize' },
      }),
    ];
    expect(stepStatusOverlay(spans)).toEqual({
      fetch: DagStatus.Done,
      summarize: DagStatus.Error,
    });
  });
});
