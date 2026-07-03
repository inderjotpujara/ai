import { expect, test } from 'bun:test';
import qwenFast from '../../models/qwen-fast.ts';
import { RuntimeKind } from '../../src/core/types.ts';
import { createOllamaModel } from '../../src/providers/ollama.ts';

test('qwen-fast declaration targets qwen3.5:9b on ollama', () => {
  expect(qwenFast.runtime).toBe(RuntimeKind.Ollama);
  expect(qwenFast.model).toBe('qwen3.5:9b');
});

test('createOllamaModel returns a model whose id matches the declaration', () => {
  const model = createOllamaModel(qwenFast);
  expect((model as { modelId: string }).modelId).toBe('qwen3.5:9b');
});
