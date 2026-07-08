import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCrew } from '../../crews/index.ts';
import qwenFast from '../../models/qwen-fast.ts';
import { runCrewCli } from '../../src/cli/crew.ts';
import { createFetchTools, createFileTools } from '../../src/mcp/client.ts';
import { createRun } from '../../src/run/run-store.ts';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = await ollamaReady(qwenFast.model);

describe.skipIf(!ready)('crew.live', () => {
  test('runs the sequential research crew end-to-end against real Ollama', async () => {
    const def = getCrew('research-crew');
    if (!def) throw new Error('research-crew not registered');
    const fileServer = await createFileTools();
    try {
      const fetchServer = await createFetchTools();
      try {
        const runsRoot = await mkdtemp(join(tmpdir(), 'crewlive-'));
        const run = await createRun(runsRoot, 'live');
        const tel = initRunTelemetry(run.dir, run.id);
        try {
          const outcome = await withRunContext(run.id, () =>
            runCrewCli({
              def,
              input: 'the example.com domain',
              run,
              tools: { ...fileServer.tools, ...fetchServer.tools },
            }),
          );
          expect(outcome.kind).toBe('done');
        } finally {
          await tel.shutdown();
        }
      } finally {
        await fetchServer.close();
      }
    } finally {
      await fileServer.close();
    }
  }, 180_000);
});
