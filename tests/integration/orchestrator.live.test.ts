import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuperAgent } from '../../agents/super.ts';
import qwenFast from '../../models/qwen-fast.ts';
import { runOrchestrator } from '../../src/core/orchestrator.ts';
import { createFileTools } from '../../src/mcp/client.ts';
import { unloadModel, warmModel } from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = await ollamaReady(qwenFast.model);

describe.skipIf(!ready)('live orchestrator (real Ollama)', () => {
  afterAll(async () => {
    await unloadModel(qwenFast.model);
  });

  test('delegates a file question to file-qa and answers', async () => {
    await warmModel(qwenFast.model);
    const dir = await mkdtemp(join(tmpdir(), 'live-'));
    const path = join(dir, 'animals.txt');
    await writeFile(path, 'The fox and the dog are friends.');
    const { tools, close } = await createFileTools();
    try {
      const orch = createSuperAgent((name) =>
        name === 'file_qa' ? tools : {},
      );
      const result = await runOrchestrator(
        orch,
        `What animals are in ${path}?`,
      );
      expect(result.kind).toBe('answer');
      if (result.kind === 'answer') {
        expect(result.text.toLowerCase()).toMatch(/fox|dog/);
      }
    } finally {
      await close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('reports a capability gap for an out-of-scope request', async () => {
    await warmModel(qwenFast.model);
    const { tools, close } = await createFileTools();
    try {
      const orch = createSuperAgent((name) =>
        name === 'file_qa' ? tools : {},
      );
      const result = await runOrchestrator(
        orch,
        'Book me a flight to Tokyo for next Tuesday.',
      );
      expect(result.kind).toBe('gap');
    } finally {
      await close();
    }
  }, 120_000);
});
