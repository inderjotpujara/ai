import { expect, test } from 'bun:test';
import {
  McpServerDtoSchema,
  MemorySpaceDtoSchema,
  ModelInventoryDtoSchema,
  RetrievalResultDtoSchema,
} from '../../src/contracts/dto.ts';
import {
  McpAuthKind,
  McpTransportKind,
  RuntimeKind,
} from '../../src/contracts/enums.ts';

test('ModelInventoryDtoSchema accepts an installed and a pullable row', () => {
  const installed = ModelInventoryDtoSchema.parse({
    runtime: RuntimeKind.Ollama,
    model: 'qwen3.5:9b',
    installed: true,
    fits: true,
  });
  expect(installed.installed).toBe(true);
  const pullable = ModelInventoryDtoSchema.parse({
    runtime: RuntimeKind.MlxServer,
    model: 'mlx-community/Qwen3.5-30B',
    installed: false,
    fits: false,
    sizeBytes: 20_000_000_000,
    shortfallBytes: 4_000_000_000,
  });
  expect(pullable.fits).toBe(false);
});

test('MemorySpaceDtoSchema + RetrievalResultDtoSchema accept minimal shapes', () => {
  expect(
    MemorySpaceDtoSchema.parse({ name: 'default', chunkCount: 12 }).chunkCount,
  ).toBe(12);
  const r = RetrievalResultDtoSchema.parse({
    id: 'doc.md#3',
    source: 'doc.md',
    text: 'chunk text',
    score: 0.82,
  });
  expect(r.score).toBeCloseTo(0.82);
});

test('McpServerDtoSchema accepts a mounted stdio server', () => {
  const s = McpServerDtoSchema.parse({
    name: 'filesystem',
    kind: McpTransportKind.Stdio,
    authKind: McpAuthKind.Static,
    status: 'mounted',
  });
  expect(s.status).toBe('mounted');
});
