import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { makeBuilderModel } from '../../src/agent-builder/deps.ts';

const schema = z.object({ servers: z.array(z.string()) });

describe('makeBuilderModel', () => {
  it('extracts and parses a plain JSON response', async () => {
    const fakeGenerateText = async () => ({ text: '{"servers":["fetch"]}' });
    const model = makeBuilderModel(
      {} as never,
      8192,
      fakeGenerateText as never,
    );
    const out = await model.object({ schema, prompt: 'x' });
    expect(out).toEqual({ servers: ['fetch'] });
  });

  it('extracts JSON from a ```json fenced response', async () => {
    const fakeGenerateText = async () => ({
      text: '```json\n{"servers":["fetch"]}\n```',
    });
    const model = makeBuilderModel(
      {} as never,
      8192,
      fakeGenerateText as never,
    );
    const out = await model.object({ schema, prompt: 'x' });
    expect(out).toEqual({ servers: ['fetch'] });
  });

  it('retries once on garbage, then succeeds on the second call', async () => {
    let call = 0;
    const fakeGenerateText = async () => {
      call += 1;
      if (call === 1) return { text: 'servers: fetch\nrole_label: nope' };
      return { text: '{"servers":["fetch"]}' };
    };
    const model = makeBuilderModel(
      {} as never,
      8192,
      fakeGenerateText as never,
    );
    const out = await model.object({ schema, prompt: 'x' });
    expect(out).toEqual({ servers: ['fetch'] });
    expect(call).toBe(2);
  });

  it('rejects when both attempts return invalid JSON', async () => {
    const fakeGenerateText = async () => ({
      text: 'servers: fetch\nrole_label: nope',
    });
    const model = makeBuilderModel(
      {} as never,
      8192,
      fakeGenerateText as never,
    );
    await expect(model.object({ schema, prompt: 'x' })).rejects.toThrow(
      'agent-builder: model did not return valid JSON for the proposal',
    );
  });

  it('text() returns the raw generateText output, unparsed', async () => {
    const fakeGenerateText = async () => ({ text: '1. plan\n2. execute' });
    const model = makeBuilderModel(
      {} as never,
      8192,
      fakeGenerateText as never,
    );
    const out = await model.text({ prompt: 'x' });
    expect(out).toBe('1. plan\n2. execute');
  });
});
