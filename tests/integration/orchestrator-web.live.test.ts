import { afterAll, describe, expect, test } from 'bun:test';
import { createSuperAgent } from '../../agents/super.ts';
import qwenFast from '../../models/qwen-fast.ts';
import { runOrchestrator } from '../../src/core/orchestrator.ts';
import { createFetchTools, createFileTools } from '../../src/mcp/client.ts';
import { unloadModel, warmModel } from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';
import { uvxReady } from './uvx-available.ts';

const ready = (await uvxReady()) && (await ollamaReady(qwenFast.model));

describe.skipIf(!ready)(
  'live orchestrator: web routing (real Ollama + uvx)',
  () => {
    afterAll(async () => {
      await unloadModel(qwenFast.model);
    });

    test('routes a URL request to web_fetch and answers', async () => {
      await warmModel(qwenFast.model);
      const fileServer = await createFileTools();
      const fetchServer = await createFetchTools();
      try {
        const orch = createSuperAgent((name) =>
          name === 'file_qa' ? fileServer.tools : fetchServer.tools,
        );
        const result = await runOrchestrator(
          orch,
          'Summarize the page at https://example.com in one sentence.',
        );
        expect(result.kind).toBe('answer');
      } finally {
        await fileServer.close();
        await fetchServer.close();
      }
    }, 180_000);
  },
);
