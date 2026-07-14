import { describe, expect, it } from 'bun:test';
import { StatusEventType } from '../../src/contracts/index.ts';
import { type EventSink, noopEventSink } from '../../src/core/events.ts';

describe('EventSink', () => {
  it('noopEventSink accepts any StatusEvent and returns void', () => {
    expect(
      noopEventSink({ type: StatusEventType.RunStart, runId: 'r1' }),
    ).toBeUndefined();
  });
  it('a sink receives the emitted event', () => {
    const seen: unknown[] = [];
    const sink: EventSink = (e) => {
      seen.push(e);
    };
    sink({ type: StatusEventType.RunEnd, runId: 'r1', outcome: 'answer' });
    expect(seen).toEqual([
      { type: 'data-run-end', runId: 'r1', outcome: 'answer' },
    ]);
  });
});
