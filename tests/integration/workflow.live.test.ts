import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileQaAgent } from '../../agents/file-qa.ts';
import { createWebFetchAgent } from '../../agents/web-fetch.ts';
import qwenFast from '../../models/qwen-fast.ts';
import { runFlow } from '../../src/cli/flow.ts';
import { createFetchTools, createFileTools } from '../../src/mcp/client.ts';
import { unloadModel } from '../../src/resource/ollama-control.ts';
import { getWorkflow } from '../../workflows/index.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = await ollamaReady(qwenFast.model);

describe.skipIf(!ready)('workflow.live', () => {
  test('runs fetch-then-summarize end-to-end against real Ollama', async () => {
    const def = getWorkflow('fetch-then-summarize');
    if (!def) throw new Error('fetch-then-summarize workflow not registered');
    const fileServer = await createFileTools();
    try {
      const fetchServer = await createFetchTools();
      try {
        const runsRoot = await mkdtemp(join(tmpdir(), 'flowlive-'));
        const fileQa = createFileQaAgent(fileServer.tools);
        const webFetch = createWebFetchAgent(fetchServer.tools);
        const outcome = await runFlow({
          def,
          input: 'https://example.com',
          runsRoot,
          runId: 'live',
          agents: { [fileQa.name]: fileQa, [webFetch.name]: webFetch },
          tools: { ...fileServer.tools, ...fetchServer.tools },
        });
        expect(outcome.kind).toBe('done');
      } finally {
        await fetchServer.close();
      }
    } finally {
      await fileServer.close();
      await unloadModel(qwenFast.model);
    }
  }, 120_000);
});
