import { describe, expect, it } from 'bun:test';
import { ProviderError } from '../../src/core/errors.ts';
import { RuntimeKind } from '../../src/core/types.ts';
import { resolveModel } from '../../src/resource/selector.ts';

describe('resolveModel failure-domain ordering', () => {
  it('after a RouteWorthy failure, tries a different-runtime candidate before another same-runtime one', async () => {
    const attempted: string[] = [];
    const footprint = { approxParamsBillions: 7, bytesPerWeight: 0.5 };
    const registry = [
      {
        role: 'general',
        model: 'o1',
        runtime: RuntimeKind.Ollama,
        requires: [],
        footprint,
      },
      {
        role: 'general',
        model: 'o2',
        runtime: RuntimeKind.Ollama,
        requires: [],
        footprint,
      },
      {
        role: 'general',
        model: 'm1',
        runtime: RuntimeKind.MlxServer,
        requires: [],
        footprint,
      },
    ] as never;
    const r = await resolveModel(
      { role: 'general', requires: [] } as never,
      registry,
      {
        ensureReady: async (d: { model: string }) => {
          attempted.push(d.model);
          if (d.model !== 'm1') throw new ProviderError('down');
          return 4096;
        },
      },
    );
    expect(r.decl.model).toBe('m1');
    // o1 first (best), then m1 (different domain) before o2:
    expect(attempted).toEqual(['o1', 'm1']);
  });
});
