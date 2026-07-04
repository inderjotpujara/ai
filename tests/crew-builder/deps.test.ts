import { expect, test } from 'bun:test';
import { buildMissingAgentVia } from '../../src/crew-builder/deps.ts';

test('buildMissingAgentVia returns the built name on success', async () => {
  const name = await buildMissingAgentVia(
    'need',
    async () =>
      ({
        kind: 'written',
        proposal: { name: 'pdf_x' },
        files: [],
      }) as never,
    {} as never,
  );
  expect(name).toBe('pdf_x');
});

test('buildMissingAgentVia returns null on decline', async () => {
  const name = await buildMissingAgentVia(
    'need',
    async () => ({ kind: 'declined' }) as never,
    {} as never,
  );
  expect(name).toBeNull();
});
