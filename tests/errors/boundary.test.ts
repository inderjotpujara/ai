import { expect, test } from 'bun:test';
import { ProviderError, ResourceError } from '../../src/core/errors.ts';
import { explain, handleTopLevel } from '../../src/errors/boundary.ts';

test('explain maps typed errors to actionable hints', () => {
  expect(explain(new ResourceError('no fit')).title).toMatch(
    /memory budget|resource/i,
  );
  expect(explain(new ProviderError('ollama down')).hint).toMatch(
    /ollama|provider/i,
  );
  expect(explain(new Error('weird')).title).toBeDefined();
});
test('handleTopLevel persists error.json and returns exit 1', () => {
  const writes: Record<string, string> = {};
  const code = handleTopLevel(new ProviderError('x'), {
    runDir: '/tmp/r',
    write: (p, d) => {
      writes[p] = d;
    },
    log: () => {},
  });
  expect(code).toBe(1);
  const written = writes['/tmp/r/error.json'];
  expect(written).toBeDefined();
  expect(JSON.parse(written as string)).toMatchObject({
    name: 'ProviderError',
  });
});
