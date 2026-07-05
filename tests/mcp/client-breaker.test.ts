import { describe, expect, it } from 'bun:test';
import { wrapToolsWithBreaker } from '../../src/mcp/client.ts';
import { resetBreakers } from '../../src/reliability/breaker.ts';
import { CircuitOpenError } from '../../src/reliability/errors.ts';

describe('wrapToolsWithBreaker', () => {
  it('opens the breaker after repeated tool failures', async () => {
    resetBreakers();
    const tools = {
      search: {
        description: 'x',
        inputSchema: undefined,
        execute: async () => {
          throw new Error('server down');
        },
      },
    };
    const wrapped = wrapToolsWithBreaker('flaky', tools as never, {
      threshold: 2,
      cooldownMs: 10_000,
    });
    const search = wrapped.search;
    expect(search?.execute).toBeDefined();
    await search?.execute?.({}, {} as never).catch(() => {});
    await search?.execute?.({}, {} as never).catch(() => {});
    await expect(search?.execute?.({}, {} as never)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
  });
});
