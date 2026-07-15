import { expect, test } from 'bun:test';
import { BuilderKind, RuntimeKind } from '../../src/contracts/enums.ts';
import {
  BuilderBuildRequestSchema,
  BuilderRegistryListResponseSchema,
  McpAddRequestSchema,
  MemoryRecallRequestSchema,
  ModelListResponseSchema,
  ModelPullRequestSchema,
} from '../../src/contracts/requests.ts';

test('BuilderBuildRequestSchema requires kind + need', () => {
  const r = BuilderBuildRequestSchema.parse({
    kind: BuilderKind.Agent,
    need: 'fetch stock quotes',
  });
  expect(r.kind as string).toBe('agent');
  expect(() => BuilderBuildRequestSchema.parse({ need: 'x' })).toThrow();
});

test('ModelPullRequestSchema requires runtime + modelRef', () => {
  const r = ModelPullRequestSchema.parse({
    runtime: RuntimeKind.Ollama,
    modelRef: 'qwen3.5:9b',
  });
  expect(r.modelRef).toBe('qwen3.5:9b');
});

test('MemoryRecallRequestSchema requires a query', () => {
  expect(
    MemoryRecallRequestSchema.parse({ query: 'what is the plan' }).query,
  ).toBe('what is the plan');
  expect(() => MemoryRecallRequestSchema.parse({})).toThrow();
});

test('McpAddRequestSchema accepts a raw server value', () => {
  const r = McpAddRequestSchema.parse({
    name: 'filesystem',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
  });
  expect(r.name).toBe('filesystem');
});

test('ModelListResponseSchema + BuilderRegistryListResponseSchema wrap items', () => {
  expect(ModelListResponseSchema.parse({ items: [] }).items).toEqual([]);
  expect(
    BuilderRegistryListResponseSchema.parse({ items: ['file_qa'] }).items,
  ).toEqual(['file_qa']);
});
