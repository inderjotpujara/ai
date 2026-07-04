import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  describeSchemaShape,
  makeBuilderModel,
} from '../../src/agent-builder/deps.ts';

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

describe('describeSchemaShape', () => {
  it('renders a flat object schema as a bare key list', () => {
    const schema = z.object({ name: z.string(), role: z.string() });
    expect(describeSchemaShape(schema)).toBe('{"name": ..., "role": ...}');
  });

  it('renders an object-array field as a one-level-deep object shape', () => {
    const schema = z.object({
      members: z.array(z.object({ name: z.string(), role: z.string() })),
    });
    expect(describeSchemaShape(schema)).toBe(
      '{"members": [{"name": ..., "role": ...}]}',
    );
  });

  it('renders a discriminated-union-array field with each variant\'s shape, not ["<string>"]', () => {
    const schema = z.object({
      steps: z.array(
        z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('agent'),
            id: z.string(),
            agent: z.string(),
          }),
          z.object({
            kind: z.literal('tool'),
            id: z.string(),
            tool: z.string(),
          }),
        ]),
      ),
    });
    const shape = describeSchemaShape(schema);
    expect(shape).not.toContain('["<string>"');
    // Surfaces the discriminator's literal values so the model knows a step
    // is an object shaped by "kind", not a bare string.
    expect(shape).toContain('"kind": "agent"');
    expect(shape).toContain('"kind": "tool"');
    // And the per-variant keys, not just the discriminator.
    expect(shape).toContain('"agent": ...');
    expect(shape).toContain('"tool": ...');
  });
});
