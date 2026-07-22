import { expect, test } from 'bun:test';
import { recordA2aCard, withA2aServerTaskSpan } from '../../src/a2a/spans.ts';
import { A2aMethod, TaskStateWire } from '../../src/contracts/index.ts';

test('a2a span helpers are a no-op without a tracer', async () => {
  recordA2aCard({ cacheHit: false }); // must not throw
  const out = await withA2aServerTaskSpan(
    { method: A2aMethod.MessageSend, skillId: 's' },
    async (rec) => {
      rec.taskState(TaskStateWire.Submitted);
      rec.outcome('ok');
      return 7;
    },
  );
  expect(out).toBe(7);
});
