import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuperAgent } from '../../agents/super.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { runChat } from '../../src/cli/run-chat.ts';
import { renderRun } from '../../src/cli/runs.ts';
import { createFileTools } from '../../src/mcp/client.ts';
import { unloadModel } from '../../src/resource/ollama-control.ts';
import { createRun } from '../../src/run/run-store.ts';
import { readSpans } from '../../src/run/run-trace.ts';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = await ollamaReady(qwenRouter.model);

describe.skipIf(!ready)('live run-viewer (real Ollama)', () => {
  afterAll(async () => {
    await unloadModel(qwenRouter.model);
  });

  test('a real run writes spans.jsonl with agent.run + agent.delegation, and renders', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'rv-live-'));
    const fileDir = await mkdtemp(join(tmpdir(), 'rv-files-'));
    try {
      const filePath = join(fileDir, 'note.txt');
      await writeFile(filePath, 'The capital of France is Paris.');
      const { tools, close } = await createFileTools();
      try {
        const orchestrator = createSuperAgent((name) =>
          name === 'file_qa' ? tools : {},
        );
        const run = await createRun(runsRoot, 'live-1');
        const tel = initRunTelemetry(run.dir, run.id);
        try {
          await withRunContext(run.id, () =>
            runChat({
              orchestrator,
              task: `What is written in ${filePath}?`,
              run,
            }),
          );
        } finally {
          await tel.shutdown();
        }
      } finally {
        await close();
      }
      const { spans } = await readSpans(join(runsRoot, 'live-1'));
      expect(spans.some((s) => s.name === 'agent.run')).toBe(true);
      expect(spans.some((s) => s.name === 'agent.delegation')).toBe(true);
      expect(spans.some((s) => s.name.startsWith('ai.generateText'))).toBe(
        true,
      );
      const out = await renderRun(runsRoot, 'live-1');
      expect(out).toContain('agent.run');
    } finally {
      await rm(runsRoot, { recursive: true, force: true });
      await rm(fileDir, { recursive: true, force: true });
    }
  }, 120_000);
});
