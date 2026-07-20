import { expect, test } from 'bun:test';
import { RunOrigin } from '../../src/contracts/enums.ts';
import { RunListQuerySchema } from '../../src/contracts/requests.ts';

test('RunListQuery accepts an origin facet', () => {
  expect(RunListQuerySchema.parse({ origin: 'daemon' }).origin).toBe(
    RunOrigin.Daemon,
  );
});
test('RunListQuery origin is optional and rejects an unknown value', () => {
  expect(RunListQuerySchema.parse({}).origin).toBeUndefined();
  expect(() => RunListQuerySchema.parse({ origin: 'nope' })).toThrow();
});
