import { expect, test } from 'bun:test';
import { withCrewBuildSpan } from '../../src/telemetry/spans.ts';

test('withCrewBuildSpan runs the body and exposes a recorder', async () => {
  const out = await withCrewBuildSpan('need', async (rec) => {
    rec.event('classified', { 'crew.build.shape': 'crew' });
    rec.outcome('written', 'workflow', 'my_flow', 2, 1);
    return 'ok';
  });
  expect(out).toBe('ok');
});
