import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { makeBuilderModel } from '../../src/agent-builder/deps.ts';

describe('makeBuilderModel', () => {
  it('wraps a generateObject-shaped call and returns the object', async () => {
    // fake LanguageModel is never actually called: we inject the generate fn
    const fakeGenerate = async () => ({ object: { servers: ['fetch'] } });
    const model = makeBuilderModel({} as never, 8192, fakeGenerate as never);
    const out = await model.object({
      schema: z.object({ servers: z.array(z.string()) }),
      prompt: 'x',
    });
    expect(out).toEqual({ servers: ['fetch'] });
  });
});
