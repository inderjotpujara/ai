import type { SpanDTO } from '@contracts';
import { describe, expect, it } from 'vitest';
import { foldSpan, type RunTraceState } from './use-run-trace.ts';

function span(id: string, offsetMs: number): SpanDTO {
  return {
    spanId: id,
    parentSpanId: null,
    name: id,
    offsetMs,
    durationMs: 1,
    depth: 0,
    status: 'ok' as SpanDTO['status'],
    degraded: false,
    attributes: {},
    events: [],
  };
}

describe('foldSpan', () => {
  const empty: RunTraceState = { spans: [], cursor: null };

  it('appends new spans sorted by offsetMs and tracks the cursor', () => {
    const s1 = foldSpan(empty, span('b', 20), 'b');
    const s2 = foldSpan(s1, span('a', 10), 'a');
    expect(s2.spans.map((s) => s.spanId)).toEqual(['a', 'b']);
    expect(s2.cursor).toBe('a');
  });

  it('de-dupes by spanId (replace, not duplicate)', () => {
    const s1 = foldSpan(empty, span('a', 10));
    const s2 = foldSpan(s1, { ...span('a', 10), durationMs: 99 });
    expect(s2.spans).toHaveLength(1);
    expect(s2.spans[0]?.durationMs).toBe(99);
  });
});
